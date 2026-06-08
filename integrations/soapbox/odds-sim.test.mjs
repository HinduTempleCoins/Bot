// odds-sim.test.mjs — offline tests for the sports-odds simulation engine. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeLcg,
  eloExpectedScore,
  eloUpdate,
  poissonPmf,
  expectedGoalsFromElo,
  dixonColesTau,
  scoreMatrixProb,
  monteCarloMatch,
  predictMatch,
  valueVsMarket,
} from './odds-sim.mjs';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('makeLcg is deterministic for a seed and varies across seeds', () => {
  const a1 = makeLcg(123);
  const a2 = makeLcg(123);
  for (let i = 0; i < 5; i++) assert.equal(a1(), a2());
  const b = makeLcg(124);
  const r1 = makeLcg(123)();
  const r2 = b();
  assert.notEqual(r1, r2);
  const r = makeLcg(7);
  for (let i = 0; i < 100; i++) {
    const u = r();
    assert.ok(u >= 0 && u < 1);
  }
});

test('poissonPmf sums to ~1 over k=0..40 for several lambdas', () => {
  for (const lam of [0.3, 1.0, 1.35, 2.5, 4.0]) {
    let s = 0;
    for (let k = 0; k <= 40; k++) s += poissonPmf(k, lam);
    assert.ok(close(s, 1, 1e-6), `lambda=${lam} sum=${s}`);
  }
});

test('poissonPmf soft-fails on bad input and handles lambda=0', () => {
  assert.equal(poissonPmf(-1, 1), 0);
  assert.equal(poissonPmf(2, -1), 0);
  assert.equal(poissonPmf('x', 1), 0);
  assert.equal(poissonPmf(0, 0), 1);
  assert.equal(poissonPmf(3, 0), 0);
});

test('eloExpectedScore: equal ratings → 0.5, symmetry E_A+E_B=1, monotone, bounded', () => {
  assert.ok(close(eloExpectedScore(1500, 1500, 0), 0.5));
  const eA = eloExpectedScore(1600, 1450, 0);
  const eB = eloExpectedScore(1450, 1600, 0);
  assert.ok(close(eA + eB, 1, 1e-9));
  // favourite > 0.5, underdog < 0.5
  assert.ok(eA > 0.5 && eB < 0.5);
  // home advantage raises home expectancy
  assert.ok(eloExpectedScore(1500, 1500, 80) > 0.5);
  // bounds
  const hi = eloExpectedScore(3000, 1000, 0);
  const lo = eloExpectedScore(1000, 3000, 0);
  assert.ok(hi > 0 && hi < 1 && lo > 0 && lo < 1);
  assert.ok(hi > 0.99 && lo < 0.01);
});

test('eloExpectedScore soft-fails to 0.5', () => {
  assert.equal(eloExpectedScore('a', 1500), 0.5);
});

test('eloUpdate moves rating toward result and soft-fails', () => {
  const r = 1500;
  const e = eloExpectedScore(1500, 1500, 0); // 0.5
  const win = eloUpdate(r, 1, e, 20);
  const loss = eloUpdate(r, 0, e, 20);
  assert.ok(win > r, 'win raises rating');
  assert.ok(loss < r, 'loss lowers rating');
  assert.ok(close(win - r, 10) && close(r - loss, 10), 'K=20, half-point surprise → ±10');
  // draw at expected 0.5 → no change
  assert.ok(close(eloUpdate(r, 0.5, 0.5, 20), r));
  // soft-fail returns old rating
  assert.equal(eloUpdate(1500, 'x', 0.5, 20), 1500);
});

test('expectedGoalsFromElo: favourite lambda > underdog, baseline at parity', () => {
  const parity = expectedGoalsFromElo({ homeElo: 1500, awayElo: 1500, homeAdv: 0 });
  assert.ok(close(parity.lambdaHome, parity.lambdaAway, 1e-9));
  const fav = expectedGoalsFromElo({ homeElo: 1700, awayElo: 1400, homeAdv: 60 });
  assert.ok(fav.lambdaHome > fav.lambdaAway);
  assert.ok(fav.lambdaHome > 0 && fav.lambdaAway > 0);
  // soft-fail still returns numbers
  const bad = expectedGoalsFromElo({ homeElo: 'x', awayElo: 'y' });
  assert.ok(Number.isFinite(bad.lambdaHome) && Number.isFinite(bad.lambdaAway));
});

test('dixonColesTau adjusts ONLY the four low scores, identity elsewhere', () => {
  const lh = 1.4;
  const la = 1.1;
  const rho = -0.05;
  // low-score cells are corrected (tau != 1)
  assert.ok(dixonColesTau(0, 0, lh, la, rho) !== 1);
  assert.ok(dixonColesTau(0, 1, lh, la, rho) !== 1);
  assert.ok(dixonColesTau(1, 0, lh, la, rho) !== 1);
  assert.ok(dixonColesTau(1, 1, lh, la, rho) !== 1);
  // everything else is exactly 1
  for (const [i, j] of [[2, 0], [0, 2], [2, 2], [3, 1], [1, 3], [5, 5]]) {
    assert.equal(dixonColesTau(i, j, lh, la, rho), 1, `(${i},${j}) should be untouched`);
  }
  // rho=0 → no correction anywhere
  for (const [i, j] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    assert.ok(close(dixonColesTau(i, j, lh, la, 0), 1));
  }
  // soft-fail
  assert.equal(dixonColesTau(0, 0, 'x', la, rho), 1);
});

test('scoreMatrixProb sums to ~1 and is empty on bad input', () => {
  const m = scoreMatrixProb(1.6, 1.1, -0.05, 10);
  let s = 0;
  for (const row of m) for (const p of row) s += p;
  assert.ok(close(s, 1, 1e-9), `matrix sum=${s}`);
  assert.deepEqual(scoreMatrixProb('x', 1.1), []);
});

test('scoreMatrixProb DC correction changes only low-score region vs plain Poisson', () => {
  const plain = scoreMatrixProb(1.5, 1.2, 0); // rho=0 → no correction (still normalized)
  const dc = scoreMatrixProb(1.5, 1.2, -0.06);
  // a high score like 3-2 should have ~identical normalized prob ratio shape; low scores differ.
  assert.ok(Math.abs(dc[0][0] - plain[0][0]) > 1e-4, '0-0 should shift under DC');
  assert.ok(Math.abs(dc[3][2] - plain[3][2]) < 1e-3, '3-2 essentially unchanged');
});

test('monteCarloMatch with a fixed seed gives stable probabilities summing to ~1', () => {
  const a = monteCarloMatch(1.6, 1.1, -0.05, 5000, makeLcg(2026));
  const b = monteCarloMatch(1.6, 1.1, -0.05, 5000, makeLcg(2026));
  // reproducible
  assert.equal(a.home, b.home);
  assert.equal(a.draw, b.draw);
  assert.equal(a.away, b.away);
  assert.equal(a.over25, b.over25);
  assert.equal(a.btts, b.btts);
  // 1X2 sums to 1
  assert.ok(close(a.home + a.draw + a.away, 1, 1e-9));
  // all probabilities in [0,1]
  for (const v of [a.home, a.draw, a.away, a.over25, a.btts]) assert.ok(v >= 0 && v <= 1);
  // favourite (home) wins most often here
  assert.ok(a.home > a.away);
  // top scores present and sorted descending
  assert.ok(a.topScores.length > 0);
  for (let i = 1; i < a.topScores.length; i++) {
    assert.ok(a.topScores[i - 1].prob >= a.topScores[i].prob);
  }
});

test('monteCarloMatch soft-fails to zeros on bad input', () => {
  const z = monteCarloMatch('x', 1, -0.05, 100, makeLcg(1));
  assert.equal(z.home, 0);
  assert.equal(z.n, 100);
  const zero = monteCarloMatch(1.3, 1.3, -0.05, 0, makeLcg(1));
  assert.equal(zero.home, 0);
});

test('monteCarlo converges close to the analytic Dixon-Coles matrix', () => {
  const lh = 1.5;
  const la = 1.0;
  const rho = -0.05;
  const m = scoreMatrixProb(lh, la, rho);
  let aHome = 0;
  let aDraw = 0;
  let aAway = 0;
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m[i].length; j++) {
      if (i > j) aHome += m[i][j];
      else if (i === j) aDraw += m[i][j];
      else aAway += m[i][j];
    }
  }
  const mc = monteCarloMatch(lh, la, rho, 40000, makeLcg(99));
  assert.ok(Math.abs(mc.home - aHome) < 0.02, `home mc=${mc.home} analytic=${aHome}`);
  assert.ok(Math.abs(mc.draw - aDraw) < 0.02, `draw mc=${mc.draw} analytic=${aDraw}`);
  assert.ok(Math.abs(mc.away - aAway) < 0.02, `away mc=${mc.away} analytic=${aAway}`);
});

test('predictMatch ties it together; probabilities valid and normalized', () => {
  const p = predictMatch({ homeElo: 1600, awayElo: 1480, homeAdv: 60, rho: -0.05, n: 3000, rng: makeLcg(7) });
  assert.ok(p.lambdaHome > 0 && p.lambdaAway > 0);
  assert.ok(close(p.model.home + p.model.draw + p.model.away, 1, 1e-9));
  assert.ok(close(p.model.over25 + p.model.under25, 1, 1e-9));
  assert.ok(close(p.model.btts + p.model.nobtts, 1, 1e-9));
  assert.ok(p.model.home > p.model.away, 'home favourite');
  assert.ok(Array.isArray(p.topScores) && p.topScores.length > 0);
  // soft-fail on garbage input still returns a shaped object
  const bad = predictMatch({});
  assert.ok(bad.model && typeof bad.model === 'object');
});

test('valueVsMarket flags a known edge and respects threshold', () => {
  // model strongly favours home vs a de-vigged market that is more even.
  const model = { home: 0.60, draw: 0.22, away: 0.18 };
  const market = { home: 0.50, draw: 0.27, away: 0.23 };
  const v = valueVsMarket(model, market, 0.03);
  assert.deepEqual(v.flagged, ['home']); // home edge = +10pp ≥ 3pp; draw/away negative
  assert.ok(close(v.byOutcome.home.edge, 0.10, 1e-9));
  assert.equal(v.byOutcome.home.value, true);
  assert.equal(v.byOutcome.draw.value, false);
  assert.equal(v.byOutcome.away.side, 'model-low');
  assert.match(v.note, /not advice/);

  // raise threshold above the edge → nothing flagged
  const v2 = valueVsMarket(model, market, 0.15);
  assert.deepEqual(v2.flagged, []);
});

test('valueVsMarket soft-fails on missing/garbage input', () => {
  const v = valueVsMarket(null, null);
  assert.deepEqual(v.flagged, []);
  assert.match(v.note, /not advice/);
  const v2 = valueVsMarket({ home: 'x' }, { home: 0.5 });
  assert.equal(v2.byOutcome.home.model, null);
  assert.equal(v2.byOutcome.home.value, false);
});
