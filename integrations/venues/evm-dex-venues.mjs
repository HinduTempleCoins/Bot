// evm-dex-venues.mjs — READ-ONLY granular analytics for EVM SPOT DEX venues.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
//  READ-ONLY by construction. NO keys, NO orders, NEVER broadcasts (zero-WIF rule, BRIEF.md §7).
//  This is the EVM-DEX counterpart to the HIVE-Engine analytics (hive-engine-market.mjs): for each
//  venue it returns per-venue 24h volume + TVL (from DefiLlama, keyless) and per-pair price /
//  liquidity / 24h volume + a tiny cross-venue edge signal (from DexScreener, keyless). It holds no
//  key, makes no write call, and there is NO code path that signs or broadcasts.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  Data sources (per integrations/CROSSCHAIN_BOTS.md), keyless HTTP, injectable fetch:
//    1. DefiLlama dexs   — /summary/dexs/<slug>  -> protocol-level 24h/7d/30d volume + change
//                          /tvl/<slug>           -> protocol-level current TVL
//                          (keyless, no signup; the cross-chain volume/TVL source)
//    2. DexScreener      — /latest/dex/search?q=<sym> -> per-pair price / liquidity / 24h vol,
//                          filtered to the venue's chain + dexId  (keyless, no signup)
//
//  Each venue is { name, kind:'S' (spot), chain, defillamaSlug?, defillamaTvlSlug?,
//                  dexscreenerChain?, dexscreenerDexIds?, probePairs?[], read() }.
//  read() returns:
//    { venue, kind, chain, asOf, volume24hUsd, volume7dUsd, change1dPct, tvlUsd,
//      topPairs:[{pair, priceUsd, liqUsd, vol24h, dex}], edgeSignals:[{pair, edgePct, ...}],
//      sources:[...], errors:[...] }
//  Every source soft-fails to null independently; the reader NEVER throws.
//
//   node integrations/venues/evm-dex-venues.mjs              # dashboard (no network in tests)
//   node integrations/venues/evm-dex-venues.mjs --serve      # GET /api/venues/evm-dex
//   node integrations/venues/evm-dex-venues.mjs uniswap aerodrome   # subset by name
//   import { EVM_DEX_VENUES, collectEvmDexVenues, handler, __setFetch } from './evm-dex-venues.mjs'

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// injectable fetch seam (house pattern) — offline tests drive the reader without a network.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (x) => { const n = +x; return Number.isFinite(n) ? n : null; };

const LLAMA_BASE = process.env.EVM_LLAMA_BASE || 'https://api.llama.fi';
const DEXSCREENER_BASE = process.env.EVM_DEXSCREENER_BASE || 'https://api.dexscreener.com';
// An "edge" above this between two same-pair venues is implausible — a poisoned/look-alike pair or a
// stale quote, never free money. Flag it but never treat it as actionable (mirrors the HIVE side).
export const MAX_PLAUSIBLE_EDGE = +(process.env.EVM_MAX_EDGE || 0.15); // 15%
const MIN_EDGE = +(process.env.EVM_MIN_EDGE || 0.005);                 // 0.5%

// ── source 1: DefiLlama dexs summary (keyless) — protocol-level volume ────────────────────────
// /summary/dexs/<slug> -> { total24h, total7d, total30d, totalAllTime, change_1d, ... }.
// Soft-fails to null on any error. Returns nulls for absent fields rather than throwing.
async function llamaDexsSummary(slug) {
  if (!slug) return null;
  try {
    const url = `${LLAMA_BASE}/summary/dexs/${encodeURIComponent(slug)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    let j;
    try {
      const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      j = await r.json();
    } finally { clearTimeout(t); }
    // DefiLlama returns { message: "..." } for an unknown slug — treat as a miss, not a number.
    if (!j || typeof j !== 'object' || (j.total24h == null && j.total7d == null)) return null;
    return {
      source: 'defillama',
      volume24hUsd: num(j.total24h),
      volume7dUsd: num(j.total7d),
      volume30dUsd: num(j.total30d),
      change1dPct: num(j.change_1d),
    };
  } catch { return null; }
}

// ── source 1b: DefiLlama protocol TVL (keyless) — /tvl/<slug> -> a bare number ─────────────────
async function llamaTvl(slug) {
  if (!slug) return null;
  try {
    const url = `${LLAMA_BASE}/tvl/${encodeURIComponent(slug)}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    let body;
    try {
      const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      body = await r.json();
    } finally { clearTimeout(t); }
    // /tvl returns a bare number on success, or a string "Protocol not found" on a miss.
    const v = num(body);
    return v != null && v > 0 ? { source: 'defillama', tvlUsd: v } : null;
  } catch { return null; }
}

// ── source 2: DexScreener per-pair snapshots (keyless) ────────────────────────────────────────
// Search by symbol, filter to the venue's chain (+ dexIds when given), return the most-liquid pairs.
// Returns [] on any error. Each pair: { pair, priceUsd, liqUsd, vol24h, dex, chain }.
async function dexscreenerPairs(query, { chain, dexIds, limit = 5 } = {}) {
  try {
    const url = `${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    let pairs;
    try {
      const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      pairs = (await r.json())?.pairs || [];
    } finally { clearTimeout(t); }
    const dexSet = dexIds && dexIds.length ? new Set(dexIds.map((d) => d.toLowerCase())) : null;
    return pairs
      .filter((p) => (!chain || p.chainId === chain)
        && (!dexSet || dexSet.has(String(p.dexId || '').toLowerCase()))
        && num(p.priceUsd) > 0)
      .map((p) => ({
        pair: `${p.baseToken?.symbol || '?'}/${p.quoteToken?.symbol || '?'}`,
        priceUsd: num(p.priceUsd),
        liqUsd: num(p.liquidity?.usd) || 0,
        vol24h: num(p.volume?.h24) || 0,
        dex: p.dexId || null,
        chain: p.chainId || null,
      }))
      .sort((a, b) => b.liqUsd - a.liqUsd)
      .slice(0, limit);
  } catch { return []; }
}

// ── PURE: cross-venue edge signal from a set of same-pair DexScreener snapshots ────────────────
// For each pair symbol that appears on >1 venue/dex in the snapshot, the spread between the cheapest
// and dearest price is a candidate edge. Implausible edges (> MAX_PLAUSIBLE_EDGE) are flagged as
// traps, not opportunities. Below MIN_EDGE is noise. Returns [{pair, edgePct, lowDex, highDex, ...}].
export function edgeSignalsFromPairs(pairs) {
  const byPair = new Map();
  for (const p of pairs || []) {
    if (!p || !(num(p.priceUsd) > 0)) continue;
    const k = (p.pair || '').toUpperCase();
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push(p);
  }
  const out = [];
  for (const [pair, group] of byPair) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.priceUsd - b.priceUsd);
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    if (!(lo.priceUsd > 0)) continue;
    const edge = (hi.priceUsd - lo.priceUsd) / lo.priceUsd;
    if (edge < MIN_EDGE) continue;
    out.push({
      pair,
      edgePct: +(edge * 100).toFixed(3),
      lowDex: lo.dex, lowPriceUsd: lo.priceUsd,
      highDex: hi.dex, highPriceUsd: hi.priceUsd,
      plausible: edge <= MAX_PLAUSIBLE_EDGE,
      note: edge > MAX_PLAUSIBLE_EDGE
        ? `implausible ${(edge * 100).toFixed(1)}% spread — treated as a trap/poisoned quote, not free money`
        : 'observational cross-venue spread (read-only, no execution)',
    });
  }
  return out.sort((a, b) => b.edgePct - a.edgePct);
}

// ── shared venue reader: composes the keyless sources for one venue, soft-failing per source ──
// Used by every venue's read(). Never throws.
async function readVenue(v) {
  const errors = [];
  const [summary, tvl, ...pairBatches] = await Promise.all([
    llamaDexsSummary(v.defillamaSlug).catch((e) => { errors.push(`dexs:${e.message}`); return null; }),
    llamaTvl(v.defillamaTvlSlug || v.defillamaSlug).catch((e) => { errors.push(`tvl:${e.message}`); return null; }),
    ...(v.probePairs || []).map((q) =>
      dexscreenerPairs(q, { chain: v.dexscreenerChain, dexIds: v.dexscreenerDexIds })
        .catch((e) => { errors.push(`dex:${e.message}`); return []; })),
  ]);
  // merge + de-dup pairs by pair+dex, keep deepest liquidity
  const seen = new Map();
  for (const batch of pairBatches) {
    for (const p of batch) {
      const k = `${p.pair}|${p.dex}`;
      if (!seen.has(k) || p.liqUsd > seen.get(k).liqUsd) seen.set(k, p);
    }
  }
  const topPairs = [...seen.values()].sort((a, b) => b.liqUsd - a.liqUsd).slice(0, 8);
  const sources = [];
  if (summary) sources.push('defillama:dexs');
  if (tvl) sources.push('defillama:tvl');
  if (topPairs.length) sources.push('dexscreener');
  return {
    venue: v.name,
    kind: v.kind,
    chain: v.chain,
    asOf: new Date().toISOString(),
    volume24hUsd: summary ? summary.volume24hUsd : null,
    volume7dUsd: summary ? summary.volume7dUsd : null,
    change1dPct: summary ? summary.change1dPct : null,
    tvlUsd: tvl ? tvl.tvlUsd : null,
    topPairs,
    edgeSignals: edgeSignalsFromPairs(topPairs),
    sources,
    errors,
  };
}

// ── the REGISTRY ──────────────────────────────────────────────────────────────────────────────
// kind:'S' = SPOT DEX. chain = the venue's primary/home chain (label). defillamaSlug = the dexs
// volume slug; defillamaTvlSlug = the /tvl slug when it differs. dexscreenerChain/dexscreenerDexIds
// scope the per-pair snapshot to the venue. probePairs = a few liquid symbols to surface as topPairs.
// Slugs verified live against DefiLlama 2026-06-14.
function mk(v) { return { kind: 'S', read() { return readVenue(this); }, ...v }; }

export const EVM_DEX_VENUES = [
  mk({ name: 'Uniswap',     chain: 'Ethereum+L2s+BSC/Base', defillamaSlug: 'uniswap',     defillamaTvlSlug: 'uniswap',           dexscreenerChain: 'ethereum', dexscreenerDexIds: ['uniswap'],   probePairs: ['WETH USDC', 'WBTC USDC'] }),
  mk({ name: 'PancakeSwap', chain: 'BNB+multi',             defillamaSlug: 'pancakeswap', defillamaTvlSlug: 'pancakeswap',       dexscreenerChain: 'bsc',      dexscreenerDexIds: ['pancakeswap'], probePairs: ['WBNB USDT', 'CAKE WBNB'] }),
  mk({ name: 'Aerodrome',   chain: 'Base',                  defillamaSlug: 'aerodrome',   defillamaTvlSlug: 'aerodrome-slipstream', dexscreenerChain: 'base',  dexscreenerDexIds: ['aerodrome'], probePairs: ['AERO USDC', 'WETH USDC'] }),
  mk({ name: 'Curve',       chain: 'Ethereum (stables)',    defillamaSlug: 'curve-dex',   defillamaTvlSlug: 'curve-dex',         dexscreenerChain: 'ethereum', dexscreenerDexIds: ['curve'],     probePairs: ['CRV USDC', 'crvUSD USDC'] }),
  mk({ name: 'Fluid',       chain: 'Ethereum',              defillamaSlug: 'fluid-dex',   defillamaTvlSlug: 'fluid-dex',         dexscreenerChain: 'ethereum', dexscreenerDexIds: ['fluid'],     probePairs: ['WETH USDC', 'WBTC USDC'] }),
  mk({ name: 'Balancer',    chain: 'Ethereum',              defillamaSlug: 'balancer',    defillamaTvlSlug: 'balancer-v2',       dexscreenerChain: 'ethereum', dexscreenerDexIds: ['balancer'],  probePairs: ['BAL WETH', 'WETH USDC'] }),
  mk({ name: 'Camelot',     chain: 'Arbitrum',              defillamaSlug: 'camelot',     defillamaTvlSlug: 'camelot-v3',        dexscreenerChain: 'arbitrum', dexscreenerDexIds: ['camelot'],   probePairs: ['GRAIL USDC', 'ARB USDC'] }),
  mk({ name: 'QuickSwap',   chain: 'Polygon',               defillamaSlug: 'quickswap',   defillamaTvlSlug: 'quickswap',         dexscreenerChain: 'polygon',  dexscreenerDexIds: ['quickswap'], probePairs: ['QUICK USDC', 'WMATIC USDC'] }),
  mk({ name: 'Velodrome',   chain: 'Optimism',              defillamaSlug: 'velodrome',   defillamaTvlSlug: 'velodrome-v2',      dexscreenerChain: 'optimism', dexscreenerDexIds: ['velodrome'], probePairs: ['VELO USDC', 'WETH USDC'] }),
  mk({ name: 'Maverick',    chain: 'Ethereum+multi',        defillamaSlug: 'maverick-v2', defillamaTvlSlug: 'maverick-protocol', dexscreenerChain: 'ethereum', dexscreenerDexIds: ['maverick'],  probePairs: ['WETH USDC'] }),
  mk({ name: 'LFJ (Trader Joe)', chain: 'Avalanche',        defillamaSlug: 'lfj',         defillamaTvlSlug: 'joe-v2.2',          dexscreenerChain: 'avalanche', dexscreenerDexIds: ['lfj', 'traderjoe'], probePairs: ['JOE USDC', 'WAVAX USDC'] }),
  mk({ name: 'DODO',        chain: 'multi',                 defillamaSlug: 'dodo',        defillamaTvlSlug: 'dodo-amm',          dexscreenerChain: 'bsc',      dexscreenerDexIds: ['dodo'],      probePairs: ['DODO USDT'] }),
  mk({ name: 'SushiSwap',   chain: 'multi',                 defillamaSlug: 'sushiswap',   defillamaTvlSlug: 'sushiswap',         dexscreenerChain: 'ethereum', dexscreenerDexIds: ['sushiswap'], probePairs: ['SUSHI WETH', 'WETH USDC'] }),
  mk({ name: 'Ramses',      chain: 'Arbitrum/HyperEVM',     defillamaSlug: 'ramses-cl',   defillamaTvlSlug: 'ramses-cl',         dexscreenerChain: 'hyperevm', dexscreenerDexIds: ['ramses'],    probePairs: ['RAM USDC'] }),
  mk({ name: 'Blackhole',   chain: 'Avalanche',             defillamaSlug: 'blackhole',   defillamaTvlSlug: 'blackhole-amm',     dexscreenerChain: 'avalanche', dexscreenerDexIds: ['blackhole'], probePairs: ['BLACK WAVAX', 'WAVAX USDC'] }),
  mk({ name: 'Shadow',      chain: 'Sonic',                 defillamaSlug: 'shadow-exchange', defillamaTvlSlug: 'shadow-exchange-clmm', dexscreenerChain: 'sonic', dexscreenerDexIds: ['shadow'], probePairs: ['SHADOW USDC', 'wS USDC'] }),
  mk({ name: 'Bancor/Carbon', chain: 'Ethereum',            defillamaSlug: 'carbon-defi', defillamaTvlSlug: 'bancor',            dexscreenerChain: 'ethereum', dexscreenerDexIds: ['carbon', 'bancor'], probePairs: ['BNT USDC'] }),
  mk({ name: 'Spectra',     chain: 'Ethereum (yield)',      defillamaSlug: 'spectra',     defillamaTvlSlug: 'spectra-v2',        dexscreenerChain: 'ethereum', dexscreenerDexIds: ['spectra'],   probePairs: [] }),
  mk({ name: 'Pendle',      chain: 'Ethereum (yield)',      defillamaSlug: 'pendle',      defillamaTvlSlug: 'pendle',            dexscreenerChain: 'ethereum', dexscreenerDexIds: ['pendle'],    probePairs: [] }),
];

// ── collect all venues (or a name-filtered subset), soft-failing per venue ────────────────────
// Returns { asOf, count, venues:[...] }. A venue that throws (it shouldn't) becomes an error stub.
export async function collectEvmDexVenues(opts = {}) {
  const names = opts.venues && opts.venues.length
    ? opts.venues.map((n) => String(n).toLowerCase())
    : null;
  const targets = names
    ? EVM_DEX_VENUES.filter((v) => names.some((n) => v.name.toLowerCase().includes(n)))
    : EVM_DEX_VENUES;
  const venues = await Promise.all(targets.map((v) =>
    v.read().catch((e) => ({ venue: v.name, kind: v.kind, chain: v.chain, asOf: new Date().toISOString(), error: e.message, topPairs: [], sources: [], errors: [e.message] }))));
  return { asOf: new Date().toISOString(), count: venues.length, venues };
}

// ── HTTP surface: GET /api/venues/evm-dex ─────────────────────────────────────────────────────
export async function handler(req, res) {
  try {
    let names = null;
    if (req && req.url && req.url.includes('?')) {
      const qs = new URLSearchParams(req.url.split('?')[1]);
      const v = qs.get('venue') || qs.get('venues');
      if (v) names = v.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const payload = await collectEvmDexVenues(names ? { venues: names } : {});
    const body = JSON.stringify({
      surface: 'evm-dex', readOnly: true, signer: null,
      asOf: payload.asOf, count: payload.count, venues: payload.venues,
      note: 'READ-ONLY analytics. No keys, no orders, never broadcasts.',
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
  } catch (e) {
    res.writeHead(200, { 'content-type': 'application/json' }); // soft-fail: never 500 the caller
    res.end(JSON.stringify({ surface: 'evm-dex', readOnly: true, venues: [], error: esc(e.message) }));
  }
}

export default { EVM_DEX_VENUES, collectEvmDexVenues, edgeSignalsFromPairs, handler, __setFetch, MAX_PLAUSIBLE_EDGE };

// ── CLI: dashboard / --serve ──────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('evm-dex-venues.mjs')) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (process.argv.includes('--serve')) {
    const http = await import('node:http');
    const PORT = +(process.env.PORT || 8097);
    http.createServer((req, res) => {
      if (req.url && req.url.startsWith('/api/venues/evm-dex')) return handler(req, res);
      res.writeHead(404); res.end('not found');
    }).listen(PORT, () => console.log(`evm-dex venues surface on :${PORT}/api/venues/evm-dex`));
  } else {
    const payload = await collectEvmDexVenues(args.length ? { venues: args } : {})
      .catch((e) => ({ asOf: '', count: 0, venues: [], error: e.message }));
    const fmtUsd = (n) => n == null ? '—' : (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
    console.log('EVM SPOT DEX venues — READ-ONLY analytics (DefiLlama + DexScreener, keyless)\n' + '─'.repeat(92));
    console.log('venue            chain                  vol24h     vol7d      TVL        chg1d   pairs sources');
    for (const v of payload.venues) {
      console.log(
        `${(v.venue || '').padEnd(16)} ${(v.chain || '').padEnd(22).slice(0, 22)} ${fmtUsd(v.volume24hUsd).padStart(9)} ${fmtUsd(v.volume7dUsd).padStart(9)} ${fmtUsd(v.tvlUsd).padStart(9)} ${(v.change1dPct == null ? '—' : v.change1dPct.toFixed(1) + '%').padStart(7)} ${String((v.topPairs || []).length).padStart(5)} ${(v.sources || []).join('+')}`);
    }
    console.log('─'.repeat(92));
    for (const v of payload.venues) {
      if (!(v.topPairs || []).length) continue;
      console.log(`\n${v.venue} top pairs:`);
      for (const p of v.topPairs.slice(0, 4)) console.log(`  ${p.pair.padEnd(16)} $${p.priceUsd}  liq ${fmtUsd(p.liqUsd)}  vol24h ${fmtUsd(p.vol24h)}  [${p.dex}]`);
      for (const e of (v.edgeSignals || [])) console.log(`  edge ${e.pair} ${e.edgePct}% ${e.lowDex}->${e.highDex}${e.plausible ? '' : ' (TRAP/flagged)'}`);
    }
    console.log('\nREAD-ONLY. Every number is observational; no keys, no orders, never broadcasts.');
  }
}
