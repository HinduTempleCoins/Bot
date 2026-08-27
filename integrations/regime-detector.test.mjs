// regime-detector.test.mjs — OFFLINE tests for the PURE regime classifier.
// No network, no keys, no fs. Deterministic: crafted marketState fixtures → expected regimes,
// hysteresis prevents flip-flop, safety regimes bypass hysteresis, junk soft-fails to UNCERTAIN.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRegime, classifyRaw, computeFactors, REGIMES } from './regime-detector.mjs';

const DAY = 86_400_000, t0 = Date.UTC(2026, 0, 1);
const bars = (fn, n = 30) => Array.from({ length: n }, (_, i) => fn(i));
// a healthy two-sided book with deep (≥ minExec) size on each side
const deepBook = { buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [{ price: 1.01, quantity: 500 }] };

const FLAT = bars((i) => ({ t: t0 + i * DAY, open: 1, high: 1.004, low: 0.996, close: 1, volume: 100 }));
const RIP = bars((i) => { const p = 1 + i * 0.08; return { t: t0 + i * DAY, open: p - 0.02, high: p + 0.02, low: p - 0.03, close: p, volume: 100 }; });
const DUMP = bars((i) => { const p = 3 - i * 0.08; return { t: t0 + i * DAY, open: p + 0.02, high: p + 0.03, low: p - 0.02, close: p, volume: 100 }; });
const OSC = bars((i) => { const p = i % 2 === 0 ? 1.0 : 1.6; return { t: t0 + i * DAY, open: p, high: p + 0.1, low: p - 0.1, close: p, volume: 100 }; });

// ── shape + safety ────────────────────────────────────────────────────────────────────────────
test('returns { regime, factors, confidence } with regime in the canonical set', () => {
  const r = detectRegime({ symbol: 'X', candles: FLAT, ...deepBook });
  assert.ok(REGIMES.includes(r.regime));
  assert.equal(typeof r.confidence, 'number');
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  assert.equal(typeof r.factors, 'object');
});

test('there are exactly 8 canonical regimes', () => {
  assert.equal(REGIMES.length, 8);
});

// ── each regime triggered by a crafted fixture ─────────────────────────────────────────────────
test('RANGE — flat candles, deep two-sided book', () => {
  assert.equal(detectRegime({ symbol: 'X', candles: FLAT, ...deepBook }).regime, 'RANGE');
});

test('TREND_UP — a steady rip, price above slow MA', () => {
  const r = detectRegime({ symbol: 'X', candles: RIP, ...deepBook });
  assert.equal(r.regime, 'TREND_UP');
  assert.ok(r.factors.adx >= 25);
});

test('TREND_DOWN — a steady dump, price below slow MA (falling-knife guard)', () => {
  const r = detectRegime({ symbol: 'X', candles: DUMP, ...deepBook });
  assert.equal(r.regime, 'TREND_DOWN');
});

test('HIGH_VOL — big non-directional oscillation (wide bands, low ADX)', () => {
  const r = detectRegime({ symbol: 'X', candles: OSC, ...deepBook });
  assert.equal(r.regime, 'HIGH_VOL');
  assert.ok(r.factors.adx < 25, 'HIGH_VOL must be non-trending (low ADX)');
});

test('PEG_DISLOCATED — a real, executable, non-suspect arb edge', () => {
  const r = detectRegime({ symbol: 'SWAP.DOGE', candles: FLAT, ...deepBook, arb: { edge: 0.06, execHive: 120, suspect: false } });
  assert.equal(r.regime, 'PEG_DISLOCATED');
});

test('PEG_DISLOCATED does NOT fire when the edge is flagged suspect (anti-rug wins → DEAD)', () => {
  const r = detectRegime({ symbol: 'SWAP.ETH', candles: FLAT, ...deepBook, arb: { edge: 1.39, execHive: 3, suspect: true } });
  assert.equal(r.regime, 'DEAD');
});

test('DEAD — one-sided book (missing ask)', () => {
  const r = detectRegime({ symbol: 'X', candles: FLAT, buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [] });
  assert.equal(r.regime, 'DEAD');
});

test('THIN_BOOK — genuine two-sided book but depth below the executable floor', () => {
  const r = detectRegime({ symbol: 'X', candles: FLAT, buyBook: [{ price: 0.99, quantity: 3 }], sellBook: [{ price: 1.01, quantity: 3 }] });
  assert.equal(r.regime, 'THIN_BOOK');
  assert.ok(r.factors.depthHive > 0 && r.factors.depthHive < 20);
});

test('UNCERTAIN — no usable data at all', () => {
  assert.equal(detectRegime({ symbol: 'X' }).regime, 'UNCERTAIN');
});

// ── anti-whipsaw hysteresis ─────────────────────────────────────────────────────────────────────
test('hysteresis prevents flip-flop: a single divergent read HOLDS the prior regime', () => {
  // prior = RANGE (well established); one TREND_UP read should NOT switch (minDwell 2).
  const prior = { regime: 'RANGE', dwell: 5, candidate: 'RANGE', candidateStreak: 0 };
  const r = detectRegime({ symbol: 'X', candles: RIP, ...deepBook }, { prior, minDwell: 2 });
  assert.equal(r.candidate, 'TREND_UP', 'the instantaneous candidate is TREND_UP');
  assert.equal(r.regime, 'RANGE', 'but the active regime is held until it persists');
  assert.equal(r.switched, false);
});

test('hysteresis lets a regime switch once the new candidate persists minDwell reads', () => {
  const step1 = detectRegime({ symbol: 'X', candles: RIP, ...deepBook },
    { prior: { regime: 'RANGE', dwell: 5, candidate: 'RANGE', candidateStreak: 0 }, minDwell: 2 });
  assert.equal(step1.regime, 'RANGE');
  const step2 = detectRegime({ symbol: 'X', candles: RIP, ...deepBook }, { prior: step1.hysteresis, minDwell: 2 });
  assert.equal(step2.regime, 'TREND_UP');
  assert.equal(step2.switched, true);
});

test('safety regime DEAD bypasses hysteresis — engages immediately', () => {
  const prior = { regime: 'RANGE', dwell: 5, candidate: 'RANGE', candidateStreak: 0 };
  const r = detectRegime({ symbol: 'X', candles: FLAT, buyBook: [{ price: 0.99, quantity: 500 }], sellBook: [] }, { prior, minDwell: 5 });
  assert.equal(r.regime, 'DEAD');
  assert.equal(r.switched, true);
});

test('steady state increments the dwell counter', () => {
  const a = detectRegime({ symbol: 'X', candles: FLAT, ...deepBook }, { prior: { regime: 'RANGE', dwell: 2, candidate: 'RANGE', candidateStreak: 0 } });
  assert.equal(a.regime, 'RANGE');
  assert.equal(a.dwell, 3);
});

// ── soft-fail: never throws ──────────────────────────────────────────────────────────────────────
test('junk input never throws and yields a safe regime', () => {
  for (const junk of [null, undefined, 42, 'x', { candles: 'nope' }, { buyBook: [{ price: {}, quantity: NaN }] }, { candles: [null, { close: 'x' }] }]) {
    const r = detectRegime(junk);
    assert.ok(REGIMES.includes(r.regime), `junk ${JSON.stringify(junk)} → ${r.regime}`);
  }
});

test('classifyRaw + computeFactors are exported and pure (same input → same output)', () => {
  const ms = { symbol: 'X', candles: RIP, ...deepBook };
  const f1 = computeFactors(ms), f2 = computeFactors(ms);
  assert.deepEqual(f1, f2);
  assert.equal(classifyRaw(f1).regime, classifyRaw(f2).regime);
});
