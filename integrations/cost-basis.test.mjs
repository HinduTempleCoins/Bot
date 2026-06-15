// cost-basis.test.mjs — OFFLINE: VWAP cost basis across the operator accounts from injected
// market history. No network — getHistory is a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyFills, costBasis, costBasisMap, BASIS_ACCOUNTS } from './cost-basis.mjs';

// fake HE history: SPS bought ONLY by the treasury (kalivankush), then transferred to angelicalist.
// angelicalist itself has no SPS buy → basis must still resolve from the treasury's history.
const HISTORY = {
  kalivankush: [
    { operation: 'market_buy', symbol: 'SPS', quantityTokens: '649.56877948', quantityHive: '42.81311723', timestamp: 1 },
    { operation: 'market_buy', symbol: 'SPS', quantityTokens: '253.32875086', quantityHive: '16.69688277', timestamp: 1 },
    { operation: 'market_buy', symbol: 'DEC', quantityTokens: '1000', quantityHive: '5', timestamp: 1 },
  ],
  angelicalist: [
    { operation: 'market_buy', symbol: 'DEC', quantityTokens: '1000', quantityHive: '7', timestamp: 2 },
  ],
};
const fakeHistory = async (account, { offset = 0 } = {}) => (offset === 0 ? (HISTORY[account] || []) : []);

test('BASIS_ACCOUNTS defaults to the treasury + executor', () => {
  assert.deepEqual(BASIS_ACCOUNTS, ['angelicalist', 'kalivankush']);
});

test('buyFills returns only market_buy fills, filtered by symbol, never throws on a bad page', async () => {
  const f = await buyFills('kalivankush', { getHistory: fakeHistory, symbol: 'SPS' });
  assert.equal(f.length, 2);
  assert.equal(f[0].symbol, 'SPS');
  // failing history → empty, not a throw
  const boom = await buyFills('x', { getHistory: async () => { throw new Error('net'); } });
  assert.deepEqual(boom, []);
});

test('costBasis VWAPs across BOTH accounts (treasury buy + executor holds it)', async () => {
  const cb = await costBasis('SPS', { getHistory: fakeHistory });
  // (42.81311723 + 16.69688277) / (649.56877948 + 253.32875086) = 59.51 / 902.897... = 0.06591 HIVE/SPS
  assert.equal(cb.symbol, 'SPS');
  assert.equal(cb.basisHive, 0.06591003);
  assert.equal(cb.tokensBought, 902.89753034);
  assert.equal(cb.hiveSpent, 59.51);
  assert.equal(cb.fills, 2);
});

test('costBasis aggregates the SAME token bought by different accounts at different prices', async () => {
  // DEC: 1000 @ 5 HIVE (kali) + 1000 @ 7 HIVE (angelicalist) = 12 HIVE / 2000 = 0.006 HIVE/DEC
  const cb = await costBasis('DEC', { getHistory: fakeHistory });
  assert.equal(cb.basisHive, 0.006);
  assert.equal(cb.tokensBought, 2000);
  assert.equal(cb.fills, 2);
});

test('costBasis returns null for a token with no recorded buy (issued/airdropped → caller falls back)', async () => {
  const cb = await costBasis('VKBT', { getHistory: fakeHistory });
  assert.equal(cb, null);
  assert.equal(await costBasis('', { getHistory: fakeHistory }), null);
});

test('costBasisMap maps symbols→basis and omits the ones with no buy', async () => {
  const m = await costBasisMap(['SPS', 'DEC', 'VKBT'], { getHistory: fakeHistory });
  assert.equal(m.get("SPS"), 0.06591003);
  assert.equal(m.get('DEC'), 0.006);
  assert.equal(m.has('VKBT'), false, 'no buy → absent, never a fake zero basis');
});
