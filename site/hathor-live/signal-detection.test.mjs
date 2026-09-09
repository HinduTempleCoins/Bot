import test from 'node:test';
import assert from 'node:assert/strict';
import {
  probit, correctedRate, dPrime2AFC, dPrimeYesNo, binomialTailP, calibration, CONFIDENCE_BINS,
} from './signal-detection.mjs';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg || ''} got ${a}, wanted ${b} ±${tol}`);

// ── the probit, against exactly-known points ─────────────────────────────────────────────────────

test('probit hits the three points whose values are known exactly', () => {
  near(probit(0.5), 0, 1e-12, 'z(0.5)');
  // Φ(1) = 0.8413447460685429, so z of that is 1 by definition.
  near(probit(0.8413447460685429), 1, 1e-7, 'z(Φ(1))');
  near(probit(0.15865525393145707), -1, 1e-7, 'z(Φ(-1))');
  // The textbook 97.5th percentile.
  near(probit(0.975), 1.959963985, 1e-7, 'z(0.975)');
  near(probit(0.95), 1.644853627, 1e-7, 'z(0.95)');
  // Φ(2) = 0.9772498680518208.
  near(probit(0.9772498680518208), 2, 1e-7, 'z(Φ(2))');
});

test('probit is symmetric and refuses to return an infinity', () => {
  for (const p of [0.01, 0.2, 0.4, 0.6, 0.9, 0.99]) near(probit(p), -probit(1 - p), 1e-9, `symmetry at ${p}`);
  for (const bad of [0, 1, -0.1, 1.1, NaN, null, 'x', undefined]) {
    assert.ok(Number.isNaN(probit(bad)), `probit(${bad}) must be NaN, never ±Infinity`);
  }
});

test('probit works far out in the tail, on both branches of the approximation', () => {
  // Below 0.02425 and above 0.97575 the approximation switches branches; both must stay continuous.
  near(probit(0.024249), -probit(0.975751), 1e-6, 'branch boundary symmetry');
  near(probit(0.001), -3.090232306, 1e-6, 'z(0.001)');
});

// ── the extreme-cell correction ──────────────────────────────────────────────────────────────────

test('only the extreme cells are corrected, and the correction is symmetric', () => {
  assert.deepEqual(correctedRate(7, 10), { rate: 0.7, corrected: false });
  // 0 → 0.5/(n+1), n → (n+0.5)/(n+1). Same offset both ends.
  assert.deepEqual(correctedRate(0, 20), { rate: 0.5 / 21, corrected: true });
  assert.deepEqual(correctedRate(20, 20), { rate: 20.5 / 21, corrected: true });
  assert.equal(correctedRate(1, 0).corrected, false);
  assert.ok(Number.isNaN(correctedRate(1, 0).rate));
});

// ── d′, hand-checked ─────────────────────────────────────────────────────────────────────────────

test("2AFC d' = √2·z(pc), hand-checked against a d' of exactly 1", () => {
  // A 2AFC d' of exactly 1 corresponds to pc = Φ(1/√2) = Φ(0.7071067811865476) = 0.7602499389065233.
  const r = dPrime2AFC({ correct: 7602499, total: 10000000 });
  near(r.dPrime, 1, 1e-5, "d' at pc=Φ(1/√2)");
  assert.equal(r.corrected, false);
  near(r.pc, 0.7602499, 1e-6);
  // And chance is exactly zero sensitivity.
  assert.equal(dPrime2AFC({ correct: 50, total: 100 }).dPrime, 0);
  // Φ(2/√2) = Φ(1.41421356) = 0.9213503964748571 → d' of exactly 2.
  near(dPrime2AFC({ correct: 9213503964, total: 10000000000 }).dPrime, 2, 1e-5, "d' = 2");
});

test('a perfect or floor 2AFC run is corrected rather than reported as infinite, and says so', () => {
  const perfect = dPrime2AFC({ correct: 20, total: 20 });
  assert.equal(perfect.corrected, true);
  assert.ok(Number.isFinite(perfect.dPrime));
  // (20+0.5)/21 = 0.976190…, z = 1.980…, d' = √2 × that.
  near(perfect.dPrime, Math.SQRT2 * probit(20.5 / 21), 1e-12);
  assert.equal(perfect.pc, 1, 'the raw proportion correct is still reported honestly');
  const floor = dPrime2AFC({ correct: 0, total: 20 });
  assert.equal(floor.corrected, true);
  assert.ok(floor.dPrime < 0);
  assert.equal(dPrime2AFC({ correct: 3, total: 0 }).ok, false);
  assert.equal(dPrime2AFC({ correct: 11, total: 10 }).ok, false);
});

test("yes/no d' = z(H) − z(F), hand-checked against a d' of exactly 2", () => {
  // H = Φ(1) = 0.8413447461, F = Φ(-1) = 0.1586552539 → d' = 1 − (−1) = 2, criterion 0.
  const r = dPrimeYesNo({
    hits: 8413447461, signalTrials: 10000000000,
    falseAlarms: 1586552539, noiseTrials: 10000000000,
  });
  near(r.dPrime, 2, 1e-5, "d' with H=Φ(1), F=Φ(-1)");
  near(r.criterion, 0, 1e-5, 'an unbiased criterion');
  assert.equal(r.corrected, false);
  // A biased observer: H = Φ(2) = 0.97724987, F = Φ(0) = 0.5 → d' = 2, c = −1.
  const biased = dPrimeYesNo({
    hits: 9772498681, signalTrials: 10000000000, falseAlarms: 5000000000, noiseTrials: 10000000000,
  });
  near(biased.dPrime, 2, 1e-5, "same d', different criterion");
  near(biased.criterion, -1, 1e-5, 'a liberal criterion');
});

test('the two formulae are documented as different and give different numbers on the same pc', () => {
  // The exact mistake this file exists to prevent: applying the yes/no formula to 2AFC data.
  const pc = 0.76;
  const twoAfc = Math.SQRT2 * probit(pc);
  const wrong = probit(pc) - probit(1 - pc); // = 2·z(pc)
  near(wrong / twoAfc, Math.SQRT2, 1e-9, 'the yes/no formula inflates 2AFC data by √2');
  assert.match(dPrime2AFC({ correct: 76, total: 100 }).formula, /forced-choice/);
  assert.match(dPrimeYesNo({ hits: 8, signalTrials: 10, falseAlarms: 2, noiseTrials: 10 }).formula, /yes\/no/);
});

// ── the binomial tail ────────────────────────────────────────────────────────────────────────────

test('the exact binomial tail matches hand-computed values', () => {
  // P(X ≥ 10 | n=10, p=0.5) = 1/1024.
  near(binomialTailP(10, 10, 0.5), 1 / 1024, 1e-12);
  // P(X ≥ 9 | n=10) = (10 + 1)/1024 = 11/1024.
  near(binomialTailP(9, 10, 0.5), 11 / 1024, 1e-12);
  // P(X ≥ 0) = 1, P(X > n) = 0, and the median of a fair 10 is above 0.5 by symmetry.
  assert.equal(binomialTailP(0, 10, 0.5), 1);
  assert.equal(binomialTailP(11, 10, 0.5), 0);
  near(binomialTailP(5, 10, 0.5), 0.623046875, 1e-12);
  // 20 trials, 15 correct — the number a real sitting might produce.
  near(binomialTailP(15, 20, 0.5), 0.020694732666015625, 1e-12);
  assert.ok(Number.isNaN(binomialTailP(3, 0, 0.5)));
});

test('the binomial tail does not overflow at a size a factorial would', () => {
  const p = binomialTailP(120, 200, 0.5);
  assert.ok(Number.isFinite(p) && p > 0 && p < 1, `got ${p}`);
  // Symmetry identity for a fair coin at even n: P(X≥n/2) = P(X≤n/2) = 1 − P(X≥n/2+1),
  // so the two tails must sum to exactly 1. Nothing here is approximated, so it holds tightly.
  near(binomialTailP(100, 200, 0.5) + binomialTailP(101, 200, 0.5), 1, 1e-9);
});

// ── calibration ──────────────────────────────────────────────────────────────────────────────────

const j = (conf, correct) => ({ confidence: conf, correct });

test('a perfectly calibrated set has zero overconfidence and a low Brier score', () => {
  // Eight trials said at 100% and all right, plus two said at 50% one right one wrong.
  const c = calibration([
    j(100, true), j(100, true), j(100, true), j(100, true),
    j(50, true), j(50, false),
  ]);
  near(c.meanConfidence, (4 * 1 + 2 * 0.5) / 6, 1e-12);
  near(c.accuracy, 5 / 6, 1e-12);
  near(c.overconfidence, 0, 1e-12, 'confidence tracked accuracy exactly');
  // Brier: four zeros, then (0.5-1)² and (0.5-0)² = 0.25 each.
  near(c.brier, (0 + 0 + 0 + 0 + 0.25 + 0.25) / 6, 1e-12);
});

test('the classic overconfident pattern is measured as overconfidence, not as skill', () => {
  const rows = [];
  for (let i = 0; i < 10; i += 1) rows.push(j(90, i < 5)); // says 90%, right half the time
  const c = calibration(rows);
  near(c.meanConfidence, 0.9, 1e-12);
  near(c.accuracy, 0.5, 1e-12);
  near(c.overconfidence, 0.4, 1e-12);
  // Brier: 5×(0.9−1)² + 5×(0.9−0)² over 10 = (5×0.01 + 5×0.81)/10 = 0.41 — worse than always saying 50%.
  near(c.brier, 0.41, 1e-12);
  assert.ok(c.brier > c.brierOfAlwaysFifty, 'confident and wrong must score worse than honestly unsure');
});

test('saying 50 to everything scores exactly 0.25, whatever the accuracy', () => {
  for (const acc of [0, 3, 7, 10]) {
    const rows = [];
    for (let i = 0; i < 10; i += 1) rows.push(j(50, i < acc));
    near(calibration(rows).brier, 0.25, 1e-12, `at ${acc}/10 correct`);
  }
});

test('bins are reported only where there is data, and carry n, said and was-right', () => {
  const c = calibration([j(55, false), j(55, true), j(95, true), j(95, true), j(95, false)]);
  assert.equal(c.bins.length, 2);
  assert.equal(c.bins[0].id, '50-59');
  assert.equal(c.bins[0].n, 2);
  near(c.bins[0].accuracy, 0.5, 1e-12);
  assert.equal(c.bins[1].id, '90-100');
  near(c.bins[1].accuracy, 2 / 3, 1e-12);
  assert.equal(CONFIDENCE_BINS.length, 5);
  assert.equal(CONFIDENCE_BINS[0].lo, 50, 'the floor is 50 because a two-way guess is already half right');
});

test('the Murphy decomposition is returned and flagged as approximate rather than as an identity', () => {
  const c = calibration([j(70, true), j(75, false), j(90, true), j(95, true), j(55, false), j(50, true)]);
  assert.ok(c.reliability >= 0 && c.resolution >= 0);
  near(c.uncertainty, c.accuracy * (1 - c.accuracy), 1e-12);
  assert.equal(c.decompositionIsApproximate, true,
    'binned human confidence is never constant inside a bin, so the identity does not hold exactly');
});

test('junk judgements are dropped, not coerced, and an empty set reports nothing rather than zero', () => {
  const c = calibration([j(70, true), j(40, true), j(101, true), j(NaN, true), null, 'x']);
  assert.equal(c.n, 1, 'only the in-range judgement survived');
  const empty = calibration([]);
  assert.equal(empty.ok, false);
  assert.equal(empty.accuracy, null, 'no data must not read as an accuracy of zero');
  assert.equal(calibration('nope').ok, false);
});
