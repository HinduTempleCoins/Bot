import { test } from 'node:test';
import assert from 'node:assert';
import { POOLS, pull, disclosedOdds, newPullState } from './gacha.mjs';
import { RARITY } from './economy.mjs';

// a deterministic rng that hands back a fixed queue of uniforms, so a pull is reproducible.
function fixedRng(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

test('every pool publishes odds that sum to 1', () => {
  for (const [key, pool] of Object.entries(POOLS)) {
    const sum = Object.values(pool.odds).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `pool "${key}" odds sum to ${sum}, expected 1`);
  }
});

test('disclosedOdds returns the published table + pity rule', () => {
  const { odds, pity } = disclosedOdds(POOLS.standard);
  assert.deepEqual(odds, {
    [RARITY.COMMON]: 0.79,
    [RARITY.UNCOMMON]: 0.15,
    [RARITY.RARE]: 0.05,
    [RARITY.EPIC]: 0.009,
    [RARITY.LEGENDARY]: 0.001,
  });
  assert.deepEqual(pity, { rarity: RARITY.LEGENDARY, after: 40 });
  // sums to 1, so disclosedOdds did not throw.
  const sum = Object.values(odds).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('deterministic pull with fixed rng — low u → Common, high u → Legendary', () => {
  // u = 0 falls in the first (Common) bucket.
  const low = pull(POOLS.standard, newPullState(), { rng: fixedRng([0]) });
  assert.equal(low.result.rarity, RARITY.COMMON);
  assert.equal(low.result.pity, false);
  assert.equal(low.result.mintIntent.dryRun, true);
  assert.equal(low.result.mintIntent.action, 'mint');
  assert.equal(low.result.mintIntent.rarity, RARITY.COMMON);
  // a Common does not meet the Legendary pity tier → counter advances.
  assert.equal(low.newState.sinceRare, 1);

  // u just under 1 falls in the last (Legendary) bucket.
  const high = pull(POOLS.standard, newPullState(), { rng: fixedRng([0.9999999]) });
  assert.equal(high.result.rarity, RARITY.LEGENDARY);
  // a natural Legendary resets the counter.
  assert.equal(high.newState.sinceRare, 0);
});

test('pity guarantees the rare tier by the disclosed threshold', () => {
  const { after, rarity } = POOLS.standard.pity;
  let state = newPullState();
  // force only Commons (u = 0) for the pulls leading up to the pity threshold.
  let got = [];
  for (let i = 0; i < after; i++) {
    const out = pull(POOLS.standard, state, { rng: fixedRng([0]) });
    state = out.newState;
    got.push(out.result);
  }
  const last = got[after - 1];
  assert.equal(last.result === undefined ? last.rarity : last.rarity, rarity,
    `pull #${after} should be the guaranteed ${rarity}`);
  assert.equal(last.pity, true, 'the guaranteed pull is flagged as a pity drop');
  // before the threshold, every forced-Common pull stayed Common.
  for (let i = 0; i < after - 1; i++) {
    assert.equal(got[i].rarity, RARITY.COMMON, `pull #${i + 1} should still be Common`);
  }
  // the pity drop resets the counter.
  assert.equal(state.sinceRare, 0);
});

test('invalid pool (odds not summing to 1) throws', () => {
  const bad = { name: 'bad', odds: { [RARITY.COMMON]: 0.5, [RARITY.RARE]: 0.2 } };
  assert.throws(() => disclosedOdds(bad), /sum to 1/);
  assert.throws(() => pull(bad), /sum to 1/);
});
