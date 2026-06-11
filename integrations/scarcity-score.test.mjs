// scarcity-score.test.mjs — offline tests for the pure scarcity scorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scarcityScore, supplyPerHolder, compare } from './scarcity-score.mjs';

// A defensible VKBT-like token: tight supply, broad holders, real self-control, low concentration.
const VKBT = { name: 'VKBT-like', circulatingSupply: 750_000, uniqueHolders: 12_000, ownerControlledPct: 40, top10Percent: 12 };
// A weak CURE-like token: huge float, almost no holders, no self-control, captured by top-10.
const CURE = { name: 'CURE-like', circulatingSupply: 850_000_000_000, uniqueHolders: 40, ownerControlledPct: 5, top10Percent: 78 };

test('VKBT-like scores higher than CURE-like', () => {
  const v = scarcityScore(VKBT);
  const c = scarcityScore(CURE);
  assert.ok(v.score > c.score, `expected ${v.score} > ${c.score}`);
});

test('result shape is well-formed', () => {
  const r = scarcityScore(VKBT);
  assert.ok(typeof r.score === 'number' && r.score >= 0 && r.score <= 100);
  assert.ok(['EXTREME', 'HIGH', 'MODERATE', 'LOW'].includes(r.tier));
  assert.ok(r.signals && typeof r.signals.supplyTightness === 'number');
  assert.ok(typeof r.signals.holderBreadth === 'number');
  assert.ok(typeof r.signals.controlAdvantage === 'number');
  assert.ok(typeof r.signals.concentrationRisk === 'number');
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0);
});

test('tiers map across the spectrum', () => {
  const best = scarcityScore({ circulatingSupply: 1, uniqueHolders: 1_000_000, ownerControlledPct: 100, top10Percent: 0 });
  assert.equal(best.tier, 'EXTREME');
  assert.ok(best.score >= 80);

  const worst = scarcityScore({ circulatingSupply: 1e15, uniqueHolders: 1, ownerControlledPct: 0, top10Percent: 100 });
  assert.equal(worst.tier, 'LOW');
  assert.ok(worst.score < 35);
});

test('monotonic: tighter supply never lowers score', () => {
  const base = { uniqueHolders: 5000, ownerControlledPct: 30, top10Percent: 20 };
  const loose = scarcityScore({ ...base, circulatingSupply: 100_000_000 });
  const tight = scarcityScore({ ...base, circulatingSupply: 100_000 });
  assert.ok(tight.score >= loose.score);
});

test('monotonic: more holders never lowers score', () => {
  const base = { circulatingSupply: 2_000_000, ownerControlledPct: 30, top10Percent: 20 };
  const few = scarcityScore({ ...base, uniqueHolders: 100 });
  const many = scarcityScore({ ...base, uniqueHolders: 40_000 });
  assert.ok(many.score >= few.score);
});

test('monotonic: more owner control never lowers score', () => {
  const base = { circulatingSupply: 2_000_000, uniqueHolders: 5000, top10Percent: 20 };
  const lo = scarcityScore({ ...base, ownerControlledPct: 10 });
  const hi = scarcityScore({ ...base, ownerControlledPct: 70 });
  assert.ok(hi.score >= lo.score);
});

test('monotonic: more top-10 concentration never raises score', () => {
  const base = { circulatingSupply: 2_000_000, uniqueHolders: 5000, ownerControlledPct: 30 };
  const lowConc = scarcityScore({ ...base, top10Percent: 5 });
  const highConc = scarcityScore({ ...base, top10Percent: 90 });
  assert.ok(highConc.score <= lowConc.score);
});

test('deterministic: same input → same output', () => {
  const a = scarcityScore(VKBT);
  const b = scarcityScore(VKBT);
  assert.deepEqual(a, b);
});

test('supplyPerHolder happy path', () => {
  assert.equal(supplyPerHolder(1_000_000, 1000), 1000);
  assert.equal(supplyPerHolder(750_000, 12_000), 62.5);
});

test('supplyPerHolder soft-fails on bad inputs (never NaN/Infinity/throw)', () => {
  assert.equal(supplyPerHolder(1000, 0), 0);
  assert.equal(supplyPerHolder(0, 1000), 0);
  assert.equal(supplyPerHolder(NaN, 1000), 0);
  assert.equal(supplyPerHolder(1000, -5), 0);
  assert.equal(supplyPerHolder(Infinity, 1000), 0);
});

test('soft-fail: non-finite / negative inputs clamp and tag a reason, never throw', () => {
  const r = scarcityScore({ circulatingSupply: -100, uniqueHolders: NaN, ownerControlledPct: Infinity, top10Percent: -5 });
  assert.ok(typeof r.score === 'number' && Number.isFinite(r.score));
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(r.reasons.some((x) => /not finite|negative/.test(x)));
});

test('soft-fail: missing input object does not throw', () => {
  const r1 = scarcityScore(undefined);
  const r2 = scarcityScore(null);
  const r3 = scarcityScore(42);
  for (const r of [r1, r2, r3]) {
    assert.ok(Number.isFinite(r.score));
    assert.ok(Array.isArray(r.reasons));
  }
});

test('clamp: pct over 100 clamped and tagged', () => {
  const r = scarcityScore({ circulatingSupply: 1_000_000, uniqueHolders: 5000, ownerControlledPct: 250, top10Percent: 999 });
  assert.equal(r.signals.controlAdvantage, 1);
  assert.equal(r.signals.concentrationRisk, 1);
  assert.ok(r.reasons.some((x) => /clamped to 100/.test(x)));
});

test('compare(array) returns sorted-by-score with verdicts; VKBT first', () => {
  const out = compare([CURE, VKBT]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'VKBT-like');
  assert.equal(out[1].name, 'CURE-like');
  assert.ok(out[0].score >= out[1].score);
  assert.ok(out[0].verdict.includes('VKBT-like'));
  assert.ok(/EXTREME|HIGH|MODERATE|LOW/.test(out[0].verdict));
});

test('compare(a, b) two-arg form works', () => {
  const out = compare(VKBT, CURE);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'VKBT-like');
});

test('compare soft-fails on non-array / empty', () => {
  assert.deepEqual(compare(), []);
  assert.deepEqual(compare(null), []);
  const out = compare([null, undefined, 5]);
  assert.equal(out.length, 3);
  out.forEach((o) => assert.ok(Number.isFinite(o.score)));
});

test('compare ties break stably by name', () => {
  const t = { circulatingSupply: 2_000_000, uniqueHolders: 5000, ownerControlledPct: 30, top10Percent: 20 };
  const out = compare([{ ...t, name: 'zebra' }, { ...t, name: 'alpha' }]);
  assert.equal(out[0].score, out[1].score);
  assert.equal(out[0].name, 'alpha');
});
