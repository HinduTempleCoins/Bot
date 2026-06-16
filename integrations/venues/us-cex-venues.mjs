// us-cex-venues.mjs — READ-ONLY granular market-data adapters for US centralized exchanges.
// NO keys. NO trading. NO secrets. Public keyless market-data REST endpoints only.
//
// Granularity matches the HIVE-Engine analytics (hive-engine-market.mjs): per market we surface
// ticker last/bid/ask + 24h volume, and an order-book DEPTH snapshot wherever the public API allows.
//
// Each venue in US_CEX_VENUES is { name, publicApi, usAvailability, read() }. read() returns a
// uniform shape so the briefs/digest/HUD can consume every venue the same way:
//
//   { venue, asOf, markets: [{ symbol, bid, ask, last, vol24h }], depth?: { bids, asks }, note }
//
// Soft-fail-never-throw: any dead source / garbage payload returns the safe empty shape with a note;
// it never throws to the caller. Venues with NO public market-data API are marked publicApi:false and
// return the marked note — we do NOT fabricate prices for them.
//
//   import { US_CEX_VENUES, collectUsCexVenues, handler, __setFetch } from './us-cex-venues.mjs'
//   node integrations/venues/us-cex-venues.mjs            # live snapshot of every venue (BTC-USD)
//   node integrations/venues/us-cex-venues.mjs coinbase   # one venue
//
// HTTP: GET /api/venues/us-cex  -> { ok, asOf, venues: [...] }

import { fileURLToPath } from 'node:url';

// ── injectable fetch (tests inject a fake; default is the global) ───────────────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'MELEK-Witness/us-cex-venues (read-only market data)' };
const TIMEOUT_MS = +(process.env.US_CEX_TIMEOUT_MS || 8000);

// number coercion: positive finite -> number, else null (so "missing" reads as null, not 0/NaN).
const n = (x) => { const v = +x; return Number.isFinite(v) ? v : null; };

// fetch JSON with a timeout, soft-fail to null on any error / non-2xx / bad JSON.
async function getJson(url, opts = {}) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), TIMEOUT_MS) : null;
  try {
    const res = await _fetch(url, { headers: UA, signal: ac ? ac.signal : undefined, ...opts });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

// the standard empty result for one venue (soft-fail / no-data path).
function empty(venue, note, extra = {}) {
  return { venue, asOf: new Date().toISOString(), markets: [], note, ...extra };
}

// trim a raw order book to the top `depth` levels in the uniform [[price, size], ...] shape.
function topLevels(levels, depth = 10) {
  if (!Array.isArray(levels)) return [];
  return levels.slice(0, depth)
    .map((l) => (Array.isArray(l) ? [n(l[0]), n(l[1])] : [n(l && l.price), n(l && (l.size ?? l.amount ?? l.quantity))]))
    .filter((l) => l[0] != null && l[1] != null);
}

const DEPTH = +(process.env.US_CEX_DEPTH || 10);

// ── per-venue readers (keyless public endpoints) ─────────────────────────────────────
// Each takes the market symbol in the VENUE'S native form and returns the uniform shape.

// Coinbase Exchange — products/<id>/ticker + /book?level=2.  id like BTC-USD.
async function readCoinbase(symbol = 'BTC-USD') {
  const base = 'https://api.exchange.coinbase.com';
  const [tk, book] = await Promise.all([
    getJson(`${base}/products/${encodeURIComponent(symbol)}/ticker`),
    getJson(`${base}/products/${encodeURIComponent(symbol)}/book?level=2`),
  ]);
  if (!tk) return empty('Coinbase', 'no ticker (source unavailable)');
  const markets = [{ symbol, bid: n(tk.bid), ask: n(tk.ask), last: n(tk.price), vol24h: n(tk.volume) }];
  const depth = book ? { bids: topLevels(book.bids, DEPTH), asks: topLevels(book.asks, DEPTH) } : undefined;
  return { venue: 'Coinbase', asOf: new Date().toISOString(), markets, depth, note: 'api.exchange.coinbase.com (keyless)' };
}

// Kraken — 0/public/Ticker?pair= + 0/public/Depth?pair=.  pair like XBTUSD / BTCUSD.
async function readKraken(symbol = 'XBTUSD') {
  const base = 'https://api.kraken.com/0/public';
  const [tk, dp] = await Promise.all([
    getJson(`${base}/Ticker?pair=${encodeURIComponent(symbol)}`),
    getJson(`${base}/Depth?pair=${encodeURIComponent(symbol)}&count=${DEPTH}`),
  ]);
  const trow = tk && tk.result && Object.values(tk.result)[0];
  if (!trow) return empty('Kraken', 'no ticker (source unavailable)');
  // Kraken: a=[ask,...], b=[bid,...], c=[last,...], v=[today,last24h].
  const markets = [{
    symbol,
    bid: n(trow.b && trow.b[0]),
    ask: n(trow.a && trow.a[0]),
    last: n(trow.c && trow.c[0]),
    vol24h: n(trow.v && trow.v[1]),
  }];
  const drow = dp && dp.result && Object.values(dp.result)[0];
  const depth = drow ? { bids: topLevels(drow.bids, DEPTH), asks: topLevels(drow.asks, DEPTH) } : undefined;
  return { venue: 'Kraken', asOf: new Date().toISOString(), markets, depth, note: 'api.kraken.com/0/public (keyless)' };
}

// Gemini — v1/pubticker/<sym> + v1/book/<sym>.  sym like btcusd.
async function readGemini(symbol = 'btcusd') {
  const base = 'https://api.gemini.com/v1';
  const [tk, book] = await Promise.all([
    getJson(`${base}/pubticker/${encodeURIComponent(symbol)}`),
    getJson(`${base}/book/${encodeURIComponent(symbol)}?limit_bids=${DEPTH}&limit_asks=${DEPTH}`),
  ]);
  if (!tk) return empty('Gemini', 'no ticker (source unavailable)');
  const markets = [{ symbol, bid: n(tk.bid), ask: n(tk.ask), last: n(tk.last), vol24h: n(tk.volume && (tk.volume.BTC ?? Object.values(tk.volume).find((v) => +v > 0))) }];
  const depth = book ? { bids: topLevels(book.bids, DEPTH), asks: topLevels(book.asks, DEPTH) } : undefined;
  return { venue: 'Gemini', asOf: new Date().toISOString(), markets, depth, note: 'api.gemini.com/v1 (keyless)' };
}

// Bitstamp — api/v2/ticker/<sym>/ + api/v2/order_book/<sym>/.  sym like btcusd.
async function readBitstamp(symbol = 'btcusd') {
  const base = 'https://www.bitstamp.net/api/v2';
  const [tk, book] = await Promise.all([
    getJson(`${base}/ticker/${encodeURIComponent(symbol)}/`),
    getJson(`${base}/order_book/${encodeURIComponent(symbol)}/`),
  ]);
  if (!tk) return empty('Bitstamp', 'no ticker (source unavailable)');
  const markets = [{ symbol, bid: n(tk.bid), ask: n(tk.ask), last: n(tk.last), vol24h: n(tk.volume) }];
  const depth = book ? { bids: topLevels(book.bids, DEPTH), asks: topLevels(book.asks, DEPTH) } : undefined;
  return { venue: 'Bitstamp', asOf: new Date().toISOString(), markets, depth, note: 'www.bitstamp.net/api/v2 (keyless)' };
}

// Crypto.com — v2/public/get-ticker?instrument_name= + get-book.  inst like BTC_USD / BTCUSD-PERP.
async function readCryptoCom(symbol = 'BTC_USD') {
  const base = 'https://api.crypto.com/v2/public';
  const [tk, book] = await Promise.all([
    getJson(`${base}/get-ticker?instrument_name=${encodeURIComponent(symbol)}`),
    getJson(`${base}/get-book?instrument_name=${encodeURIComponent(symbol)}&depth=${DEPTH}`),
  ]);
  const d = tk && tk.result && tk.result.data;
  const row = Array.isArray(d) ? d[0] : d;
  if (!row) return empty('Crypto.com', 'no ticker (source unavailable)');
  // fields: b=best bid, k=best ask, a=last, v=24h volume, h/l/c=high/low/change.
  const markets = [{ symbol, bid: n(row.b), ask: n(row.k), last: n(row.a), vol24h: n(row.v) }];
  const bk = book && book.result && book.result.data && book.result.data[0];
  const depth = bk ? { bids: topLevels(bk.bids, DEPTH), asks: topLevels(bk.asks, DEPTH) } : undefined;
  return { venue: 'Crypto.com', asOf: new Date().toISOString(), markets, depth, note: 'api.crypto.com/v2/public (keyless)' };
}

// OKX — api/v5/market/ticker?instId= + market/books?instId=.  instId like BTC-USDT / BTC-USD.
async function readOkx(symbol = 'BTC-USDT') {
  const base = 'https://www.okx.com/api/v5/market';
  const [tk, book] = await Promise.all([
    getJson(`${base}/ticker?instId=${encodeURIComponent(symbol)}`),
    getJson(`${base}/books?instId=${encodeURIComponent(symbol)}&sz=${DEPTH}`),
  ]);
  const row = tk && tk.data && tk.data[0];
  if (!row) return empty('OKX (US)', 'no ticker (source unavailable)');
  const markets = [{ symbol, bid: n(row.bidPx), ask: n(row.askPx), last: n(row.last), vol24h: n(row.vol24h) }];
  const bk = book && book.data && book.data[0];
  // OKX book levels are [price, size, liquidatedOrders, numOrders] — topLevels keeps [price,size].
  const depth = bk ? { bids: topLevels(bk.bids, DEPTH), asks: topLevels(bk.asks, DEPTH) } : undefined;
  return { venue: 'OKX (US)', asOf: new Date().toISOString(), markets, depth, note: 'www.okx.com/api/v5 (keyless; US access rolling out by state)' };
}

// Binance.US — api/v3/ticker/24hr?symbol= + api/v3/depth?symbol=.  symbol like BTCUSD / BTCUSDT.
async function readBinanceUs(symbol = 'BTCUSD') {
  const base = 'https://api.binance.us/api/v3';
  const [tk, book, bookTk] = await Promise.all([
    getJson(`${base}/ticker/24hr?symbol=${encodeURIComponent(symbol)}`),
    getJson(`${base}/depth?symbol=${encodeURIComponent(symbol)}&limit=${DEPTH}`),
    getJson(`${base}/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`),
  ]);
  if (!tk || tk.code != null) return empty('Binance.US', 'no ticker (source unavailable or symbol not listed)');
  const markets = [{
    symbol,
    bid: n((bookTk && bookTk.bidPrice) ?? tk.bidPrice),
    ask: n((bookTk && bookTk.askPrice) ?? tk.askPrice),
    last: n(tk.lastPrice),
    vol24h: n(tk.volume),
  }];
  const depth = book && book.bids ? { bids: topLevels(book.bids, DEPTH), asks: topLevels(book.asks, DEPTH) } : undefined;
  return { venue: 'Binance.US', asOf: new Date().toISOString(), markets, depth, note: 'api.binance.us/api/v3 (keyless)' };
}

// CEX.io — api/ticker/<sym1>/<sym2> + api/order_book/<sym1>/<sym2>.  e.g. BTC/USD.
async function readCexIo(symbol = 'BTC/USD') {
  const [s1, s2] = symbol.split('/');
  if (!s1 || !s2) return empty('CEX.io', 'symbol must be SYM1/SYM2');
  const base = 'https://cex.io/api';
  const [tk, book] = await Promise.all([
    getJson(`${base}/ticker/${encodeURIComponent(s1)}/${encodeURIComponent(s2)}`),
    getJson(`${base}/order_book/${encodeURIComponent(s1)}/${encodeURIComponent(s2)}?depth=${DEPTH}`),
  ]);
  if (!tk || tk.error) return empty('CEX.io', 'no ticker (source unavailable)');
  const markets = [{ symbol, bid: n(tk.bid), ask: n(tk.ask), last: n(tk.last), vol24h: n(tk.volume) }];
  const depth = book ? { bids: topLevels(book.bids, DEPTH), asks: topLevels(book.asks, DEPTH) } : undefined;
  return { venue: 'CEX.io', asOf: new Date().toISOString(), markets, depth, note: 'cex.io/api (keyless)' };
}

// venues with NO public market-data API — honest stub: marked note, never fabricated data.
function noPublicApi(name, usAvailability) {
  return {
    name,
    publicApi: false,
    usAvailability,
    read: async () => empty(name, 'retail/no public market data', { publicApi: false }),
  };
}

// ── the registry ─────────────────────────────────────────────────────────────────────
// `read(symbol?)` — pass a venue-native symbol or rely on the BTC-USD default. Public-API venues
// carry a `defaultSymbol` so collectUsCexVenues() can snapshot BTC on every one uniformly.
export const US_CEX_VENUES = [
  { name: 'Coinbase',         publicApi: true,  usAvailability: 'US-full (Coinbase Exchange).',                          defaultSymbol: 'BTC-USD',  read: readCoinbase },
  { name: 'Kraken',           publicApi: true,  usAvailability: 'US-full (most states).',                                defaultSymbol: 'XBTUSD',   read: readKraken },
  { name: 'Crypto.com',       publicApi: true,  usAvailability: 'US app + exchange; product set narrower than global.',  defaultSymbol: 'BTC_USD',  read: readCryptoCom },
  { name: 'OKX (US)',         publicApi: true,  usAvailability: 'US access relaunched 2025, rolling out by state.',      defaultSymbol: 'BTC-USDT', read: readOkx },
  { name: 'Gemini',           publicApi: true,  usAvailability: 'US-full (NY NYDFS trust).',                             defaultSymbol: 'btcusd',   read: readGemini },
  { name: 'Binance.US',       publicApi: true,  usAvailability: 'Separate US entity; not all states; rails restricted at times.', defaultSymbol: 'BTCUSD', read: readBinanceUs },
  { name: 'Bitstamp',         publicApi: true,  usAvailability: 'US-supported (Robinhood-owned).',                       defaultSymbol: 'btcusd',   read: readBitstamp },
  { name: 'CEX.io',           publicApi: true,  usAvailability: 'US-supported; varies by state.',                        defaultSymbol: 'BTC/USD',  read: readCexIo },
  // ── no public keyless market-data API: retail brokers / consumer rails / institutional ──
  noPublicApi('Robinhood Crypto', 'US broker; crypto withdrawals limited historically; not all states.'),
  noPublicApi('eToro',            'US entity (eToro USA); copy-trading broker — no public market-data REST.'),
  noPublicApi('Uphold',           'US consumer multi-asset; no public market-data REST (private quote API).'),
  noPublicApi('Bullish',          'Institutional-leaning; US retail status varies — no public retail market-data REST.'),
  noPublicApi('Cash App',         'US consumer BTC rail (Block); no public market-data REST.'),
  noPublicApi('PayPal/Venmo',     'US consumer crypto via PayPal/Venmo; no public market-data REST.'),
  noPublicApi('River',            'US BTC-focused brokerage; no public market-data REST.'),
  noPublicApi('Swan',             'US BTC-only brokerage; no public market-data REST.'),
  noPublicApi('Coinmama',         'US brokerage on-ramp (varies by state); no public market-data REST.'),
];

// ── collect: snapshot every venue, soft-fail per source ───────────────────────────────
// symbolMap: optional { '<venue name>': '<override symbol>' }. Public-API venues without an
// override use their defaultSymbol (BTC). Each entry that throws is caught and returns the
// empty shape so one dead venue never breaks the collection.
export async function collectUsCexVenues(symbolMap = {}) {
  const venues = await Promise.all(US_CEX_VENUES.map(async (v) => {
    const meta = { name: v.name, publicApi: v.publicApi, usAvailability: v.usAvailability };
    try {
      const sym = symbolMap[v.name] || v.defaultSymbol;
      const r = await v.read(sym);
      return { ...meta, ...r };
    } catch (e) {
      return { ...meta, ...empty(v.name, `read failed: ${(e && e.message) || 'error'}`) };
    }
  }));
  return { ok: true, asOf: new Date().toISOString(), venues };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────────────
// GET /api/venues/us-cex  -> the full collection. Soft-fails to { ok:false } on any error.
export async function handler(req, res) {
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const path = (req.url || '/').split('?')[0];
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' && (path === '/api/venues/us-cex' || path === '/')) {
    try {
      return sendJson(200, await collectUsCexVenues());
    } catch (e) {
      return sendJson(200, { ok: false, error: (e && e.message) || 'error', venues: [] });
    }
  }
  return sendJson(404, { ok: false, error: 'not found' });
}

export default { US_CEX_VENUES, collectUsCexVenues, handler, __setFetch };

// ── CLI ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = (process.argv[2] || '').toLowerCase();
  const fmt = (x, d = 2) => (x == null ? '—' : (+x).toLocaleString(undefined, { maximumFractionDigits: d }));
  const { venues } = await collectUsCexVenues();
  console.log('US centralized-exchange market data (READ-ONLY, keyless public endpoints, no trading)');
  console.log('─'.repeat(96));
  for (const v of venues) {
    if (only && !v.name.toLowerCase().includes(only)) continue;
    if (!v.publicApi) { console.log(`${v.name.padEnd(18)} (no public market API) — ${v.note}`); continue; }
    const m = v.markets[0];
    if (!m) { console.log(`${v.name.padEnd(18)} — ${v.note}`); continue; }
    const depthN = v.depth ? `${v.depth.bids.length}/${v.depth.asks.length}` : '—';
    console.log(`${v.name.padEnd(18)} ${String(m.symbol).padEnd(10)} last ${fmt(m.last).padStart(12)}  bid ${fmt(m.bid).padStart(12)}  ask ${fmt(m.ask).padStart(12)}  vol24h ${fmt(m.vol24h, 3).padStart(14)}  depth(b/a) ${depthN}`);
  }
  console.log('─'.repeat(96));
  console.log('Advisory / informational only — no keys, no orders, no secrets. Public market data only.');
}
