// integrations/trade/ev-filter.mjs — DRAFT (NOT WIRED IN). Ranks + filters candidate trades by
// EXPECTED VALUE using the §4.7 gambling engine. Pure math, no network, no keys, no execution.
//
// ┌─ HARD SAFETY INVARIANT ─────────────────────────────────────────────────────────────────────┐
// │ READ-ONLY / ADVISORY DRAFT. Pure functions only. It scores INTENTIONS; it never places, sizes  │
// │ to a live book, broadcasts, or holds a key. A candidate that survives the filter is a           │
// │ SUGGESTION the separate, gated executor could later act on — not an order. zero-WIF-on-host.     │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// The problem it solves: the current bots act on a raw EDGE threshold (peg-arb fires at ≥3% gap).
// Edge alone ignores HOW OFTEN the trade actually pays and how bad the miss is. +EV filtering asks
// the §4.7 question instead: given MY fair estimate of the win probability and the payoff on offer,
// is this bet's expected value positive? EV = P_fair·payout − (1 − P_fair). Only +EV candidates pass.
//
// A candidate is expressed either as { fairProb, decimalOdds } (a book-style price) or as
// { fairProb, winFraction, lossFraction } (a trade: gain winFraction of stake on a win, lose
// lossFraction on a miss — e.g. take-profit vs stop-loss distances). We map the trade form onto the
// engine: a win returns (1 + winFraction) per unit staked at risk lossFraction, i.e. decimalOdds =
// 1 + winFraction/lossFraction, so evFromDecimal gives EV per unit AT RISK.
//
//   import { scoreCandidate, filterEv, rankEv } from './integrations/trade/ev-filter.mjs'

import { evFromDecimal, expectedValue, impliedFromDecimal } from '../soapbox/gambling.mjs';

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const round = (x, n = 6) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);

// Normalize a candidate to { fairProb, decimalOdds } (odds = payout multiple per unit at risk).
function toOdds(c) {
  if (!c || typeof c !== 'object') return null;
  const p = num(c.fairProb);
  if (!(p > 0 && p < 1)) return null;
  let d;
  if (Number.isFinite(+c.decimalOdds)) {
    d = +c.decimalOdds;
  } else if (Number.isFinite(+c.winFraction) && Number.isFinite(+c.lossFraction)) {
    const w = +c.winFraction, l = +c.lossFraction;
    if (!(w > 0 && l > 0)) return null;
    d = 1 + w / l;                       // payoff:risk expressed as decimal odds on the at-risk unit
  } else if (Number.isFinite(+c.edge)) {
    // last resort: a symmetric even-money bet skewed by a raw edge estimate. decimalOdds = 2 gives
    // payout 1; the edge lives entirely in fairProb the caller supplied. Kept for legacy signals.
    d = 2;
  } else {
    return null;
  }
  if (!(d > 1)) return null;
  return { fairProb: p, decimalOdds: d };
}

/**
 * Score ONE candidate. Returns the candidate augmented with { ev, evPct, edge, impliedProb, fairProb,
 * decimalOdds, positiveEv } — or null on junk (soft-fail, never throws). `edge` is per-unit-at-risk EV
 * (the +EV/−EV signal); `impliedProb` is the break-even probability the offered price bakes in, so
 * (fairProb − impliedProb) is your probability edge over the market.
 */
export function scoreCandidate(c, { stake = 1 } = {}) {
  const o = toOdds(c);
  if (!o) return null;
  const ev = evFromDecimal(o.decimalOdds, o.fairProb, stake > 0 ? stake : 1);
  if (!ev) return null;
  const implied = impliedFromDecimal(o.decimalOdds);
  return {
    ...c,
    fairProb: o.fairProb,
    decimalOdds: o.decimalOdds,
    impliedProb: implied,
    probEdge: implied == null ? null : round(o.fairProb - implied),
    ev: ev.ev,
    evPct: ev.evPct,
    edge: ev.edge,
    positiveEv: ev.edge > 0,
  };
}

/** Score a list; drop the junk (null) candidates but keep +EV and −EV so callers can inspect both. */
export function scoreAll(candidates = [], opts = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((c) => scoreCandidate(c, opts))
    .filter(Boolean);
}

/**
 * Keep only +EV candidates whose per-unit edge clears `minEdge` (default 0 = any positive edge),
 * ranked best-first. This is the drop-in replacement for a raw edge>threshold gate.
 */
export function filterEv(candidates = [], { minEdge = 0, stake = 1 } = {}) {
  return scoreAll(candidates, { stake })
    .filter((c) => c.positiveEv && c.edge >= minEdge)
    .sort((a, b) => b.edge - a.edge);
}

/** Rank ALL scored candidates by edge, best-first (no filtering). Useful for reports/ordering. */
export function rankEv(candidates = [], opts = {}) {
  return scoreAll(candidates, opts).sort((a, b) => b.edge - a.edge);
}

// Direct passthrough so callers can EV-score a book price without building a candidate object.
export { evFromDecimal, expectedValue, impliedFromDecimal };

if (process.argv[1] && process.argv[1].endsWith('ev-filter.mjs')) {
  const demo = [
    { id: 'peg-arb SWAP.DOGE', fairProb: 0.7, winFraction: 0.03, lossFraction: 0.02 },
    { id: 'coinflip fair', fairProb: 0.5, decimalOdds: 2.0 },
    { id: 'overpriced long', fairProb: 0.45, decimalOdds: 1.8 },
    { id: 'garbage', fairProb: 2, decimalOdds: 'x' },
  ];
  console.log('ev-filter DRAFT — +EV candidates (edge desc):');
  for (const c of filterEv(demo)) console.log(`  ${c.id}: edge ${c.edge}  EV% ${c.evPct}  probEdge ${c.probEdge}`);
}
