// market-depth.test.mjs — verifies the ownership/whale-concentration CALC end-to-end by feeding
// canned HIVE-Engine RPC responses through he-client's injected fetch. (Task #6: confirm the
// Hive-Engine calcs are correct.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch } from './he-client.mjs';
import { ownership } from './market-depth.mjs';

// Build a fake fetch that dispatches on the JSON-RPC body's (contract, table).
function fakeHe(tables) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const { contract, table } = body.params;
    const rows = (tables[`${contract}/${table}`] || []);
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result: rows }) };
  };
}

test('ownership: issuerPct / top3 / outsideHolders / last computed correctly', async () => {
  __setFetch(
    fakeHe({
      'tokens/tokens': [{ symbol: 'VKBT', issuer: 'kalivankush', circulatingSupply: '1000' }],
      'tokens/balances': [
        { account: 'kalivankush', balance: '600', stake: '0' },
        { account: 'alice', balance: '200' },
        { account: 'bob', balance: '100' },
        { account: 'carol', balance: '0.5' }, // < 1 → not an "outside holder"
      ],
      'market/metrics': [{ lastPrice: '0.05' }],
    }),
  );
  const o = await ownership('VKBT');
  assert.equal(o.symbol, 'VKBT');
  assert.equal(o.issuer, 'kalivankush');
  assert.equal(o.supply, 1000);
  assert.equal(o.issuerPct, 60.0); // 600/1000
  assert.equal(o.top3, 90.0); // (600+200+100)/1000
  assert.equal(o.outsideHolders, 2); // alice + bob (carol's 0.5 < 1 excluded)
  assert.equal(o.last, 0.05);
  __setFetch(null);
});

test('ownership: stake is added to balance for issuer concentration', async () => {
  // market-depth.mjs measures issuer concentration against the hardcoded ISSUER account.
  __setFetch(
    fakeHe({
      'tokens/tokens': [{ symbol: 'X', issuer: 'kalivankush', circulatingSupply: '100' }],
      'tokens/balances': [{ account: 'kalivankush', balance: '10', stake: '40' }], // (10+40)/100 = 50%
      'market/metrics': [{ lastPrice: '1' }],
    }),
  );
  const o = await ownership('X');
  assert.equal(o.issuerPct, 50.0); // confirms stake is counted, not just liquid balance
  __setFetch(null);
});

test('ownership: missing token → null (soft-fail)', async () => {
  __setFetch(fakeHe({ 'tokens/tokens': [] }));
  assert.equal(await ownership('NOPE'), null);
  __setFetch(null);
});

test('ownership: zero supply → 0% (no divide-by-zero)', async () => {
  __setFetch(
    fakeHe({
      'tokens/tokens': [{ symbol: 'Z', issuer: 'iss', circulatingSupply: '0' }],
      'tokens/balances': [{ account: 'iss', balance: '5' }],
      'market/metrics': [{ lastPrice: '0' }],
    }),
  );
  const o = await ownership('Z');
  assert.equal(o.issuerPct, 0);
  assert.equal(o.top3, 0);
  __setFetch(null);
});
