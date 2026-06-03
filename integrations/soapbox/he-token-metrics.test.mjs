import { test } from 'node:test';
import assert from 'node:assert';
import { tokenMetrics, dashboard } from './he-token-metrics.mjs';

// fully-stubbed, offline deps — no network, no he-client. Mirrors the real module shapes:
//   market.metrics  → { lastPrice, volume, highestBid, lowestAsk }
//   market.buyBook/sellBook → [{ price, quantity }]
//   ownership(sym)  → { top3, issuerPct }
//   holders(sym)    → { issuerPct, counts: { total } }
function makeDeps(over = {}) {
  return {
    market: {
      metrics: () => ({ lastPrice: 0.5, volume: 1234.5, highestBid: 0.49, lowestAsk: 0.51 }),
      buyBook: () => [{ price: 0.49, quantity: 100 }, { price: 0.48, quantity: 200 }],
      sellBook: () => [{ price: 0.51, quantity: 50 }, { price: 0.52, quantity: 80 }],
      ...over.market,
    },
    ownership: over.ownership || (() => ({ top3: 72.5, issuerPct: 60.1 })),
    holders: over.holders || (() => ({ issuerPct: 61.0, counts: { total: 42 } })),
  };
}

test('tokenMetrics assembles the full shape from injected module outputs', async () => {
  const m = await tokenMetrics('VKBT', makeDeps());
  assert.equal(m.symbol, 'VKBT');
  assert.equal(m.price, 0.5);
  assert.equal(m.volume24h, 1234.5);
  assert.equal(m.holders, 42);
  assert.equal(m.top3Pct, 72.5);
  assert.equal(m.issuerPct, 61.0, 'issuerPct prefers holders source');
  // buy wall in HIVE = 0.49*100 + 0.48*200 = 49 + 96 = 145
  assert.equal(m.buyWallHive, 145);
  // sell wall qty = 50 + 80 = 130
  assert.equal(m.sellWallQty, 130);
  // spread = (0.51 - 0.49)/0.51*100 ≈ 3.92
  assert.equal(m.spreadPct, 3.92);
  assert.match(m.lastUpdated, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(m.provenance, { market: true, books: true, ownership: true, holders: true });
});

test('tokenMetrics soft-fails missing market metrics to null (price/volume)', async () => {
  const m = await tokenMetrics('GONE', makeDeps({ market: { metrics: () => null } }));
  assert.equal(m.price, null);
  assert.equal(m.volume24h, null);
  // books still present → walls + spread (from book tops) survive
  assert.equal(m.buyWallHive, 145);
  assert.equal(m.spreadPct, 3.92);
  assert.equal(m.provenance.market, false);
  assert.equal(m.provenance.books, true);
});

test('tokenMetrics soft-fails a throwing source without throwing', async () => {
  const m = await tokenMetrics('BOOM', makeDeps({
    ownership: () => { throw new Error('node down'); },
    holders: () => { throw new Error('node down'); },
  }));
  assert.equal(m.top3Pct, null);
  assert.equal(m.issuerPct, null);
  assert.equal(m.holders, null);
  assert.equal(m.provenance.ownership, false);
  assert.equal(m.provenance.holders, false);
  // unaffected sources still populate
  assert.equal(m.price, 0.5);
});

test('tokenMetrics falls back to metrics bid/ask when books are empty', async () => {
  const m = await tokenMetrics('THIN', makeDeps({ market: {
    metrics: () => ({ lastPrice: 1, volume: 0, highestBid: 0.9, lowestAsk: 1.1 }),
    buyBook: () => [],
    sellBook: () => [],
  } }));
  // spread from metrics: (1.1 - 0.9)/1.1*100 ≈ 18.18
  assert.equal(m.spreadPct, 18.18);
  assert.equal(m.buyWallHive, null, 'no book → no wall');
  assert.equal(m.sellWallQty, null);
});

test('issuerPct falls back to ownership when holders is missing', async () => {
  const m = await tokenMetrics('FB', makeDeps({ holders: () => null }));
  assert.equal(m.issuerPct, 60.1, 'used ownership.issuerPct');
  assert.equal(m.holders, null, 'no holder count without holders source');
});

test('tokenMetrics never throws and yields a full null row when everything fails', async () => {
  const m = await tokenMetrics('DEAD', {
    market: { metrics: () => { throw new Error('x'); }, buyBook: () => { throw new Error('x'); }, sellBook: () => { throw new Error('x'); } },
    ownership: () => { throw new Error('x'); },
    holders: () => { throw new Error('x'); },
  });
  for (const k of ['price', 'volume24h', 'holders', 'top3Pct', 'issuerPct', 'buyWallHive', 'sellWallQty', 'spreadPct']) {
    assert.equal(m[k], null, `${k} is null`);
  }
  assert.deepEqual(m.provenance, { market: false, books: false, ownership: false, holders: false });
});

test('dashboard maps multiple symbols, one row each', async () => {
  const deps = makeDeps();
  const rows = await dashboard(['VKBT', 'CURE', 'PAL'], deps);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.symbol), ['VKBT', 'CURE', 'PAL']);
  for (const r of rows) {
    assert.equal(r.price, 0.5);
    assert.equal(r.holders, 42);
    assert.ok('provenance' in r);
  }
});

test('dashboard handles empty/non-array input gracefully', async () => {
  assert.deepEqual(await dashboard([], makeDeps()), []);
  assert.deepEqual(await dashboard(undefined, makeDeps()), []);
});
