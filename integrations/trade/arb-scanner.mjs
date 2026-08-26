// integrations/trade/arb-scanner.mjs — DRAFT (NOT WIRED IN). Cross-exchange + triangular arbitrage
// scanner that drives the §4.7 gambling engine (integrations/soapbox/gambling.mjs) over a QUOTES
// SNAPSHOT. Pure math, no network, no keys, no execution.
//
// ┌─ HARD SAFETY INVARIANT ─────────────────────────────────────────────────────────────────────┐
// │ READ-ONLY / ADVISORY DRAFT. Nothing here trades, broadcasts, holds or references a key, or     │
// │ hits a live exchange. Every function is PURE: snapshot in → ranked opportunities out. This is  │
// │ a candidate the (separate, gated, autonomous) executor COULD later adopt — it is not wired      │
// │ into any live loop, and by construction cannot place an order. zero-WIF-on-host holds.          │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY reuse gambling.mjs: an arbitrage is an arbitrage. The sports "surebet" test Σ(1/dᵢ) < 1 and a
// three-leg FX "triangular" cycle are exactly the math a cross-venue crypto/FX arb needs, already
// implemented + tested there. This module maps trade quotes onto that engine so ONE audited §4.7
// core prices both the arcade Event Markets and the trade bots (see .local/TRADE_BOT_PROFITABILITY.md §7).
//
// Three arb families, each using the RIGHT §4.7 primitive:
//   1. SPOT cross-exchange (same asset, buy cheapest ask / sell richest bid): direct edge, net of
//      taker fees + amortized withdrawal — the honest spot analog of the surebet inequality.
//   2. OUTCOME / prediction arb (mutually-exclusive outcomes quoted across books, e.g. an event
//      market, or a paired UP/DOWN token): gambling.arbitrage(decimalOddsList) — the EXACT surebet.
//   3. TRIANGULAR (A→B→C→A cross-rates): gambling.triangularArb({ab,bc,ac}, feePct).
//
//   import { scanArb, spotArbs, outcomeArbs, triangleArbs } from './integrations/trade/arb-scanner.mjs'

import { arbitrage, triangularArb } from '../soapbox/gambling.mjs';

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const round = (x, n = 6) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);

// ── SPOT cross-exchange ─────────────────────────────────────────────────────────────────────────
// venues: [ { venue, bid, ask, takerFee?, withdrawFeeUsd? } ]. Buy the lowest ask, sell into the
// highest bid, ON A DIFFERENT venue. grossEdge = bestBid/bestAsk − 1. netEdge subtracts BOTH taker
// fees and the flat withdrawal fee amortized over `sizeUsd` (a flat fee is ruinous on small size —
// this is the exact bug PR #377 fixed in cross-venue-arb). Soft-fails to null on junk / <2 venues.
export function spotArb(symbol, venues, { sizeUsd = 100, defaultTakerFee = 0.001 } = {}) {
  if (!Array.isArray(venues) || venues.length < 2) return null;
  const rows = venues
    .map((v) => ({
      venue: String(v?.venue ?? '?'),
      bid: num(v?.bid), ask: num(v?.ask),
      takerFee: Number.isFinite(+v?.takerFee) ? +v.takerFee : defaultTakerFee,
      withdrawFeeUsd: Number.isFinite(+v?.withdrawFeeUsd) ? +v.withdrawFeeUsd : 0,
    }))
    .filter((r) => r.ask > 0 && r.bid > 0);
  if (rows.length < 2) return null;

  let buy = rows[0], sell = rows[0];
  for (const r of rows) { if (r.ask < buy.ask) buy = r; if (r.bid > sell.bid) sell = r; }
  if (buy.venue === sell.venue) {
    // best bid and best ask are the same venue → no cross-venue leg; pick the next-best sell venue.
    const others = rows.filter((r) => r.venue !== buy.venue);
    if (!others.length) return null;
    sell = others.reduce((a, b) => (b.bid > a.bid ? b : a));
  }
  if (!(sell.bid > 0 && buy.ask > 0)) return null;

  const grossEdge = sell.bid / buy.ask - 1;
  const feeLegs = buy.takerFee + sell.takerFee;                        // taker on both sides
  const size = sizeUsd > 0 ? sizeUsd : 100;
  const withdrawFrac = (buy.withdrawFeeUsd + sell.withdrawFeeUsd) / size; // flat fee as a fraction of size
  const netEdge = grossEdge - feeLegs - withdrawFrac;
  // breakeven size: the trade size at which the flat withdrawal fee is exactly eaten by the spread.
  const spreadAfterTaker = grossEdge - feeLegs;
  const breakevenSizeUsd = spreadAfterTaker > 0
    ? (buy.withdrawFeeUsd + sell.withdrawFeeUsd) / spreadAfterTaker
    : null;
  return {
    kind: 'spot',
    symbol: String(symbol),
    buy: { venue: buy.venue, price: buy.ask },
    sell: { venue: sell.venue, price: sell.bid },
    grossEdgePct: round(grossEdge * 100, 3),
    netEdgePct: round(netEdge * 100, 3),
    isArb: netEdge > 0,
    sizeUsd: size,
    feePct: round(feeLegs * 100, 3),
    withdrawFeeUsd: round(buy.withdrawFeeUsd + sell.withdrawFeeUsd, 4),
    breakevenSizeUsd: breakevenSizeUsd == null ? null : round(breakevenSizeUsd, 2),
  };
}

// snapshot.spot = { SYMBOL: [ {venue,bid,ask,...} ] }. Returns every symbol's spot arb, arbs first.
export function spotArbs(snapshot = {}, opts = {}) {
  const spot = snapshot && typeof snapshot.spot === 'object' ? snapshot.spot : {};
  return Object.entries(spot)
    .map(([sym, venues]) => spotArb(sym, venues, opts))
    .filter(Boolean)
    .sort((a, b) => (b.netEdgePct ?? -1e9) - (a.netEdgePct ?? -1e9));
}

// ── OUTCOME / prediction arb (the exact surebet) ─────────────────────────────────────────────────
// legs: [ { venue?, outcome?, decimalOdds } ] — one per MUTUALLY-EXCLUSIVE outcome, best price per
// outcome (from any book/venue). Delegates to gambling.arbitrage: Σ(1/dᵢ) < 1 ⇒ locked profit.
// This is the same call that prices the arcade Event Markets — see the profitability doc §7.
export function outcomeArb(market, legs) {
  if (!Array.isArray(legs) || legs.length < 2) return null;
  const odds = legs.map((l) => num(l?.decimalOdds));
  const arb = arbitrage(odds);                 // soft-fails to null on any bad odds
  if (!arb) return null;
  return {
    kind: 'outcome',
    market: String(market ?? 'event'),
    legs: legs.map((l, i) => ({
      outcome: l?.outcome ?? `#${i}`,
      venue: l?.venue ?? null,
      decimalOdds: odds[i],
      stakeFraction: arb.stakes[i],
    })),
    impliedSum: arb.impliedSum,
    isArb: arb.isArb,
    guaranteedProfitPct: arb.guaranteedProfitPct,
    bookMarginPct: arb.marginPct,             // positive ⇒ NOT an arb (the book's vig)
  };
}

// snapshot.outcomes = [ { market, legs: [ {decimalOdds,...} ] } ]
export function outcomeArbs(snapshot = {}) {
  const list = Array.isArray(snapshot?.outcomes) ? snapshot.outcomes : [];
  return list
    .map((m) => outcomeArb(m?.market, m?.legs))
    .filter(Boolean)
    .sort((a, b) => (b.guaranteedProfitPct ?? -1e9) - (a.guaranteedProfitPct ?? -1e9));
}

// ── TRIANGULAR (A→B→C→A) ─────────────────────────────────────────────────────────────────────────
// triangles: [ { name?, ab, bc, ac, feePct? } ]. Delegates to gambling.triangularArb. Works for FX
// crosses AND crypto triangles (e.g. HIVE→SWAP.BTC→SWAP.USDT→HIVE expressed as three cross-rates).
export function triangleArb(t) {
  if (!t || typeof t !== 'object') return null;
  const r = triangularArb({ ab: t.ab, bc: t.bc, ac: t.ac }, Number.isFinite(+t.feePct) ? +t.feePct : 0);
  if (!r) return null;
  return { kind: 'triangular', name: String(t.name ?? 'A/B/C'), ...r };
}

export function triangleArbs(snapshot = {}) {
  const list = Array.isArray(snapshot?.triangles) ? snapshot.triangles : [];
  return list
    .map(triangleArb)
    .filter(Boolean)
    .sort((a, b) => (b.profitPct ?? -1e9) - (a.profitPct ?? -1e9));
}

// ── One-call scan ────────────────────────────────────────────────────────────────────────────────
// Fuses all three families into one ranked view. `opportunities` are the profitable ones only,
// sorted by profit %, each tagged with its family. Always returns an object (soft-fail throughout).
export function scanArb(snapshot = {}, opts = {}) {
  const spot = spotArbs(snapshot, opts);
  const outcome = outcomeArbs(snapshot);
  const triangle = triangleArbs(snapshot);
  const profitOf = (o) =>
    o.kind === 'spot' ? o.netEdgePct
      : o.kind === 'outcome' ? o.guaranteedProfitPct
        : o.profitPct;
  const opportunities = [...spot, ...outcome, ...triangle]
    .filter((o) => o.isArb)
    .map((o) => ({ ...o, profitPct: round(profitOf(o), 3) }))
    .sort((a, b) => b.profitPct - a.profitPct);
  return {
    disclaimer: 'DRAFT / advisory only — detection, not execution. No keys, no live venue calls.',
    spot, outcome, triangle,
    opportunities,
    best: opportunities[0] || null,
  };
}

if (process.argv[1] && process.argv[1].endsWith('arb-scanner.mjs')) {
  const demo = {
    spot: {
      'SWAP.BTC': [
        { venue: 'hive-engine', bid: 61000, ask: 61200, takerFee: 0.0025 },
        { venue: 'binance', bid: 62000, ask: 62050, takerFee: 0.001, withdrawFeeUsd: 4 },
      ],
    },
    outcomes: [
      { market: 'MELEK-UP-vs-DOWN', legs: [
        { outcome: 'UP', venue: 'bookA', decimalOdds: 2.10 },
        { outcome: 'DOWN', venue: 'bookB', decimalOdds: 2.10 },
      ] },
    ],
    triangles: [{ name: 'EUR/USD/GBP', ab: 1.10, bc: 1.28, ac: 0.86, feePct: 0.1 }],
  };
  const r = scanArb(demo, { sizeUsd: 200 });
  console.log('arb-scanner DRAFT — opportunities (profit% desc):');
  for (const o of r.opportunities) console.log(`  [${o.kind}] ${o.symbol || o.market || o.name} → +${o.profitPct}%`);
  if (!r.opportunities.length) console.log('  (none profitable in demo snapshot)');
}
