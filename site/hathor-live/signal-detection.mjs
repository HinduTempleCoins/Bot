// site/hathor-live/signal-detection.mjs — signal-detection theory, as arithmetic rather than as vibes.
//
// WHY THIS IS A SEPARATE FILE. Percent correct is not a measure of sensitivity; it confounds how well
// you can tell two things apart with how willing you are to say one of them. Every exam in this
// battery that asks a person to discriminate needs the same three or four functions, and they need to
// be right, so they live in one place with one set of hand-checked tests rather than being re-derived
// per exam. X7 (human-or-model) is the first caller. The blindsight exam (§A.2 of the SF paper) will
// want meta-d′ on top of this and is not built yet — the gap is named, not papered over.
//
// ── THE TWO d′ FORMULAE ARE NOT INTERCHANGEABLE ──────────────────────────────────────────────────
//
//   YES/NO (one stimulus per trial, "was that a signal?"):  d′ = z(H) − z(F)
//   2AFC   (two stimuli per trial, "which one was it?"):    d′ = √2 · z(pc)
//
// Using the yes/no formula on 2AFC data inflates d′ by a factor of about 1.41, and that mistake is
// extremely common in web-published "AI detection" scores. X7 is a 2AFC design, so it uses the 2AFC
// formula, and this file refuses to make the choice implicit by exporting one function that guesses.
//
// A NOTE ON THE DEGENERATE DECOMPOSITION. In a pure 2AFC design, calling the model-side judgement a
// "hit" and the human-side judgement a "false alarm" produces F = 1 − H by construction, so the
// yes/no formula collapses to 2·z(pc) — a monotone re-scaling of the same number, not a second
// measurement. `dPrimeYesNo` is therefore exported for designs that genuinely have independent
// signal and noise trials, and X7 does not call it. Saying that out loud is cheaper than fixing it
// after someone reports two "different" sensitivities that were the same data twice.
//
// ── EXTREME RATES ────────────────────────────────────────────────────────────────────────────────
//
// z(1) and z(0) are infinite, so a perfect or floor score has no finite d′. The convention used here
// is Macmillan & Creelman's: correct ONLY the extreme cells, by 0.5/(N+1), and say on the result that
// it was done. Hautus (1995) argues for applying the log-linear correction to every cell always; that
// is defensible and it makes hand-checking impossible, so it is not what this does. Whichever is used
// has to be stated, and this one is stated.
//
// Macmillan NA & Creelman CD (2005), Detection Theory: A User's Guide, 2nd ed., Lawrence Erlbaum.
// Hautus MJ (1995), Corrections for extreme proportions and their biasing effects on estimated values
// of d′, Behavior Research Methods 27:46–51. https://doi.org/10.3758/BF03203619
//
// Pure. No I/O, no network, nothing thrown into a request path.

const num = (v) => (v == null || v === '' ? NaN : Number(v));
const finite = (v) => Number.isFinite(num(v));

// ── the probit: the inverse of the standard normal CDF ───────────────────────────────────────────
//
// Peter Acklam's rational approximation. Relative error below 1.15e-9 over the whole open interval,
// which is four orders of magnitude better than anything this battery can measure, so no Newton or
// Halley refinement step is carried. Checked against three exactly-known points in the tests:
// z(0.5) = 0, z(Φ(1)) = 1, z(0.975) = 1.959963985.

const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
  1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
  6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
  -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
  3.754408661907416e+00];
const P_LOW = 0.02425;
const P_HIGH = 1 - P_LOW;

/**
 * z such that Φ(z) = p. Returns NaN outside (0,1) rather than ±Infinity — a caller that gets NaN has
 * to decide what to do about an undefined score, and a caller that gets Infinity tends to print it.
 */
export function probit(p) {
  const x = num(p);
  if (!Number.isFinite(x) || x <= 0 || x >= 1) return NaN;
  if (x < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(x));
    return (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
      / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  if (x > P_HIGH) {
    const q = Math.sqrt(-2 * Math.log(1 - x));
    return -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
      / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  const q = x - 0.5;
  const r = q * q;
  return (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
    / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
}

/** Macmillan & Creelman's extreme-cell correction. Returns the rate and whether it was moved. */
export function correctedRate(k, n) {
  const hits = num(k);
  const total = num(n);
  if (!Number.isFinite(hits) || !Number.isFinite(total) || total <= 0) {
    return { rate: NaN, corrected: false };
  }
  const raw = hits / total;
  if (raw > 0 && raw < 1) return { rate: raw, corrected: false };
  // 0 → 0.5/(N+1); 1 → (N+0.5)/(N+1). Same offset, both ends, so the correction is symmetric.
  return { rate: (hits + 0.5) / (total + 1), corrected: true };
}

/**
 * 2AFC sensitivity. d′ = √2 · z(pc). THIS is the formula for X7.
 *
 * Returns pc as well, because pc is the number a person understands and d′ is the number that is
 * comparable across designs, and printing one without the other is how a result becomes a boast.
 */
export function dPrime2AFC({ correct, total } = {}) {
  const k = num(correct);
  const n = num(total);
  if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0 || k > n) {
    return { ok: false, dPrime: null, pc: null, n: 0, corrected: false };
  }
  const { rate, corrected } = correctedRate(k, n);
  const z = probit(rate);
  return {
    ok: Number.isFinite(z),
    dPrime: Number.isFinite(z) ? Math.SQRT2 * z : null,
    pc: k / n,
    pcUsed: rate,
    n,
    correct: k,
    corrected,
    formula: "d' = √2 · z(proportion correct) — the two-alternative forced-choice formula",
  };
}

/**
 * Yes/no sensitivity, d′ = z(H) − z(F), with the criterion c = −(z(H) + z(F))/2.
 *
 * Exported for designs with genuinely independent signal and noise trials. X7 does not call it; see
 * the header for why the 2AFC decomposition into H and F is degenerate.
 */
export function dPrimeYesNo({ hits, signalTrials, falseAlarms, noiseTrials } = {}) {
  const h = correctedRate(hits, signalTrials);
  const f = correctedRate(falseAlarms, noiseTrials);
  const zh = probit(h.rate);
  const zf = probit(f.rate);
  if (!Number.isFinite(zh) || !Number.isFinite(zf)) {
    return { ok: false, dPrime: null, criterion: null, hitRate: h.rate, faRate: f.rate, corrected: h.corrected || f.corrected };
  }
  return {
    ok: true,
    dPrime: zh - zf,
    criterion: -(zh + zf) / 2,
    hitRate: h.rate,
    faRate: f.rate,
    corrected: h.corrected || f.corrected,
    formula: "d' = z(hit rate) − z(false-alarm rate) — the yes/no formula",
  };
}

// ── is it distinguishable from guessing ──────────────────────────────────────────────────────────

/**
 * One-sided exact binomial tail: P(X ≥ k | n, p0). Exact, not a normal approximation, because n here
 * is small enough that the approximation's error is the same size as the effect being reported.
 *
 * Computed in log space so a 200-trial factorial does not overflow on the way to a probability.
 */
export function binomialTailP(k, n, p0 = 0.5) {
  const K = Math.ceil(num(k));
  const N = Math.round(num(n));
  const p = num(p0);
  if (!Number.isFinite(K) || !Number.isFinite(N) || N <= 0 || !(p > 0 && p < 1)) return NaN;
  if (K <= 0) return 1;
  if (K > N) return 0;
  // log C(n,i) built incrementally; sum the exact terms from K to N.
  let logC = 0;
  for (let i = 1; i <= K; i += 1) logC += Math.log((N - i + 1) / i);
  let total = 0;
  for (let i = K; i <= N; i += 1) {
    total += Math.exp(logC + i * Math.log(p) + (N - i) * Math.log(1 - p));
    if (i < N) logC += Math.log((N - i) / (i + 1));
  }
  return Math.min(1, Math.max(0, total));
}

// ── calibration ──────────────────────────────────────────────────────────────────────────────────

/** The confidence bins. 50 is the floor because a two-alternative guess is already 50% right. */
export const CONFIDENCE_BINS = Object.freeze([
  { id: '50-59', lo: 50, hi: 59, label: 'a coin-flip, or nearly' },
  { id: '60-69', lo: 60, hi: 69, label: 'a lean' },
  { id: '70-79', lo: 70, hi: 79, label: 'fairly sure' },
  { id: '80-89', lo: 80, hi: 89, label: 'confident' },
  { id: '90-100', lo: 90, hi: 100, label: 'near-certain' },
]);

const binFor = (conf) => CONFIDENCE_BINS.find((b) => conf >= b.lo && conf <= b.hi) || null;

/**
 * Calibration over a list of { confidence: 50..100, correct: boolean } judgements.
 *
 * WHAT IS REPORTED AND WHY:
 *  - meanConfidence vs accuracy, and their difference. This is the headline of the whole exam: the
 *    near-universal finding is that the difference is positive and large.
 *  - Brier score, mean (p − outcome)². Lower is better; 0.25 is what you get by saying 50% to
 *    everything, which is the honest score of somebody who knows they cannot do this.
 *  - Murphy's (1973) decomposition into reliability, resolution and uncertainty. It is EXACT only
 *    when the forecast probability is constant inside each bin, which binned human data never is, so
 *    the returned object says `decompositionIsApproximate: true` rather than implying an identity.
 *
 * Murphy AH (1973), A new vector partition of the probability score, Journal of Applied Meteorology
 * 12(4):595–600. https://doi.org/10.1175/1520-0450(1973)012<0595:ANVPOT>2.0.CO;2
 */
export function calibration(judgements = []) {
  const rows = (Array.isArray(judgements) ? judgements : [])
    .map((j) => ({ confidence: num(j && j.confidence), correct: !!(j && j.correct) }))
    .filter((j) => Number.isFinite(j.confidence) && j.confidence >= 50 && j.confidence <= 100);
  const n = rows.length;
  if (!n) {
    return {
      ok: false, n: 0, meanConfidence: null, accuracy: null, overconfidence: null,
      brier: null, bins: [], reliability: null, resolution: null, uncertainty: null,
      decompositionIsApproximate: true,
    };
  }
  const meanConfidence = rows.reduce((s, r) => s + r.confidence, 0) / n / 100;
  const accuracy = rows.reduce((s, r) => s + (r.correct ? 1 : 0), 0) / n;
  const brier = rows.reduce((s, r) => s + ((r.confidence / 100) - (r.correct ? 1 : 0)) ** 2, 0) / n;

  const bins = CONFIDENCE_BINS.map((b) => {
    const inBin = rows.filter((r) => binFor(r.confidence) === b);
    return {
      id: b.id, lo: b.lo, hi: b.hi, label: b.label, n: inBin.length,
      meanConfidence: inBin.length ? inBin.reduce((s, r) => s + r.confidence, 0) / inBin.length / 100 : null,
      accuracy: inBin.length ? inBin.reduce((s, r) => s + (r.correct ? 1 : 0), 0) / inBin.length : null,
    };
  });

  let reliability = 0;
  let resolution = 0;
  for (const b of bins) {
    if (!b.n) continue;
    reliability += (b.n / n) * ((b.meanConfidence - b.accuracy) ** 2);
    resolution += (b.n / n) * ((b.accuracy - accuracy) ** 2);
  }
  return {
    ok: true,
    n,
    meanConfidence,
    accuracy,
    overconfidence: meanConfidence - accuracy,
    brier,
    brierOfAlwaysFifty: 0.25,
    bins: bins.filter((b) => b.n > 0),
    reliability,
    resolution,
    uncertainty: accuracy * (1 - accuracy),
    decompositionIsApproximate: true,
  };
}

export default {
  probit, correctedRate, dPrime2AFC, dPrimeYesNo, binomialTailP, calibration, CONFIDENCE_BINS,
};
