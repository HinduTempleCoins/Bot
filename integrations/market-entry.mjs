// market-entry.mjs — "MARKETS WE SHOULD ENTER" recommender. Fuses our existing READ-ONLY scanners
// into ONE ranked, actionable list the trade bots + the Resource Center can act on (task: #189-adjacent
// fusion layer). It does NOT scan anything itself — it imports the scanners we already trust and folds
// each one's findings into a uniform candidate shape, then risk-ranks them.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  ADVISORY ONLY — NO EXECUTION, NO KEYS.  Every contributing module is read-only; this layer only
//  re-shapes + ranks. It never holds a key, never broadcasts, never trades (zero-WIF rule). The output
//  is a list of leads a human (or a gated, keyed signer step) verifies before risking a cent.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// SOFT-FAIL by construction: each source is wrapped so a thrown/empty source contributes nothing and
// never breaks the fusion. A scan with every source down returns [] rather than throwing.
//
//   node integrations/market-entry.mjs                 # ranked entries (live)
//   node integrations/market-entry.mjs 0.05 10         # minEdge=5%, max=10
//   import { recommendEntries, rankEntries } from './market-entry.mjs'

import { scanArb } from './arb-scanner.mjs';
import { crossVenueEdges } from './cross-venue-arb.mjs';
import { scanSymbol } from './cex-arb.mjs';
import { scanAccounts } from './held-asset-scan.mjs';
import { topByVolume } from './market-universe.mjs';
import { crossChainSpread } from './chains/crosschain-arb.mjs';
import { candidates as copyCandidates } from './copy-trade-scan.mjs';

const nz = (x) => { const v = +x; return Number.isFinite(v) ? v : 0; };
const nowIso = () => new Date().toISOString();

// Pairs/queries the cross-exchange + cross-chain scanners need a SYMBOL for (they're per-symbol, not
// universe scans). A small, liquid, US-tradeable default set — callers can override via `sources`.
const CEX_SYMBOLS = (process.env.MARKET_ENTRY_CEX_SYMBOLS || 'BTC/USDT,ETH/USDT,LTC/USDT,DOGE/USDT').split(',').map((s) => s.trim()).filter(Boolean);
const XCHAIN_QUERIES = (process.env.MARKET_ENTRY_XCHAIN || 'WETH,USDC,WBTC').split(',').map((s) => s.trim()).filter(Boolean);
const COPY_TARGETS = [
  { asset: 'crypto', query: 'BTC' },
  { asset: 'crypto', query: 'ETH' },
  { asset: 'forex', query: 'EURUSD' },
];

// ── default source set ────────────────────────────────────────────────────────────────────────
// Each entry: a `name` (provenance) and an async `run()` that returns an array of RAW candidate rows
// already mapped to the uniform shape (minus ranking). Callers inject their own for tests. Every run()
// is additionally guarded in collect() so a thrown source can't break the fusion.
export function defaultSources() {
  return [
    { name: 'arb-scanner', run: fromArbScanner },
    { name: 'cross-venue-arb', run: fromCrossVenue },
    { name: 'cex-arb', run: fromCexArb },
    { name: 'held-asset-scan', run: fromHeldAssets },
    { name: 'market-universe', run: fromUniverse },
    { name: 'crosschain-arb', run: fromCrossChain },
    { name: 'copy-trade-scan', run: fromCopyTrade },
  ];
}

// ── per-source adapters: native shape → uniform candidate ──────────────────────────────────────
// Uniform candidate (pre-rank): { market, venue, chain, kind, edgePct, executableDepth, reason,
//   action, usJurisdictionOK, confidence, provenance:{source, fetched_at} }.
// edgePct is a FRACTION (0.05 = 5%), matching the minEdge convention.

async function fromArbScanner() {
  const r = await scanArb();
  const fetched_at = nowIso();
  return (r?.opportunities || []).map((o) => ({
    market: o.sym,
    venue: 'Hive-Engine',
    chain: 'Hive-Engine',
    kind: 'swap-arb',
    edgePct: nz(o.edge),
    executableDepth: nz(o.execHive),                 // in HIVE
    reason: `${o.signal} — real $${nz(o.realUsd).toFixed(4)}, ${(nz(o.edge) * 100).toFixed(1)}% executable edge over ~${Math.round(nz(o.execHive))} HIVE`,
    action: o.signal,
    usJurisdictionOK: true,                          // Hive-Engine, no US-restricted venue named
    confidence: nz(o.edge) >= 0.05 && nz(o.execHive) >= 50 ? 'high' : 'medium',
    provenance: { source: 'arb-scanner', fetched_at },
  }));
}

async function fromCrossVenue() {
  const r = await crossVenueEdges();
  const fetched_at = nowIso();
  return (r?.edges || []).map((e) => ({
    market: e.token,
    venue: e.usVenue ? e.usVenue.name : 'Hive-Engine → US exchange',
    chain: e.chain,
    kind: 'cross-venue-arb',
    edgePct: nz(e.netPct) / 100,                     // module reports netPct as a percentage
    executableDepth: nz(e.heVolumeHive),             // 24h HE volume as a depth proxy
    reason: `round trip nets ${nz(e.netPct)}% after the full fee stack ($${nz(e.netAfterFeesUsd)}/unit)`,
    action: Array.isArray(e.path) ? e.path.join(' → ') : `trade ${e.token} round trip`,
    usJurisdictionOK: !!(e.usVenue && (e.usVenue.us === 'full' || e.usVenue.us === 'partial')),
    confidence: e.confidence || 'low',
    provenance: { source: 'cross-venue-arb', fetched_at },
  }));
}

async function fromCexArb() {
  const fetched_at = nowIso();
  const out = [];
  for (const symbol of CEX_SYMBOLS) {
    const r = await scanSymbol(symbol).catch(() => null);   // per-symbol soft-fail
    const b = r?.best;
    if (!b || !(b.edge > 0)) continue;
    out.push({
      market: symbol,
      venue: `${b.buyOn} → ${b.sellOn}`,
      chain: 'CEX',
      kind: 'cross-exchange-arb',
      edgePct: nz(b.edge),
      executableDepth: 0,                            // ccxt ticker gives no book depth here
      reason: `buy ${symbol} on ${b.buyOn} @ ${b.buyAsk}, sell on ${b.sellOn} @ ${b.sellBid} = ${nz(b.netEdgePct)}% net of taker fees`,
      action: `buy on ${b.buyOn} → sell on ${b.sellOn}`,
      usJurisdictionOK: /coinbase|kraken|gemini/i.test(`${b.buyOn} ${b.sellOn}`),
      confidence: nz(b.edge) >= 0.01 ? 'medium' : 'low',
      provenance: { source: 'cex-arb', fetched_at },
    });
  }
  return out;
}

async function fromHeldAssets() {
  const ops = await scanAccounts();
  const fetched_at = nowIso();
  return (ops || [])
    .filter((o) => o.spreadPct != null && Math.abs(nz(o.spreadPct)) > 0)
    .map((o) => ({
      market: o.symbol,
      venue: o.venue || 'Hive-Engine',
      chain: 'Hive-Engine',
      kind: 'held-asset-rotation',
      edgePct: Math.abs(nz(o.spreadPct)) / 100,      // spreadPct is a percentage
      executableDepth: nz(o.valueUsd),               // USD value already held = realizable size
      reason: o.action,
      action: o.action,
      // held-asset venues are gated on usFriendly() upstream, but a null venue ("US-verify") is unknown
      usJurisdictionOK: !!(o.venue && !/verify/i.test(o.venue)),
      confidence: Math.abs(nz(o.spreadPct)) >= 5 ? 'high' : 'medium',
      provenance: { source: 'held-asset-scan', fetched_at },
    }));
}

async function fromUniverse() {
  const rows = await topByVolume(15);
  const fetched_at = nowIso();
  // The universe is liquidity, not an edge per se: surface the highest-volume markets as low-edge,
  // depth-rich entry candidates (where you CAN trade), using the absolute 24h % move as a soft edge.
  return (rows || [])
    .filter((r) => nz(r.volume) > 0)
    .map((r) => ({
      market: r.symbol,
      venue: 'Hive-Engine / TribalDEX',
      chain: 'Hive-Engine',
      kind: 'liquidity',
      edgePct: Math.abs(nz(r.priceChangePercent)) / 100,
      executableDepth: nz(r.volume),                 // 24h HIVE volume
      reason: `top-volume market: ${Math.round(nz(r.volume))} HIVE/24h, ${nz(r.priceChangePercent).toFixed(1)}% move`,
      action: `liquid market — entry available on Hive-Engine / TribalDEX`,
      usJurisdictionOK: true,
      confidence: 'low',                             // liquidity ≠ a verified edge
      provenance: { source: 'market-universe', fetched_at },
    }));
}

async function fromCrossChain() {
  const fetched_at = nowIso();
  const out = [];
  for (const q of XCHAIN_QUERIES) {
    const r = await crossChainSpread(q).catch(() => null);  // per-query soft-fail
    const o = r?.opportunity;
    if (!o || !(o.spreadPct > 0)) continue;
    out.push({
      market: q,
      venue: `${o.buyOn} → ${o.sellOn}`,
      chain: 'multi-chain (DEX)',
      kind: 'cross-chain-arb',
      edgePct: nz(o.spreadPct) / 100,                // spreadPct is a percentage
      executableDepth: nz(o.executableLiqUsd),       // min liquidity across the two venues, USD
      reason: `${nz(o.spreadPct)}% spread: buy on ${o.buyOn} ($${o.buyUsd}) → sell on ${o.sellOn} ($${o.sellUsd}); ~$${Math.round(nz(o.executableLiqUsd)).toLocaleString()} executable liq`,
      action: `buy on ${o.buyOn} → bridge → sell on ${o.sellOn} (verify bridge cost + slippage)`,
      usJurisdictionOK: false,                       // DEX/bridge route — not US-jurisdiction-clean by default
      confidence: nz(o.executableLiqUsd) >= 20000 ? 'medium' : 'low',
      provenance: { source: 'crosschain-arb', fetched_at },
    });
  }
  return out;
}

async function fromCopyTrade() {
  const fetched_at = nowIso();
  const lists = await Promise.all(COPY_TARGETS.map((t) => copyCandidates(t).catch(() => [])));
  return lists.flat().map((c) => ({
    market: `${(c.direction || '').toUpperCase()} ${c.asset}`.trim(),
    venue: c.source || 'public idea',
    chain: c.asset || 'mixed',
    kind: 'copy-trade',
    // copy-trade confidence is 0–1; treat it as a soft edge proxy (no executable price edge).
    edgePct: nz(c.confidence) * 0.05,                // map 0–1 confidence onto a modest 0–5% edge band
    executableDepth: 0,                              // a mirror, not a book — no executable depth here
    reason: `${c.summary || 'public trade idea'} (fund from SKIM BUCKET only, never core capital)`,
    action: c.summary || `mirror ${c.market}`,
    usJurisdictionOK: true,                          // mirroring a public idea is not a venue restriction
    confidence: nz(c.confidence) >= 0.6 ? 'medium' : 'low',
    provenance: { source: 'copy-trade-scan', fetched_at },
  }));
}

// ── PURE ranking ────────────────────────────────────────────────────────────────────────────────
// Risk-adjusted score = edge × depth-confidence × jurisdiction-ok, deduped by market+venue (keeping
// the higher-scoring duplicate). No network, no throw — safe on [].
//   • depth-confidence: a soft 0.2–1.0 multiplier from the confidence tier AND whether there's any
//     executable depth (a real, sizeable book scores above a phantom/no-depth lead).
//   • jurisdiction-ok: US-clean entries keep full weight; non-US-clean ones are penalized (×0.5) but
//     NOT dropped — they're still surfaced, just ranked lower (a human may still want them).
const CONF_WEIGHT = { high: 1.0, medium: 0.7, low: 0.4 };

export function rankEntries(list) {
  const rows = (Array.isArray(list) ? list : []).filter((x) => x && x.market != null);

  // dedup by market+venue, keeping the candidate with the higher pre-rank edge×conf signal.
  const best = new Map();
  const presignal = (x) => nz(x.edgePct) * (CONF_WEIGHT[x.confidence] ?? 0.4);
  for (const x of rows) {
    const key = `${String(x.market).toLowerCase()}|${String(x.venue || '').toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || presignal(x) > presignal(prev)) best.set(key, x);
  }

  const scored = [...best.values()].map((x) => {
    const confW = CONF_WEIGHT[x.confidence] ?? 0.4;
    const depthBonus = nz(x.executableDepth) > 0 ? 1 : 0.6;   // having real executable depth beats none
    const depthConf = confW * depthBonus;
    const jurW = x.usJurisdictionOK ? 1 : 0.5;               // penalize, don't drop, non-US-clean
    const score = nz(x.edgePct) * depthConf * jurW;
    return { ...x, score: +score.toFixed(6) };
  });

  // rank by risk-adjusted score, then by raw edge, then by executable depth (tie-breakers).
  scored.sort((a, b) =>
    b.score - a.score ||
    nz(b.edgePct) - nz(a.edgePct) ||
    nz(b.executableDepth) - nz(a.executableDepth));
  return scored;
}

// ── fusion: collect → rank → cap ─────────────────────────────────────────────────────────────────
async function collect(sources) {
  const lists = await Promise.all(sources.map(async (s) => {
    try {
      const rows = await s.run();
      return Array.isArray(rows) ? rows : [];
    } catch { return []; }                                   // soft-fail: a dead source contributes nothing
  }));
  return lists.flat();
}

/**
 * Fuse every scanner into one ranked, actionable "markets we should enter" list.
 *   recommendEntries({ minEdge = 0.03, max = 20, sources })
 * `sources` lets callers inject scanner fns (each { name, run:()=>rows[] }) — used by tests so the
 * real network scanners are never called. Soft-fails the whole way; returns [] rather than throwing.
 */
export async function recommendEntries({ minEdge = 0.03, max = 20, sources } = {}) {
  const src = Array.isArray(sources) && sources.length ? sources : defaultSources();
  let raw = [];
  try { raw = await collect(src); } catch { raw = []; }
  const ranked = rankEntries(raw);
  const filtered = ranked.filter((x) => nz(x.edgePct) >= nz(minEdge));
  return filtered.slice(0, Math.max(0, max | 0));
}

export default { recommendEntries, rankEntries, defaultSources };

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('market-entry.mjs')) {
  const minEdge = process.argv[2] != null ? +process.argv[2] : 0.03;
  const max = process.argv[3] != null ? +process.argv[3] : 20;
  const entries = await recommendEntries({ minEdge, max });
  console.log(`MARKETS WE SHOULD ENTER — fused, risk-ranked (READ-ONLY · advisory · no execution)`);
  console.log(`minEdge ${(minEdge * 100).toFixed(1)}% · top ${max} · ${entries.length} candidate(s)\n${'─'.repeat(86)}`);
  if (!entries.length) {
    console.log('  No candidates clear the edge threshold right now (or all sources returned nothing).');
  } else {
    entries.forEach((e, i) => {
      console.log(`${String(i + 1).padStart(2)}. ${String(e.market).padEnd(18)} ${(e.kind).padEnd(20)} edge ${(e.edgePct * 100).toFixed(1).padStart(6)}%  score ${e.score}  ${e.usJurisdictionOK ? 'US-OK' : 'US?'}  [${e.confidence}]`);
      console.log(`    venue: ${e.venue}  ·  src: ${e.provenance.source}`);
      console.log(`    ${e.reason}`);
      console.log(`    → ${e.action}`);
    });
  }
  console.log('\n*advisory only — fuses read-only scanners; proposes, never executes. Verify before risking capital.*');
}
