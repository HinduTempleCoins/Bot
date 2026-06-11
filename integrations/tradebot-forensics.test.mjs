// tradebot-forensics.test.mjs — offline coverage for the READ-ONLY on-chain P&L reconstruction.
// Exercises the three key exports:
//   • reconstruct(ops)        — PURE: per-symbol fill aggregation (no network)
//   • marketHistory(account)  — paginated history walk, driven via he-client's injectable fetch seam
//   • currentHoldings(account)— balances find, same fetch seam
// All network is the he-client `__setFetch` seam — no real network, no keys, no fs (cache TTL 0).
//
// NOTE: he-client reads HE_*_NODES / HE_CACHE_TTL_MS at import time, so we set them BEFORE importing
// either module (tradebot-forensics imports he-client). Cache left OFF (TTL 0) → no disk touch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HE_RPC_NODES = 'https://node-a.test/contracts';
process.env.HE_HISTORY_NODES = 'https://hist-a.test/accountHistory';
process.env.HE_CACHE_TTL_MS = '0';

const { __setFetch } = await import('./he-client.mjs');
const { reconstruct, marketHistory, currentHoldings } = await import('./tradebot-forensics.mjs');

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

// ── reconstruct: PURE function ──────────────────────────────────────────────

test('reconstruct: happy path — buys + sells aggregate per symbol', () => {
  const ops = [
    { operation: 'market_buy', data: { symbol: 'VKBT', quantityTokens: '10', quantityHive: '5.00' } },
    { operation: 'market_buy', data: { symbol: 'VKBT', quantityTokens: '20', quantityHive: '8.00' } },
    { operation: 'market_sell', data: { symbol: 'VKBT', quantityTokens: '15', quantityHive: '9.00' } },
  ];
  const { sym, fills } = reconstruct(ops);
  assert.equal(fills, 3);
  assert.equal(sym.VKBT.buys, 2);
  assert.equal(sym.VKBT.sells, 1);
  assert.equal(sym.VKBT.bought, 30);
  assert.equal(sym.VKBT.sold, 15);
  assert.equal(sym.VKBT.hiveSpent, 13);
  assert.equal(sym.VKBT.hiveRecv, 9);
});

test('reconstruct: tracks multiple symbols independently', () => {
  const ops = [
    { operation: 'market_buy', data: { symbol: 'AAA', quantity: '1', quantityHive: '2' } },
    { operation: 'market_sell', data: { symbol: 'BBB', quantity: '3', quantityHive: '4' } },
  ];
  const { sym, fills } = reconstruct(ops);
  assert.equal(fills, 2);
  assert.equal(Object.keys(sym).length, 2);
  assert.equal(sym.AAA.hiveSpent, 2);
  assert.equal(sym.BBB.hiveRecv, 4);
});

test('reconstruct: accepts the flat shape (data missing → op fields used directly)', () => {
  // The module does `const d = o.data || o`, so a flattened op works too.
  const ops = [{ operation: 'market_buy', symbol: 'FLAT', quantityTokens: '7', quantityHive: '3' }];
  const { sym, fills } = reconstruct(ops);
  assert.equal(fills, 1);
  assert.equal(sym.FLAT.bought, 7);
  assert.equal(sym.FLAT.hiveSpent, 3);
});

test('reconstruct: alternate field spellings (quantity / quantityHIVE) are honored', () => {
  const ops = [{ operation: 'market_sell', data: { symbol: 'ALT', quantity: '2', quantityHIVE: '6' } }];
  const { sym } = reconstruct(ops);
  assert.equal(sym.ALT.sold, 2);
  assert.equal(sym.ALT.hiveRecv, 6);
});

test('reconstruct: non-fill ops (placeOrder/expire/cancel) and zero-hive fills do NOT count', () => {
  const ops = [
    { operation: 'market_placeOrder', data: { symbol: 'VKBT', quantityTokens: '10', quantityHive: '5' } },
    { operation: 'market_expire', data: { symbol: 'VKBT' } },
    { operation: 'market_cancel', data: { symbol: 'VKBT' } },
    { operation: 'market_buy', data: { symbol: 'VKBT', quantityTokens: '10', quantityHive: '0' } }, // 0 hive → skipped
  ];
  const { sym, fills } = reconstruct(ops);
  assert.equal(fills, 0);
  // A symbol bucket IS created (sym[s] ||= ... runs before the op/hive guards), but every counter
  // stays 0 because no op qualifies as a fill — so the realized net for VKBT is 0.
  assert.deepEqual(sym.VKBT, { bought: 0, sold: 0, hiveSpent: 0, hiveRecv: 0, buys: 0, sells: 0 });
  assert.equal(sym.VKBT.hiveRecv - sym.VKBT.hiveSpent, 0);
});

test('reconstruct: ops without a symbol are skipped', () => {
  const ops = [
    { operation: 'market_buy', data: { quantityTokens: '10', quantityHive: '5' } }, // no symbol
    { operation: 'market_buy', data: { symbol: 'OK', quantityTokens: '1', quantityHive: '1' } },
  ];
  const { sym, fills } = reconstruct(ops);
  assert.equal(fills, 1);
  assert.deepEqual(Object.keys(sym), ['OK']);
});

test('reconstruct: soft-fail on empty / bad input — typed empty result, never throws', () => {
  assert.deepEqual(reconstruct([]), { sym: {}, fills: 0 });
  // bad inputs: array of junk that has no symbol / no operation → still typed empty, no throw
  assert.deepEqual(reconstruct([{}, { foo: 1 }, { operation: 'market_buy' }]), { sym: {}, fills: 0 });
});

// ── marketHistory: paginated walk over he-client.historyPage ────────────────

test('marketHistory: walks pages of 500 until a short page, concatenating ops', async () => {
  // 1200 ops across pages 0/500/1000 (sizes 500,500,200) — stops on the short 200-row page.
  const all = Array.from({ length: 1200 }, (_, i) => ({ operation: 'market_buy', data: { symbol: 'X', i } }));
  const offsets = [];
  __setFetch(async (url) => {
    const off = +new URL(url).searchParams.get('offset');
    offsets.push(off);
    return jsonResponse(all.slice(off, off + 500));
  });
  try {
    const ops = await marketHistory('kalivankush');
    assert.equal(ops.length, 1200);
    assert.deepEqual(offsets, [0, 500, 1000]);
    assert.equal(ops[1199].data.i, 1199);
  } finally { __setFetch(null); }
});

test('marketHistory: respects the cap argument (stops once cap reached)', async () => {
  const page = Array.from({ length: 500 }, (_, i) => ({ operation: 'market_buy', data: { symbol: 'X', i } }));
  __setFetch(async () => jsonResponse(page)); // every full page → would loop forever without the cap
  try {
    const ops = await marketHistory('acct', 500); // cap 500 → exactly one page then loop condition stops
    assert.equal(ops.length, 500);
  } finally { __setFetch(null); }
});

test('marketHistory: empty first page → [] (soft, no throw)', async () => {
  __setFetch(async () => jsonResponse([]));
  try { assert.deepEqual(await marketHistory('nobody'), []); } finally { __setFetch(null); }
});

test('marketHistory: a failing history page is swallowed → typed [] (never throws)', async () => {
  // historyPage rejects (all nodes down); marketHistory's .catch(() => []) turns it into a short page → stop.
  __setFetch(async () => { throw new Error('all history nodes down'); });
  try { assert.deepEqual(await marketHistory('acct'), []); } finally { __setFetch(null); }
});

// ── currentHoldings: balances find ──────────────────────────────────────────

test('currentHoldings: keeps only positive balance/stake, maps to {symbol,balance,stake}', async () => {
  __setFetch(async () => jsonResponse({
    result: [
      { symbol: 'KEEP', balance: '12.5', stake: '0' },
      { symbol: 'STAKED', balance: '0', stake: '3' },
      { symbol: 'ZERO', balance: '0', stake: '0' }, // dropped
    ],
  }));
  try {
    const h = await currentHoldings('acct');
    assert.deepEqual(h, [
      { symbol: 'KEEP', balance: 12.5, stake: 0 },
      { symbol: 'STAKED', balance: 0, stake: 3 },
    ]);
  } finally { __setFetch(null); }
});

test('currentHoldings: no balances → [] (typed empty)', async () => {
  __setFetch(async () => jsonResponse({ result: [] }));
  try { assert.deepEqual(await currentHoldings('acct'), []); } finally { __setFetch(null); }
});
