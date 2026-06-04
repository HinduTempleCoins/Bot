// holders.test.mjs — offline coverage for the token holder-reality aggregation. holders() reads the
// chain via he-client's find(); we drive it through the re-exported __setFetch seam (= he-client's
// seam) and assert the issuer / affiliated / real-outside percentage math + the soft-fail (not-found
// → null) contract. No network is touched. The HE disk cache is left off (TTL 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HE_RPC_NODES = 'https://node-a.test/contracts';
process.env.HE_CACHE_TTL_MS = '0';
process.env.TRADE_ACCOUNT = 'kalivankush';

const { holders, __setFetch } = await import('./holders.mjs');

function jsonResponse(body) { return { ok: true, status: 200, async json() { return body; } }; }

// Route he-client's JSON-RPC POST by the `table` in the request body: 'tokens' → token info,
// 'balances' → the balance rows. Returns the supplied fixtures.
function routeFetch({ token, balances }) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const table = body?.params?.table;
    if (table === 'tokens') return jsonResponse({ result: token ? [token] : [] });
    if (table === 'balances') return jsonResponse({ result: balances || [] });
    return jsonResponse({ result: [] });
  };
}

test('holders: not-found token → null (soft contract)', async () => {
  __setFetch(routeFetch({ token: null }));
  try { assert.equal(await holders('NOPE'), null); } finally { __setFetch(null); }
});

test('holders: computes issuer / affiliated / real-outside percentages', async () => {
  // supply 1000. issuer (kalivankush) 600 = 60%. affiliated vankush 100 = 10%.
  // real outside: alice 250 (25%) + bob 50 (5%) = 30%. carol 0.5 is below the ≥1 threshold → excluded.
  // holders() does NOT re-sort — it trusts the chain's balance-descending index — so the fixture is
  // supplied in that order (issuer 600 → alice 250 → vankush 100 → bob 50 → carol 0.5).
  __setFetch(routeFetch({
    token: { issuer: 'kalivankush', circulatingSupply: '1000', supply: '1000' },
    balances: [
      { account: 'kalivankush', balance: '600', stake: '0' },
      { account: 'alice', balance: '200', stake: '50' },   // 250 incl stake
      { account: 'vankush', balance: '100', stake: '0' },
      { account: 'bob', balance: '50', stake: '0' },
      { account: 'carol', balance: '0.5', stake: '0' },     // dust, excluded (<1)
    ],
  }));
  try {
    const h = await holders('VKBT');
    assert.equal(h.symbol, 'VKBT');
    assert.equal(h.issuer, 'kalivankush');
    assert.equal(h.supply, 1000);
    assert.equal(h.issuerPct, 60);
    assert.equal(h.affiliatedPct, 10);
    assert.equal(h.realOutsidePct, 30);
    assert.equal(h.counts.outside, 3);        // alice, bob, vankush (≥1, not issuer)
    assert.equal(h.counts.realOutside, 2);    // alice, bob (not affiliated)
    // topOutside is sorted/sliced; alice should lead with the largest balance.
    assert.equal(h.topOutside[0].account, 'alice');
    assert.equal(h.topOutside[0].bal, 250);
    assert.ok(h.topOutside.find((o) => o.account === 'vankush').affiliated);
  } finally { __setFetch(null); }
});

test('holders: stake folded into balance + zero-supply guard (pct = 0, no divide-by-zero)', async () => {
  __setFetch(routeFetch({
    token: { issuer: 'kalivankush', circulatingSupply: '0', supply: '0' },
    balances: [{ account: 'alice', balance: '5', stake: '5' }],
  }));
  try {
    const h = await holders('ZERO');
    assert.equal(h.supply, 0);
    assert.equal(h.topOutside[0].bal, 10);    // 5 + 5 stake
    assert.equal(h.topOutside[0].pct, 0);     // supply 0 → pct 0, not NaN/Infinity
    assert.equal(h.realOutsidePct, 0);
  } finally { __setFetch(null); }
});
