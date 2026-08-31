// risk-gate.mjs — the ONE gate every suggestion crosses before it can become an order. This is where
// "the bots suggest, nothing happens" is fixed: instead of a suggestion dying in a brief, it is scored,
// sized, and either turned into a concrete order or rejected WITH A REASON that gets recorded. There is
// no path from suggestion to execution that skips this function.
//
// It composes the already-audited pieces (no new strategy math):
//   • +EV test        ← ../trade/ev-filter.mjs  (scoreCandidate)     — replaces raw edge>threshold
//   • fractional-Kelly ← ../trade/position-sizing.mjs (sizePosition)  — size under all hard caps
//   • hard guards (reused from the angelicalist doctrine):
//       1. DEAD-BOOK REJECT: edge above maxBelievableEdgePct is a stale/broken book → reject.
//       2. UPSTREAM REJECT : a signal already flagged verdict:'REJECT' (trap) is never acted on.
//       3. BUY-FIRST       : a naked sell (not closing a prior buy) is sized to 0 → reject.
//       4. DUST FLOOR      : an order below minOrderUsd is not worth the fees → reject.
//       5. THIN DEPTH      : size is clamped to available executable depth.
//
// Pure, offline, soft-fail-never-throw. No keys, no network, no orders placed here — it only decides.

import { scoreCandidate } from '../trade/ev-filter.mjs';
import { sizePosition } from '../trade/position-sizing.mjs';

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const round = (x, d = 6) => (Number.isFinite(+x) ? +(+x).toFixed(d) : x);

export const DEFAULT_GATE = Object.freeze({
  maxBelievableEdgePct: 30,   // above this, the book is stale/broken (SWAP.ETH 164% trap)
  minEdgePct: 1,              // ignore sub-1% "edges" that vanish into fees
  minOrderUsd: 1,             // dust floor
  maxOrderUsd: 2,             // per-order hard cap ($1-5 band, mid)
  bankrollUsd: 100,           // dry-powder bankroll for Kelly (operator-set in live config)
  kellyFraction: 0.25,        // quarter-Kelly
  maxFraction: 0.10,          // never risk >10% of bankroll on one order
  defaultWinProb: 0.85,       // assumed fill prob for a peg-arb-style edge when no explicit model
  allowNakedSell: false,      // buy-first discipline: naked sells blocked by default
});

/**
 * Normalize a raw signal (from signal-orchestrator, ai-trade-suggest, or a bot) into a gate candidate.
 * Keeps the fields the gate needs; carries the rest through untouched.
 */
export function normalize(sig = {}) {
  const edgePct = num(sig.edgePct ?? sig.edge ?? (num(sig.edgeFrac) * 100));
  return {
    id: sig.id ?? sig.signalId ?? `${sig.symbol ?? '_'}::${sig.side ?? 'na'}`,
    symbol: sig.symbol ?? '_',
    side: String(sig.side ?? 'buy').toLowerCase(),
    venue: sig.venue ?? 'hive-engine',
    edgePct: Number.isFinite(edgePct) ? edgePct : NaN,
    fairProb: sig.fairProb,
    decimalOdds: sig.decimalOdds,
    winProb: sig.winProb,
    priceUsd: num(sig.priceUsd),
    price: sig.price,
    depthUsd: num(sig.depthUsd),
    isRoundTrip: !!sig.isRoundTrip,
    verdict: sig.verdict,
    source: sig.source ?? null,
    _raw: sig,
  };
}

/**
 * Gate ONE candidate. Returns { pass, reason, sizeUsd, scored, sizing, candidate }.
 * `pass:false` always carries a machine-usable `reason` so the ledger can record why it died.
 */
export function gate(input, cfg = {}) {
  const c = { ...DEFAULT_GATE, ...cfg };
  const cand = input && input._raw ? input : normalize(input || {});
  const fail = (reason) => ({ pass: false, reason, sizeUsd: 0, candidate: cand });

  // 2. upstream trap
  if (cand.verdict === 'REJECT') return fail('upstream-reject');

  const edge = num(cand.edgePct);
  if (!Number.isFinite(edge)) return fail('no-edge-value');

  // 1. dead-book
  if (Math.abs(edge) > c.maxBelievableEdgePct) return fail(`dead-book (edge ${round(edge, 2)}% > ${c.maxBelievableEdgePct}%)`);
  // sub-threshold
  if (edge < c.minEdgePct) return fail(`below-min-edge (${round(edge, 2)}% < ${c.minEdgePct}%)`);

  // 3. buy-first: naked sell blocked unless explicitly allowed AND closing a prior buy
  const isSell = cand.side === 'sell';
  if (isSell && !cand.isRoundTrip && !c.allowNakedSell) return fail('buy-first (naked sell blocked)');

  // SIZING. Two regimes:
  //  (a) a genuine probabilistic bet (fairProb/decimalOdds present, e.g. an event/prediction line, or an
  //      explicit winProb) → fractional-Kelly via the audited position-sizing (loss = full stake model).
  //  (b) a directional spot edge (peg-arb / momentum / mean-revert) with NO win/loss-probability model →
  //      Kelly's total-loss assumption doesn't fit (a spread trade's downside is a stop, not −100%), so
  //      we size CONSERVATIVELY at the capped notional and let the hard caps + dust floor bind. Honest
  //      for a staged pipeline: it never sizes ABOVE the caps, it just doesn't fabricate a Kelly edge.
  const hasProbModel = Number.isFinite(num(cand.fairProb)) || Number.isFinite(num(cand.winProb));
  const scored = scoreCandidate({ fairProb: cand.fairProb, decimalOdds: cand.decimalOdds, edge: edge / 100 }) || null;
  if (scored && hasProbModel && scored.positiveEv === false) return fail('negative-ev');

  const availableUsd = Number.isFinite(num(cand.depthUsd)) ? num(cand.depthUsd) : Infinity;
  let sizing;
  if (hasProbModel) {
    const p = num(cand.winProb) || scored?.fairProb;
    const b = scored && Number.isFinite(scored.decimalOdds) ? scored.decimalOdds - 1 : Math.max(edge / 100, 0.005);
    sizing = sizePosition({ p, b, bankrollUsd: c.bankrollUsd, side: cand.side, isRoundTrip: cand.isRoundTrip,
      kellyFraction: c.kellyFraction, maxFraction: c.maxFraction, maxOrderUsd: c.maxOrderUsd, availableUsd });
  } else {
    // conservative capped flat size (buy-first already enforced above for naked sells)
    const capFrac = num(c.maxFraction) > 0 ? num(c.maxFraction) : 0.10;
    const flat = Math.min(num(c.maxOrderUsd) || Infinity, capFrac * num(c.bankrollUsd), availableUsd);
    sizing = { sizeUsd: round(Math.max(0, flat), 4), cappedBy: 'flat-capped', kellyRaw: null,
      note: `no probability model — conservative capped size (min of maxOrderUsd / ${(capFrac * 100).toFixed(0)}%-bankroll / depth)` };
  }

  let sizeUsd = sizing.sizeUsd;
  if (!(sizeUsd > 0)) return { ...fail(`unsized (${sizing.cappedBy})`), scored, sizing };

  // 5. thin-depth clamp (informational — sizePosition already clamps to depthUsd via availableUsd)
  if (Number.isFinite(num(cand.depthUsd)) && num(cand.depthUsd) < sizeUsd) sizeUsd = num(cand.depthUsd);

  // 4. dust floor
  if (sizeUsd < c.minOrderUsd) return { ...fail(`dust (< $${c.minOrderUsd})`), scored, sizing };

  return { pass: true, reason: 'pass', sizeUsd: round(sizeUsd, 4), scored, sizing, candidate: cand };
}

export default { DEFAULT_GATE, normalize, gate };
