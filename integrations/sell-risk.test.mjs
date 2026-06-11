// sell-risk.test.mjs — offline coverage for the READ-ONLY whale-dump / downside-risk indicator.
// sellRisk has no network of its own: every data dependency routes through he-client's injectable
// fetch seam (RPC `find`/`findOne` for token info / metrics / buy book / balances, and the GET
// `accountHistory` endpoint for recent sells), and `hiveUsd` is injectable as an option. So the whole
// function is exercised here with a single stub fetch that dispatches on the RPC table / history URL —
// no real network, clock, fs, or keys are touched. We pin hiveUsd via the option so the price oracle
// (and its outbound calls) is never reached.
//
// NOTE: he-client reads HE_RPC_NODES / HE_HISTORY_NODES / HE_CACHE_TTL_MS at import time, so this file
// sets them on process.env BEFORE the dynamic imports below. The disk cache is left off (TTL 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HE_RPC_NODES = 'https://node-a.test/contracts';
process.env.HE_HISTORY_NODES = 'https://hist-a.test/accountHistory';
process.env.HE_CACHE_TTL_MS = '0';
process.env.TRADE_ACCOUNT = 'kalivankush'; // the issuer/us — excluded from the whale set

const { __setFetch } = await import('./he-client.mjs');
const { sellRisk } = await import('./sell-risk.mjs');

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

// Build a stub fetch from a per-table dataset. RPC POSTs carry { params: { table, ... } }; the history
// GET hits the accountHistory URL. `history` maps an account -> array of market_sell ops. We return a
// SHORT history page (< 500) so recentSells' paging loop breaks after one call (no infinite loop).
function stubFetch({ tokens = null, metrics = null, buyBook = [], balances = [], history = {} } = {}) {
  const calls = { rpc: [], history: [] };
  __setFetch(async (url, opts = {}) => {
    if (String(url).includes('accountHistory')) {
      const u = new URL(url);
      const account = u.searchParams.get('account');
      calls.history.push(account);
      return jsonResponse(history[account] || []);
    }
    const params = JSON.parse(opts.body).params;
    calls.rpc.push(params.table);
    const byTable = {
      tokens: tokens ? [tokens] : [],
      metrics: metrics ? [metrics] : [],
      buyBook,
      balances,
    };
    return jsonResponse({ jsonrpc: '2.0', id: 1, result: byTable[params.table] ?? [] });
  });
  return calls;
}

// a descending bid book (HIVE/token, quantity in tokens)
const BIDS = [
  { price: '1.00', quantity: '50' },
  { price: '0.50', quantity: '100' },
  { price: '0.10', quantity: '200' },
];

test('happy path: shape, whale filtering, scenarios, USD conversion, recent sells', async () => {
  const calls = stubFetch({
    tokens: { circulatingSupply: '10000', issuer: 'kalivankush' },
    metrics: { lastPrice: '1.00' },
    buyBook: BIDS,
    balances: [
      { account: 'kalivankush', balance: '5000' },        // the issuer/us → excluded
      { account: 'whale1', balance: '300', stake: '100' }, // bal+stake = 400
      { account: 'minnow', balance: '0.5' },               // < 1 token → excluded
    ],
    history: {
      // whale1 already dumped twice; data nested under .data (HE history shape)
      whale1: [
        { data: { symbol: 'VKBT', quantityTokens: '40' }, timestamp: 1700000002 },
        { data: { symbol: 'VKBT', quantityTokens: '60' }, timestamp: 1700000001 },
        { data: { symbol: 'OTHER', quantityTokens: '999' }, timestamp: 1700000000 }, // other token, ignored
      ],
    },
  });

  const r = await sellRisk('VKBT', { hiveUsd: 2, topN: 5 });

  // top-level shape
  assert.equal(r.symbol, 'VKBT');
  assert.equal(r.last, 1);
  assert.equal(r.lastUsd, 2);            // 1.00 * 2
  assert.equal(r.supply, 10000);
  // bid support = Σ price*qty = 1*50 + 0.5*100 + 0.1*200 = 120 HIVE → *2 = 240 USD
  assert.equal(r.bidSupportUsd, 240);

  // only whale1 survives the filter (us excluded, minnow < 1 token)
  assert.equal(r.whales.length, 1);
  const w = r.whales[0];
  assert.equal(w.account, 'whale1');
  assert.equal(w.bal, 400);                       // balance + stake
  assert.equal(w.pctOfSupply, 4);                 // 400 / 10000 * 100

  // three dump scenarios, 25/50/100%
  assert.deepEqual(w.scenarios.map(s => s.frac), [0.25, 0.5, 1.0]);

  // dump ALL (400 tokens) walks the full book (350 tokens available) → 50 unsold, floor 0.10
  const full = w.scenarios.find(s => s.frac === 1.0);
  assert.equal(full.unsold, 50);
  assert.equal(full.floorUsd, 0.2);               // floorPrice 0.10 * hiveUsd 2
  assert.equal(full.dropPct, 90);                 // (1 - 0.1)/1 * 100
  // hiveReceived = 50*1 + 100*0.5 + 200*0.1 = 120 HIVE → *2 = 240 USD
  assert.equal(full.hiveReceivedUsd, 240);

  // dump 25% (100 tokens): fills 50@1 + 50@0.5 → floor 0.5, no unsold, drop 50%
  const quarter = w.scenarios.find(s => s.frac === 0.25);
  assert.equal(quarter.unsold, 0);
  assert.equal(quarter.floorUsd, 1);              // 0.5 * 2
  assert.equal(quarter.dropPct, 50);

  // recent sells: 2 VKBT sells (OTHER ignored), 100 tokens, newest timestamp first
  assert.equal(w.recent.count, 2);
  assert.equal(w.recent.qtySold, 100);
  assert.equal(w.recent.lastTs, 1700000002);

  // and it really exercised every reader exactly once for the surviving whale
  assert.deepEqual(calls.history, ['whale1']);
  assert.ok(calls.rpc.includes('tokens') && calls.rpc.includes('metrics') && calls.rpc.includes('buyBook') && calls.rpc.includes('balances'));

  __setFetch(null);
});

test('soft-fail: unknown token (no info row) returns null, never throws', async () => {
  stubFetch({ tokens: null, metrics: null, buyBook: [], balances: [] });
  const r = await sellRisk('NOPE', { hiveUsd: 1 });
  assert.equal(r, null);
  __setFetch(null);
});

test('edge: token exists but no outside holders → empty whale list, typed result', async () => {
  stubFetch({
    tokens: { circulatingSupply: '500' },
    metrics: { lastPrice: '0.5' },
    buyBook: BIDS,
    balances: [{ account: 'kalivankush', balance: '500' }], // only us → filtered out
  });
  const r = await sellRisk('VKBT', { hiveUsd: 1 });
  assert.ok(r);
  assert.deepEqual(r.whales, []);
  assert.equal(r.symbol, 'VKBT');
  assert.equal(r.last, 0.5);
  __setFetch(null);
});

test('edge: empty bid book → every dump is fully unsold; price craters to zero (100% drop)', async () => {
  stubFetch({
    tokens: { circulatingSupply: '1000' },
    metrics: { lastPrice: '1' },
    buyBook: [],                                   // no bids at all
    balances: [{ account: 'whale1', balance: '100' }],
    history: { whale1: [] },
  });
  const r = await sellRisk('VKBT', { hiveUsd: 1 });
  const w = r.whales[0];
  assert.equal(r.bidSupportUsd, 0);
  for (const s of w.scenarios) {
    assert.equal(s.hiveReceivedUsd, 0);            // nothing sold → no HIVE
    assert.equal(s.floorUsd, 0);                   // floorPrice 0 (no bids)
    assert.equal(s.dropPct, 100);                  // (1 - 0)/1 * 100 — printed price → 0
    assert.ok(s.unsold > 0);                       // nothing could be sold
  }
  assert.equal(w.recent.count, 0);                 // empty history → typed zero
  __setFetch(null);
});

test('edge: missing metrics (no lastPrice) → last 0, dropPct 0 (no divide-by-zero)', async () => {
  stubFetch({
    tokens: { supply: '2000' },                    // falls back to .supply (no circulatingSupply)
    metrics: null,                                 // no metrics row
    buyBook: BIDS,
    balances: [{ account: 'whale1', balance: '50' }],
    history: { whale1: [] },
  });
  const r = await sellRisk('VKBT', { hiveUsd: 1 });
  assert.equal(r.last, 0);
  assert.equal(r.lastUsd, 0);
  assert.equal(r.supply, 2000);                    // .supply fallback worked
  for (const s of r.whales[0].scenarios) assert.equal(s.dropPct, 0); // last==0 guard
  __setFetch(null);
});

test('soft-fail: recentSells history endpoint throws → recent defaults to zero, row still built', async () => {
  // RPC data is fine, but the history mirror is down. recentSells(...).catch(...) must swallow it.
  __setFetch(async (url, opts = {}) => {
    if (String(url).includes('accountHistory')) throw new Error('history node down');
    const params = JSON.parse(opts.body).params;
    const byTable = {
      tokens: [{ circulatingSupply: '1000' }],
      metrics: [{ lastPrice: '1' }],
      buyBook: BIDS,
      balances: [{ account: 'whale1', balance: '100' }],
    };
    return jsonResponse({ result: byTable[params.table] ?? [] });
  });
  const r = await sellRisk('VKBT', { hiveUsd: 1 });
  assert.equal(r.whales.length, 1);
  // historyPage's per-batch .catch(()=>[]) swallows the dead mirror inside recentSells, so it
  // returns the typed empty shape (with lastTs:null) rather than throwing up to the row builder.
  assert.deepEqual(r.whales[0].recent, { count: 0, qtySold: 0, lastTs: null });
  __setFetch(null);
});

test('topN caps the whale list', async () => {
  const balances = [
    { account: 'kalivankush', balance: '9000' },   // us, excluded
    ...Array.from({ length: 8 }, (_, i) => ({ account: `w${i}`, balance: String(100 - i) })),
  ];
  const history = Object.fromEntries(balances.map(b => [b.account, []]));
  stubFetch({
    tokens: { circulatingSupply: '100000' },
    metrics: { lastPrice: '1' },
    buyBook: BIDS,
    balances,
    history,
  });
  const r = await sellRisk('VKBT', { hiveUsd: 1, topN: 3 });
  assert.equal(r.whales.length, 3);                // capped at topN, after excluding us
  assert.ok(!r.whales.some(w => w.account === 'kalivankush'));
  __setFetch(null);
});

test('recentSells reads top-level (non-.data) op shape too', async () => {
  // some history mirrors return flat ops (symbol/quantity at top level, not under .data)
  stubFetch({
    tokens: { circulatingSupply: '1000' },
    metrics: { lastPrice: '1' },
    buyBook: BIDS,
    balances: [{ account: 'whale1', balance: '100' }],
    history: {
      whale1: [
        { symbol: 'VKBT', quantity: '10', timestamp: 5 },
        { symbol: 'VKBT', quantity: '15', timestamp: 4 },
      ],
    },
  });
  const r = await sellRisk('VKBT', { hiveUsd: 1 });
  assert.equal(r.whales[0].recent.count, 2);
  assert.equal(r.whales[0].recent.qtySold, 25);    // 10 + 15 via the .quantity fallback
  __setFetch(null);
});
