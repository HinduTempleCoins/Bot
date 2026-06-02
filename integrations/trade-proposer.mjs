// trade-proposer.mjs — the trade-PROPOSAL engine that feeds the brief process (task #169).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
//  ADVISORY ONLY.  THE BOTS PROPOSE; HUMANS DECIDE.
//  This module is READ-ONLY by construction. It NEVER executes, signs, or broadcasts a trade.
//  It holds NO keys and makes NO write calls (zero-WIF rule). Its only output is structured
//  PROPOSALS + a markdown `briefBlock()` a human brief-writer drops into a brief. Acting on a
//  proposal is a separate, human-gated step that does not live here.
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
//  What it does:
//    1. marketSnapshot()         → which Hive-Engine / TribalDEX markets are actually moving.
//    2. scanArb()                → the EXISTING depth-aware arbitrage edge logic (arb-scanner +
//                                  market-depth). We don't reinvent the edge math — we call it.
//    3. shapes structured PROPOSALS, each one US-availability-gated against markets-catalog
//       usFriendly(): a venue/account move on a us:'no' venue is flagged "non-US server required".
//    4. briefBlock()             → renders the proposals as a markdown section for the brief pipeline.
//
//  Best-effort, cached, never throws: an unattended automode / 12&12 loop never dies on a flaky node.
//
//    node integrations/trade-proposer.mjs              # print today's proposals
//    import { proposeTrades, briefBlock } from './trade-proposer.mjs'

import { marketSnapshot } from './market-universe.mjs';
import { scanArb } from './arb-scanner.mjs';
import { ownership } from './market-depth.mjs';
import { usFriendly, exchangesByAsset } from './soapbox/markets-catalog.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

// Proposals above this confidence are worth a brief writer's attention; below it they're context.
const MIN_VOLUME_FOR_NEW_MARKET = +(process.env.PROPOSER_MIN_VOLUME || 50); // HIVE 24h
const NEW_MARKET_TOP_N = +(process.env.PROPOSER_NEW_MARKET_N || 6);

// ── US-availability gate ─────────────────────────────────────────────────────────────────────
// Resolve a venue NAME against the catalog and produce a uniform usNote. We operate from the US,
// so a us:'no' venue is not usable by us directly — it is flagged "non-US server required" rather
// than silently dropped (the PROJECT could cover it from a non-US server; the US host cannot).
function usGate(venueName) {
  const v = exchangesByAsset('crypto').find((e) => e.name === venueName);
  if (!v) return { us: 'unknown', usNote: `${venueName}: US availability unverified — confirm before opening an account.`, usable: false };
  if (v.us === 'no') return { us: 'no', usNote: `${v.name} blocks US persons — NON-US SERVER REQUIRED (not usable from our US host). ${v.note}`, usable: false };
  if (v.us === 'unknown') return { us: 'unknown', usNote: `${v.name}: US status unverified — confirm before opening an account. ${v.note}`, usable: false };
  if (v.us === 'partial') return { us: 'partial', usNote: `${v.name}: US-accessible with carve-outs — verify state/product. ${v.note}`, usable: true };
  return { us: 'full', usNote: `${v.name}: open to US persons (routine KYC).`, usable: true };
}

// Our ecosystem markets all live behind the Hive-Engine venue (TribalDEX/Beeswap are front ends).
const HE_VENUE = 'Hive-Engine';

function pct(x) { return +(x * 100).toFixed(1); }

// ── proposal builders ────────────────────────────────────────────────────────────────────────

// arbitrage proposals: the executable mispricings the depth-aware scanner found, restated as moves.
function arbProposals(arb) {
  const out = [];
  const heGate = usGate(HE_VENUE);
  for (const o of (arb.opportunities || [])) {
    const edgePct = pct(o.edge);
    out.push({
      kind: 'arbitrage',
      summary: `${o.signal} — ${edgePct}% executable edge (~${Math.round(o.execHive)} HIVE deep) vs real $${(+o.realUsd).toFixed(4)}`,
      evidence: {
        volume: null,                 // arb edge is depth-driven, not 24h-volume-driven
        spread: edgePct,              // % the HE book is mispriced vs the multi-source real price
        depth: +o.execHive.toFixed(1),// HIVE that is actually executable at this edge
        fees: 'HE 1% market fee per side — net the edge against ~2% round-trip before acting.',
      },
      // arbitrage trades on OUR ecosystem (Hive-Engine), which is us:'partial' — usable from the US.
      usNote: heGate.usNote,
      confidence: o.execHive >= 100 && o.edge >= 0.05 ? 'high' : 'medium',
      suggestedAction: `Review the ${o.sym} book on Hive-Engine/TribalDEX; the ${o.side} side shows a depth-backed ${edgePct}% edge. Human-verify the real price and net of fees before any manual trade.`,
    });
  }
  return out;
}

// new-market proposals: high-volume markets the operator isn't already tracking are worth a scan.
async function newMarketProposals(snapshot) {
  const out = [];
  const heGate = usGate(HE_VENUE);
  const movers = (snapshot.topVolume || [])
    .filter((m) => m.volume >= MIN_VOLUME_FOR_NEW_MARKET)
    .slice(0, NEW_MARKET_TOP_N);
  for (const m of movers) {
    // pull the ownership picture so the proposal carries real evidence (is it real demand or self-trade?).
    const own = await ownership(m.symbol).catch(() => null);
    const selfHeavy = own && own.issuerPct >= 60;
    out.push({
      kind: 'new-market',
      summary: `Scan ${m.symbol} — ${Math.round(m.volume)} HIVE 24h volume (${(+m.changePct).toFixed(1)}%)`,
      evidence: {
        volume: Math.round(m.volume),
        spread: null,
        depth: own ? { issuerPct: own.issuerPct, top3Pct: own.top3, outsideHolders: own.outsideHolders } : null,
        fees: 'HE 1% market fee per side.',
      },
      usNote: heGate.usNote,
      confidence: m.volume >= MIN_VOLUME_FOR_NEW_MARKET * 4 && !selfHeavy ? 'medium' : 'low',
      suggestedAction: selfHeavy
        ? `Treat ${m.symbol}'s volume with caution — issuer holds ${own.issuerPct}% (likely self-trade, not organic demand). Watch for real outside flow before scanning for arb.`
        : `Add ${m.symbol} to the arb watchlist (WATCH_TOKENS / SWAP_PAIRS) and run a depth-aware scan; ${own ? own.outsideHolders + ' outside holders' : 'volume'} suggests there is a real market to read.`,
    });
  }
  return out;
}

// new-exchange / new-currency proposals: where COULD we widen the search? Surfaces US-friendly
// venues + the SWAP currencies we don't yet wrap, each US-gated. Pure catalog work, no network.
function expansionProposals(arb) {
  const out = [];

  // new-exchange: the US-friendly crypto venues a US operator could legitimately open an account on.
  // (Out-of-ecosystem CEX/DEX arbitrage is the longer game; we name the usable ones, flag the rest.)
  const usableVenues = usFriendly('crypto')
    .filter((e) => e.type === 'CEX')
    .slice(0, 4)
    .map((e) => e.name);
  if (usableVenues.length) {
    out.push({
      kind: 'new-exchange',
      summary: `Open an account on a US-friendly CEX to widen the arb search: ${usableVenues.join(', ')}`,
      evidence: {
        volume: null, spread: null, depth: null,
        fees: 'Per-venue maker/taker — confirm before relying on a cross-venue edge.',
      },
      usNote: `All listed are us:'full'/'partial' — usable from our US host (routine KYC). Global venues like Binance/Bybit/KuCoin are us:'no' → NON-US SERVER REQUIRED.`,
      confidence: 'low',
      suggestedAction: `If we want cross-venue (CEX↔Hive-Engine) arbitrage, open accounts on the US-friendly venues above. Do NOT route through a us:'no' venue from the US host.`,
    });
  }

  // new-currency: SWAP wrappers the arb scanner watches but that had no confident real price or
  // two-sided book this scan — i.e. currencies worth wiring up better / watching for a market.
  const stalled = (arb.rows || [])
    .filter((r) => r.note && /not confident|one-sided|empty/.test(r.note))
    .map((r) => r.sym)
    .slice(0, 6);
  if (stalled.length) {
    out.push({
      kind: 'new-currency',
      summary: `Wire up / watch SWAP currencies that had no readable market this scan: ${stalled.join(', ')}`,
      evidence: {
        volume: null, spread: null, depth: null,
        fees: 'n/a — these have no executable book yet.',
      },
      usNote: usGate(HE_VENUE).usNote, // they'd trade on Hive-Engine (us:'partial', usable).
      confidence: 'low',
      suggestedAction: `These SWAP pairs had a thin/one-sided HE book or an unconfident real price. Add a more reliable price source or watch for a two-sided book before counting them as arb candidates.`,
    });
  }

  return out;
}

// ── the engine ───────────────────────────────────────────────────────────────────────────────
// Returns { ts, hiveUsd, snapshot, proposals } — advisory only. Never throws.
export async function proposeTrades(opts = {}) {
  const { fresh = false } = opts;
  const run = async () => {
    const ts = new Date().toISOString();
    let snapshot = null, arb = { hiveUsd: 0, rows: [], opportunities: [] };
    try { snapshot = await marketSnapshot({ topN: 12 }); } catch { snapshot = null; }
    try { arb = await scanArb(); } catch { /* keep zeroed arb */ }

    const proposals = [];
    try { proposals.push(...arbProposals(arb)); } catch {}
    if (snapshot) { try { proposals.push(...await newMarketProposals(snapshot)); } catch {} }
    try { proposals.push(...expansionProposals(arb)); } catch {}

    // rank: high > medium > low, arbitrage first within a tier (it's the actionable kind).
    const rank = { high: 0, medium: 1, low: 2 };
    const kindRank = { arbitrage: 0, 'new-market': 1, 'new-exchange': 2, 'new-currency': 3 };
    proposals.sort((a, b) =>
      (rank[a.confidence] - rank[b.confidence]) || (kindRank[a.kind] - kindRank[b.kind]));

    return {
      ts,
      hiveUsd: arb.hiveUsd || 0,
      snapshot: snapshot
        ? { totalMarkets: snapshot.totalMarkets, activeMarkets: snapshot.activeMarkets, totalVolumeHive: snapshot.totalVolumeHive }
        : null,
      proposals,
    };
  };

  try {
    if (fresh) return await run();
    // TTL.clarity (30m) — the heavy reads (universe page + depth) shouldn't refire per brief.
    return await cached('trade-proposer:today', TTL.clarity, run);
  } catch {
    return { ts: new Date().toISOString(), hiveUsd: 0, snapshot: null, proposals: [] };
  }
}

// ── brief pipeline surface ─────────────────────────────────────────────────────────────────────
// briefBlock() renders the proposals as a markdown section a brief writer drops straight into a
// three-part brief. The 12&12 conference / brief writers call this, read the "Proposed moves",
// and a HUMAN decides which (if any) to act on. The bots propose; humans decide.
export function briefBlock(result) {
  const r = result || { proposals: [] };
  const lines = [];
  lines.push('## Proposed moves (trade-proposer — ADVISORY ONLY, the bots propose, humans decide)');
  lines.push('');
  const hive = r.hiveUsd ? `HIVE $${(+r.hiveUsd).toFixed(4)}` : 'HIVE price unavailable';
  const mkt = r.snapshot ? `, ${r.snapshot.activeMarkets}/${r.snapshot.totalMarkets} markets active, ${Math.round(r.snapshot.totalVolumeHive)} HIVE 24h vol` : '';
  lines.push(`_Read-only scan ${r.ts || ''} — ${hive}${mkt}. No trade is executed by this engine._`);
  lines.push('');

  if (!r.proposals || !r.proposals.length) {
    lines.push('- No proposals this scan — markets fairly aligned and nothing new worth opening.');
    return lines.join('\n');
  }

  const icon = { high: '🟢', medium: '🟡', low: '⚪' };
  for (const p of r.proposals) {
    const ev = p.evidence || {};
    const evBits = [];
    if (ev.volume != null) evBits.push(`vol ${ev.volume} HIVE`);
    if (ev.spread != null) evBits.push(`edge ${ev.spread}%`);
    if (ev.depth != null) evBits.push(typeof ev.depth === 'object' ? `depth ${JSON.stringify(ev.depth)}` : `depth ${ev.depth} HIVE`);
    if (ev.fees) evBits.push(`fees: ${ev.fees}`);
    lines.push(`- ${icon[p.confidence] || '⚪'} **[${p.kind}]** ${p.summary}`);
    lines.push(`  - evidence: ${evBits.join(' · ') || '—'}`);
    lines.push(`  - US: ${p.usNote}`);
    lines.push(`  - suggested (human-gated): ${p.suggestedAction}`);
  }
  return lines.join('\n');
}

export default { proposeTrades, briefBlock };

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('trade-proposer.mjs')) {
  const result = await proposeTrades({ fresh: true });
  console.log(briefBlock(result));
}
