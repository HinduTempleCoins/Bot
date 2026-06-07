// holders.test.mjs — offline coverage for the token holder-reality aggregation. holders() reads the
// chain via he-client's find()/findAll(); we drive it through the re-exported __setFetch seam (=
// he-client's seam) and assert the issuer / affiliated / real-outside percentage math, the holder
// COUNT (paginated + numerically sorted), and the soft-fail (not-found → null) contract. No network is
// touched. The HE disk cache is left off (TTL 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HE_RPC_NODES = 'https://node-a.test/contracts';
process.env.HE_CACHE_TTL_MS = '0';
process.env.TRADE_ACCOUNT = 'kalivankush';

const { holders, __setFetch } = await import('./holders.mjs');

function jsonResponse(body) { return { ok: true, status: 200, async json() { return body; } }; }

// Route he-client's JSON-RPC POST by the `table` in the request body: 'tokens' → token info,
// 'balances' → the balance rows. balances is served OFFSET-AWARE in pages of `pageSize`, mirroring how
// the real HE node paginates — so findAll()'s offset walk terminates on the short/empty page instead of
// looping forever on a stub that ignores offset. The stub returns rows in WHATEVER order it's given (it
// does NOT honour the `balance` sort index) — exactly like the real node's broken string-sort — so the
// test proves holders() sorts numerically in code rather than trusting node order.
function routeFetch({ token, balances, pageSize = 1000 }) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const p = body?.params || {};
    if (p.table === 'tokens') return jsonResponse({ result: token ? [token] : [] });
    if (p.table === 'balances') {
      const rows = balances || [];
      const offset = p.offset || 0;
      const limit = p.limit || pageSize;
      return jsonResponse({ result: rows.slice(offset, offset + limit) });
    }
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
  // Rows supplied in a NON-numeric order on purpose — holders() must sort by total balance in code.
  __setFetch(routeFetch({
    token: { issuer: 'kalivankush', circulatingSupply: '1000', supply: '1000' },
    balances: [
      { account: 'bob', balance: '50', stake: '0' },
      { account: 'kalivankush', balance: '600', stake: '0' },
      { account: 'carol', balance: '0.5', stake: '0' },     // dust, excluded (<1)
      { account: 'alice', balance: '200', stake: '50' },   // 250 incl stake
      { account: 'vankush', balance: '100', stake: '0' },
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
    assert.equal(h.counts.holders, 4);        // kalivankush, alice, vankush, bob (≥1 total; carol dust out)
    // topOutside is numerically sorted; alice (250) leads despite being supplied 4th.
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

// Regression for the "holders: 0" bug on CURE / VKBT / SWAP.GIFU.
// Root cause reproduced here: (a) most holders staked everything so their LIQUID balance is "0", and
// (b) there are MORE rows than a single HE page (limit cap). The old code read one page sorted by the
// HE `balance` string-index, which pushed the staked-everything holders out of the window and capped
// the count at the page size — collapsing the visible outside-holder count toward 0. findAll() + the
// in-code numeric sort + the (balance+stake) threshold must now surface them all.
test('holders: staked-everything holders past the page cap are counted, not dropped (the "holders: 0" bug)', async () => {
  const balances = [{ account: 'kalivankush', balance: '100', stake: '0' }]; // issuer, only liquid holder
  // 1500 real outside holders, each holding 10 entirely in STAKE (liquid balance "0") — these are the
  // ones the old single-page string-sorted-by-balance query silently dropped.
  for (let i = 0; i < 1500; i++) balances.push({ account: `holder${i}`, balance: '0', stake: '10' });
  __setFetch(routeFetch({
    token: { issuer: 'kalivankush', circulatingSupply: '15100', supply: '15100' },
    balances,
    pageSize: 1000, // HE caps a single find at 1000 — must paginate to see all 1501 rows
  }));
  try {
    const h = await holders('CURE');
    assert.equal(h.counts.total, 1501);                 // all rows paged in (not truncated at 1000)
    assert.equal(h.counts.holders, 1501);               // every account holds ≥1 incl. stake
    assert.equal(h.counts.outside, 1500);               // everyone but the issuer
    assert.equal(h.counts.realOutside, 1500);           // none affiliated
    assert.ok(h.counts.realOutside > 0, 'must NOT report 0 outside holders');
    // staked-everything holders carry real percentage despite liquid balance "0"
    assert.ok(h.realOutsidePct > 90);
  } finally { __setFetch(null); }
});

// Third-party / swap token: the real on-chain issuer (not TRADE_ACCOUNT) is classified as the issuer.
test('holders: token issuer (not just TRADE_ACCOUNT) is treated as issuer', async () => {
  __setFetch(routeFetch({
    token: { issuer: 'swap-bsc', circulatingSupply: '1000', supply: '1000' },
    balances: [
      { account: 'swap-bsc', balance: '700', stake: '0' }, // the real issuer
      { account: 'alice', balance: '300', stake: '0' },
    ],
  }));
  try {
    const h = await holders('SWAP.GIFU');
    assert.equal(h.issuerPct, 70);            // swap-bsc counted as issuer, not "real outside"
    assert.equal(h.counts.realOutside, 1);    // only alice
    assert.ok(!h.topOutside.find((o) => o.account === 'swap-bsc'));
  } finally { __setFetch(null); }
});
