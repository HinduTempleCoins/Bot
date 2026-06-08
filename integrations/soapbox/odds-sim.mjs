// odds-sim.mjs — sports-odds SIMULATION engine for SoapBox (operator spec, Jun-3 L1168).
// The PREDICTIVE layer that sits on top of sports-odds.mjs / odds-education.mjs (which only do
// odds AGGREGATION + de-vig/overround math). Pipeline:
//   Elo team ratings → expected goals (lambda) → Poisson goal model → Dixon-Coles low-score
//   correction → Monte-Carlo simulation of many matches → model outcome probabilities
//   (1X2, over/under 2.5, both-teams-to-score) → compare vs the de-vigged market to surface VALUE.
//
// EDUCATION & ANALYTICS ONLY. This is a "model estimate, not advice" surface. It never takes,
// places, settles, or brokers a wager. The value flags are a teaching device (where does our model
// disagree with the de-vigged line?), not a betting signal.
//
// HOUSE STYLE: ESM .mjs, pure functions, injectable inputs, soft-fail-never-throw, NO network in
// the core math. Determinism is load-bearing: there is NO Math.random / Date.now anywhere here —
// the Monte-Carlo draws come from an INJECTED seeded RNG (a small LCG) so tests reproduce exactly.
//
//   import { predictMatch, valueVsMarket, makeLcg } from './odds-sim.mjs'
//   node integrations/soapbox/odds-sim.mjs

// ── Seeded RNG (LCG) ──────────────────────────────────────────────────────────
// Numerical Recipes / glibc-style 32-bit LCG. Deterministic given a seed; returns a function rng()
// yielding floats in [0,1). We never use Math.random (forbidden + non-reproducible). The workflow
// rule "vary by index" is satisfied by seeding per simulation index in callers if desired.

/** Make a seeded RNG. Returns rng() → float in [0,1). Pure/deterministic for a given seed. */
export function makeLcg(seed = 1) {
  // Keep state in an unsigned 32-bit range. Constants from Numerical Recipes (LCG).
  let s = (Number(seed) >>> 0) || 1;
  return function rng() {
    // s = (a*s + c) mod 2^32
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296; // 2^32
  };
}

// ── Elo ratings ────────────────────────────────────────────────────────────────
// Standard Elo expected score with an additive home-field advantage (in rating points). The
// expected score for A is the logistic of the rating gap; symmetric: E_A + E_B = 1.

/**
 * Expected score (win expectancy, 0..1) for team A vs team B under Elo, with `homeAdv` rating
 * points added to A (the home side). Returns 0.5 on invalid input (soft-fail).
 */
export function eloExpectedScore(rA, rB, homeAdv = 0) {
  const a = Number(rA);
  const b = Number(rB);
  const h = Number(homeAdv) || 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.5;
  return 1 / (1 + Math.pow(10, (b - (a + h)) / 400));
}

/**
 * Elo rating update. actual ∈ {1 win, 0.5 draw, 0 loss}; expected from eloExpectedScore; k is the
 * K-factor (how fast ratings move). Returns the new rating. Soft-fail → returns the old rating.
 */
export function eloUpdate(rating, actual, expected, k = 20) {
  const r = Number(rating);
  const a = Number(actual);
  const e = Number(expected);
  const kk = Number(k);
  if (![r, a, e, kk].every(Number.isFinite)) return Number.isFinite(r) ? r : 0;
  return r + kk * (a - e);
}

// ── Poisson goal model ──────────────────────────────────────────────────────────
// Goals in a match are modelled ~Poisson(lambda). pmf(k;λ) = e^-λ λ^k / k!. We compute it in a
// numerically stable way via the log-gamma of (k+1) to avoid factorial overflow at larger k.

function lnFactorial(k) {
  // ln(k!) = lnGamma(k+1). Lanczos approximation.
  if (k < 0) return NaN;
  if (k <= 1) return 0;
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  let x = k + 1; // lnGamma(x) where x = k+1
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Poisson probability mass P(X=k) for rate lambda. Soft-fail → 0 for invalid input. */
export function poissonPmf(k, lambda) {
  const kk = Math.trunc(Number(k));
  const lam = Number(lambda);
  if (!Number.isFinite(kk) || kk < 0 || !Number.isFinite(lam) || lam < 0) return 0;
  if (lam === 0) return kk === 0 ? 1 : 0;
  // exp(k*ln(λ) − λ − ln(k!))
  return Math.exp(kk * Math.log(lam) - lam - lnFactorial(kk));
}

// ── Elo/ratings → expected goals (lambda) ────────────────────────────────────────
// Map a team's Elo win-expectancy to an expected-goals figure around a league baseline. A team
// favoured by Elo scores more than baseline, the underdog fewer. `spread` scales how strongly the
// Elo edge tilts goals. This is intentionally simple and tunable (the spec calls for an Elo-based
// attack/defence → lambda mapping; richer attack/defence params can layer on later).

/**
 * Expected goals for both sides from Elo ratings.
 * @param {object} o
 * @param {number} o.homeElo, o.awayElo — team ratings.
 * @param {number} [o.homeAdv=60] — Elo home advantage (points).
 * @param {number} [o.baseGoals=1.35] — league-average goals per team per match.
 * @param {number} [o.spread=1.1] — how strongly the Elo edge tilts goals (multiplicative range).
 * @returns {{lambdaHome:number, lambdaAway:number, pHome:number}} lambdas + Elo home win-expectancy.
 * Soft-fail → baseline lambdas on invalid input.
 */
export function expectedGoalsFromElo({ homeElo, awayElo, homeAdv = 60, baseGoals = 1.35, spread = 1.1 } = {}) {
  const base = Number(baseGoals);
  const b = Number.isFinite(base) && base > 0 ? base : 1.35;
  const sp = Number.isFinite(Number(spread)) ? Number(spread) : 1.1;
  const pHome = eloExpectedScore(homeElo, awayElo, homeAdv); // 0..1
  // Centre on 0.5 → multiplier favours the side Elo prefers; underdog scores fewer.
  const tilt = (pHome - 0.5) * 2; // −1..1
  const lambdaHome = Math.max(0.05, b * Math.exp(tilt * Math.log(1 + sp)));
  const lambdaAway = Math.max(0.05, b * Math.exp(-tilt * Math.log(1 + sp)));
  return { lambdaHome, lambdaAway, pHome };
}

// ── Dixon-Coles low-score correction ──────────────────────────────────────────────
// The independent-Poisson model misprices the four lowest scorelines (0-0, 1-0, 0-1, 1-1). The
// Dixon-Coles tau factor corrects exactly those, governed by a dependence parameter rho. Other
// scores are unchanged (tau = 1).

/**
 * Dixon-Coles tau correction for scoreline (i home goals, j away goals) given lambdas + rho.
 * Affects only {0,1}×{0,1}; returns 1 elsewhere. Clamped to be non-negative. Soft-fail → 1.
 */
export function dixonColesTau(i, j, lambdaHome, lambdaAway, rho) {
  const li = Math.trunc(Number(i));
  const lj = Math.trunc(Number(j));
  const lh = Number(lambdaHome);
  const la = Number(lambdaAway);
  const r = Number(rho);
  if (![lh, la, r].every(Number.isFinite)) return 1;
  if (li === 0 && lj === 0) return Math.max(0, 1 - lh * la * r);
  if (li === 0 && lj === 1) return Math.max(0, 1 + lh * r);
  if (li === 1 && lj === 0) return Math.max(0, 1 + la * r);
  if (li === 1 && lj === 1) return Math.max(0, 1 - r);
  return 1;
}

/**
 * Correct-score probability matrix with the Dixon-Coles correction, normalized to sum to 1.
 * @param {number} lambdaHome, lambdaAway — expected goals.
 * @param {number} [rho=-0.05] — DC low-score dependence parameter.
 * @param {number} [maxGoals=10] — matrix dimension (goals 0..maxGoals per side).
 * @returns {number[][]} matrix[i][j] = P(home i, away j). Soft-fail → empty matrix.
 */
export function scoreMatrixProb(lambdaHome, lambdaAway, rho = -0.05, maxGoals = 10) {
  const lh = Number(lambdaHome);
  const la = Number(lambdaAway);
  if (!Number.isFinite(lh) || !Number.isFinite(la) || lh < 0 || la < 0) return [];
  const n = Math.max(1, Math.trunc(Number(maxGoals)) || 10);
  const m = [];
  let total = 0;
  for (let i = 0; i <= n; i++) {
    m[i] = [];
    const pHomeI = poissonPmf(i, lh);
    for (let j = 0; j <= n; j++) {
      const pAwayJ = poissonPmf(j, la);
      const p = pHomeI * pAwayJ * dixonColesTau(i, j, lh, la, rho);
      m[i][j] = p;
      total += p;
    }
  }
  if (total > 0) for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) m[i][j] /= total;
  return m;
}

// Reduce a (normalized) score matrix to outcome probabilities. Pure helper.
function matrixToOutcomes(m) {
  const out = { home: 0, draw: 0, away: 0, over25: 0, btts: 0 };
  if (!Array.isArray(m) || m.length === 0) return out;
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      const p = m[i][j];
      if (!Number.isFinite(p)) continue;
      if (i > j) out.home += p;
      else if (i === j) out.draw += p;
      else out.away += p;
      if (i + j > 2) out.over25 += p; // over 2.5 = 3+ total goals
      if (i >= 1 && j >= 1) out.btts += p;
    }
  }
  return out;
}

// ── Monte-Carlo simulation ──────────────────────────────────────────────────────
// Sample n matches. Goals per side drawn from Poisson(lambda) by inversion using the injected RNG.
// The Dixon-Coles correction is applied as a rejection/reweighting on the low-score region so the
// simulated distribution matches scoreMatrixProb. Deterministic given the rng.

// Poisson sampler by CDF inversion using a uniform u from rng().
function samplePoisson(lambda, u) {
  if (!(lambda > 0)) return 0;
  // Inversion via cumulative pmf (lambda is small for goals; cheap). Bounded loop.
  let cum = 0;
  let k = 0;
  for (; k < 30; k++) {
    cum += poissonPmf(k, lambda);
    if (u <= cum) return k;
  }
  return k;
}

/**
 * Simulate n matches and tally outcome probabilities. Deterministic given `rng` (default: a seeded
 * LCG). To honour Dixon-Coles, low scorelines are accepted with probability tau (≤1) and otherwise
 * resampled, so the Monte-Carlo distribution converges to scoreMatrixProb.
 * @returns {{home,draw,away,over25,btts,topScores:Array<{score:string,prob:number}>, n:number}}
 * Soft-fail → zeros on invalid input.
 */
export function monteCarloMatch(lambdaHome, lambdaAway, rho = -0.05, n = 10000, rng = makeLcg(1)) {
  const lh = Number(lambdaHome);
  const la = Number(lambdaAway);
  const N = Math.max(0, Math.trunc(Number(n)) || 0);
  const r = typeof rng === 'function' ? rng : makeLcg(1);
  const base = { home: 0, draw: 0, away: 0, over25: 0, btts: 0, topScores: [], n: N };
  if (!Number.isFinite(lh) || !Number.isFinite(la) || lh < 0 || la < 0 || N === 0) return base;

  const counts = { home: 0, draw: 0, away: 0, over25: 0, btts: 0 };
  const scoreTally = new Map();

  for (let s = 0; s < N; s++) {
    let i = 0;
    let j = 0;
    // Draw a (possibly rejection-corrected) scoreline. Bounded attempts → never an infinite loop.
    let accept = false;
    for (let attempt = 0; attempt < 8 && !accept; attempt++) {
      i = samplePoisson(lh, r());
      j = samplePoisson(la, r());
      const tau = dixonColesTau(i, j, lh, la, rho);
      if (tau >= 1) accept = true;
      else accept = r() < tau; // accept low-score draw with prob tau (tau ≤ 1 here)
    }
    if (i > j) counts.home++;
    else if (i === j) counts.draw++;
    else counts.away++;
    if (i + j > 2) counts.over25++;
    if (i >= 1 && j >= 1) counts.btts++;
    const key = `${i}-${j}`;
    scoreTally.set(key, (scoreTally.get(key) || 0) + 1);
  }

  const topScores = [...scoreTally.entries()]
    .map(([score, c]) => ({ score, prob: c / N }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, 6);

  return {
    home: counts.home / N,
    draw: counts.draw / N,
    away: counts.away / N,
    over25: counts.over25 / N,
    btts: counts.btts / N,
    topScores,
    n: N,
  };
}

// ── Top-level predictor ──────────────────────────────────────────────────────────

/**
 * Predict a match end-to-end: Elo → lambdas → DC score matrix (analytic) + Monte-Carlo (sampled).
 * @param {object} o
 * @param {number} o.homeElo, o.awayElo
 * @param {number} [o.homeAdv=60] Elo home advantage points.
 * @param {number} [o.rho=-0.05] Dixon-Coles parameter.
 * @param {number} [o.n=10000] Monte-Carlo samples.
 * @param {function} [o.rng] injected RNG (defaults to a seeded LCG → deterministic).
 * @param {number} [o.baseGoals], [o.spread] goal-mapping tuning.
 * @returns model probabilities (analytic + Monte-Carlo) plus the lambdas and Elo win-expectancy.
 * Soft-fail-never-throw.
 */
export function predictMatch({
  homeElo, awayElo, homeAdv = 60, rho = -0.05, n = 10000, rng, baseGoals = 1.35, spread = 1.1,
} = {}) {
  try {
    const { lambdaHome, lambdaAway, pHome } = expectedGoalsFromElo({
      homeElo, awayElo, homeAdv, baseGoals, spread,
    });
    const matrix = scoreMatrixProb(lambdaHome, lambdaAway, rho);
    const analytic = matrixToOutcomes(matrix);
    const mc = monteCarloMatch(lambdaHome, lambdaAway, rho, n, rng || makeLcg(1));
    // Model probabilities we publish (the analytic DC matrix is exact; MC is the spec's sim layer).
    const model = {
      home: analytic.home,
      draw: analytic.draw,
      away: analytic.away,
      over25: analytic.over25,
      under25: 1 - analytic.over25,
      btts: analytic.btts,
      nobtts: 1 - analytic.btts,
    };
    return {
      lambdaHome,
      lambdaAway,
      eloHomeWinExpectancy: pHome,
      model,
      analytic,
      monteCarlo: mc,
      topScores: mc.topScores,
    };
  } catch {
    return {
      lambdaHome: null, lambdaAway: null, eloHomeWinExpectancy: null,
      model: { home: null, draw: null, away: null }, analytic: null,
      monteCarlo: null, topScores: [],
    };
  }
}

// ── Value vs market ────────────────────────────────────────────────────────────────
// Compare model probabilities against the DE-VIGGED (fair) market probabilities. Edge = model −
// market. A positive edge means the model thinks the outcome is MORE likely than the fair line
// implies → "value". This mirrors odds-education.mjs's edge framing but the other way round (model,
// not book). Education only.

/**
 * Flag value: for each shared outcome, edge = modelProb − marketProb (de-vigged).
 * @param {object} modelProbs — { outcome: prob 0..1 } (e.g. predictMatch().model).
 * @param {object} marketDevigged — { outcome: prob 0..1 } (e.g. bookOverround().true).
 * @param {number} [threshold=0.03] — minimum positive edge to flag as value (3 percentage points).
 * @returns {{byOutcome:{[o]:{model,market,edge,edgePct,value:boolean,side}}, flagged:string[], note:string}}
 * Soft-fail → empty result. PURE.
 */
export function valueVsMarket(modelProbs, marketDevigged, threshold = 0.03) {
  const mp = modelProbs && typeof modelProbs === 'object' ? modelProbs : {};
  const mk = marketDevigged && typeof marketDevigged === 'object' ? marketDevigged : {};
  const th = Number.isFinite(Number(threshold)) ? Math.abs(Number(threshold)) : 0.03;
  const outcomes = Array.from(new Set([...Object.keys(mp), ...Object.keys(mk)]));
  const byOutcome = {};
  const flagged = [];
  for (const o of outcomes) {
    const model = Number.isFinite(Number(mp[o])) ? Number(mp[o]) : null;
    const market = Number.isFinite(Number(mk[o])) ? Number(mk[o]) : null;
    const edge = model != null && market != null ? model - market : null;
    const value = edge != null && edge >= th;
    byOutcome[o] = {
      model,
      market,
      edge,
      edgePct: edge != null ? edge * 100 : null,
      value,
      side: edge == null ? null : edge > 0 ? 'model-high' : 'model-low',
    };
    if (value) flagged.push(o);
  }
  const note = flagged.length
    ? `Model estimate, not advice. Outcomes where the model exceeds the fair (de-vigged) line by ` +
      `≥${(th * 100).toFixed(1)}pp: ${flagged.join(', ')}. This is an analytics comparison, not a bet signal.`
    : 'Model estimate, not advice. No outcome clears the value threshold against the de-vigged line.';
  return { byOutcome, flagged, note };
}

// ── CLI demo ────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('odds-sim.mjs')) {
  // A home favourite (1600) vs a weaker away side (1480). Deterministic via seeded LCG.
  const pred = predictMatch({ homeElo: 1600, awayElo: 1480, homeAdv: 60, rho: -0.05, n: 20000, rng: makeLcg(42) });
  console.log('== MODEL PREDICTION (model estimate, not advice) ==');
  console.log(`  lambda home ${pred.lambdaHome.toFixed(3)}  lambda away ${pred.lambdaAway.toFixed(3)}  (Elo home win-exp ${(pred.eloHomeWinExpectancy * 100).toFixed(1)}%)`);
  console.log('  Analytic (Dixon-Coles matrix):');
  console.log(`    1X2  H ${(pred.model.home * 100).toFixed(1)}%  D ${(pred.model.draw * 100).toFixed(1)}%  A ${(pred.model.away * 100).toFixed(1)}%`);
  console.log(`    O/U 2.5  Over ${(pred.model.over25 * 100).toFixed(1)}%  Under ${(pred.model.under25 * 100).toFixed(1)}%`);
  console.log(`    BTTS  Yes ${(pred.model.btts * 100).toFixed(1)}%  No ${(pred.model.nobtts * 100).toFixed(1)}%`);
  console.log('  Monte-Carlo (20k sims):');
  console.log(`    1X2  H ${(pred.monteCarlo.home * 100).toFixed(1)}%  D ${(pred.monteCarlo.draw * 100).toFixed(1)}%  A ${(pred.monteCarlo.away * 100).toFixed(1)}%`);
  console.log('    Top scorelines: ' + pred.topScores.map((s) => `${s.score} (${(s.prob * 100).toFixed(1)}%)`).join('  '));

  // Compare vs a sample de-vigged market (fair probs that would come from bookOverround().true).
  // Only the 1X2 market is supplied here, so we compare the matching subset of model probs.
  const market = { home: 0.50, draw: 0.27, away: 0.23 };
  const model1x2 = { home: pred.model.home, draw: pred.model.draw, away: pred.model.away };
  const v = valueVsMarket(model1x2, market, 0.03);
  console.log('\n== VALUE vs DE-VIGGED MARKET ==');
  for (const [o, d] of Object.entries(v.byOutcome)) {
    console.log(`  ${o.padEnd(6)} model ${(d.model * 100).toFixed(1)}%  market ${(d.market * 100).toFixed(1)}%  edge ${d.edgePct.toFixed(1)}pp${d.value ? '  <- VALUE' : ''}`);
  }
  console.log('  ' + v.note);
}
