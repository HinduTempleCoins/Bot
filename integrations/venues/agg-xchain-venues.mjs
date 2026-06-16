// agg-xchain-venues.mjs — READ-ONLY analytics adapters for AGGREGATOR + CROSS-CHAIN +
// non-EVM-L1 venues, as granular as our HIVE-Engine market view (hive-engine-market.mjs).
// No keys, no trading, soft-fail-never-throw. Per venue we surface:
//   { venue, kind, chain, asOf, volume24hUsd, tvlUsd?, topPairs?, edgeSignals? }
//
// Sources (keyless; see integrations/CROSSCHAIN_BOTS.md):
//   - DefiLlama  /summary/dexs/<slug> + /summary/aggregators/<slug>  → 24h/7d volume per venue
//   - DefiLlama  /protocols                                          → per-protocol TVL
//   - THORChain  Midgard /v2/stats                                   → native swap vol/depth (DL fallback)
//   - Aggregator quote APIs (1inch/OpenOcean/KyberSwap)              → live route/price edge signal
// Every source is wrapped to soft-fail: a dead/garbage source degrades the row, never throws.
//
//   node integrations/venues/agg-xchain-venues.mjs            # collect all, print table
//   node integrations/venues/agg-xchain-venues.mjs serve      # GET /api/venues/agg-xchain
//   import { collectAggXchainVenues, AGG_XCHAIN_VENUES, handler } from './agg-xchain-venues.mjs'

import { fileURLToPath } from 'node:url';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// ---- injectable fetch seam (house pattern) ----
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function jget(url, { timeout = 15000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : 'no-response'}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function num(x) { const n = +x; return Number.isFinite(n) ? n : null; }

// ---------------------------------------------------------------------------
// Shared DefiLlama readers
// ---------------------------------------------------------------------------

// Volume summary for a single protocol slug under either the dexs or aggregators endpoint.
// `kind` selects the DefiLlama endpoint family: 'A' (aggregator) → /aggregators, else /dexs.
async function llamaVolume(slug, kind = 'S') {
  const family = kind === 'A' ? 'aggregators' : 'dexs';
  const url = `https://api.llama.fi/summary/${family}/${encodeURIComponent(slug)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
  const d = await jget(url);
  if (!d || typeof d !== 'object' || d.error) return null;
  return {
    volume24hUsd: num(d.total24h),
    volume7dUsd: num(d.total7d),
    volume30dUsd: num(d.total30d),
    change1d: num(d.change_1d),
    chains: Array.isArray(d.chains) ? d.chains : null,
    source: `defillama/${family}/${slug}`,
  };
}

// Per-protocol TVL from the /protocols snapshot. Cached for the lifetime of one collect() pass so
// ten venues don't each pull the (heavy) full protocols list.
let _protocolsCache = null;
async function llamaProtocols() {
  if (_protocolsCache) return _protocolsCache;
  const all = await jget('https://api.llama.fi/protocols');
  _protocolsCache = Array.isArray(all) ? all : [];
  return _protocolsCache;
}
function _resetProtocolsCache() { _protocolsCache = null; }

async function llamaTvl(slug) {
  const all = await llamaProtocols();
  const p = all.find((x) => x && x.slug === slug);
  return p ? num(p.tvl) : null;
}

// ---------------------------------------------------------------------------
// THORChain native (Midgard) reader — preferred for THORChain; DefiLlama is the fallback
// ---------------------------------------------------------------------------
async function thorchainMidgard() {
  // ninerealms asks for an x-client-id; harmless to send.
  const s = await jget('https://midgard.ninerealms.com/v2/stats', { headers: { 'x-client-id': 'melek-bot' } });
  if (!s || typeof s !== 'object') return null;
  const runePrice = num(s.runePriceUSD);
  // Midgard reports swapVolume in 1e-8 RUNE units; convert to RUNE then USD.
  const volRune = num(s.swapVolume);
  const volUsd = (volRune != null && runePrice != null) ? (volRune / 1e8) * runePrice : null;
  return {
    runePriceUSD: runePrice,
    swapCount24h: num(s.swapCount24h),
    totalSwapVolumeUsd: volUsd,
    source: 'midgard/v2/stats',
  };
}

// ---------------------------------------------------------------------------
// Aggregator live-quote edge signals (keyless where possible)
// ---------------------------------------------------------------------------

// OpenOcean has a keyless public quote endpoint. A successful quote = live routing edge signal
// (we surface the out-amount per 1 unit in for a canonical pair, no key, no trade).
// Soft-fails to null on any error / rate-limit / key requirement.
async function openOceanQuote() {
  // 1 ETH (1e18 wei) → USDC on Ethereum, gas-priced route. Keyless v3 quote.
  const url = 'https://open-api.openocean.finance/v3/eth/quote'
    + '?inTokenAddress=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
    + '&outTokenAddress=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    + '&amount=1&gasPrice=5';
  const d = await jget(url, { timeout: 10000 }).catch(() => null);
  if (!d || d.code !== 200 || !d.data) return null;
  return { pair: 'ETH/USDC', outAmount: num(d.data.outAmount), priceImpact: num(d.data.price_impact), liveQuote: true };
}

// ---------------------------------------------------------------------------
// Registry — each venue knows its own best read path and degrades gracefully.
// kind: 'A' = aggregator, 'S' = swap/AMM/cross-chain venue.
// ---------------------------------------------------------------------------

function row(base, extra) {
  return { venue: base.name, kind: base.kind, chain: base.chain, asOf: new Date().toISOString(), ...extra };
}

// Generic DefiLlama-backed read: volume (dexs|aggregators) + optional TVL by slug.
function llamaRead(base, { volSlug, tvlSlug, edge } = {}) {
  return async () => {
    const out = { venue: base.name, kind: base.kind, chain: base.chain, asOf: new Date().toISOString(),
      volume24hUsd: null, tvlUsd: null, topPairs: null, edgeSignals: {}, sources: [], errors: [] };
    if (volSlug) {
      const v = await llamaVolume(volSlug, base.kind).catch((e) => { out.errors.push(`vol:${e.message}`); return null; });
      if (v) {
        out.volume24hUsd = v.volume24hUsd;
        out.edgeSignals.volume7dUsd = v.volume7dUsd;
        if (v.volume30dUsd != null) out.edgeSignals.volume30dUsd = v.volume30dUsd;
        out.edgeSignals.change1d = v.change1d;
        if (v.chains) out.edgeSignals.activeChains = v.chains.length;
        out.sources.push(v.source);
      }
    }
    if (tvlSlug) {
      const t = await llamaTvl(tvlSlug).catch((e) => { out.errors.push(`tvl:${e.message}`); return null; });
      if (t != null) { out.tvlUsd = t; out.sources.push(`defillama/protocols/${tvlSlug}`); }
    }
    if (edge) {
      const e = await edge().catch((err) => { out.errors.push(`edge:${err.message}`); return null; });
      if (e) Object.assign(out.edgeSignals, e);
    }
    if (out.tvlUsd != null && out.volume24hUsd != null && out.tvlUsd > 0) {
      out.edgeSignals.volumeToTvl = +(out.volume24hUsd / out.tvlUsd).toFixed(4);
    }
    return out;
  };
}

export const AGG_XCHAIN_VENUES = [
  // ---- Aggregators (A) — volume via DefiLlama /aggregators; keyless quote where possible ----
  (() => { const b = { name: '1inch', kind: 'A', chain: 'multi' };
    return { ...b, read: llamaRead(b, { volSlug: '1inch' }) }; })(),
  (() => { const b = { name: 'OpenOcean', kind: 'A', chain: 'multi' };
    return { ...b, read: llamaRead(b, { volSlug: 'openocean', edge: openOceanQuote }) }; })(),
  (() => { const b = { name: 'KyberSwap', kind: 'A', chain: 'multi' };
    return { ...b, read: llamaRead(b, { volSlug: 'kyberswap-aggregator' }) }; })(),
  (() => { const b = { name: 'Hashflow', kind: 'A', chain: 'multi (RFQ)' };
    // Hashflow is RFQ but DefiLlama tracks it under dexs.
    return { ...b, read: llamaRead({ ...b, kind: 'S' }, { volSlug: 'hashflow', tvlSlug: 'hashflow' }) }; })(),

  // ---- Cross-chain / non-EVM L1 swap venues (S) ----
  (() => { const b = { name: 'THORChain', kind: 'S', chain: 'cross-chain' };
    // Prefer native Midgard; fall back to DefiLlama (which often reports 24h=0 for THORChain).
    return { ...b, read: async () => {
      const out = await llamaRead(b, { volSlug: 'thorchain-dex', tvlSlug: 'thorchain' })();
      const mg = await thorchainMidgard().catch((e) => { out.errors.push(`midgard:${e.message}`); return null; });
      if (mg) {
        out.edgeSignals.runePriceUSD = mg.runePriceUSD;
        out.edgeSignals.swapCount24h = mg.swapCount24h;
        out.edgeSignals.totalSwapVolumeUsd = mg.totalSwapVolumeUsd;
        out.sources.push(mg.source);
      }
      return out;
    } }; })(),
  (() => { const b = { name: 'Osmosis', kind: 'S', chain: 'Cosmos' };
    return { ...b, read: llamaRead(b, { volSlug: 'osmosis-dex', tvlSlug: 'osmosis-dex' }) }; })(),
  (() => { const b = { name: 'Cetus', kind: 'S', chain: 'Sui' };
    return { ...b, read: llamaRead(b, { volSlug: 'cetus-clmm', tvlSlug: 'cetus-clmm' }) }; })(),
  (() => { const b = { name: 'Ekubo', kind: 'S', chain: 'Starknet/Eth' };
    return { ...b, read: llamaRead(b, { volSlug: 'ekubo', tvlSlug: 'ekubo' }) }; })(),
  (() => { const b = { name: 'Hyperion', kind: 'S', chain: 'Aptos/HyperEVM' };
    return { ...b, read: llamaRead(b, { volSlug: 'hyperion', tvlSlug: 'hyperion' }) }; })(),
  (() => { const b = { name: 'Magma', kind: 'S', chain: 'Move (Sui)' };
    // Magma volume isn't on DefiLlama /dexs; TVL is on /protocols (slug 'magma').
    return { ...b, read: llamaRead(b, { volSlug: 'magma', tvlSlug: 'magma' }) }; })(),
];

// ---------------------------------------------------------------------------
// Collector — run every venue's read() in parallel, soft-fail each independently.
// ---------------------------------------------------------------------------
export async function collectAggXchainVenues() {
  _resetProtocolsCache(); // fresh TVL snapshot per pass
  const venues = await Promise.all(AGG_XCHAIN_VENUES.map(async (v) => {
    try { return await v.read(); }
    catch (e) {
      return { venue: v.name, kind: v.kind, chain: v.chain, asOf: new Date().toISOString(),
        volume24hUsd: null, tvlUsd: null, topPairs: null, edgeSignals: {}, sources: [], errors: [`read:${e && e.message}`] };
    }
  }));
  const withVol = venues.filter((v) => v.volume24hUsd != null).length;
  const withTvl = venues.filter((v) => v.tvlUsd != null).length;
  return {
    ok: true,
    asOf: new Date().toISOString(),
    count: venues.length,
    summary: { venuesWithVolume: withVol, venuesWithTvl: withTvl },
    venues,
  };
}

// ---------------------------------------------------------------------------
// HTTP handler — GET /api/venues/agg-xchain
// ---------------------------------------------------------------------------
export async function handler(req, res) {
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const path = (req.url || '/').split('?')[0];
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' && (path === '/api/venues/agg-xchain' || path === '/' || path === '/agg-xchain')) {
    try { return sendJson(200, await collectAggXchainVenues()); }
    catch (e) { return sendJson(200, { ok: false, error: e && e.message, venues: [] }); }
  }
  return sendJson(404, { ok: false, error: 'not found' });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === 'serve') {
    const { createServer } = await import('node:http');
    const PORT = +process.env.PORT || 8095;
    createServer((req, res) => handler(req, res)).listen(PORT, () => {
      console.log(`agg-xchain venues on :${PORT}  GET /api/venues/agg-xchain`);
    });
  } else {
    const fmtUsd = (n) => n == null ? '—' : '$' + (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n.toLocaleString());
    const data = await collectAggXchainVenues();
    console.log('\n══════ AGGREGATOR + CROSS-CHAIN + non-EVM-L1 venues (read-only) ══════');
    console.log(`asOf ${data.asOf}  |  ${data.summary.venuesWithVolume}/${data.count} with volume, ${data.summary.venuesWithTvl}/${data.count} with TVL\n`);
    for (const v of data.venues) {
      const sig = Object.entries(v.edgeSignals || {}).filter(([, x]) => x != null).map(([k, x]) => `${k}=${x}`).join(' ');
      console.log(`  ${(`[${v.kind}] ${v.venue}`).padEnd(22)} ${String(v.chain).padEnd(16)} vol24h:${fmtUsd(v.volume24hUsd).padEnd(11)} tvl:${fmtUsd(v.tvlUsd).padEnd(11)}`);
      if (sig) console.log(`      ↳ ${sig}`);
      if (v.errors && v.errors.length) console.log(`      ⚠ ${v.errors.join(' | ')}`);
    }
    console.log('');
  }
}
