import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  burnWeight,
  minerShare,
  rewardFor,
  projectRewards,
  hashrateEquivalent,
  summarize,
} from './proof-of-burn.mjs';

test('esc escapes HTML metacharacters and coerces non-strings', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('burnWeight with no half-life returns full amount (no decay)', () => {
  assert.equal(burnWeight({ amount: 100 }), 100);
  assert.equal(burnWeight({ amount: 100, ageBlocks: 9999 }), 100);
  assert.equal(burnWeight({ amount: 100, decayHalfLifeBlocks: 0, ageBlocks: 50 }), 100);
});

test('burnWeight decays by exactly one half-life', () => {
  assert.equal(burnWeight({ amount: 100, decayHalfLifeBlocks: 10, ageBlocks: 10 }), 50);
  assert.equal(burnWeight({ amount: 100, decayHalfLifeBlocks: 10, ageBlocks: 20 }), 25);
  assert.equal(burnWeight({ amount: 100, decayHalfLifeBlocks: 10, ageBlocks: 0 }), 100);
});

test('burnWeight is monotone non-increasing in age and never negative/NaN', () => {
  let prev = Infinity;
  for (let age = 0; age <= 100; age += 5) {
    const w = burnWeight({ amount: 1000, decayHalfLifeBlocks: 25, ageBlocks: age });
    assert.ok(Number.isFinite(w), `finite at age ${age}`);
    assert.ok(w >= 0, `non-negative at age ${age}`);
    assert.ok(w <= 1000, `never exceeds amount at age ${age}`);
    assert.ok(w <= prev, `non-increasing at age ${age}`);
    prev = w;
  }
});

test('burnWeight soft-fails bad/negative/missing inputs to 0 or amount', () => {
  assert.equal(burnWeight(), 0);
  assert.equal(burnWeight({}), 0);
  assert.equal(burnWeight({ amount: -5 }), 0);
  assert.equal(burnWeight({ amount: NaN }), 0);
  assert.equal(burnWeight({ amount: 'abc' }), 0);
  assert.equal(burnWeight({ amount: Infinity }), 0);
  // negative age coerces to 0 => no decay
  assert.equal(burnWeight({ amount: 80, decayHalfLifeBlocks: 10, ageBlocks: -5 }), 80);
});

test('minerShare returns clamped [0,1] fraction', () => {
  assert.equal(minerShare({ yourBurnWeight: 25, totalBurnWeight: 100 }), 0.25);
  assert.equal(minerShare({ yourBurnWeight: 100, totalBurnWeight: 100 }), 1);
  // yours > total clamps to 1
  assert.equal(minerShare({ yourBurnWeight: 500, totalBurnWeight: 100 }), 1);
});

test('minerShare returns 0 when total <= 0 or inputs bad', () => {
  assert.equal(minerShare({ yourBurnWeight: 10, totalBurnWeight: 0 }), 0);
  assert.equal(minerShare({ yourBurnWeight: 10, totalBurnWeight: -1 }), 0);
  assert.equal(minerShare(), 0);
  assert.equal(minerShare({}), 0);
  assert.equal(minerShare({ yourBurnWeight: NaN, totalBurnWeight: 100 }), 0);
});

test('rewardFor computes share * rewardPerPeriod', () => {
  assert.equal(rewardFor({ yourBurnWeight: 25, totalBurnWeight: 100, rewardPerPeriod: 1000 }), 250);
  assert.equal(rewardFor({ yourBurnWeight: 0, totalBurnWeight: 100, rewardPerPeriod: 1000 }), 0);
  assert.equal(rewardFor({ yourBurnWeight: 50, totalBurnWeight: 100, rewardPerPeriod: 0 }), 0);
  assert.equal(rewardFor(), 0);
  assert.equal(rewardFor({ yourBurnWeight: 50, totalBurnWeight: 0, rewardPerPeriod: 1000 }), 0);
});

test('projectRewards builds per-period payouts with running total', () => {
  const proj = projectRewards({
    yourBurnWeight: 25,
    totalBurnWeight: 100,
    rewardPerPeriod: 1000,
    periods: 3,
  });
  assert.deepEqual(proj, [
    { period: 1, payout: 250, runningTotal: 250 },
    { period: 2, payout: 250, runningTotal: 500 },
    { period: 3, payout: 250, runningTotal: 750 },
  ]);
});

test('projectRewards soft-fails periods <= 0 / bad to empty array', () => {
  assert.deepEqual(projectRewards({ yourBurnWeight: 25, totalBurnWeight: 100, rewardPerPeriod: 1000, periods: 0 }), []);
  assert.deepEqual(projectRewards({ yourBurnWeight: 25, totalBurnWeight: 100, rewardPerPeriod: 1000, periods: -3 }), []);
  assert.deepEqual(projectRewards({ periods: 2 }), [
    { period: 1, payout: 0, runningTotal: 0 },
    { period: 2, payout: 0, runningTotal: 0 },
  ]);
  assert.deepEqual(projectRewards(), []);
});

test('projectRewards floors fractional period counts', () => {
  const proj = projectRewards({ yourBurnWeight: 1, totalBurnWeight: 1, rewardPerPeriod: 10, periods: 2.9 });
  assert.equal(proj.length, 2);
});

test('hashrateEquivalent scales burn weight by unitsPerWeight', () => {
  assert.equal(hashrateEquivalent(50), 50);
  assert.equal(hashrateEquivalent(50, 4), 200);
  assert.equal(hashrateEquivalent(0, 100), 0);
  assert.equal(hashrateEquivalent(-5), 0);
  assert.equal(hashrateEquivalent('bad'), 0);
  assert.equal(hashrateEquivalent(50, -1), 0);
});

test('summarize produces deterministic summary from a projection', () => {
  const proj = projectRewards({ yourBurnWeight: 25, totalBurnWeight: 100, rewardPerPeriod: 1000, periods: 4 });
  assert.deepEqual(summarize(proj), { periods: 4, total: 1000, avgPerPeriod: 250 });
});

test('summarize soft-fails non-array / empty to zeros', () => {
  assert.deepEqual(summarize([]), { periods: 0, total: 0, avgPerPeriod: 0 });
  assert.deepEqual(summarize(null), { periods: 0, total: 0, avgPerPeriod: 0 });
  assert.deepEqual(summarize(undefined), { periods: 0, total: 0, avgPerPeriod: 0 });
  assert.deepEqual(summarize('nope'), { periods: 0, total: 0, avgPerPeriod: 0 });
});

test('summarize ignores malformed rows', () => {
  const proj = [{ payout: 10 }, null, { payout: 'bad' }, { payout: 30 }];
  assert.deepEqual(summarize(proj), { periods: 4, total: 40, avgPerPeriod: 10 });
});

test('end-to-end: burn -> weight -> share -> projection -> summary', () => {
  const yourBurnWeight = burnWeight({ amount: 200, decayHalfLifeBlocks: 100, ageBlocks: 100 }); // 100
  const totalBurnWeight = 400;
  assert.equal(yourBurnWeight, 100);
  assert.equal(minerShare({ yourBurnWeight, totalBurnWeight }), 0.25);
  const proj = projectRewards({ yourBurnWeight, totalBurnWeight, rewardPerPeriod: 800, periods: 5 });
  assert.equal(proj[4].runningTotal, 1000);
  assert.deepEqual(summarize(proj), { periods: 5, total: 1000, avgPerPeriod: 200 });
});
