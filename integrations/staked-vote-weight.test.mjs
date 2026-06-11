// staked-vote-weight.test.mjs — offline, node:test. Backlog 5103031115.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  voteWeight, tally, effectiveStake, normalizeWeights, MODELS,
} from './staked-vote-weight.mjs';

test('voteWeight: linear share is proportional to stake', () => {
  assert.equal(voteWeight({ stake: 250, totalStake: 1000, model: 'linear' }), 0.25);
  assert.equal(voteWeight({ stake: 1000, totalStake: 1000, model: 'linear' }), 1);
  assert.equal(voteWeight({ stake: 0, totalStake: 1000, model: 'linear' }), 0);
});

test('voteWeight: damping compresses a whale toward parity (sqrt/log raise its share toward 1)', () => {
  // A whale holding 90% of the pool. The concave curves compress the whole pool, so the
  // whale's SHARE rises toward 1 — i.e. relative to a one-token-one-vote baseline the
  // marginal power of extra stake is damped. log compresses hardest, then sqrt.
  const lin = voteWeight({ stake: 900, totalStake: 1000, model: 'linear' });
  const sq = voteWeight({ stake: 900, totalStake: 1000, model: 'sqrt' });
  const lg = voteWeight({ stake: 900, totalStake: 1000, model: 'log' });
  assert.ok(lin < sq && sq < lg, `expected linear<${sq}<sqrt<${lg}<log, got ${lin}/${sq}/${lg}`);
  assert.ok(lg > 0 && lg <= 1);
});

test('voteWeight: quadratic/log divergence at the small end favors small stakers', () => {
  // A small holder gets a LARGER share under the concave models than under linear,
  // and the strongest boost under log.
  const lin = voteWeight({ stake: 100, totalStake: 1000, model: 'linear' });
  const sq = voteWeight({ stake: 100, totalStake: 1000, model: 'sqrt' });
  const lg = voteWeight({ stake: 100, totalStake: 1000, model: 'log' });
  assert.ok(sq > lin, `small staker sqrt (${sq}) should exceed linear (${lin})`);
  assert.ok(lg > sq, `small staker log (${lg}) should exceed sqrt (${sq})`);
});

test('voteWeight: soft-fails on bad input, never throws', () => {
  assert.equal(voteWeight({ stake: -50, totalStake: 1000 }), 0);
  assert.equal(voteWeight({ stake: NaN, totalStake: 1000 }), 0);
  assert.equal(voteWeight({}), 0);
  assert.equal(voteWeight(), 0);
  assert.equal(voteWeight({ stake: 'abc', totalStake: 'xyz' }), 0);
  // unknown model falls back to linear
  assert.equal(voteWeight({ stake: 500, totalStake: 1000, model: 'wat' }), 0.5);
  // lone staker with no total → 1
  assert.equal(voteWeight({ stake: 500, totalStake: 0 }), 1);
});

test('effectiveStake: linear stake-age maturation', () => {
  assert.equal(effectiveStake({ stake: 1000, ageDays: 0, maxAgeDays: 30 }), 0);
  assert.equal(effectiveStake({ stake: 1000, ageDays: 15, maxAgeDays: 30 }), 500);
  assert.equal(effectiveStake({ stake: 1000, ageDays: 30, maxAgeDays: 30 }), 1000);
  // past full maturity stays capped
  assert.equal(effectiveStake({ stake: 1000, ageDays: 60, maxAgeDays: 30 }), 1000);
  // no window → fully mature
  assert.equal(effectiveStake({ stake: 1000, ageDays: 1, maxAgeDays: 0 }), 1000);
  // soft-fail
  assert.equal(effectiveStake({ stake: -1, ageDays: 10, maxAgeDays: 30 }), 0);
  assert.equal(effectiveStake({}), 0);
  assert.equal(effectiveStake(), 0);
});

test('normalizeWeights: scales to sum 1; handles objects and bare numbers', () => {
  const n = normalizeWeights([{ weight: 1 }, { weight: 3 }]);
  assert.deepEqual(n, [0.25, 0.75]);
  assert.deepEqual(normalizeWeights([2, 2]), [0.5, 0.5]);
  // all-zero → zeros, no NaN
  assert.deepEqual(normalizeWeights([0, 0]), [0, 0]);
  // empty / bad input
  assert.deepEqual(normalizeWeights([]), []);
  assert.deepEqual(normalizeWeights(null), []);
  assert.deepEqual(normalizeWeights('nope'), []);
});

test('tally: simple majority passes with quorum met (linear)', () => {
  const r = tally([
    { stake: 700, choice: 'for' },
    { stake: 300, choice: 'against' },
  ], { model: 'linear', quorum: 0.5, threshold: 0.5 });
  assert.ok(Math.abs(r.forPct - 0.7) < 1e-9);
  assert.ok(Math.abs(r.againstPct - 0.3) < 1e-9);
  assert.equal(r.abstainPct, 0);
  assert.equal(r.totalWeight, 1000);
  assert.equal(r.quorumMet, true);
  assert.equal(r.passed, true);
});

test('tally: fails when for-share is below threshold', () => {
  const r = tally([
    { stake: 400, choice: 'for' },
    { stake: 600, choice: 'against' },
  ], { quorum: 0, threshold: 0.5 });
  assert.equal(r.passed, false);
  assert.equal(r.quorumMet, true);
});

test('tally: pass/fail at a supermajority threshold', () => {
  const votes = [
    { stake: 600, choice: 'for' },
    { stake: 400, choice: 'against' },
  ];
  // 60% for: passes simple majority...
  assert.equal(tally(votes, { threshold: 0.5 }).passed, true);
  // ...but fails a 2/3 supermajority.
  assert.equal(tally(votes, { threshold: 0.6667 }).passed, false);
});

test('tally: quorum gating blocks an otherwise-passing vote', () => {
  // Only abstentions toward turnout besides a tiny for; require high quorum on for+against.
  const r = tally([
    { stake: 50, choice: 'for' },
    { stake: 950, choice: 'abstain' },
  ], { quorum: 0.6, threshold: 0.5, countAbstainInQuorum: false });
  // participating (for+against) = 50 of 1000 = 5% < 60% quorum
  assert.equal(r.quorumMet, false);
  assert.equal(r.passed, false);
});

test('tally: abstain counts toward turnout but not the decision', () => {
  const r = tally([
    { stake: 100, choice: 'for' },
    { stake: 0, choice: 'against' },
    { stake: 900, choice: 'abstain' },
  ], { quorum: 0, threshold: 0.5 });
  // for+against decided weight = 100, all for → passes
  assert.equal(r.passed, true);
  assert.ok(Math.abs(r.abstainPct - 0.9) < 1e-9);
});

test('tally: age maturation changes the outcome', () => {
  // The "against" stake is brand-new (age 0) so it matures to 0 weight → for wins.
  const votes = [
    { stake: 400, choice: 'for', ageDays: 30 },
    { stake: 600, choice: 'against', ageDays: 0 },
  ];
  const withAge = tally(votes, { maxAgeDays: 30, threshold: 0.5 });
  assert.equal(withAge.passed, true, 'new against-stake should be discounted');
  const withoutAge = tally(votes, { threshold: 0.5 });
  assert.equal(withoutAge.passed, false, 'without maturation, against wins');
});

test('tally: quadratic vs linear can flip a whale-vs-crowd vote', () => {
  // One whale AGAINST, many small holders FOR. Linear: whale wins. Sqrt: crowd wins.
  const votes = [
    { stake: 1000, choice: 'against' },
    ...Array.from({ length: 20 }, () => ({ stake: 80, choice: 'for' })), // 1600 total for
  ];
  // Linear: for=1600 vs against=1000 → for already wins; make whale bigger to show flip.
  const v2 = [
    { stake: 2000, choice: 'against' },
    ...Array.from({ length: 30 }, () => ({ stake: 100, choice: 'for' })), // 3000 for
  ];
  const lin = tally(v2, { model: 'linear', threshold: 0.5 });
  const sq = tally(v2, { model: 'sqrt', threshold: 0.5 });
  // linear: for 3000 > against 2000 → passes; sqrt: 30*sqrt(100)=300 vs sqrt(2000)≈44.7 → passes harder
  assert.equal(lin.passed, true);
  assert.equal(sq.passed, true);
  // crowd's share is LARGER under sqrt than linear
  assert.ok(sq.forPct > lin.forPct, `sqrt forPct (${sq.forPct}) > linear (${lin.forPct})`);
});

test('tally: empty / bad input returns a well-formed zeroed result', () => {
  for (const bad of [[], null, undefined, 'x', {}]) {
    const r = tally(bad, { quorum: 0.5 });
    assert.equal(r.forPct, 0);
    assert.equal(r.againstPct, 0);
    assert.equal(r.abstainPct, 0);
    assert.equal(r.totalWeight, 0);
    assert.equal(r.quorumMet, false);
    assert.equal(r.passed, false);
  }
});

test('MODELS is the frozen expected set', () => {
  assert.deepEqual([...MODELS], ['linear', 'sqrt', 'log']);
  assert.ok(Object.isFrozen(MODELS));
});
