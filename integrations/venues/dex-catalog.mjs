// dex-catalog.mjs — READ-ONLY multi-chain DEX / perp / aggregator VENUE CATALOG.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
//  READ-ONLY by construction. NO keys, NO orders, NEVER broadcasts (zero-WIF rule, BRIEF.md §7).
//  There is NO code path here that signs or broadcasts. Every number is observational.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  This is the BROAD DeFiLlama-keyed catalog layer that complements the dedicated per-venue native
//  collectors (evm-dex-venues.mjs, perps-venues.mjs, us-cex-venues.mjs, he-external-listings.mjs).
//  Those readers hit each venue's own API for per-pair/per-market granularity; this catalog instead
//  keys EVERY venue in the operator's list to a DeFiLlama protocol slug and pulls protocol-level
//  24h volume + TVL the scalable, keyless way. Where the native collectors already cover a venue
//  deeply, this layer adds breadth (one row per venue, ~150 venues, tagged by chain).
//
//  Data sources (keyless HTTP, injectable fetch):
//    DefiLlama dexs        — /summary/dexs/<slug>?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true
//                            -> { total24h, total7d, total30d, change_1d }
//    DefiLlama derivatives — /summary/derivatives/<slug>  (same shape; for the (P) perp venues)
//    DefiLlama TVL         — /tvl/<slug>  -> a bare number  (spot/dex venues)
//    An unknown slug returns { message: "..." } (or a non-numeric string for /tvl) -> a MISS (null),
//    NEVER a number. Each entry soft-fails independently; one dead venue never breaks the collection.
//
//   import { DEX_CATALOG, collectDexCatalog, handler, __setFetch } from './venues/dex-catalog.mjs'
//   node integrations/venues/dex-catalog.mjs            # by-chain table + top-10 + stats (network)
//   node integrations/venues/dex-catalog.mjs --serve    # GET /api/venues/catalog
//   node integrations/venues/dex-catalog.mjs bsc solana # subset by chain

import { fileURLToPath } from 'node:url';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// ── injectable fetch seam (house pattern) — offline tests drive the collector without a network ──
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (x) => { const n = +x; return Number.isFinite(n) ? n : null; };
const nowIso = () => new Date().toISOString();

const LLAMA_BASE = process.env.CATALOG_LLAMA_BASE || 'https://api.llama.fi';
const TIMEOUT_MS = +(process.env.CATALOG_TIMEOUT_MS || 12000);
const CONCURRENCY = +(process.env.CATALOG_CONCURRENCY || 8);

// ── DefiLlama summary (dexs OR derivatives) — keyless, soft-fails to null ──────────────────────
// Unknown slug -> { message: ... } (no total24h/total7d) -> null (a MISS, not a number).
async function llamaSummary(slug, type = 'dexs') {
  if (!slug) return null;
  try {
    const url = `${LLAMA_BASE}/summary/${type}/${encodeURIComponent(slug)}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let j;
    try {
      const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      if (!r || (typeof r.ok === 'boolean' && !r.ok)) return null;
      j = await r.json();
    } finally { clearTimeout(t); }
    if (!j || typeof j !== 'object' || (j.total24h == null && j.total7d == null)) return null;
    return {
      volume24hUsd: num(j.total24h),
      volume7dUsd: num(j.total7d),
      volume30dUsd: num(j.total30d),
      change1dPct: num(j.change_1d),
    };
  } catch { return null; }
}

// ── DefiLlama protocol TVL — /tvl/<slug> -> a bare number; non-numeric string on a miss -> null ──
async function llamaTvl(slug) {
  if (!slug) return null;
  try {
    const url = `${LLAMA_BASE}/tvl/${encodeURIComponent(slug)}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let body;
    try {
      const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctrl.signal });
      if (!r || (typeof r.ok === 'boolean' && !r.ok)) return null;
      body = await r.json();
    } finally { clearTimeout(t); }
    const v = num(body);
    return v != null && v > 0 ? v : null;
  } catch { return null; }
}

// ── the REGISTRY ────────────────────────────────────────────────────────────────────────────────
//  Each entry: { id, name, chain, kind, defillamaSlug, defillamaType?: 'dexs'|'derivatives',
//                confidence: 'high'|'medium'|'verify', note? }
//  kind ∈ 'dex' (spot AMM/orderbook) · 'perp' (the (P) items) · 'aggregator' (the (A) items)
//         · 'options' (Derive) · 'rwa' (Ostium).
//  defillamaType:'derivatives' for perps/aggregators DefiLlama tracks under derivatives; else 'dexs'.
//  confidence:'verify' = best-effort slug guess (an unknown slug just soft-fails to null — honest).
//
//  Items 1-50 (the highest-volume majors) are covered deeply by the dedicated collectors; a handful
//  of majors are included here for completeness. The focus is items 51-150.
function mk(e) { return { defillamaType: 'dexs', confidence: 'high', ...e }; }

export const DEX_CATALOG = [
  // ── majors (for completeness; deep coverage lives in the dedicated collectors) ──────────────
  mk({ id: 'uniswap',       name: 'Uniswap',       chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'uniswap' }),
  mk({ id: 'pancakeswap',   name: 'PancakeSwap',   chain: 'bsc',       kind: 'dex',        defillamaSlug: 'pancakeswap' }),
  mk({ id: 'curve',         name: 'Curve',         chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'curve-dex' }),
  mk({ id: 'hyperliquid',   name: 'Hyperliquid',   chain: 'hyperevm',  kind: 'perp',       defillamaSlug: 'hyperliquid', defillamaType: 'derivatives' }),
  mk({ id: 'gmx',           name: 'GMX',           chain: 'arbitrum',  kind: 'perp',       defillamaSlug: 'gmx', defillamaType: 'derivatives' }),

  // ── Ethereum DEX / aggregators (51-65) ──────────────────────────────────────────────────────
  mk({ id: 'cow-protocol',  name: 'CoW Protocol',  chain: 'ethereum',  kind: 'aggregator', defillamaSlug: 'cowswap', defillamaType: 'dexs-aggregators', note: 'A/RFQ batch auction' }),
  mk({ id: '0x',            name: '0x Protocol',   chain: 'ethereum',  kind: 'aggregator', defillamaSlug: '0x', defillamaType: 'dexs-aggregators', confidence: 'verify' }),
  mk({ id: 'matcha',        name: 'Matcha',        chain: 'ethereum',  kind: 'aggregator', defillamaSlug: 'matcha', defillamaType: 'dexs-aggregators', confidence: 'verify', note: '0x front-end aggregator' }),
  mk({ id: 'paraswap',      name: 'ParaSwap',      chain: 'ethereum',  kind: 'aggregator', defillamaSlug: 'paraswap', defillamaType: 'dexs-aggregators' }),
  mk({ id: 'odos',          name: 'Odos',          chain: 'ethereum',  kind: 'aggregator', defillamaSlug: 'odos', defillamaType: 'dexs-aggregators' }),
  mk({ id: 'bebop',         name: 'Bebop',         chain: 'ethereum',  kind: 'aggregator', defillamaSlug: 'bebop', defillamaType: 'dexs-aggregators', confidence: 'verify', note: 'A/RFQ' }),
  mk({ id: 'clipper',       name: 'Clipper',       chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'clipper', confidence: 'verify' }),
  mk({ id: 'smardex',       name: 'SmarDex',       chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'smardex', confidence: 'verify' }),
  mk({ id: 'integral',      name: 'Integral',      chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'integral', confidence: 'verify' }),
  mk({ id: 'swaap',         name: 'Swaap',         chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'swaap-v2', confidence: 'verify' }),
  mk({ id: 'fraxswap',      name: 'Fraxswap',      chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'fraxswap', confidence: 'verify' }),
  mk({ id: 'verse',         name: 'Verse',         chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'verse', confidence: 'verify' }),
  mk({ id: 'shibaswap',     name: 'ShibaSwap',     chain: 'ethereum',  kind: 'dex',        defillamaSlug: 'shibaswap', confidence: 'verify' }),
  mk({ id: 'ambient',       name: 'Ambient Finance', chain: 'ethereum', kind: 'dex',       defillamaSlug: 'ambient', confidence: 'verify' }),
  mk({ id: 'iziswap',       name: 'iZiSwap (iZUMi)', chain: 'ethereum', kind: 'dex',       defillamaSlug: 'izumi-finance', confidence: 'verify' }),

  // ── BNB Chain (66-72) ─────────────────────────────────────────────────────────────────────
  mk({ id: 'thena',         name: 'Thena',         chain: 'bsc',       kind: 'dex',        defillamaSlug: 'thena' }),
  mk({ id: 'wombat',        name: 'Wombat Exchange', chain: 'bsc',     kind: 'dex',        defillamaSlug: 'wombat-exchange' }),
  mk({ id: 'biswap',        name: 'Biswap',        chain: 'bsc',       kind: 'dex',        defillamaSlug: 'biswap' }),
  mk({ id: 'apeswap',       name: 'ApeSwap',       chain: 'bsc',       kind: 'dex',        defillamaSlug: 'apeswap', confidence: 'verify' }),
  mk({ id: 'mdex',          name: 'MDEX',          chain: 'bsc',       kind: 'dex',        defillamaSlug: 'mdex', confidence: 'verify' }),
  mk({ id: 'babyswap',      name: 'BabySwap',      chain: 'bsc',       kind: 'dex',        defillamaSlug: 'babyswap', confidence: 'verify' }),
  mk({ id: 'ellipsis',      name: 'Ellipsis',      chain: 'bsc',       kind: 'dex',        defillamaSlug: 'ellipsis-finance', confidence: 'verify' }),

  // ── Solana (73-86) ────────────────────────────────────────────────────────────────────────
  mk({ id: 'phoenix',       name: 'Phoenix',       chain: 'solana',    kind: 'dex',        defillamaSlug: 'phoenix', confidence: 'verify', note: 'on-chain orderbook' }),
  mk({ id: 'openbook',      name: 'OpenBook',      chain: 'solana',    kind: 'dex',        defillamaSlug: 'openbook', confidence: 'verify', note: 'CLOB' }),
  mk({ id: 'invariant',     name: 'Invariant',     chain: 'solana',    kind: 'dex',        defillamaSlug: 'invariant', confidence: 'verify' }),
  mk({ id: 'goosefx',       name: 'GooseFX',       chain: 'solana',    kind: 'dex',        defillamaSlug: 'goosefx', confidence: 'verify' }),
  mk({ id: 'saber',         name: 'Saber',         chain: 'solana',    kind: 'dex',        defillamaSlug: 'saber', confidence: 'verify' }),
  mk({ id: 'fluxbeam',      name: 'FluxBeam',      chain: 'solana',    kind: 'dex',        defillamaSlug: 'fluxbeam', confidence: 'verify' }),
  mk({ id: 'stabble',       name: 'Stabble',       chain: 'solana',    kind: 'dex',        defillamaSlug: 'stabble', confidence: 'verify' }),
  mk({ id: 'solfi',         name: 'SolFi',         chain: 'solana',    kind: 'dex',        defillamaSlug: 'solfi', confidence: 'verify' }),
  mk({ id: 'obric',         name: 'Obric',         chain: 'solana',    kind: 'dex',        defillamaSlug: 'obric-v2', confidence: 'verify' }),
  mk({ id: 'humidifi',      name: 'HumidiFi',      chain: 'solana',    kind: 'dex',        defillamaSlug: 'humidifi', confidence: 'verify' }),
  mk({ id: 'byreal',        name: 'Byreal',        chain: 'solana',    kind: 'dex',        defillamaSlug: 'byreal', confidence: 'verify' }),
  mk({ id: 'bonkswap',      name: 'Bonkswap',      chain: 'solana',    kind: 'dex',        defillamaSlug: 'bonkswap', confidence: 'verify' }),
  mk({ id: 'zeta',          name: 'Zeta Markets',  chain: 'solana',    kind: 'perp',       defillamaSlug: 'zeta', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'mango',         name: 'Mango Markets', chain: 'solana',    kind: 'perp',       defillamaSlug: 'mango-markets', defillamaType: 'derivatives', confidence: 'verify' }),

  // ── Arbitrum (87-94) ──────────────────────────────────────────────────────────────────────
  mk({ id: 'chronos',       name: 'Chronos',       chain: 'arbitrum',  kind: 'dex',        defillamaSlug: 'chronos', confidence: 'verify' }),
  mk({ id: 'zyberswap',     name: 'Zyberswap',     chain: 'arbitrum',  kind: 'dex',        defillamaSlug: 'zyberswap', confidence: 'verify' }),
  mk({ id: 'woofi',         name: 'WooFi',         chain: 'arbitrum',  kind: 'dex',        defillamaSlug: 'woofi', confidence: 'verify' }),
  mk({ id: 'hmx',           name: 'HMX',           chain: 'arbitrum',  kind: 'perp',       defillamaSlug: 'hmx', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'mux',           name: 'MUX Protocol',  chain: 'arbitrum',  kind: 'perp',       defillamaSlug: 'mux-protocol', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'rage-trade',    name: 'Rage Trade',    chain: 'arbitrum',  kind: 'perp',       defillamaSlug: 'rage-trade', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'ostium',        name: 'Ostium',        chain: 'arbitrum',  kind: 'rwa',        defillamaSlug: 'ostium', defillamaType: 'derivatives', confidence: 'verify', note: 'P, RWA perps' }),
  mk({ id: 'contango',      name: 'Contango',      chain: 'arbitrum',  kind: 'perp',       defillamaSlug: 'contango', defillamaType: 'derivatives', confidence: 'verify' }),

  // ── Optimism / Base (OP-stack) (95-102) ─────────────────────────────────────────────────────
  mk({ id: 'synthetix',     name: 'Synthetix',     chain: 'optimism',  kind: 'perp',       defillamaSlug: 'synthetix', defillamaType: 'derivatives' }),
  mk({ id: 'kwenta',        name: 'Kwenta',        chain: 'optimism',  kind: 'perp',       defillamaSlug: 'kwenta', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'polynomial',    name: 'Polynomial',    chain: 'optimism',  kind: 'perp',       defillamaSlug: 'polynomial', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'derive',        name: 'Derive',        chain: 'optimism',  kind: 'options',    defillamaSlug: 'derive', defillamaType: 'options', confidence: 'verify', note: 'ex-Lyra, options' }),
  mk({ id: 'avantis',       name: 'Avantis',       chain: 'base',      kind: 'perp',       defillamaSlug: 'avantis', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'extra-finance', name: 'Extra Finance', chain: 'base',      kind: 'dex',        defillamaSlug: 'extra-finance', confidence: 'verify' }),
  mk({ id: 'baseswap',      name: 'BaseSwap',      chain: 'base',      kind: 'dex',        defillamaSlug: 'baseswap', confidence: 'verify' }),
  mk({ id: 'swapbased',     name: 'SwapBased',     chain: 'base',      kind: 'dex',        defillamaSlug: 'swapbased', confidence: 'verify' }),

  // ── Polygon (103-106) ─────────────────────────────────────────────────────────────────────
  mk({ id: 'dfyn',          name: 'Dfyn',          chain: 'polygon',   kind: 'dex',        defillamaSlug: 'dfyn', confidence: 'verify' }),
  mk({ id: 'retro',         name: 'Retro',         chain: 'polygon',   kind: 'dex',        defillamaSlug: 'retro', confidence: 'verify' }),
  mk({ id: 'meshswap',      name: 'Meshswap',      chain: 'polygon',   kind: 'dex',        defillamaSlug: 'meshswap', confidence: 'verify' }),
  mk({ id: 'gains-network', name: 'Gains Network / gTrade', chain: 'polygon', kind: 'perp', defillamaSlug: 'gains-network', defillamaType: 'derivatives' }),

  // ── Avalanche (107-110) ───────────────────────────────────────────────────────────────────
  mk({ id: 'pangolin',      name: 'Pangolin',      chain: 'avalanche', kind: 'dex',        defillamaSlug: 'pangolin', confidence: 'verify' }),
  mk({ id: 'pharaoh',       name: 'Pharaoh',       chain: 'avalanche', kind: 'dex',        defillamaSlug: 'pharaoh-exchange', confidence: 'verify' }),
  mk({ id: 'platypus',      name: 'Platypus',      chain: 'avalanche', kind: 'dex',        defillamaSlug: 'platypus-finance', confidence: 'verify' }),
  mk({ id: 'vela',          name: 'Vela Exchange', chain: 'avalanche', kind: 'perp',       defillamaSlug: 'vela-exchange', defillamaType: 'derivatives', confidence: 'verify' }),

  // ── Fantom / Sonic (111-115) ──────────────────────────────────────────────────────────────
  mk({ id: 'spookyswap',    name: 'SpookySwap',    chain: 'fantom',    kind: 'dex',        defillamaSlug: 'spookyswap' }),
  mk({ id: 'equalizer',     name: 'Equalizer',     chain: 'fantom',    kind: 'dex',        defillamaSlug: 'equalizer-exchange', confidence: 'verify' }),
  mk({ id: 'swapx',         name: 'SwapX',         chain: 'sonic',     kind: 'dex',        defillamaSlug: 'swapx', confidence: 'verify' }),
  mk({ id: 'beethoven-x',   name: 'Beethoven X',   chain: 'sonic',     kind: 'dex',        defillamaSlug: 'beethoven-x', confidence: 'verify' }),
  mk({ id: 'metropolis',    name: 'Metropolis',    chain: 'sonic',     kind: 'dex',        defillamaSlug: 'metropolis', confidence: 'verify' }),

  // ── Sui (116-121) ─────────────────────────────────────────────────────────────────────────
  mk({ id: 'turbos',        name: 'Turbos Finance', chain: 'sui',      kind: 'dex',        defillamaSlug: 'turbos-finance', confidence: 'verify' }),
  mk({ id: 'kriya',         name: 'Kriya',         chain: 'sui',       kind: 'dex',        defillamaSlug: 'kriyadex', confidence: 'verify' }),
  mk({ id: 'flowx',         name: 'FlowX',         chain: 'sui',       kind: 'dex',        defillamaSlug: 'flowx-finance', confidence: 'verify' }),
  mk({ id: 'aftermath',     name: 'Aftermath',     chain: 'sui',       kind: 'dex',        defillamaSlug: 'aftermath-finance', confidence: 'verify' }),
  mk({ id: 'deepbook',      name: 'DeepBook',      chain: 'sui',       kind: 'dex',        defillamaSlug: 'deepbook', confidence: 'verify', note: 'CLOB' }),
  mk({ id: 'momentum',      name: 'Momentum',      chain: 'sui',       kind: 'dex',        defillamaSlug: 'momentum', confidence: 'verify' }),

  // ── Aptos / Move (122-124) ────────────────────────────────────────────────────────────────
  mk({ id: 'liquidswap',    name: 'Liquidswap',    chain: 'aptos',     kind: 'dex',        defillamaSlug: 'liquidswap', confidence: 'verify' }),
  mk({ id: 'thala',         name: 'Thala',         chain: 'aptos',     kind: 'dex',        defillamaSlug: 'thala', confidence: 'verify' }),
  mk({ id: 'cellana',       name: 'Cellana',       chain: 'aptos',     kind: 'dex',        defillamaSlug: 'cellana-finance', confidence: 'verify' }),

  // ── Cosmos / Injective (125-130) ──────────────────────────────────────────────────────────
  mk({ id: 'astroport',     name: 'Astroport',     chain: 'cosmos',    kind: 'dex',        defillamaSlug: 'astroport', confidence: 'verify' }),
  mk({ id: 'helix',         name: 'Helix',         chain: 'injective', kind: 'dex',        defillamaSlug: 'helix', confidence: 'verify', note: 'orderbook' }),
  mk({ id: 'white-whale',   name: 'White Whale',   chain: 'cosmos',    kind: 'dex',        defillamaSlug: 'white-whale', confidence: 'verify' }),
  mk({ id: 'crescent',      name: 'Crescent',      chain: 'cosmos',    kind: 'dex',        defillamaSlug: 'crescent', confidence: 'verify' }),
  mk({ id: 'levana',        name: 'Levana',        chain: 'cosmos',    kind: 'perp',       defillamaSlug: 'levana', defillamaType: 'derivatives', confidence: 'verify' }),
  mk({ id: 'dexter',        name: 'Dexter',        chain: 'cosmos',    kind: 'dex',        defillamaSlug: 'dexter', confidence: 'verify' }),

  // ── zk & newer L2s (zkSync / Linea / Scroll) (131-137) ──────────────────────────────────────
  mk({ id: 'syncswap',      name: 'SyncSwap',      chain: 'zksync',    kind: 'dex',        defillamaSlug: 'syncswap', confidence: 'verify' }),
  mk({ id: 'koi',           name: 'Koi (ex-Mute)', chain: 'zksync',    kind: 'dex',        defillamaSlug: 'koi-finance', confidence: 'verify' }),
  mk({ id: 'spacefi',       name: 'SpaceFi',       chain: 'zksync',    kind: 'dex',        defillamaSlug: 'spacefi', confidence: 'verify' }),
  mk({ id: 'velocore',      name: 'Velocore',      chain: 'linea',     kind: 'dex',        defillamaSlug: 'velocore', confidence: 'verify' }),
  mk({ id: 'lynex',         name: 'Lynex',         chain: 'linea',     kind: 'dex',        defillamaSlug: 'lynex', confidence: 'verify' }),
  mk({ id: 'nile',          name: 'Nile',          chain: 'linea',     kind: 'dex',        defillamaSlug: 'nile-exchange', confidence: 'verify' }),
  mk({ id: 'nuri',          name: 'Nuri',          chain: 'scroll',    kind: 'dex',        defillamaSlug: 'nuri-exchange', confidence: 'verify' }),

  // ── HyperEVM (138-139) ────────────────────────────────────────────────────────────────────
  mk({ id: 'hyperswap',     name: 'HyperSwap',     chain: 'hyperevm',  kind: 'dex',        defillamaSlug: 'hyperswap', confidence: 'verify' }),
  mk({ id: 'kittenswap',    name: 'Kittenswap',    chain: 'hyperevm',  kind: 'dex',        defillamaSlug: 'kittenswap', confidence: 'verify' }),

  // ── Non-EVM L1s (140-150) ─────────────────────────────────────────────────────────────────
  mk({ id: 'minswap',       name: 'Minswap',       chain: 'cardano',   kind: 'dex',        defillamaSlug: 'minswap', confidence: 'verify' }),
  mk({ id: 'sundaeswap',    name: 'SundaeSwap',    chain: 'cardano',   kind: 'dex',        defillamaSlug: 'sundaeswap', confidence: 'verify' }),
  mk({ id: 'wingriders',    name: 'WingRiders',    chain: 'cardano',   kind: 'dex',        defillamaSlug: 'wingriders', confidence: 'verify' }),
  mk({ id: 'muesliswap',    name: 'MuesliSwap',    chain: 'cardano',   kind: 'dex',        defillamaSlug: 'muesliswap', confidence: 'verify' }),
  mk({ id: 'tinyman',       name: 'Tinyman',       chain: 'algorand',  kind: 'dex',        defillamaSlug: 'tinyman', confidence: 'verify' }),
  mk({ id: 'pact',          name: 'Pact',          chain: 'algorand',  kind: 'dex',        defillamaSlug: 'pact', confidence: 'verify' }),
  mk({ id: 'quipuswap',     name: 'QuipuSwap',     chain: 'tezos',     kind: 'dex',        defillamaSlug: 'quipuswap', confidence: 'verify' }),
  mk({ id: 'plentydefi',    name: 'PlentyDeFi',    chain: 'tezos',     kind: 'dex',        defillamaSlug: 'plenty', confidence: 'verify' }),
  mk({ id: 'ref-finance',   name: 'Ref Finance',   chain: 'near',      kind: 'dex',        defillamaSlug: 'ref-finance', confidence: 'verify' }),
  mk({ id: 'alex',          name: 'ALEX',          chain: 'stacks',    kind: 'dex',        defillamaSlug: 'alex', confidence: 'verify' }),
  mk({ id: 'velar',         name: 'Velar',         chain: 'stacks',    kind: 'dex',        defillamaSlug: 'velar', confidence: 'verify' }),
];

// ── read one catalog entry: DefiLlama summary (+ TVL for spot venues), soft-fails per source ─────
async function readEntry(e) {
  const meta = { id: e.id, name: e.name, chain: e.chain, kind: e.kind, confidence: e.confidence };
  const type = e.defillamaType || 'dexs';
  // derivatives/options/aggregator slugs don't carry a /tvl protocol number worth pulling; only
  // fetch TVL for spot dexs (and the rwa/dex-style venues), keeping the fan-out lean.
  const wantTvl = type === 'dexs';
  try {
    const [summary, tvl] = await Promise.all([
      llamaSummary(e.defillamaSlug, type).catch(() => null),
      wantTvl ? llamaTvl(e.defillamaSlug).catch(() => null) : Promise.resolve(null),
    ]);
    const alive = !!(summary || tvl != null);
    return {
      ...meta,
      volume24hUsd: summary ? summary.volume24hUsd : null,
      tvlUsd: tvl != null ? tvl : null,
      change1d: summary ? summary.change1dPct : null,
      source: `defillama:${type}`,
      alive,
    };
  } catch {
    return { ...meta, volume24hUsd: null, tvlUsd: null, change1d: null, source: `defillama:${type}`, alive: false };
  }
}

// ── chunked fan-out (bounded concurrency) so we never open ~150 sockets at once ─────────────────
async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...await Promise.all(batch.map(fn)));
  }
  return out;
}

// ── collect the whole catalog (or a chain-filtered subset), soft-failing per entry ──────────────
// Returns { ok, asOf, venues:[{ id,name,chain,kind,volume24hUsd,tvlUsd,change1d,source,alive,confidence }] }.
export async function collectDexCatalog(opts = {}) {
  const chains = Array.isArray(opts.chains) && opts.chains.length
    ? new Set(opts.chains.map((c) => String(c).toLowerCase()))
    : null;
  const ids = Array.isArray(opts.ids) && opts.ids.length
    ? new Set(opts.ids.map((s) => String(s).toLowerCase()))
    : null;
  const targets = DEX_CATALOG.filter((e) =>
    (!chains || chains.has(e.chain)) && (!ids || ids.has(e.id)));
  const venues = await inChunks(targets, CONCURRENCY, (e) =>
    readEntry(e).catch(() => ({ id: e.id, name: e.name, chain: e.chain, kind: e.kind, confidence: e.confidence, volume24hUsd: null, tvlUsd: null, change1d: null, source: `defillama:${e.defillamaType || 'dexs'}`, alive: false })));
  return { ok: true, asOf: nowIso(), venues };
}

// ── PURE helpers ────────────────────────────────────────────────────────────────────────────────
// { chain: { count, volume24hUsd, tvlUsd } } — sums skip nulls so a partial collection still totals.
export function byChain(venues) {
  const out = {};
  for (const v of venues || []) {
    const c = v.chain || 'unknown';
    if (!out[c]) out[c] = { count: 0, volume24hUsd: 0, tvlUsd: 0 };
    out[c].count += 1;
    if (v.volume24hUsd != null) out[c].volume24hUsd += v.volume24hUsd;
    if (v.tvlUsd != null) out[c].tvlUsd += v.tvlUsd;
  }
  return out;
}

// top N venues by 24h volume (nulls sort last).
export function topByVolume(venues, n = 10) {
  return [...(venues || [])]
    .filter((v) => v.volume24hUsd != null)
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, n);
}

// the distinct chains the catalog covers (sorted).
export function chainsCovered() {
  return [...new Set(DEX_CATALOG.map((e) => e.chain))].sort();
}

// static registry stats — { venues, chains, byKind }.
export function catalogStats() {
  const byKind = {};
  for (const e of DEX_CATALOG) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  return { venues: DEX_CATALOG.length, chains: chainsCovered().length, byKind };
}

// ── HTTP surface: GET /api/venues/catalog ───────────────────────────────────────────────────────
export async function handler(req, res) {
  const send = (code, obj) => {
    if (res && typeof res.writeHead === 'function') res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    if (res && typeof res.end === 'function') res.end(JSON.stringify(obj));
    return obj;
  };
  try {
    const url = (req && req.url) || '/api/venues/catalog';
    let chains = null, ids = null;
    if (url.includes('?')) {
      const qs = new URLSearchParams(url.split('?')[1]);
      const c = qs.get('chain') || qs.get('chains');
      if (c) chains = c.split(',').map((s) => s.trim()).filter(Boolean);
      const i = qs.get('id') || qs.get('ids');
      if (i) ids = i.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const payload = await collectDexCatalog({ chains, ids });
    return send(200, {
      surface: 'dex-catalog', readOnly: true, signer: null,
      asOf: payload.asOf, count: payload.venues.length, venues: payload.venues,
      stats: catalogStats(),
      note: 'READ-ONLY catalog analytics. No keys, no orders, never broadcasts.',
    });
  } catch (e) {
    // soft-fail: never 500 the caller
    return send(200, { surface: 'dex-catalog', readOnly: true, ok: false, venues: [], error: esc(e && e.message) });
  }
}

export default { DEX_CATALOG, collectDexCatalog, byChain, topByVolume, chainsCovered, catalogStats, handler, __setFetch };

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fmtUsd = (n) => n == null ? '—' : (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`);
  if (process.argv.includes('--serve')) {
    const http = await import('node:http');
    const PORT = +(process.env.PORT || 8098);
    http.createServer((req, res) => {
      if (req.url && req.url.startsWith('/api/venues/catalog')) return handler(req, res);
      res.writeHead(404); res.end('not found');
    }).listen(PORT, () => console.log(`dex-catalog surface on :${PORT}/api/venues/catalog`));
  } else {
    const payload = await collectDexCatalog(args.length ? { chains: args } : {})
      .catch((e) => ({ ok: false, asOf: '', venues: [], error: e.message }));
    const stats = catalogStats();
    console.log('MULTI-CHAIN DEX/PERP/AGGREGATOR CATALOG — READ-ONLY analytics (DefiLlama, keyless)\n' + '─'.repeat(78));
    const bc = byChain(payload.venues);
    console.log('chain          venues   vol24h        TVL');
    for (const c of Object.keys(bc).sort()) {
      const r = bc[c];
      console.log(`${c.padEnd(14)} ${String(r.count).padStart(6)}   ${fmtUsd(r.volume24hUsd).padStart(10)}  ${fmtUsd(r.tvlUsd).padStart(10)}`);
    }
    console.log('─'.repeat(78));
    console.log('\nTop 10 by 24h volume:');
    for (const v of topByVolume(payload.venues, 10)) {
      console.log(`  ${v.name.padEnd(24)} ${v.chain.padEnd(11)} ${v.kind.padEnd(11)} ${fmtUsd(v.volume24hUsd).padStart(10)}`);
    }
    const aliveN = payload.venues.filter((v) => v.alive).length;
    console.log('─'.repeat(78));
    console.log(`stats: ${stats.venues} venues · ${stats.chains} chains · byKind ${JSON.stringify(stats.byKind)} · alive ${aliveN}/${payload.venues.length}`);
    console.log('READ-ONLY. Every number is observational; no keys, no orders, never broadcasts.');
  }
}
