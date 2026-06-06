// he-token-metrics.mjs — per-token daily metrics for a HIVE-Engine token dashboard (queue #45).
// Aggregates three existing read-only modules into one flat row per token:
//   - hive-engine-market.mjs  → price / 24h volume / order books (bid/ask, walls)
//   - market-depth.mjs        → whale concentration (top-3 %, issuer %)
//   - holders.mjs             → holder count + concentration (real outside vs affiliated)
// Never throws; every field soft-fails to null so a single broken source can't sink the row.
// Follows the macro.mjs pattern: ESM, __setFetch hook, CLI guarded by process.argv[1].
//
//   node integrations/soapbox/he-token-metrics.mjs <SYMBOL> [SYMBOL2 ...]
//   import { tokenMetrics, dashboard } from './he-token-metrics.mjs'

import { market } from '../hive-engine-market.mjs';
import { ownership } from '../market-depth.mjs';
import { holders } from '../holders.mjs';

// __setFetch hook (macro.mjs parity). The underlying he-client manages its own fetch, so this hook
// only governs anything this module fetches directly (none today) — kept for a uniform surface and
// so the CLI/tests can swap globalThis.fetch without touching the network.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// numeric coercion that yields null (not 0) on garbage — so "missing" reads as null, not a real value.
function n(x) { const v = +x; return Number.isFinite(v) ? v : null; }
function pct(x, d = 2) { const v = n(x); return v == null ? null : +v.toFixed(d); }

// safe single-source read: never lets one source's throw escape; returns fallback instead.
async function soft(p, fallback = null) {
  try { const v = await p; return v == null ? fallback : v; } catch { return fallback; }
}

/**
 * One flat metrics row for a single token. Each field soft-fails to null.
 * @param {string} symbol
 * @param {object} [deps] optional injected stubs for offline tests: { market, ownership, holders }
 * @returns {Promise<{symbol,price,volume24h,holders,top3Pct,issuerPct,buyWallHive,sellWallQty,spreadPct,lastUpdated,provenance}>}
 */
export async function tokenMetrics(symbol, deps = {}) {
  const mkt = deps.market || market;
  const own = deps.ownership || ownership;
  const hld = deps.holders || holders;

  const [metrics, buys, sells, ownData, holdData] = await Promise.all([
    soft(Promise.resolve().then(() => mkt.metrics(symbol))),
    soft(Promise.resolve().then(() => mkt.buyBook(symbol, 8)), []),
    soft(Promise.resolve().then(() => mkt.sellBook(symbol, 8)), []),
    soft(Promise.resolve().then(() => own(symbol))),
    soft(Promise.resolve().then(() => hld(symbol))),
  ]);

  const buyBook = Array.isArray(buys) ? buys : [];
  const sellBook = Array.isArray(sells) ? sells : [];

  // price + 24h volume from market metrics
  const price = metrics ? n(metrics.lastPrice) : null;
  const volume24h = metrics ? n(metrics.volume) : null;

  // bid/ask → spread%. Prefer book tops; fall back to metrics bid/ask.
  const bid = n(buyBook[0]?.price) ?? (metrics ? n(metrics.highestBid) : null);
  const ask = n(sellBook[0]?.price) ?? (metrics ? n(metrics.lowestAsk) : null);
  const spreadPct = (bid != null && ask != null && ask > 0) ? pct((ask - bid) / ask * 100) : null;

  // walls: buy support measured in HIVE, sell resistance measured in token quantity
  const buyWallHive = buyBook.length
    ? pct(buyBook.reduce((a, o) => a + (n(o.price) || 0) * (n(o.quantity) || 0), 0))
    : null;
  const sellWallQty = sellBook.length
    ? pct(sellBook.reduce((a, o) => a + (n(o.quantity) || 0), 0))
    : null;

  // concentration: top-3 % from ownership; issuer % prefer holders (named/affiliate-aware), else ownership
  const top3Pct = ownData ? pct(ownData.top3) : null;
  const issuerPct = (holdData && holdData.issuerPct != null) ? pct(holdData.issuerPct)
    : (ownData ? pct(ownData.issuerPct) : null);

  // holder count: holders.counts.total is the full balance-row count
  const holderCount = holdData?.counts ? (n(holdData.counts.total)) : null;

  // provenance: which sources actually answered (operator can see what's real vs missing)
  const provenance = {
    market: metrics != null,
    books: buyBook.length > 0 || sellBook.length > 0,
    ownership: ownData != null,
    holders: holdData != null,
  };

  return {
    symbol,
    price,
    volume24h,
    holders: holderCount,
    top3Pct,
    issuerPct,
    buyWallHive,
    sellWallQty,
    spreadPct,
    lastUpdated: new Date().toISOString(),
    provenance,
  };
}

/**
 * Metrics rows for many tokens (the dashboard). Best-effort; a failing symbol still yields a row
 * (all fields null) rather than dropping out.
 * @param {string[]} symbols
 * @param {object} [deps]
 * @returns {Promise<Array>}
 */
// build the soft-fail row for a symbol given an error (so the #284 honest-empty row is unit-testable
// without forcing the internally-soft tokenMetrics to throw on the network). #284 soft-fail-honest:
// the row carries the REASON it's empty (`error`) instead of swallowing it — a dashboard can show "why"
// rather than a silent blank row.
export function emptyRow(symbol, error) {
  return {
    symbol, price: null, volume24h: null, holders: null, top3Pct: null, issuerPct: null,
    buyWallHive: null, sellWallQty: null, spreadPct: null, lastUpdated: new Date().toISOString(),
    provenance: { market: false, books: false, ownership: false, holders: false },
    ...(error ? { error: error && error.message ? error.message : String(error) } : {}),
  };
}

export async function dashboard(symbols = [], deps = {}) {
  const list = Array.isArray(symbols) ? symbols : [];
  return Promise.all(list.map((s) => tokenMetrics(s, deps).catch((e) => emptyRow(s, e))));
}

if (process.argv[1] && process.argv[1].endsWith('he-token-metrics.mjs')) {
  const syms = process.argv.slice(2);
  let targets = syms;
  if (!targets.length) {
    try { ({ ISSUED_TOKENS: targets } = await import('../watchlist.mjs')); } catch { targets = ['VKBT', 'CURE']; }
  }
  console.log('HIVE-Engine token daily metrics (read-only)\n' + '─'.repeat(72));
  const rows = await dashboard(targets);
  for (const r of rows) {
    console.log(`\n${r.symbol}`);
    console.log(`  price ${r.price ?? '—'}  vol24h ${r.volume24h ?? '—'}  spread ${r.spreadPct != null ? r.spreadPct + '%' : '—'}`);
    console.log(`  holders ${r.holders ?? '—'}  top3 ${r.top3Pct != null ? r.top3Pct + '%' : '—'}  issuer ${r.issuerPct != null ? r.issuerPct + '%' : '—'}`);
    console.log(`  buyWall ${r.buyWallHive != null ? r.buyWallHive + ' HIVE' : '—'}  sellWall ${r.sellWallQty != null ? r.sellWallQty + ' tokens' : '—'}`);
    const ok = Object.entries(r.provenance).filter(([, v]) => v).map(([k]) => k).join(',') || 'none';
    console.log(`  sources: ${ok}`);
  }
}
