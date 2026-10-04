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
// 'balances' → the balance rows.
//
// The balances stub mirrors the REAL node on the two points that have burned us:
//   1. it pages by `_id` CURSOR (`query._id.$gt`), which is how findAll must walk a large table;
//   2. with `offsetCap` set it REJECTS any offset above that cap the way Hive-Engine really does
//      ({"code":400,"message":"Invalid request"}) — so an offset-paging client is caught here instead of
//      silently truncating in production.
// Rows are returned in WHATEVER order they were given for the `balance` index — exactly like the real
// node's broken string-sort — so the test proves holders() sorts numerically in code.
function routeFetch({ token, balances, pageSize = 1000, offsetCap = 10000 }) {
  // every row needs an _id for cursor paging, as the real table has
  const rows = (balances || []).map((b, i) => ({ _id: b._id ?? i + 1, ...b }));
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const p = body?.params || {};
    if (p.table === 'tokens') return jsonResponse({ result: token ? [token] : [] });
    if (p.table === 'balances') {
      const offset = p.offset || 0;
      if (offsetCap != null && offset > offsetCap) {
        return jsonResponse({ error: { code: 400, message: 'Invalid request' } });
      }
      const after = p.query && p.query._id && typeof p.query._id.$gt === 'number' ? p.query._id.$gt : null;
      const pool = after === null ? rows : rows.filter((r) => r._id > after);
      const limit = p.limit || pageSize;
      return jsonResponse({ result: pool.slice(offset, offset + limit) });
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

// ⭐ THE OFFSET-CAP BUG, pinned. Hive-Engine refuses any offset above 10,000 outright. The old findAll
// paged by offset inside a try/catch that `break`-ed on error, so a table with more rows than that
// returned a SHORT list and said nothing about it. Two wrong holder counts reached the public wiki that
// way (~10,894 VKBT, ~10,526 CURE, against true row counts of 26,066 and 15,692). This test puts 12,000
// rows behind a stub that enforces the real cap: a cursor-paging client sees all of them.
test('⭐ holders: a table larger than the 10,000-offset cap is read in FULL, not silently truncated', async () => {
  const balances = [{ account: 'kalivankush', balance: '5000', stake: '0' }];
  for (let i = 0; i < 12000; i++) balances.push({ account: `h${i}`, balance: '0', stake: '1' });
  __setFetch(routeFetch({
    token: { issuer: 'kalivankush', circulatingSupply: '17000', supply: '17000' },
    balances,
    pageSize: 1000,
    offsetCap: 10000,   // the real server-side ceiling
  }));
  try {
    const h = await holders('VKBT');
    assert.equal(h.counts.total, 12001, 'every row must be read past the offset cap');
    assert.equal(h.counts.outside, 12000);
  } finally { __setFetch(null); }
});

// A read that genuinely could not finish must SAY so rather than hand back a short list.
test('⭐ an incomplete read is flagged, and can be made fatal for callers that publish numbers', async () => {
  const { findAllByCursor, __setFetch: setHe } = await import('./he-client.mjs');
  const rows = Array.from({ length: 2500 }, (_, i) => ({ _id: i + 1, symbol: 'X' }));
  let calls = 0;
  setHe(async (_u, opts) => {
    calls += 1;
    if (calls > 2) return { ok: true, status: 200, async json() { return { error: { code: 400, message: 'Invalid request' } }; } };
    const p = JSON.parse(opts.body).params;
    const after = p.query?._id?.$gt ?? 0;
    return { ok: true, status: 200, async json() { return { result: rows.filter((r) => r._id > after).slice(0, 1000) }; } };
  });
  try {
    const got = await findAllByCursor('tokens', 'balances', { symbol: 'X' });
    assert.equal(got.length, 2000);
    assert.equal(got.truncated, true, 'a short read must be flagged');
    await assert.rejects(
      () => findAllByCursor('tokens', 'balances', { symbol: 'X' }, { onTruncate: 'throw' }),
      /incomplete read/,
    );
  } finally { setHe(null); }
});
