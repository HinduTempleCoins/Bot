// solana-venues.mjs — READ-ONLY Solana venue analytics registry.
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ─────────────────────────────────────────────┐
// │ • READ-ONLY. This module READS public, KEYLESS market data for Solana venues (DEXes + perps). │
// │   It holds NO key, signs nothing, broadcasts nothing, places no order. There is no write path.│
// │ • Soft-fail-never-throw: every source is fetched independently and `.catch`ed to null. A dead │
// │   venue → a null entry; a dead source within a venue → that field is null. The reader never    │
// │   throws to the caller. Garbage in → a clean partial/empty shape, not a crash.                │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// This is the venue REGISTRY companion to chains/sol-bot.mjs (which is the dry-run TRADER). sol-bot
// decides paper intentions; this module gives the granular per-venue market picture behind them —
// matching the granularity of the HIVE-Engine side (hive-engine-market.mjs): per-pair price, 24h
// volume, liquidity/TVL, depth where exposed, and an arb/edge signal where derivable.
//
// KEYLESS SOURCES (per integrations/CROSSCHAIN_BOTS.md):
//   • DefiLlama  GET api.llama.fi/summary/dexs/<slug>   -> { total24h, total7d, ... } (DEX volume)
//                GET api.llama.fi/tvl/<slug>            -> number (protocol TVL, USD)
//     (NOTE 2026-06-14: api.llama.fi/summary/derivatives/<slug> is now a PAID 402 endpoint — so
//      perp venues do NOT use DefiLlama volume; they use their own public API + DexScreener.)
//   • DexScreener GET api.dexscreener.com/token-pairs/v1/solana/<mint> -> [ pair, ... ]
//     each pair { dexId, baseToken, quoteToken, priceUsd, liquidity:{usd}, volume:{h24}, txns... }
//     We anchor on canonical mints (SOL/USDC) and FILTER by dexId to get a venue's top pairs.
//   • Pacifica   GET api.pacifica.fi/api/v1/info/prices -> { data:[ { symbol, mark, oracle,
//                funding, open_interest, volume_24h, ... } ] } (perp marks + OI + funding + vol)
//   • Drift      GET data.api.drift.trade/contracts      -> per-market 24h vol / OI / funding
//                (geo/UA-gated from some hosts — soft-fails to DexScreener + DefiLlama-tvl).
//   • Jupiter    GET lite-api.jup.ag/price/v3?ids=<mint> -> aggregated USD ref price (edge anchor).
//
//   import { SOLANA_VENUES, collectSolanaVenues, handler } from './venues/solana-venues.mjs'
//   node integrations/venues/solana-venues.mjs           # print every venue's live snapshot
//   GET /api/venues/solana  ->  { ok, asOf, venues:[ ... ] }

import http from 'node:http';
import { fileURLToPath } from 'node:url';

// ── injectable fetch (offline tests inject a fake; production uses global fetch) ───────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const TIMEOUT_MS = +(process.env.SOL_VENUES_TIMEOUT_MS || 12000);

// ── HTML/CLI escape — never throws ─────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── tiny pure helpers (no I/O) ─────────────────────────────────────────────────────────────────
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const isPos = (n) => Number.isFinite(+n) && +n > 0;
const round = (n, dp = 6) => +(+n).toFixed(dp);
const nowIso = () => new Date().toISOString();

// canonical mainnet mints we anchor DexScreener pair lookups on.
const MINT_SOL = 'So11111111111111111111111111111111111111112';
const MINT_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// endpoint bases (env-overridable so offline tests / mirrors can redirect them)
const LLAMA_DEXS = process.env.SOL_LLAMA_DEXS_URL || 'https://api.llama.fi/summary/dexs';
const LLAMA_TVL = process.env.SOL_LLAMA_TVL_URL || 'https://api.llama.fi/tvl';
const DEXSCREENER_TP = process.env.SOL_DEXSCREENER_URL || 'https://api.dexscreener.com/token-pairs/v1/solana';
const JUP_PRICE = process.env.SOL_JUP_PRICE_URL || 'https://lite-api.jup.ag/price/v3';
const PACIFICA_PRICES = process.env.SOL_PACIFICA_URL || 'https://api.pacifica.fi/api/v1/info/prices';
const DRIFT_CONTRACTS = process.env.SOL_DRIFT_URL || 'https://data.api.drift.trade/contracts';

async function fetchJSON(url, opts = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal, ...opts });
    if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 'no-response'}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// ── shared source readers (each soft-fails to null) ────────────────────────────────────────────

// DefiLlama DEX volume for a protocol slug. Returns { volume24hUsd, volume7dUsd } or null.
export async function llamaDexVolume(slug) {
  if (!slug) return null;
  const u = `${LLAMA_DEXS}/${encodeURIComponent(slug)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
  const j = await fetchJSON(u).catch(() => null);
  if (!j || typeof j !== 'object') return null;
  const v24 = num(j.total24h, NaN), v7 = num(j.total7d, NaN);
  if (!Number.isFinite(v24) && !Number.isFinite(v7)) return null;
  return {
    volume24hUsd: Number.isFinite(v24) ? round(v24, 2) : null,
    volume7dUsd: Number.isFinite(v7) ? round(v7, 2) : null,
    chains: Array.isArray(j.chains) ? j.chains : null,
  };
}

// DefiLlama protocol TVL (USD). Endpoint returns a bare number.
export async function llamaTvl(slug) {
  if (!slug) return null;
  const j = await fetchJSON(`${LLAMA_TVL}/${encodeURIComponent(slug)}`).catch(() => null);
  const v = num(j, NaN);
  return Number.isFinite(v) && v >= 0 ? round(v, 2) : null;
}

// Parse a DexScreener token-pairs array into the top pairs for a given dexId (venue).
// Anchored on SOL+USDC mints; we union both lookups and keep the venue's own pairs, top by liquidity.
export function parseDexScreenerPairs(arrays, dexId, limit = 8) {
  const seen = new Set();
  const pairs = [];
  for (const arr of (Array.isArray(arrays) ? arrays : [arrays])) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== 'object') continue;
      if (dexId && String(p.dexId || '').toLowerCase() !== String(dexId).toLowerCase()) continue;
      const key = p.pairAddress || `${p.baseToken?.address}-${p.quoteToken?.address}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const priceUsd = num(p.priceUsd, NaN);
      const liqUsd = num(p.liquidity?.usd, NaN);
      const vol24 = num(p.volume?.h24, NaN);
      pairs.push({
        pair: `${p.baseToken?.symbol || '?'}/${p.quoteToken?.symbol || '?'}`,
        priceUsd: Number.isFinite(priceUsd) ? round(priceUsd, 8) : null,
        liqUsd: Number.isFinite(liqUsd) ? round(liqUsd, 2) : null,
        vol24h: Number.isFinite(vol24) ? round(vol24, 2) : null,
        priceChange24h: num(p.priceChange?.h24, NaN) || null,
        dexId: p.dexId || null,
      });
    }
  }
  pairs.sort((a, b) => num(b.liqUsd) - num(a.liqUsd));
  return pairs.slice(0, limit);
}

// Fetch DexScreener pairs anchored on SOL + USDC, filtered to a venue dexId.
async function readDexScreener(dexId, limit = 8) {
  if (!dexId) return { topPairs: [], tvlFromPairs: null };
  const [solArr, usdcArr] = await Promise.all([
    fetchJSON(`${DEXSCREENER_TP}/${MINT_SOL}`).catch(() => null),
    fetchJSON(`${DEXSCREENER_TP}/${MINT_USDC}`).catch(() => null),
  ]);
  const topPairs = parseDexScreenerPairs([solArr, usdcArr], dexId, limit);
  // a rough liquidity proxy from the visible pairs (NOT full venue TVL — labelled as such by caller)
  const tvlFromPairs = topPairs.length
    ? round(topPairs.reduce((s, p) => s + num(p.liqUsd), 0), 2)
    : null;
  return { topPairs, tvlFromPairs };
}

// Jupiter aggregated USD reference price for a mint (the cross-venue arb anchor).
export async function jupRefPrice(mint = MINT_SOL) {
  const j = await fetchJSON(`${JUP_PRICE}?ids=${encodeURIComponent(mint)}`).catch(() => null);
  if (!j) return null;
  const node = j[mint] || (j.data && j.data[mint]) || null;
  const p = num(node?.usdPrice ?? node?.price, NaN);
  return Number.isFinite(p) && p > 0 ? round(p, 8) : null;
}

// ── perp-venue native readers ──────────────────────────────────────────────────────────────────

// Pacifica: full perp board (mark, oracle, funding, OI, 24h vol) per symbol.
export function parsePacifica(raw, limit = 12) {
  const data = raw && Array.isArray(raw.data) ? raw.data : (Array.isArray(raw) ? raw : null);
  if (!data) return null;
  let volume24hUsd = 0, oiUsd = 0;
  const rows = [];
  for (const m of data) {
    if (!m || typeof m !== 'object') continue;
    const mark = num(m.mark, NaN);
    const vol = num(m.volume_24h, NaN);       // Pacifica volume_24h is already USD (quote terms)
    const oi = num(m.open_interest, NaN);     // open_interest is in BASE units → × mark for USD
    const volUsd = Number.isFinite(vol) ? vol : NaN;
    const oiU = Number.isFinite(oi) && Number.isFinite(mark) ? oi * mark : NaN;
    if (Number.isFinite(volUsd)) volume24hUsd += volUsd;
    if (Number.isFinite(oiU)) oiUsd += oiU;
    rows.push({
      pair: `${m.symbol || '?'}-PERP`,
      priceUsd: Number.isFinite(mark) ? round(mark, 8) : null,
      oracleUsd: isPos(num(m.oracle, NaN)) ? round(num(m.oracle), 8) : null,
      funding: m.funding != null ? round(num(m.funding), 8) : null,
      oiUsd: Number.isFinite(oiU) ? round(oiU, 2) : null,
      vol24h: Number.isFinite(volUsd) ? round(volUsd, 2) : null,
      // edge: mark vs oracle gap — a perp basis / funding-pressure signal
      basisPct: (Number.isFinite(mark) && isPos(num(m.oracle, NaN)))
        ? round((mark - num(m.oracle)) / num(m.oracle), 6) : null,
    });
  }
  rows.sort((a, b) => num(b.vol24h) - num(a.vol24h));
  return {
    volume24hUsd: round(volume24hUsd, 2),
    oiUsd: round(oiUsd, 2),
    topPairs: rows.slice(0, limit),
    markets: rows.length,
  };
}

async function readPacifica(limit = 12) {
  const raw = await fetchJSON(PACIFICA_PRICES).catch(() => null);
  return parsePacifica(raw, limit);
}

// Drift: native contracts endpoint (24h vol / OI / funding per perp market). Geo/UA-gated on some
// hosts → soft-fails to null, and the venue read() falls back to DexScreener + DefiLlama tvl.
export function parseDrift(raw, limit = 12) {
  const data = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.contracts) ? raw.contracts : null);
  if (!data) return null;
  let volume24hUsd = 0, oiUsd = 0;
  const rows = [];
  for (const c of data) {
    if (!c || typeof c !== 'object') continue;
    const price = num(c.last_price ?? c.price ?? c.mark_price, NaN);
    const vol = num(c.quote_volume ?? c.volume_24h ?? c.base_volume, NaN);
    const oi = num(c.open_interest, NaN);
    if (Number.isFinite(vol)) volume24hUsd += vol;
    rows.push({
      pair: String(c.ticker_id || c.contract_index || c.base_currency || '?'),
      priceUsd: Number.isFinite(price) ? round(price, 8) : null,
      vol24h: Number.isFinite(vol) ? round(vol, 2) : null,
      oiUsd: Number.isFinite(oi) ? round(oi, 2) : null,
      funding: c.funding_rate != null ? round(num(c.funding_rate), 8) : null,
    });
    if (Number.isFinite(oi)) oiUsd += oi;
  }
  rows.sort((a, b) => num(b.vol24h) - num(a.vol24h));
  return { volume24hUsd: round(volume24hUsd, 2), oiUsd: round(oiUsd, 2), topPairs: rows.slice(0, limit), markets: rows.length };
}

async function readDrift(limit = 12) {
  const raw = await fetchJSON(DRIFT_CONTRACTS).catch(() => null);
  return parseDrift(raw, limit);
}

// ── generic venue read builders ────────────────────────────────────────────────────────────────
// A spot/aggregator DEX read: DefiLlama volume + TVL, DexScreener top pairs, Jupiter ref-price edge.
function makeSpotRead(entry) {
  return async () => {
    const out = {
      venue: entry.name, kind: entry.kind, chain: entry.chain, asOf: nowIso(),
      volume24hUsd: null, volume7dUsd: null, tvlUsd: null,
      topPairs: [], depth: null, edgeSignals: null, sources: [],
    };
    try {
      const [vol, tvl, ds, ref] = await Promise.all([
        llamaDexVolume(entry.defillamaSlug).catch(() => null),
        llamaTvl(entry.defillamaSlug).catch(() => null),
        readDexScreener(entry.dexscreenerDexId, entry.pairLimit || 8).catch(() => null),
        jupRefPrice(MINT_SOL).catch(() => null),
      ]);
      if (vol) {
        out.volume24hUsd = vol.volume24hUsd;
        out.volume7dUsd = vol.volume7dUsd;
        out.sources.push('defillama-dexs');
      }
      if (isPos(tvl)) { out.tvlUsd = tvl; out.sources.push('defillama-tvl'); }
      if (ds && ds.topPairs.length) {
        out.topPairs = ds.topPairs;
        out.sources.push('dexscreener');
        // depth proxy: sum of visible pair liquidity (not full book depth — DexScreener gives liq, not L2)
        out.depth = { visiblePairLiqUsd: ds.tvlFromPairs, pairCount: ds.topPairs.length };
        if (out.tvlUsd == null && isPos(ds.tvlFromPairs)) out.tvlUsd = ds.tvlFromPairs; // fallback TVL proxy
      }
      // edge signal: each SOL-quoted pair's priceUsd vs Jupiter's aggregated SOL ref → a cross-venue gap
      if (isPos(ref) && out.topPairs.length) {
        out.sources.push('jupiter-ref');
        const gaps = [];
        for (const p of out.topPairs) {
          const isSolPair = /\bSOL\b/.test(p.pair) && !/USDC|USDT/.test(p.pair.split('/')[0] || '');
          if (isSolPair && isPos(p.priceUsd)) {
            gaps.push({ pair: p.pair, venuePriceUsd: p.priceUsd, refUsd: ref, edgePct: round((ref - p.priceUsd) / p.priceUsd, 6) });
          }
        }
        out.edgeSignals = { refSource: 'jupiter', refUsd: ref, gaps };
      }
    } catch { /* soft-fail: return whatever we gathered */ }
    return out;
  };
}

// An aggregator read: aggregators route through the spot DEXes, so their own DefiLlama "dexs" volume
// is small and they have no native pairs. Their analytic VALUE is the keyless aggregated ref-price —
// the cross-venue arb anchor. We surface that as the venue's edgeSignals, plus DefiLlama vol/TVL.
function makeAggRead(entry) {
  return async () => {
    const out = {
      venue: entry.name, kind: entry.kind, chain: entry.chain, asOf: nowIso(),
      volume24hUsd: null, volume7dUsd: null, tvlUsd: null,
      topPairs: [], depth: null, edgeSignals: null, sources: [],
    };
    try {
      const [vol, tvl, solRef, usdcRef] = await Promise.all([
        llamaDexVolume(entry.defillamaSlug).catch(() => null),
        llamaTvl(entry.defillamaSlug).catch(() => null),
        jupRefPrice(MINT_SOL).catch(() => null),
        jupRefPrice(MINT_USDC).catch(() => null),
      ]);
      if (vol) { out.volume24hUsd = vol.volume24hUsd; out.volume7dUsd = vol.volume7dUsd; out.sources.push('defillama-dexs'); }
      if (isPos(tvl)) { out.tvlUsd = tvl; out.sources.push('defillama-tvl'); }
      if (isPos(solRef)) {
        out.sources.push('jupiter-price');
        out.edgeSignals = {
          kind: 'aggregated-ref',
          note: 'Jupiter aggregated USD reference prices — the cross-venue arb anchor used against each spot venue.',
          refs: [
            { token: 'SOL', refUsd: solRef },
            ...(isPos(usdcRef) ? [{ token: 'USDC', refUsd: usdcRef }] : []),
          ],
        };
        // expose the refs as "pairs" so the granular shape is populated like the other venues
        out.topPairs = [
          { pair: 'SOL/USD', priceUsd: solRef, liqUsd: null, vol24h: null },
          ...(isPos(usdcRef) ? [{ pair: 'USDC/USD', priceUsd: usdcRef, liqUsd: null, vol24h: null }] : []),
        ];
      }
    } catch { /* soft-fail */ }
    return out;
  };
}

// A perp venue read: native API (Pacifica/Drift) for vol/OI/funding/basis, DexScreener + tvl fallback.
function makePerpRead(entry) {
  return async () => {
    const out = {
      venue: entry.name, kind: entry.kind, chain: entry.chain, asOf: nowIso(),
      volume24hUsd: null, volume7dUsd: null, tvlUsd: null,
      topPairs: [], depth: null, edgeSignals: null, sources: [],
    };
    try {
      const native = entry.native ? await entry.native(entry.pairLimit || 12).catch(() => null) : null;
      if (native) {
        out.volume24hUsd = native.volume24hUsd ?? null;
        out.topPairs = native.topPairs || [];
        out.depth = { openInterestUsd: native.oiUsd ?? null, markets: native.markets ?? null };
        out.tvlUsd = native.oiUsd ?? null; // for a perp venue, open interest is the analog of "TVL at risk"
        out.sources.push(entry.nativeSource || 'native-perp');
        // edge: the mark-vs-oracle basis rows are the per-pair perp edge signal
        const basis = (native.topPairs || []).filter((p) => p.basisPct != null)
          .map((p) => ({ pair: p.pair, basisPct: p.basisPct, funding: p.funding ?? null }));
        if (basis.length) out.edgeSignals = { kind: 'perp-basis', rows: basis.slice(0, 8) };
      }
      // TVL via DefiLlama (perps still report a vault/TVL even when derivatives-volume is paywalled)
      const tvl = await llamaTvl(entry.defillamaSlug).catch(() => null);
      if (isPos(tvl)) { out.tvlUsd = out.tvlUsd ?? tvl; if (!out.sources.includes('defillama-tvl')) out.sources.push('defillama-tvl'); }
      // DexScreener fallback for venues whose perp markets surface as on-chain pairs
      if (!out.topPairs.length && entry.dexscreenerDexId) {
        const ds = await readDexScreener(entry.dexscreenerDexId, entry.pairLimit || 8).catch(() => null);
        if (ds && ds.topPairs.length) { out.topPairs = ds.topPairs; out.sources.push('dexscreener'); }
      }
    } catch { /* soft-fail */ }
    return out;
  };
}

// ── THE REGISTRY ───────────────────────────────────────────────────────────────────────────────
// kind: 'S' = spot DEX/AMM, 'P' = perps, 'A' = aggregator. Each read() returns the granular shape.
const _venueDefs = [
  { name: 'Raydium',  kind: 'S', defillamaSlug: 'raydium',      dexscreenerDexId: 'raydium' },
  { name: 'PumpSwap', kind: 'S', defillamaSlug: 'pumpswap',     dexscreenerDexId: 'pumpswap' }, // memecoin flow
  { name: 'Orca',     kind: 'S', defillamaSlug: 'orca',         dexscreenerDexId: 'orca' },
  { name: 'Jupiter',  kind: 'A', defillamaSlug: 'jupiter', dexscreenerDexId: null, agg: true }, // A: aggregator (routes through DEXes; its value is the keyless ref-price)
  { name: 'Meteora',  kind: 'S', defillamaSlug: 'meteora',      dexscreenerDexId: 'meteora' },
  { name: 'Drift',    kind: 'P', defillamaSlug: 'drift',        dexscreenerDexId: null, native: readDrift,    nativeSource: 'drift-contracts' },
  { name: 'Pacifica', kind: 'P', defillamaSlug: 'pacifica',     dexscreenerDexId: null, native: readPacifica, nativeSource: 'pacifica-api' },
  { name: 'Lifinity', kind: 'S', defillamaSlug: 'lifinity',     dexscreenerDexId: 'lifinity' },
  { name: 'Saros',    kind: 'S', defillamaSlug: 'saros',        dexscreenerDexId: 'saros' },
  // More venues for cheap ($1) SOL test trades (operator 2026-06-17). Unresolved slugs soft-fail to
  // alive:false (no fabricated numbers) — kept best-effort so coverage widens without breaking.
  { name: 'Phoenix',   kind: 'S', defillamaSlug: 'phoenix',     dexscreenerDexId: 'phoenix' },   // CLOB
  { name: 'OpenBook',  kind: 'S', defillamaSlug: 'openbook-v2', dexscreenerDexId: 'openbook' },  // CLOB
  { name: 'GooseFX',   kind: 'S', defillamaSlug: 'goosefx',     dexscreenerDexId: 'goosefx' },
  { name: 'Invariant', kind: 'S', defillamaSlug: 'invariant',   dexscreenerDexId: 'invariant' },
  { name: 'FluxBeam',  kind: 'S', defillamaSlug: 'fluxbeam',    dexscreenerDexId: 'fluxbeam' },
  { name: 'Sanctum',   kind: 'S', defillamaSlug: 'sanctum',     dexscreenerDexId: null },        // LST router
];

export const SOLANA_VENUES = Object.freeze(_venueDefs.map((d) => {
  const entry = { ...d, chain: 'solana', dexscreenerChain: 'solana' };
  entry.read = d.agg ? makeAggRead(entry) : (d.kind === 'P' ? makePerpRead(entry) : makeSpotRead(entry));
  return Object.freeze(entry);
}));

/**
 * Read every venue in the registry. A venue whose read() throws or yields nothing usable becomes a
 * null entry (so the caller sees the slot, dead or alive). Never throws.
 * @returns {Promise<{asOf:string, venues:Array<({venue,kind,...}|{venue,kind,error,read:null})>}>}
 */
export async function collectSolanaVenues(venues = SOLANA_VENUES) {
  const asOf = nowIso();
  const results = await Promise.all((venues || []).map(async (v) => {
    try {
      const r = await v.read();
      // a venue with zero data from every source → represent as a dead/null entry but keep the slot
      const alive = r && (isPos(r.volume24hUsd) || isPos(r.tvlUsd) || (Array.isArray(r.topPairs) && r.topPairs.length));
      if (!alive) return { venue: v.name, kind: v.kind, chain: v.chain, asOf, alive: false, data: null };
      return { venue: v.name, kind: v.kind, chain: v.chain, asOf, alive: true, data: r };
    } catch (e) {
      return { venue: v.name, kind: v.kind, chain: v.chain, asOf, alive: false, error: e && e.message ? e.message : String(e), data: null };
    }
  }));
  return { asOf, venues: results };
}

// ── HTTP handler: GET /api/venues/solana ───────────────────────────────────────────────────────
export async function handler(req, res) {
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const url = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    if (url.pathname !== '/api/venues/solana') { sendJson(404, { ok: false, error: 'not found' }); return; }
    const { asOf, venues } = await collectSolanaVenues();
    sendJson(200, { ok: true, asOf, venues });
  } catch (e) {
    try { sendJson(200, { ok: false, error: e && e.message ? e.message : String(e), venues: [] }); } catch { /* ignore */ }
  }
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === 'serve') {
    const PORT = +(process.env.PORT || 8096);
    http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('{"ok":false}'); } catch { /* */ } }); })
      .listen(PORT, () => console.log(`solana-venues read-only on http://localhost:${PORT}/api/venues/solana`));
  } else {
    console.log('Solana venue analytics — READ-ONLY (keyless DefiLlama + DexScreener + native perp APIs). NO keys, no trading.');
    console.log('─'.repeat(96));
    const { asOf, venues } = await collectSolanaVenues();
    console.log(`asOf ${asOf}\n`);
    const fmt = (n) => (isPos(n) ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');
    for (const v of venues) {
      const d = v.data;
      const head = `${esc(v.venue).padEnd(10)} [${v.kind}]`;
      if (!v.alive || !d) { console.log(`${head}  DEAD (${esc(v.error || 'no data from any source')})`); continue; }
      console.log(`${head}  vol24h=${fmt(d.volume24hUsd).padStart(14)}  tvl/OI=${fmt(d.tvlUsd).padStart(14)}  src=${d.sources.join('+') || 'none'}`);
      for (const p of (d.topPairs || []).slice(0, 4)) {
        const px = isPos(p.priceUsd) ? '$' + p.priceUsd : '—';
        console.log(`            ${esc(p.pair).padEnd(20)} ${px.padStart(14)}  liq=${fmt(p.liqUsd).padStart(12)}  vol=${fmt(p.vol24h).padStart(12)}${p.basisPct != null ? `  basis=${(p.basisPct * 100).toFixed(3)}%` : ''}`);
      }
      if (d.edgeSignals && Array.isArray(d.edgeSignals.gaps) && d.edgeSignals.gaps.length) {
        const g = d.edgeSignals.gaps[0];
        console.log(`            edge: ${esc(g.pair)} venue $${g.venuePriceUsd} vs ref $${g.refUsd} → ${(g.edgePct * 100).toFixed(3)}%`);
      }
    }
    console.log('\nRead-only. No keys, no orders, no broadcasts — this layer only OBSERVES Solana venues.');
  }
}
