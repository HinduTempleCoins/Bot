// perps-venues.mjs — READ-ONLY analytics adapters for on-chain PERPS / DERIVATIVES venues.
//
// The derivatives-side companion to the spot/HIVE-Engine analytics (hive-engine-market.mjs):
// per-market mark/index price, funding rate, open interest, 24h volume, and a derivable
// edge/signal, across the high-volume on-chain perp venues. Keyless public APIs only.
//
//   NO keys. NO trading. NO signing. READ-ONLY. Soft-fail-never-throw, injectable fetch.
//
// Venues (kind:'P' = perps):
//   Hyperliquid (own L1)  · dYdX v4 (own chain) · GMX (Arbitrum) · Vertex (Arbitrum)
//   Aster (BNB/multi)     · Lighter (zk L2)     · edgeX          · ApeX (omni)
//   Paradex (Starknet)    · Bluefin (Sui)       · + DefiLlama derivatives overview (fallback)
//
//   import { PERPS_VENUES, collectPerpsVenues, handler, __setFetch } from './venues/perps-venues.mjs'
//   node integrations/venues/perps-venues.mjs            # print a live snapshot (network)
//   node integrations/venues/perps-venues.mjs hyperliquid dydx   # only named venues
//
// Per-venue read() returns:
//   { venue, asOf, ok, source, volume24hUsd, openInterestUsd?, markets:[
//       { symbol, markPrice, indexPrice?, funding, oi, oiUsd?, vol24h } ],
//     edgeSignals?, note? }
//   markPrice/indexPrice are quote-USD; funding is the venue's native funding rate (per its
//   interval — see note); oi is base-unit open interest; oiUsd is oi*markPrice when derivable;
//   vol24h is per-market 24h NOTIONAL in USD where the venue reports it.

import { fileURLToPath } from 'node:url';

// ── injectable fetch (offline tests inject; never hits network in the suite) ──────────────────
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── tiny helpers (all soft-fail) ──────────────────────────────────────────────────────────────
const num = (x) => { const n = +x; return Number.isFinite(n) ? n : 0; };
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const nowIso = () => new Date().toISOString();

// Fetch JSON with a timeout; returns null on ANY failure (never throws).
async function getJson(url, opts = {}, ms = 12000) {
  try {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => { try { ctl.abort(); } catch {} }, ms) : null;
    const res = await _fetch(url, { ...opts, signal: ctl ? ctl.signal : undefined });
    if (t) clearTimeout(t);
    if (!res || (typeof res.ok === 'boolean' && !res.ok)) return null;
    const txt = typeof res.text === 'function' ? await res.text() : null;
    if (txt == null) return null;
    // DefiLlama-style plaintext paywall guards parse as garbage → soft-null.
    if (typeof txt === 'string' && txt.trim() && txt.trim()[0] !== '{' && txt.trim()[0] !== '[') return null;
    return JSON.parse(txt);
  } catch { return null; }
}
async function postJson(url, body, ms = 12000) {
  return getJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, ms);
}

// Top-N markets by 24h USD volume, so a snapshot stays legible.
function topByVol(markets, n = 25) {
  return [...markets].sort((a, b) => num(b.vol24h) - num(a.vol24h)).slice(0, n);
}
// Derive a small edge/signal block from a market list (funding extremes + concentration).
function edgeFrom(markets) {
  if (!markets.length) return undefined;
  const withFunding = markets.filter((m) => Number.isFinite(+m.funding));
  let topFundingLong = null, topFundingShort = null;
  for (const m of withFunding) {
    if (!topFundingLong || +m.funding > +topFundingLong.funding) topFundingLong = m;
    if (!topFundingShort || +m.funding < +topFundingShort.funding) topFundingShort = m;
  }
  const totVol = markets.reduce((s, m) => s + num(m.vol24h), 0);
  const sorted = topByVol(markets, 1);
  const top = sorted[0];
  return {
    // most-positive funding = crowded longs pay shorts (mean-revert-short watch);
    // most-negative = crowded shorts pay longs (mean-revert-long watch).
    crowdedLongs: topFundingLong ? { symbol: topFundingLong.symbol, funding: num(topFundingLong.funding) } : null,
    crowdedShorts: topFundingShort ? { symbol: topFundingShort.symbol, funding: num(topFundingShort.funding) } : null,
    topVolumeMarket: top ? { symbol: top.symbol, vol24h: num(top.vol24h) } : null,
    volumeConcentration: totVol > 0 && top ? +(num(top.vol24h) / totVol).toFixed(4) : 0,
  };
}

const fail = (venue, chain, note) => ({ venue, chain, kind: 'P', asOf: nowIso(), ok: false, markets: [], volume24hUsd: 0, note });
const okEnv = (venue, chain, source, markets, extra = {}) => ({
  venue, chain, kind: 'P', asOf: nowIso(), ok: true, source,
  volume24hUsd: extra.volume24hUsd != null ? extra.volume24hUsd : markets.reduce((s, m) => s + num(m.vol24h), 0),
  ...(extra.openInterestUsd != null ? { openInterestUsd: extra.openInterestUsd } : {}),
  markets: topByVol(markets), edgeSignals: edgeFrom(markets),
  ...(extra.note ? { note: extra.note } : {}),
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// HYPERLIQUID — own L1; ~60-70% of on-chain perps. POST /info { type: metaAndAssetCtxs }.
// Returns [meta, ctxs] index-aligned. ctx: { markPx, oraclePx, funding (hourly), openInterest
// (base coins), dayNtlVlm (USD notional 24h), prevDayPx }.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readHyperliquid() {
  const V = 'Hyperliquid', C = 'Hyperliquid L1';
  const d = await postJson('https://api.hyperliquid.xyz/info', { type: 'metaAndAssetCtxs' });
  if (!Array.isArray(d) || d.length < 2 || !d[0] || !Array.isArray(d[0].universe) || !Array.isArray(d[1])) {
    return fail(V, C, 'metaAndAssetCtxs unavailable or malformed');
  }
  const [meta, ctxs] = d;
  const markets = [];
  let oiUsdTotal = 0;
  for (let i = 0; i < meta.universe.length; i++) {
    const u = meta.universe[i], ctx = ctxs[i];
    if (!u || !ctx || u.isDelisted) continue;
    const mark = num(ctx.markPx);
    const oi = num(ctx.openInterest);
    const oiUsd = oi * mark;
    oiUsdTotal += oiUsd;
    markets.push({
      symbol: u.name,
      markPrice: mark,
      indexPrice: num(ctx.oraclePx),
      funding: num(ctx.funding),   // hourly
      oi, oiUsd,
      vol24h: num(ctx.dayNtlVlm),  // already USD notional
    });
  }
  return okEnv(V, C, 'api.hyperliquid.xyz/info metaAndAssetCtxs', markets, {
    openInterestUsd: oiUsdTotal, note: 'funding=hourly; oiUsd=openInterest*markPx',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// dYdX v4 — own chain. GET indexer/v4/perpetualMarkets. market: { oraclePrice, nextFundingRate
// (1h), openInterest (base), volume24H (USD), priceChange24H }. No on-venue markPrice → use oracle.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readDydx() {
  const V = 'dYdX', C = 'dYdX Chain (v4)';
  const d = await getJson('https://indexer.dydx.trade/v4/perpetualMarkets');
  if (!d || !d.markets || typeof d.markets !== 'object') return fail(V, C, 'v4 indexer perpetualMarkets unavailable');
  const markets = [];
  let oiUsdTotal = 0;
  for (const k of Object.keys(d.markets)) {
    const m = d.markets[k];
    if (!m || m.status === 'CANCEL_ONLY' || m.status === 'FINAL_SETTLEMENT') continue;
    const px = num(m.oraclePrice);
    const oi = num(m.openInterest);
    const oiUsd = oi * px;
    oiUsdTotal += oiUsd;
    markets.push({
      symbol: m.ticker || k,
      markPrice: px, indexPrice: px,
      funding: num(m.nextFundingRate),  // 1h
      oi, oiUsd,
      vol24h: num(m.volume24H),         // USD
    });
  }
  if (!markets.length) return fail(V, C, 'no active markets parsed');
  return okEnv(V, C, 'indexer.dydx.trade/v4/perpetualMarkets', markets, {
    openInterestUsd: oiUsdTotal, note: 'markPrice=oraclePrice; funding=nextFundingRate(1h)',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// GMX (Arbitrum) — keyless infra API gives per-token tickers (min/max px, 30dp) and the market
// list. Funding/OI are on-chain reader contract reads (not exposed keyless) → omitted, prices only.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readGmx() {
  const V = 'GMX', C = 'Arbitrum';
  const [tickers, markets] = await Promise.all([
    getJson('https://arbitrum-api.gmxinfra.io/prices/tickers'),
    getJson('https://arbitrum-api.gmxinfra.io/markets'),
  ]);
  if (!Array.isArray(tickers) || !tickers.length) return fail(V, C, 'gmxinfra tickers unavailable');
  // GMX prices are integers scaled by 10^(30 - tokenDecimals); we don't have decimals here,
  // so report the mid of min/max in the venue's native scaled units AND a usd-normalized guess
  // is unsafe → expose the raw scaled mid as markPrice and flag the scale in note.
  const out = [];
  for (const t of tickers) {
    if (!t || !t.tokenSymbol) continue;
    const mid = (num(t.minPrice) + num(t.maxPrice)) / 2;
    out.push({ symbol: t.tokenSymbol, markPrice: mid, indexPrice: mid, funding: 0, oi: 0, vol24h: 0 });
  }
  const listedPerps = Array.isArray(markets && markets.markets)
    ? markets.markets.filter((m) => m && m.isListed && m.name && !/SWAP-ONLY/.test(m.name)).length
    : 0;
  return okEnv(V, C, 'arbitrum-api.gmxinfra.io', out, {
    volume24hUsd: 0,
    note: `markPrice in GMX scaled units (10^(30-decimals)); funding/OI need on-chain reader reads (keyless API has none); ${listedPerps} listed perp markets`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Aster (BNB / multi) — Binance-fapi-style: premiumIndex (mark/index/lastFundingRate),
// ticker/24hr (quoteVolume USD), openInterest per-symbol. We join premiumIndex+24hr; OI is a
// per-symbol call so we skip it in bulk (kept derivable per-market on demand).
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readAster() {
  const V = 'Aster', C = 'BNB Chain (+multi)';
  const [prem, tick] = await Promise.all([
    getJson('https://fapi.asterdex.com/fapi/v1/premiumIndex'),
    getJson('https://fapi.asterdex.com/fapi/v1/ticker/24hr'),
  ]);
  if (!Array.isArray(prem) || !prem.length) return fail(V, C, 'asterdex premiumIndex unavailable');
  const volBySym = new Map();
  if (Array.isArray(tick)) for (const t of tick) if (t && t.symbol) volBySym.set(t.symbol, num(t.quoteVolume));
  const markets = [];
  for (const p of prem) {
    if (!p || !p.symbol) continue;
    markets.push({
      symbol: p.symbol,
      markPrice: num(p.markPrice), indexPrice: num(p.indexPrice),
      funding: num(p.lastFundingRate),
      oi: 0,
      vol24h: volBySym.get(p.symbol) || 0,  // quoteVolume = USD-quote notional
    });
  }
  return okEnv(V, C, 'fapi.asterdex.com', markets, {
    note: 'funding=lastFundingRate; vol24h=quoteVolume(24hr); per-market OI via /openInterest?symbol=',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Lighter (zk L2) — GET /api/v1/orderBookDetails: per-perp last_trade_price, open_interest
// (base), daily_quote_token_volume (USD). No funding in this endpoint.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readLighter() {
  const V = 'Lighter', C = 'Lighter zkL2';
  const d = await getJson('https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails');
  const rows = d && Array.isArray(d.order_book_details) ? d.order_book_details : null;
  if (!rows || !rows.length) return fail(V, C, 'zklighter orderBookDetails unavailable');
  const markets = [];
  let oiUsdTotal = 0;
  for (const r of rows) {
    if (!r || r.market_type !== 'perp' || r.status !== 'active') continue;
    const px = num(r.last_trade_price);
    const oi = num(r.open_interest);
    const oiUsd = oi * px;
    oiUsdTotal += oiUsd;
    markets.push({
      symbol: r.symbol, markPrice: px, indexPrice: px,
      funding: 0, oi, oiUsd,
      vol24h: num(r.daily_quote_token_volume),  // USD
    });
  }
  if (!markets.length) return fail(V, C, 'no active perp markets parsed');
  return okEnv(V, C, 'mainnet.zklighter.elliot.ai', markets, {
    openInterestUsd: oiUsdTotal,
    note: 'markPrice=last_trade_price; funding not in orderBookDetails; vol24h=daily_quote_token_volume',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// edgeX — metadata gives contractList (id/name); per-contract ticker gives lastPrice, indexPrice,
// markPrice, openInterest (base), fundingRate, value (24h USD). Limit fan-out to top contracts.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readEdgex(maxContracts = 40) {
  const V = 'edgeX', C = 'edgeX (StarkEx)';
  const meta = await getJson('https://pro.edgex.exchange/api/v1/public/meta/getMetaData');
  const list = meta && meta.data && Array.isArray(meta.data.contractList) ? meta.data.contractList : null;
  if (!list || !list.length) return fail(V, C, 'edgex getMetaData unavailable');
  const ids = list.filter((c) => c && c.contractId).slice(0, maxContracts);
  const tickers = await Promise.all(ids.map((c) =>
    getJson(`https://pro.edgex.exchange/api/v1/public/quote/getTicker?contractId=${encodeURIComponent(c.contractId)}`)
      .then((t) => (t && Array.isArray(t.data) && t.data[0]) ? t.data[0] : null)
      .catch(() => null)
  ));
  const markets = [];
  let oiUsdTotal = 0;
  for (const t of tickers) {
    if (!t || !t.contractName) continue;
    const mark = num(t.markPrice);
    const oi = num(t.openInterest);
    const oiUsd = oi * mark;
    oiUsdTotal += oiUsd;
    markets.push({
      symbol: t.contractName, markPrice: mark, indexPrice: num(t.indexPrice),
      funding: num(t.fundingRate), oi, oiUsd,
      vol24h: num(t.value),  // value = 24h quote (USD) turnover
    });
  }
  if (!markets.length) return fail(V, C, 'no ticker rows parsed');
  return okEnv(V, C, 'pro.edgex.exchange', markets, {
    openInterestUsd: oiUsdTotal, note: `funding=fundingRate; vol24h=value(24h quote); sampled top ${ids.length} contracts`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ApeX (omni) — per-symbol ticker (markPrice, indexPrice, fundingRate, openInterest (base),
// turnover24h USD, volume24h base). No all-tickers endpoint → query a majors set.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readApex(symbols) {
  const V = 'ApeX', C = 'ApeX Omni';
  const syms = (Array.isArray(symbols) && symbols.length) ? symbols
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'SUIUSDT', 'AVAXUSDT', 'LINKUSDT', 'TRXUSDT'];
  const rows = await Promise.all(syms.map((s) =>
    getJson(`https://omni.apex.exchange/api/v3/ticker?symbol=${encodeURIComponent(s)}`)
      .then((t) => (t && Array.isArray(t.data) && t.data[0]) ? t.data[0] : null)
      .catch(() => null)
  ));
  const markets = [];
  let oiUsdTotal = 0;
  for (const t of rows) {
    if (!t || !t.symbol) continue;
    const mark = num(t.markPrice);
    const oi = num(t.openInterest);
    const oiUsd = oi * mark;
    oiUsdTotal += oiUsd;
    markets.push({
      symbol: t.symbol, markPrice: mark, indexPrice: num(t.indexPrice),
      funding: num(t.fundingRate), oi, oiUsd,
      vol24h: num(t.turnover24h),  // turnover24h = USD notional
    });
  }
  if (!markets.length) return fail(V, C, 'no ticker rows parsed (omni per-symbol)');
  return okEnv(V, C, 'omni.apex.exchange', markets, {
    openInterestUsd: oiUsdTotal, note: `funding=fundingRate; vol24h=turnover24h; sampled ${syms.length} majors`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Paradex (Starknet) — GET /v1/markets/summary?market=ALL. Filter -PERP (skip options).
// Row: mark_price, underlying_price (index), funding_rate (8h), open_interest (base), volume_24h.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readParadex() {
  const V = 'Paradex', C = 'Starknet';
  const d = await getJson('https://api.prod.paradex.trade/v1/markets/summary?market=ALL');
  const rows = d && Array.isArray(d.results) ? d.results : null;
  if (!rows || !rows.length) return fail(V, C, 'paradex markets/summary unavailable');
  const markets = [];
  let oiUsdTotal = 0;
  for (const r of rows) {
    if (!r || !r.symbol || !/-PERP$/.test(r.symbol)) continue;  // perps only, drop options
    const mark = num(r.mark_price);
    const oi = num(r.open_interest);
    const oiUsd = oi * mark;
    oiUsdTotal += oiUsd;
    markets.push({
      symbol: r.symbol, markPrice: mark, indexPrice: num(r.underlying_price),
      funding: num(r.funding_rate), oi, oiUsd,
      vol24h: num(r.volume_24h),  // USD
    });
  }
  if (!markets.length) return fail(V, C, 'no -PERP markets parsed');
  return okEnv(V, C, 'api.prod.paradex.trade', markets, {
    openInterestUsd: oiUsdTotal, note: 'funding=funding_rate(8h); index=underlying_price; vol24h=volume_24h',
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Vertex (Arbitrum) — gateway v2 contracts/market_snapshots. Reachability varies by region; the
// parser handles the documented v2 shape and soft-fails when the host is unreachable.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readVertex() {
  const V = 'Vertex', C = 'Arbitrum';
  // v2 "contracts" returns CoinGecko-style ticker rows: { ticker_id, last_price, index_price,
  // funding_rate, open_interest, base_volume / target_volume }.
  const d = await getJson('https://gateway.prod.vertexprotocol.com/v2/contracts');
  const rows = Array.isArray(d) ? d : (d && Array.isArray(d.tickers) ? d.tickers : null);
  if (!rows || !rows.length) return fail(V, C, 'vertex gateway v2 unreachable/empty (region-gated)');
  const markets = [];
  for (const r of rows) {
    const sym = r.ticker_id || r.symbol || r.product_id;
    if (!sym || !/PERP/i.test(String(sym)) && r.product_type && r.product_type !== 'perp') continue;
    const mark = num(r.last_price ?? r.mark_price ?? r.price);
    markets.push({
      symbol: String(sym), markPrice: mark, indexPrice: num(r.index_price ?? r.oracle_price),
      funding: num(r.funding_rate ?? r.predicted_funding_rate),
      oi: num(r.open_interest),
      vol24h: num(r.target_volume ?? r.quote_volume ?? r.volume_usd),
    });
  }
  if (!markets.length) return fail(V, C, 'no perp rows parsed');
  return okEnv(V, C, 'gateway.prod.vertexprotocol.com/v2', markets, { note: 'v2 CoinGecko-style ticker rows' });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Bluefin (Sui, Spot/Perp) — exchange info / marketData. Reachability varies by region; parser
// handles the documented marketData shape and soft-fails when the host is unreachable.
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readBluefin() {
  const V = 'Bluefin', C = 'Sui';
  const d = await getJson('https://dapi.api.sui-prod.bluefin.io/marketData');
  const rows = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : null);
  if (!rows || !rows.length) return fail(V, C, 'bluefin marketData unreachable/empty (region-gated)');
  const markets = [];
  for (const r of rows) {
    const sym = r.symbol || r.marketSymbol;
    if (!sym) continue;
    // Bluefin returns 18-dp fixed-point strings for prices/sizes; normalize by 1e18 when the
    // value is implausibly large (a fixed-point integer) else trust it.
    const norm = (x) => { const n = num(x); return n > 1e12 ? n / 1e18 : n; };
    const mark = norm(r.marketPrice ?? r.markPrice ?? r.lastPrice);
    markets.push({
      symbol: String(sym), markPrice: mark, indexPrice: norm(r.indexPrice ?? r.oraclePrice),
      funding: num(r.currentFundingRate ?? r.fundingRate) / (Math.abs(num(r.currentFundingRate)) > 1e6 ? 1e18 : 1),
      oi: norm(r.openInterest), vol24h: norm(r._24hrVolume ?? r.volume24h),
    });
  }
  if (!markets.length) return fail(V, C, 'no markets parsed');
  return okEnv(V, C, 'dapi.api.sui-prod.bluefin.io', markets, { note: '18-dp fixed-point normalized' });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DefiLlama derivatives overview — keyless protocol-level 24h volume/OI fallback. As of 2026-06
// the /overview/derivatives + /summary/derivatives endpoints are gated to the paid plan and the
// public host returns a plaintext upgrade notice (→ soft-null). Parser kept for when a proxy/key
// is available; gives venue-level totals only (no per-market granularity).
// ─────────────────────────────────────────────────────────────────────────────────────────────
export async function readDefiLlamaDerivs() {
  const V = 'DefiLlama-derivatives', C = 'aggregate';
  const d = await getJson('https://api.llama.fi/overview/derivatives?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true');
  const protos = d && Array.isArray(d.protocols) ? d.protocols : null;
  if (!protos) return fail(V, C, 'overview/derivatives gated to paid plan (keyless host returns upgrade notice)');
  const markets = protos.map((p) => ({
    symbol: p.name || p.displayName || '?',
    markPrice: 0, funding: 0, oi: num(p.openInterestAtEnd ?? p.totalOpenInterest),
    vol24h: num(p.total24h),
  }));
  return okEnv(V, C, 'api.llama.fi/overview/derivatives', markets, {
    volume24hUsd: num(d.total24h),
    note: 'protocol-level totals (no per-market granularity); "symbol"=protocol name',
  });
}

// ── registry ────────────────────────────────────────────────────────────────────────────────
export const PERPS_VENUES = [
  { name: 'Hyperliquid', kind: 'P', chain: 'Hyperliquid L1', read: readHyperliquid },
  { name: 'dYdX', kind: 'P', chain: 'dYdX Chain (v4)', read: readDydx },
  { name: 'GMX', kind: 'P', chain: 'Arbitrum', read: readGmx },
  { name: 'Vertex', kind: 'P', chain: 'Arbitrum', read: readVertex },
  { name: 'Aster', kind: 'P', chain: 'BNB Chain (+multi)', read: readAster },
  { name: 'Lighter', kind: 'P', chain: 'Lighter zkL2', read: readLighter },
  { name: 'edgeX', kind: 'P', chain: 'edgeX (StarkEx)', read: readEdgex },
  { name: 'ApeX', kind: 'P', chain: 'ApeX Omni', read: readApex },
  { name: 'Paradex', kind: 'P', chain: 'Starknet', read: readParadex },
  { name: 'Bluefin', kind: 'P', chain: 'Sui', read: readBluefin },
  { name: 'DefiLlama-derivatives', kind: 'P', chain: 'aggregate', read: readDefiLlamaDerivs },
];

// Run every venue's read() in parallel; each soft-fails independently so one dead source never
// poisons the snapshot. Optionally filter to a subset by name (case-insensitive).
export async function collectPerpsVenues(only) {
  const want = Array.isArray(only) && only.length
    ? new Set(only.map((s) => String(s).toLowerCase()))
    : null;
  const targets = want ? PERPS_VENUES.filter((v) => want.has(v.name.toLowerCase())) : PERPS_VENUES;
  const results = await Promise.all(targets.map(async (v) => {
    try {
      const r = await v.read();
      return r && typeof r === 'object' ? r : fail(v.name, v.chain, 'read() returned non-object');
    } catch (e) {
      return fail(v.name, v.chain, `read() threw: ${e && e.message ? e.message : 'error'}`);
    }
  }));
  const live = results.filter((r) => r.ok);
  return {
    asOf: nowIso(),
    readOnly: true, advisory: true,
    venueCount: results.length,
    liveCount: live.length,
    totalVolume24hUsd: live.reduce((s, r) => s + num(r.volume24hUsd), 0),
    totalOpenInterestUsd: live.reduce((s, r) => s + num(r.openInterestUsd), 0),
    venues: results,
  };
}

// ── HTTP handler: GET /api/venues/perps → the full snapshot JSON ───────────────────────────────
// READ-ONLY. Non-GET / wrong path → 4xx JSON. Soft-fails to a valid snapshot, never 500-throws.
export async function handler(req, res) {
  const method = (req && req.method) || 'GET';
  const url = (req && req.url) || '/api/venues/perps';
  const path = url.split('?')[0];
  const send = (code, obj) => {
    if (res && typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json' });
    if (res && typeof res.end === 'function') res.end(JSON.stringify(obj));
    return obj;
  };
  if (method !== 'GET') return send(405, { ok: false, error: 'method not allowed', advisory: true });
  if (path !== '/api/venues/perps') return send(404, { ok: false, error: `not found: ${esc(path)}`, advisory: true });
  // optional ?only=hyperliquid,dydx
  let only;
  const q = url.split('?')[1];
  if (q) { const m = new URLSearchParams(q).get('only'); if (m) only = m.split(',').map((s) => s.trim()).filter(Boolean); }
  const snap = await collectPerpsVenues(only);
  return send(200, { ok: true, ...snap });
}

export default { PERPS_VENUES, collectPerpsVenues, handler, __setFetch };

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const snap = await collectPerpsVenues(only.length ? only : undefined);
  console.log('ON-CHAIN PERPS / DERIVATIVES — read-only venue analytics');
  console.log('─'.repeat(96));
  for (const v of snap.venues) {
    const head = `${v.ok ? 'ok  ' : 'DOWN'}  ${String(v.venue).padEnd(22)} ${String(v.chain).padEnd(20)}`;
    if (!v.ok) { console.log(`${head} ${v.note || ''}`); continue; }
    const volM = (num(v.volume24hUsd) / 1e6).toFixed(1);
    const oiM = v.openInterestUsd != null ? (num(v.openInterestUsd) / 1e6).toFixed(1) : '—';
    console.log(`${head} mkts:${String(v.markets.length).padStart(3)}  vol24h:$${volM}M  OI:$${oiM}M`);
    for (const m of v.markets.slice(0, 5)) {
      console.log(`        ${String(m.symbol).padEnd(16)} mark:${m.markPrice}  fund:${m.funding}  oi:${m.oi}  vol24h:$${(num(m.vol24h) / 1e6).toFixed(2)}M`);
    }
    if (v.edgeSignals && v.edgeSignals.crowdedLongs) {
      console.log(`        edge: crowded-longs ${v.edgeSignals.crowdedLongs.symbol}@${v.edgeSignals.crowdedLongs.funding}  crowded-shorts ${v.edgeSignals.crowdedShorts.symbol}@${v.edgeSignals.crowdedShorts.funding}  topVolConc ${v.edgeSignals.volumeConcentration}`);
    }
  }
  console.log('─'.repeat(96));
  console.log(`live ${snap.liveCount}/${snap.venueCount}  ·  total vol24h $${(snap.totalVolume24hUsd / 1e9).toFixed(2)}B  ·  total OI $${(snap.totalOpenInterestUsd / 1e9).toFixed(2)}B  ·  asOf ${snap.asOf}`);
}
