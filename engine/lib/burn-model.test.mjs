import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBurn,
  burnSchedule,
  projectSupply,
  burnToMintRatio,
  summarize,
} from './burn-model.mjs';

// ---- applyBurn -------------------------------------------------------------

test('applyBurn: subtracts and conserves', () => {
  const r = applyBurn(1000, 250);
  assert.equal(r.ok, true);
  assert.equal(r.supply, 750);
});

test('applyBurn: zero burn is identity', () => {
  assert.deepEqual(applyBurn(1000, 0), { ok: true, supply: 1000 });
});

test('applyBurn: rejects over-burn', () => {
  const r = applyBurn(100, 200);
  assert.equal(r.ok, false);
  assert.match(r.error, /over-burn/);
});

test('applyBurn: rejects negative supply and amount', () => {
  assert.equal(applyBurn(-1, 0).ok, false);
  assert.equal(applyBurn(100, -5).ok, false);
});

test('applyBurn: rejects non-numeric / NaN / Infinity, never throws', () => {
  assert.equal(applyBurn('abc', 5).ok, false);
  assert.equal(applyBurn(100, NaN).ok, false);
  assert.equal(applyBurn(Infinity, 5).ok, false);
  assert.equal(applyBurn(true, 1).ok, false);
});

// ---- burnSchedule ----------------------------------------------------------

test('burnSchedule: fixed per-period burn, conserving rows', () => {
  const r = burnSchedule({ initialSupply: 1000, burnPerPeriod: 100, periods: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.schedule.length, 3);
  assert.deepEqual(r.schedule[0], {
    period: 1, burned: 100, remaining: 900, cumulativeBurned: 100, pctBurned: 10,
  });
  const last = r.schedule[2];
  assert.equal(last.remaining, 700);
  assert.equal(last.cumulativeBurned, 300);
  assert.equal(last.pctBurned, 30);
});

test('burnSchedule: clamps final burn and stops when supply exhausted (no over-burn)', () => {
  const r = burnSchedule({ initialSupply: 250, burnPerPeriod: 100, periods: 10 });
  assert.equal(r.ok, true);
  // 100, 100, 50 -> exhausted after 3 periods; never negative
  assert.equal(r.schedule.length, 3);
  assert.equal(r.schedule[2].burned, 50);
  assert.equal(r.schedule[2].remaining, 0);
  for (const row of r.schedule) assert.ok(row.remaining >= 0);
});

test('burnSchedule: monotonic remaining decreases, cumulative increases', () => {
  const r = burnSchedule({ initialSupply: 1000, burnPerPeriod: 90, periods: 8 });
  for (let i = 1; i < r.schedule.length; i++) {
    assert.ok(r.schedule[i].remaining <= r.schedule[i - 1].remaining);
    assert.ok(r.schedule[i].cumulativeBurned >= r.schedule[i - 1].cumulativeBurned);
  }
});

test('burnSchedule: zero burn per period -> no decay', () => {
  const r = burnSchedule({ initialSupply: 1000, burnPerPeriod: 0, periods: 5 });
  assert.equal(r.ok, true);
  for (const row of r.schedule) {
    assert.equal(row.burned, 0);
    assert.equal(row.remaining, 1000);
    assert.equal(row.pctBurned, 0);
  }
});

test('burnSchedule: soft-fail on bad inputs', () => {
  assert.equal(burnSchedule({ initialSupply: 'x', burnPerPeriod: 1, periods: 1 }).ok, false);
  assert.equal(burnSchedule({ initialSupply: 100, burnPerPeriod: -1, periods: 1 }).ok, false);
  assert.equal(burnSchedule({ initialSupply: 100, burnPerPeriod: 1, periods: NaN }).ok, false);
  assert.equal(burnSchedule().ok, false);
});

// ---- projectSupply (geometric decay) ---------------------------------------

test('projectSupply: geometric decay matches (1-r)^p', () => {
  const r = projectSupply({ initialSupply: 1000, burnRatePct: 10, periods: 3 });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.table[0].remaining - 900) < 1e-9);
  assert.ok(Math.abs(r.table[1].remaining - 810) < 1e-9);
  assert.ok(Math.abs(r.table[2].remaining - 729) < 1e-9);
});

test('projectSupply: decay monotonicity (remaining strictly decreasing for r>0)', () => {
  const r = projectSupply({ initialSupply: 1000, burnRatePct: 25, periods: 10 });
  for (let i = 1; i < r.table.length; i++) {
    assert.ok(r.table[i].remaining < r.table[i - 1].remaining);
    assert.ok(r.table[i].cumulativeBurned > r.table[i - 1].cumulativeBurned);
  }
});

test('projectSupply: zero-rate identity', () => {
  const r = projectSupply({ initialSupply: 1000, burnRatePct: 0, periods: 5 });
  assert.equal(r.ok, true);
  for (const row of r.table) {
    assert.equal(row.burned, 0);
    assert.equal(row.remaining, 1000);
    assert.equal(row.pctBurned, 0);
  }
});

test('projectSupply: cumulativeBurned + remaining conserves initial', () => {
  const r = projectSupply({ initialSupply: 1000, burnRatePct: 10, periods: 6 });
  for (const row of r.table) {
    assert.ok(Math.abs(row.remaining + row.cumulativeBurned - 1000) < 1e-9);
  }
});

test('projectSupply: soft-fail on bad inputs', () => {
  assert.equal(projectSupply({ initialSupply: -1, burnRatePct: 10, periods: 1 }).ok, false);
  assert.equal(projectSupply({ initialSupply: 100, burnRatePct: 'x', periods: 1 }).ok, false);
  assert.equal(projectSupply({ initialSupply: 100, burnRatePct: 10, periods: Infinity }).ok, false);
});

// ---- burnToMintRatio -------------------------------------------------------

test('burnToMintRatio: minted = burned * rate', () => {
  assert.deepEqual(burnToMintRatio({ burned: 1000, mintRate: 0.5 }), { ok: true, minted: 500 });
  assert.deepEqual(burnToMintRatio({ burned: 200, mintRate: 2 }), { ok: true, minted: 400 });
});

test('burnToMintRatio: zero rate -> zero minted', () => {
  assert.deepEqual(burnToMintRatio({ burned: 1000, mintRate: 0 }), { ok: true, minted: 0 });
});

test('burnToMintRatio: soft-fail on bad inputs', () => {
  assert.equal(burnToMintRatio({ burned: -1, mintRate: 1 }).ok, false);
  assert.equal(burnToMintRatio({ burned: 1000, mintRate: -1 }).ok, false);
  assert.equal(burnToMintRatio({ burned: 'x', mintRate: 1 }).ok, false);
  assert.equal(burnToMintRatio().ok, false);
});

// ---- summarize -------------------------------------------------------------

test('summarize: rolls up a fixed schedule', () => {
  const sched = burnSchedule({ initialSupply: 1000, burnPerPeriod: 100, periods: 5 }).schedule;
  const s = summarize(sched);
  assert.equal(s.ok, true);
  assert.equal(s.totalBurned, 500);
  assert.equal(s.finalSupply, 500);
  assert.equal(s.finalPctBurned, 50);
});

test('summarize: half-life is first period crossing 50% burned', () => {
  // 100/period of 1000 -> cumulative hits 500 (=half) at period 5
  const sched = burnSchedule({ initialSupply: 1000, burnPerPeriod: 100, periods: 10 }).schedule;
  const s = summarize(sched);
  assert.equal(s.halfLifePeriods, 5);
});

test('summarize: half-life of geometric 50%/period decay is period 1', () => {
  const table = projectSupply({ initialSupply: 1000, burnRatePct: 50, periods: 4 }).table;
  const s = summarize(table);
  // After period 1, 500 burned = exactly half
  assert.equal(s.halfLifePeriods, 1);
});

test('summarize: half-life null when never reaching 50% burned', () => {
  const sched = burnSchedule({ initialSupply: 1000, burnPerPeriod: 100, periods: 3 }).schedule;
  const s = summarize(sched); // only 300 burned, never half
  assert.equal(s.halfLifePeriods, null);
});

test('summarize: empty schedule is a clean zero, never throws', () => {
  assert.deepEqual(summarize([]), {
    ok: true, totalBurned: 0, finalSupply: 0, finalPctBurned: 0, halfLifePeriods: null,
  });
});

test('summarize: soft-fail on non-array', () => {
  assert.equal(summarize(null).ok, false);
  assert.equal(summarize('nope').ok, false);
});
