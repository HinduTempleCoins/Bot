// price-oracle.test.mjs — OFFLINE tests for the multi-source USD price oracle.
// The pure aggregation (median / robustMedian) is tested directly with crafted inputs.
// The end-to-end priceUsd() path is tested by stubbing the global `fetch` that the
// underlying free-apis clients use, so NO network is ever touched.

import { test } from 'node:test';
import assert from 'node:assert';
import { median, robustMedian, priceUsd, hiveUsd } from './price-oracle.mjs';

// ── pure: median ───────────────────────────────────────────────────────────
test('median: odd-length picks the middle element (order-independent)', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([5]), 5);
});

test('median: even-length averages the two middle elements', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 20]), 15);
});

// ── pure: robustMedian ──────────────────────────────────────────────────────
test('robustMedian: empty input → zeroed, not confident', () => {
  assert.deepEqual(robustMedian([]), { usd: 0, sources: 0, spreadPct: null, confident: false });
});

test('robustMedian: single source is never confident (needs 2+)', () => {
  const r = robustMedian([100]);
  assert.equal(r.usd, 100);
  assert.equal(r.sources, 1);
  assert.equal(r.spreadPct, 0);     // spread undefined for <2 -> 0
  assert.equal(r.confident, false); // confidence requires >=2 surviving sources
});

test('robustMedian: tight cluster of 3 → confident, low spread', () => {
  // 100, 101, 102 -> median 101, all within 5% -> confident
  const r = robustMedian([100, 101, 102]);
  assert.equal(r.usd, 101);
  assert.equal(r.sources, 3);
  assert.ok(r.spreadPct <= 5, `spread ${r.spreadPct}% should be <=5`);
  assert.equal(r.confident, true);
});

test('robustMedian: rejects a gross outlier outside the ~35% band', () => {
  // median of [100,101,102, 1000] is 101.5; 1000 is ~885% off -> dropped.
  const r = robustMedian([100, 101, 102, 1000]);
  assert.equal(r.sources, 3, 'the 1000 outlier is rejected');
  assert.equal(r.usd, 101, 'survivors re-median to 101');
  assert.equal(r.confident, true, 'survivors agree within 5%');
});

test('robustMedian: band edge — keep at exactly 35%, drop just past it', () => {
  // median = 100. 134 -> 34% off (kept). 136 -> 36% off (dropped).
  const kept = robustMedian([100, 100, 134]);
  assert.equal(kept.sources, 3, '34% is within the 35% band -> kept');

  const dropped = robustMedian([100, 100, 136]);
  assert.equal(dropped.sources, 2, '36% exceeds the 35% band -> dropped');
  assert.equal(dropped.usd, 100);
});

test('robustMedian: confident only when surviving spread <= 5%', () => {
  // 100, 104 -> spread 4% -> confident
  const tight = robustMedian([100, 104]);
  assert.equal(tight.sources, 2);
  assert.equal(tight.confident, true);

  // 100, 130 -> median 115; both within 35% band (kept), but spread ~26% -> NOT confident
  const wide = robustMedian([100, 130]);
  assert.equal(wide.sources, 2, 'both within 35% band so both kept');
  assert.equal(wide.confident, false, 'spread too wide for confidence');
  assert.ok(wide.spreadPct > 5);
});

test('robustMedian: when EVERYTHING is far from the median, falls back to all values', () => {
  // Two-element symmetric case: median 100, both 50% off -> kept array empty -> fall back to all.
  const r = robustMedian([50, 150]);
  assert.equal(r.sources, 2, 'falls back to the full set rather than returning nothing');
  assert.equal(r.usd, 100);
  assert.equal(r.confident, false);
});

test('robustMedian: spreadPct is rounded to 2 decimals', () => {
  const r = robustMedian([100, 103, 107]); // spread (107-100)/103 = 6.7961...%
  assert.equal(r.spreadPct, 6.8);
});

// ── integration: priceUsd() via stubbed global fetch (offline) ──────────────
// XREF['ethereum'] = paprika eth-ethereum, cap ethereum, kraken ETHUSD, coinbase ETH-USD.
// We route each upstream URL to a crafted JSON body. coingecko is passed as cgPrice arg.

function installFetch(routes) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    for (const [needle, body] of routes) {
      if (u.includes(needle)) {
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
      }
    }
    throw new Error(`unexpected fetch in offline test: ${u}`);
  };
  return () => { globalThis.fetch = realFetch; };
}

// shape helpers matching what gather() destructures
const paprika = (price) => ({ quotes: { USD: { price } } });
const coincap = (priceUsd) => ({ data: { priceUsd: String(priceUsd) } });
const coinbase = (amount) => ({ data: { amount: String(amount) } });
const kraken = (pair, price) => ({ result: { [pair]: { c: [String(price), '1.0'] } } });

test('priceUsd: aggregates 5 agreeing sources → confident median', async () => {
  const restore = installFetch([
    ['coinpaprika.com/v1/tickers/eth-ethereum', paprika(2010)],
    ['coincap.io/v2/assets/ethereum', coincap(2005)],
    ['coinbase.com/v2/prices/ETH-USD', coinbase(2000)],
    ['kraken.com', kraken('ETHUSD', 1995)],
  ]);
  try {
    const r = await priceUsd('ethereum', 2002); // cgPrice = coingecko quote
    assert.equal(r.sources, 5, 'coingecko + 4 live sources');
    assert.equal(r.confident, true);
    assert.ok(r.usd >= 1995 && r.usd <= 2010, `median ${r.usd} in cluster`);
    assert.ok('coingecko' in r.quotes && 'kraken' in r.quotes);
    assert.ok(r.spreadPct <= 5);
  } finally { restore(); }
});

test('priceUsd: a wildly stale source is outlier-rejected', async () => {
  const restore = installFetch([
    ['coinpaprika.com/v1/tickers/eth-ethereum', paprika(2010)],
    ['coincap.io/v2/assets/ethereum', coincap(2005)],
    ['coinbase.com/v2/prices/ETH-USD', coinbase(2000)],
    ['kraken.com', kraken('ETHUSD', 9999)], // stale/bad quote
  ]);
  try {
    const r = await priceUsd('ethereum', 2002);
    assert.equal(r.sources, 4, 'the 9999 quote is dropped from the survivors');
    assert.ok(r.usd >= 2000 && r.usd <= 2010, `survivor median ${r.usd}`);
    assert.equal(r.confident, true);
    // the bad quote is still reported in the raw quotes map, just not in the median
    assert.equal(+r.quotes.kraken, 9999);
  } finally { restore(); }
});

test('priceUsd: failing upstreams are ignored, not fatal', async () => {
  const restore = installFetch([
    ['coinpaprika.com/v1/tickers/eth-ethereum', paprika(2010)],
    // coincap, coinbase, kraken intentionally NOT routed -> they throw -> caught as null
  ]);
  try {
    const r = await priceUsd('ethereum', 2000); // coingecko + paprika survive
    assert.equal(r.sources, 2);
    assert.ok(r.usd >= 2000 && r.usd <= 2010);
    assert.equal(r.confident, true, 'two near-equal sources -> confident');
  } finally { restore(); }
});

test('priceUsd: zero/negative quotes are sanitized out by n()', async () => {
  const restore = installFetch([
    ['coinpaprika.com/v1/tickers/eth-ethereum', paprika(0)],     // invalid -> dropped
    ['coincap.io/v2/assets/ethereum', coincap(-5)],              // invalid -> dropped
    ['coinbase.com/v2/prices/ETH-USD', coinbase(2000)],
    ['kraken.com', kraken('ETHUSD', 2004)],
  ]);
  try {
    const r = await priceUsd('ethereum', 2002);
    assert.equal(r.sources, 3, 'coingecko + coinbase + kraken; the 0 and -5 are dropped');
    assert.equal(r.confident, true);
  } finally { restore(); }
});

test('priceUsd: no live data at all → zeroed, not confident, empty quotes', async () => {
  const restore = installFetch([]); // every upstream throws
  try {
    const r = await priceUsd('ethereum', null); // no coingecko quote either
    assert.deepEqual(
      { usd: r.usd, sources: r.sources, spreadPct: r.spreadPct, confident: r.confident, quotes: r.quotes },
      { usd: 0, sources: 0, spreadPct: null, confident: false, quotes: {} },
    );
  } finally { restore(); }
});

test('hiveUsd: returns just the numeric median for hive', async () => {
  // XREF.hive = paprika hive-hive, cap hive, coinbase HIVE-USD (no kraken)
  const restore = installFetch([
    ['coinpaprika.com/v1/tickers/hive-hive', paprika(0.31)],
    ['coincap.io/v2/assets/hive', coincap(0.30)],
    ['coinbase.com/v2/prices/HIVE-USD', coinbase(0.305)],
  ]);
  try {
    const usd = await hiveUsd();
    assert.equal(typeof usd, 'number');
    assert.ok(usd >= 0.30 && usd <= 0.31, `hive median ${usd}`);
  } finally { restore(); }
});
