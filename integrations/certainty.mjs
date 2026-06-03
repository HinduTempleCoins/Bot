// certainty.mjs — a MYCIN-style certainty-factor (CF) module for the SoapBox neurosymbolic
// layer (queue #92). PURE functions, no I/O. It gives the Clarity Score and the trade/risk
// rule layer an auditable algebra for reasoning-under-uncertainty: how to combine independent
// pieces of evidence, how to discount a rule's conclusion by how confident we are in its
// premise, and how to fold a whole bag of signals into a single certainty.
//
// Background — MYCIN certainty factors (Shortliffe & Buchanan, 1975):
//   A certainty factor CF ∈ [-1, +1] is a single number capturing belief MINUS disbelief in a
//   hypothesis:  CF = MB − MD,  where MB (measure of belief) and MD (measure of disbelief) each
//   live in [0, 1]. So:
//     CF = +1   → certainly true
//     CF =  0   → no evidence either way
//     CF = −1   → certainly false
//   CFs are NOT probabilities and do not have to sum to 1; they are a heuristic calculus chosen
//   because it composes nicely and stays interpretable for rule authors.
//
//   import { combineCF, chainCF, aggregate, toConfidence } from './certainty.mjs'
//   node integrations/certainty.mjs            # print a worked example

// ── helpers ─────────────────────────────────────────────────────────────────

// Clamp any number to the valid CF range [-1, 1]. NaN/non-numeric garbage collapses to 0
// ("no evidence"); ±Infinity clamps to the corresponding bound.
export function clampCF(cf) {
  const n = Number(cf);
  if (Number.isNaN(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

// ── combineCF: parallel combination of two CFs for the SAME hypothesis ────────
//
// Two independent observations both bear on one conclusion (e.g. "this token is opaque" supported
// by concentrated holders AND by silent-mint headroom). MYCIN's parallel-combination formula
// merges them. With x = CF(h, evidence-1) and y = CF(h, evidence-2):
//
//   • both positive (corroborating belief):
//         CF = x + y · (1 − x)            // each adds, but with diminishing returns toward +1
//
//   • both negative (corroborating disbelief):
//         CF = x + y · (1 + x)            // symmetric: drives toward −1 with diminishing returns
//
//   • mixed sign (one believes, one disbelieves — partial cancellation):
//         CF = (x + y) / (1 − min(|x|, |y|))
//
// The formula is commutative and associative, so order of combination does not matter.
export function combineCF(cf1, cf2) {
  const x = clampCF(cf1);
  const y = clampCF(cf2);

  let cf;
  if (x >= 0 && y >= 0) {
    // both corroborate belief
    cf = x + y * (1 - x);
  } else if (x <= 0 && y <= 0) {
    // both corroborate disbelief
    cf = x + y * (1 + x);
  } else {
    // mixed sign: belief and disbelief partially cancel
    const denom = 1 - Math.min(Math.abs(x), Math.abs(y));
    // denom is 0 only when one input is exactly ±1 and the other its exact opposite (±1):
    // that is a direct contradiction (certainly-true vs certainly-false) → net 0, "no idea".
    cf = denom === 0 ? 0 : (x + y) / denom;
  }
  return clampCF(cf);
}

// ── chainCF: discount a rule's conclusion by confidence in its premise ────────
//
// Sequential / serial combination. A rule "IF premise THEN conclusion (with strength ruleCF)"
// only fires as strongly as we believe the premise. MYCIN propagates as:
//
//   CF(conclusion) = ruleCF · max(0, evidenceCF)
//
// We only chain on POSITIVE evidence: if the premise is disbelieved (evidenceCF < 0) the rule
// simply does not fire (contributes 0), rather than producing perverse negative belief in the
// conclusion. ruleCF itself may be negative (a rule that, when its premise holds, argues AGAINST
// the conclusion), so a negative ruleCF with positive evidence correctly yields negative CF.
export function chainCF(ruleCF, evidenceCF) {
  const r = clampCF(ruleCF);
  const e = Math.max(0, clampCF(evidenceCF));
  return clampCF(r * e);
}

// ── aggregate: fold combineCF over a list of CFs for one hypothesis ───────────
//
// Convenience for "I have N independent signals about the same conclusion." Because combineCF is
// commutative and associative, folding left-to-right is order-independent. Empty list → 0
// (no evidence). Non-CF entries are clamped (NaN → 0) by combineCF.
export function aggregate(cfs) {
  const list = Array.isArray(cfs) ? cfs : [];
  if (list.length === 0) return 0;
  return list.reduce((acc, cf) => combineCF(acc, cf), 0);
}

// ── toConfidence: map a CF in [-1, 1] to a 0..100 confidence for display ──────
//
// The CF axis runs −1 → +1; we present it as 0 → 100 so a UI / report can show a plain percent.
//   CF = −1 → 0,   CF = 0 → 50,   CF = +1 → 100.
//   confidence = round( (CF + 1) / 2 · 100 )
export function toConfidence(cf) {
  return Math.round((clampCF(cf) + 1) / 2 * 100);
}

// ── CLI: a worked example ─────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('certainty.mjs')) {
  // Worked example: "Is this token opaque?" — two corroborating positive signals, one rule
  // chained off a partly-believed premise, then aggregated.
  const holdersConcentrated = 0.7;   // strong evidence: issuer/whales hold ~everything
  const silentMintHeadroom = 0.5;    // moderate evidence: supply can be silently inflated

  const corroborated = combineCF(holdersConcentrated, silentMintHeadroom);
  console.log('combineCF(0.7, 0.5)  [both positive] =', corroborated.toFixed(3));

  const ruleCF = 0.8;                 // "IF concentrated THEN opaque" strength
  const premiseBelief = 0.6;          // we are only 0.6 sure it's concentrated
  const chained = chainCF(ruleCF, premiseBelief);
  console.log('chainCF(0.8, 0.6)    [discounted rule] =', chained.toFixed(3));

  const mixed = combineCF(0.6, -0.3); // one signal argues opaque, one argues transparent
  console.log('combineCF(0.6, -0.3) [mixed sign]      =', mixed.toFixed(3));

  const agg = aggregate([0.4, 0.3, 0.2]);
  console.log('aggregate([0.4,0.3,0.2])               =', agg.toFixed(3));
  console.log('toConfidence(' + agg.toFixed(3) + ')  →', toConfidence(agg) + '%');
}
