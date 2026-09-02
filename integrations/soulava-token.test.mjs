// soulava-token.test.mjs — offline. `node --test`. SOULAVA is a PRANA (EVM) token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOULAVA, toWei, mintCall, distributionPlan, announcement, status } from './soulava-token.mjs';

test('SOULAVA is a PRANA ERC-20 (18 decimals), pairs with MWALI', () => {
  assert.equal(SOULAVA.chain, 'PRANA');
  assert.equal(SOULAVA.symbol, 'SOUL');
  assert.equal(SOULAVA.decimals, 18);
  assert.equal(SOULAVA.pairsWith, 'MWALI');
});

test('toWei converts SOUL (6dp accounting) to 18-decimal base units', () => {
  assert.equal(toWei(1).toString(), '1000000000000000000');
  assert.equal(toWei(2.5).toString(), '2500000000000000000');
  assert.equal(toWei(0.000001).toString(), '1000000000000');    // 1 micro-SOUL
  assert.equal(toWei(0).toString(), '0');
});

test('mintCall is a distributor.mint(to, wei) descriptor', () => {
  const c = mintCall('0x1111111111111111111111111111111111111111', 3);
  assert.equal(c.fn, 'mint');
  assert.deepEqual(c.args, ['0x1111111111111111111111111111111111111111', '3000000000000000000']);
  assert.equal(c.token, 'SOUL');
});

test('distributionPlan maps earned SOUL → PRANA mint calls; unresolved addresses are skipped, not zeroed', () => {
  const ledger = { delegators: [
    { account: 'whale', earned: 10 },
    { account: 'minnow', earned: 2 },
    { account: 'nowallet', earned: 5 },
    { account: 'zero', earned: 0 },
  ] };
  const addrs = { whale: '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa', minnow: '0xBbBbBBBbbBBBbbBBbbbbbBBBBbbbbbBBBBbBbBBB' };
  const plan = distributionPlan(ledger, (a) => addrs[a] || null);
  assert.equal(plan.chain, 'PRANA');
  assert.equal(plan.mints.length, 2);                           // whale + minnow
  assert.equal(plan.mints[0].args[1], '10000000000000000000');
  assert.deepEqual(plan.unresolved.map((u) => u.account), ['nowallet']);  // earned>0 but no address
  assert.ok(!plan.mints.some((m) => m.account === 'zero'));      // zero earned → no mint
});

test('announcement says PRANA + KulaSwap, honest status', () => {
  const a = announcement({ pool: 'hathor' });
  assert.match(a, /not minted yet|design/i);
  assert.match(a, /PRANA/);
  assert.match(a, /KulaSwap/);
  assert.match(a, /MWALI/);
  assert.match(announcement({ minted: true }), /is live/i);
});

test('status: ERC-20 on PRANA, pairs with MWALI', () => {
  assert.deepEqual(status(), { name: 'SOULAVA', symbol: 'SOUL', kind: 'ERC-20', chain: 'PRANA', status: 'design', pairsWith: 'MWALI', role: 'delegation-mining reward' });
});
