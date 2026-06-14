// arb-facade.mjs — ONE deduped, ranked arbitrage feed over the FOUR independent detectors:
//   • arb-scanner.scanArb           — single-leg HE-vs-real (the proven SWAP.BLURT/DOGE edge), depth-aware
//   • cross-venue-arb.crossVenueEdges — HE → redeem → US exchange round trip, NET of the full fee stack
//   • cex-arb.scanSymbol            — cross-EXCHANGE spread on a pair, net of both taker fees
//   • chains/crosschain-arb.crossChainSpread — same token mispriced across chains/DEXes
//
// WHY: peg-arb + scenario-runner (and the AIs/briefs) want to consume ONE feed, not four shapes. This
// facade normalizes every detector into the same row, dedupes (a token surfaced by two detectors is
// kept once, by its strongest net edge), and ranks by NET edge after fees so the best realizable
// opportunity is first. READ-ONLY: no keys, no trading, no fs. Each detector is soft-failed
// INDEPENDENTLY — one detector throwing or timing out never sinks the others (the empty feed is a
// valid, common result). Detectors are injectable for offline tests (no network in the suite).
//
//   import { scanAllArb } from './arb-facade.mjs';
//   const { rows, sources, errors } = await scanAllArb();   // rows ranked by netEdgePct desc
//   node integrations/arb-facade.mjs                        # live combined scan (read-only)

import { loadTradeConfig } from './trade-config.mjs';

// default detector imports are lazy/injected so tests can run fully offline.
import { scanArb as _scanArb } from './arb-scanner.mjs';
import { crossVenueEdges as _crossVenueEdges, heNativeEdges as _heNativeEdges } from './cross-venue-arb.mjs';
import { scanSymbol as _scanSymbol } from './cex-arb.mjs';
import { crossChainSpread as _crossChainSpread } from './chains/crosschain-arb.mjs';

const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);

// the cross-exchange pairs + cross-chain queries to sweep by default (env-overridable, read via
// trade-config's token tiers + small built-ins). Kept short so a live sweep is bounded.
const DEFAULT_CEX_PAIRS = (process.env.ARB_CEX_PAIRS || 'BTC/USDT,ETH/USDT,LTC/USDT,DOGE/USDT').split(',').map((s) => s.trim()).filter(Boolean);
// Cross-chain (DEXScreener) queries. This defaulted to EMPTY — so the standing scan NEVER exercised
// the cross-chain detector (a whole category of opportunity went dark; the broad-scan audit found a
// live 17.3% spread when the detector was run directly). Default to our own tokens + HIVE + a couple
// majors so the standing sweep actually covers it; still env-overridable, kept short to stay bounded.
const DEFAULT_XCHAIN_QUERIES = (process.env.ARB_XCHAIN_QUERIES || 'HIVE,MELEK,VKBT,CURE,ETH,SOL').split(',').map((s) => s.trim()).filter(Boolean);

// ── normalizers: each detector's native shape → the common row ─────────────────────────────────
// common row: { source, market, side, netEdgePct, execHive, detail, raw }
//   netEdgePct — the rankable figure. For detectors that already subtract fees (cross-venue, cex,
//   crosschain) it's the net %. arb-scanner returns a gross executable edge fraction; we surface it as
//   a percentage and FLAG it gross (feesApplied:false) so a consumer knows it hasn't been fee-netted.
function fromArbScanner(res) {
  const rows = [];
  for (const o of (res && res.opportunities) || []) {
    if (!o || !o.sym) continue;
    rows.push({
      source: 'arb-scanner', market: o.sym, side: o.side || null,
      netEdgePct: +(num(o.edge) * 100).toFixed(3), feesApplied: false,
      execHive: +num(o.execHive).toFixed(2),
      // carry the phantom-edge guard's verdict through so the combined feed down-ranks it too
      suspect: !!o.suspect, suspectReason: o.suspect ? (o.suspectReason || 'phantom/one-sided/stale HE book') : null,
      detail: `${o.signal || `HE-vs-real edge ${(num(o.edge) * 100).toFixed(1)}%`}${o.suspect ? ` [SUSPECT: ${o.suspectReason}]` : ''}`, raw: o,
    });
  }
  return rows;
}
function fromCrossVenue(res) {
  const rows = [];
  for (const e of (res && res.edges) || []) {
    if (!e || !e.token) continue;
    rows.push({
      source: 'cross-venue', market: e.token, side: 'buy',
      netEdgePct: +num(e.netPct).toFixed(3), feesApplied: true,
      execHive: null,
      detail: `round trip via ${e.chain}${e.usVenue ? ` → ${e.usVenue.name}` : ''} (net ${e.netPct}%)`, raw: e,
    });
  }
  return rows;
}
function fromHeNative(res) {
  const rows = [];
  for (const e of (res && res.edges) || []) {
    if (!e || !e.token) continue;
    rows.push({
      source: 'he-native', market: e.token, side: 'buy',
      netEdgePct: +num(e.netPct).toFixed(3), feesApplied: true,
      execHive: null,
      detail: `HE-native bridge via ${e.chain}${e.usVenue ? ` → ${e.usVenue.name}` : ''} (net ${e.netPct}%)`, raw: e,
    });
  }
  return rows;
}
function fromCex(symbol, res) {
  const b = res && res.best;
  if (!b || !(b.netEdgePct > 0)) return [];
  return [{
    source: 'cex-arb', market: symbol, side: 'buy',
    netEdgePct: +num(b.netEdgePct).toFixed(3), feesApplied: true, execHive: null,
    detail: `buy @${b.buyOn} ${b.buyAsk} → sell @${b.sellOn} ${b.sellBid} (net ${b.netEdgePct}%)`, raw: b,
  }];
}
function fromCrossChain(query, res) {
  const o = res && res.opportunity;
  if (!o || !(num(o.spreadPct) > 0)) return [];
  return [{
    source: 'crosschain', market: query, side: 'buy',
    netEdgePct: +num(o.spreadPct).toFixed(3), feesApplied: false,  // gross DEX spread (bridge cost not netted)
    execHive: null,
    detail: `buy ${o.buyOn} ($${o.buyUsd}) → sell ${o.sellOn} ($${o.sellUsd}), spread ${o.spreadPct}%${o.verified === false ? ' [unverified]' : ''}`, raw: o,
  }];
}

/**
 * Run all four arb detectors, soft-fail each independently, return ONE deduped + ranked feed.
 *
 * @param {object} [opts]
 * @param {Function} [opts.scanArb]          inject arb-scanner.scanArb (tests)
 * @param {Function} [opts.crossVenueEdges]  inject cross-venue-arb.crossVenueEdges (tests)
 * @param {Function} [opts.scanSymbol]       inject cex-arb.scanSymbol (tests)
 * @param {Function} [opts.crossChainSpread] inject chains/crosschain-arb.crossChainSpread (tests)
 * @param {string[]} [opts.cexPairs]         cross-exchange pairs to sweep
 * @param {string[]} [opts.xchainQueries]    cross-chain token queries to sweep
 * @returns {Promise<{rows:Array, sources:object, errors:object, scannedAt:string}>}
 *   rows are deduped by source+market and ranked by netEdgePct desc.
 */
export async function scanAllArb(opts = {}) {
  const cfg = loadTradeConfig();
  const scanArb = opts.scanArb || _scanArb;
  const crossVenueEdges = opts.crossVenueEdges || _crossVenueEdges;
  const heNativeEdges = opts.heNativeEdges || _heNativeEdges;
  const scanSymbol = opts.scanSymbol || _scanSymbol;
  const crossChainSpread = opts.crossChainSpread || _crossChainSpread;
  const cexPairs = opts.cexPairs || DEFAULT_CEX_PAIRS;
  const xchainQueries = opts.xchainQueries || DEFAULT_XCHAIN_QUERIES;

  const errors = {};
  const sources = {};
  const all = [];

  // each detector wrapped in its OWN try/catch so one failure never sinks the feed.
  // 1. single-leg HE arb
  try { const r = await scanArb(); const rows = fromArbScanner(r); sources['arb-scanner'] = rows.length; all.push(...rows); }
  catch (e) { errors['arb-scanner'] = e && e.message ? e.message : String(e); sources['arb-scanner'] = 0; }

  // 2. cross-venue round trip (fee-netted) — SWAP.* 1:1 redemption
  try { const r = await crossVenueEdges(); const rows = fromCrossVenue(r); sources['cross-venue'] = rows.length; all.push(...rows); }
  catch (e) { errors['cross-venue'] = e && e.message ? e.message : String(e); sources['cross-venue'] = 0; }

  // 2b. HE-native bridge round trip (fee-netted) — SPS/DEC/LEO via a US-accessible DEX
  try { const r = await heNativeEdges(); const rows = fromHeNative(r); sources['he-native'] = rows.length; all.push(...rows); }
  catch (e) { errors['he-native'] = e && e.message ? e.message : String(e); sources['he-native'] = 0; }

  // 3. cross-exchange spreads (one scan per pair; each pair soft-failed too)
  let cexCount = 0;
  for (const pair of cexPairs) {
    try { const r = await scanSymbol(pair); const rows = fromCex(pair, r); cexCount += rows.length; all.push(...rows); }
    catch (e) { errors[`cex-arb:${pair}`] = e && e.message ? e.message : String(e); }
  }
  sources['cex-arb'] = cexCount;

  // 4. cross-chain spreads (one query each; opt-in via env/opts so the default live scan stays bounded)
  let xcCount = 0;
  for (const q of xchainQueries) {
    try { const r = await crossChainSpread(q); const rows = fromCrossChain(q, r); xcCount += rows.length; all.push(...rows); }
    catch (e) { errors[`crosschain:${q}`] = e && e.message ? e.message : String(e); }
  }
  sources['crosschain'] = xcCount;

  // ── DEDUP: a (source, market) pair appears once — keep the strongest net edge if a detector
  // surfaced the same market twice. (We dedup within source, not across — the same token via two
  // DIFFERENT detectors is a genuinely different opportunity/route and is kept separately.)
  const byKey = new Map();
  for (const row of all) {
    const key = `${row.source}::${row.market}`;
    const prev = byKey.get(key);
    if (!prev || row.netEdgePct > prev.netEdgePct) byKey.set(key, row);
  }
  // ── RANK: clean rows first (a row the phantom-edge guard flagged suspect sinks below every clean
  // row, regardless of headline edge), then by net edge after fees, descending (best realizable first).
  const rows = [...byKey.values()].sort((a, b) =>
    (!!a.suspect === !!b.suspect ? 0 : a.suspect ? 1 : -1) || (b.netEdgePct - a.netEdgePct));

  return { rows, sources, errors, scannedAt: new Date().toISOString(), thresholdPct: +(cfg.arb.minNetPct).toFixed(3) };
}

export default { scanAllArb };

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('arb-facade.mjs')) {
  const { rows, sources, errors } = await scanAllArb().catch((e) => ({ rows: [], sources: {}, errors: { fatal: e.message } }));
  console.log('Combined arbitrage feed — 4 detectors, deduped + ranked by net edge (read-only)\n' + '─'.repeat(80));
  console.log(`sources: ${Object.entries(sources).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  if (Object.keys(errors).length) console.log(`soft-failed: ${Object.entries(errors).map(([k, v]) => `${k} (${v})`).join('; ')}`);
  console.log('─'.repeat(80));
  if (!rows.length) console.log('  (no opportunities right now — markets fairly aligned, or detectors offline)');
  for (const r of rows.slice(0, 20)) {
    console.log(`  [${r.source}] ${r.market}  ${r.netEdgePct}%${r.feesApplied ? ' net' : ' gross'}${r.execHive != null ? `  ~${r.execHive} HIVE` : ''}  — ${r.detail}`);
  }
  console.log('\nRead-only: surfaces edges for the analyzer/AIs. Execution is a separate, gated step (no keys here).');
}
