// work-gate.test.mjs — offline tests for the PRANA AI-work gate verifier.
// node --test integrations/work-gate.test.mjs   (no network, deterministic)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, digest, consensus, recompute, verifyEpoch } from './work-gate.mjs';

test('canonicalize is key-order independent', () => {
  assert.equal(canonicalize({ a: 1, b: 2 }), canonicalize({ b: 2, a: 1 }));
  assert.equal(digest({ x: [1, 2], y: 3 }), digest({ y: 3, x: [1, 2] }));
});

test('canonicalize distinguishes different values', () => {
  assert.notEqual(digest({ a: 1 }), digest({ a: 2 }));
  assert.notEqual(digest([1, 2, 3]), digest([3, 2, 1]));
});

test('consensus: a clear majority is reached, the odd one out dissents', () => {
  const c = consensus([
    { pool: 'A', result: { pi: 3.14159 } },
    { pool: 'B', result: { pi: 3.14159 } },
    { pool: 'C', result: { pi: 3.14 } },
  ], { threshold: 0.5 });
  assert.equal(c.reached, true);
  assert.deepEqual(c.agree.sort(), ['A', 'B']);
  assert.deepEqual(c.dissent, ['C']);
});

test('consensus: a lone result never reaches consensus (need >=2 agreeing)', () => {
  const c = consensus([{ pool: 'A', result: 1 }], { threshold: 0.5 });
  assert.equal(c.reached, false);
  assert.equal(c.hash, null);
});

test('consensus: below-threshold plurality is not reached', () => {
  // 2 of 5 agree = 0.4 < 0.6 threshold
  const c = consensus([
    { pool: 'A', result: 1 }, { pool: 'B', result: 1 },
    { pool: 'C', result: 2 }, { pool: 'D', result: 3 }, { pool: 'E', result: 4 },
  ], { threshold: 0.6 });
  assert.equal(c.reached, false);
});

test('consensus: soft-fails on junk input without throwing', () => {
  assert.equal(consensus(null).reached, false);
  assert.equal(consensus(undefined).total, 0);
  assert.equal(consensus([{ result: 1 }]).total, 0); // no pool field → filtered out
});

test('recompute: sum and mean are exact', () => {
  assert.deepEqual(recompute({ type: 'sum', inputs: [1, 2, 3, 4] }), { ok: true, result: 10 });
  assert.deepEqual(recompute({ type: 'mean', inputs: [2, 4, 6] }), { ok: true, result: 4 });
});

test('recompute: montecarlo-pi is reproducible for a fixed seed', () => {
  const a = recompute({ type: 'montecarlo-pi', seed: 42, iters: 5000 });
  const b = recompute({ type: 'montecarlo-pi', seed: 42, iters: 5000 });
  assert.equal(a.ok, true);
  assert.equal(a.result, b.result);            // bitwise-identical recompute
  assert.ok(Math.abs(a.result - Math.PI) < 0.2); // in the right ballpark
  // a different seed gives a different sample
  const c = recompute({ type: 'montecarlo-pi', seed: 7, iters: 5000 });
  assert.notEqual(a.result, c.result);
});

test('recompute: bad/unsupported specs soft-fail', () => {
  assert.equal(recompute({ type: 'sum', inputs: ['x'] }).ok, false);
  assert.equal(recompute({ type: 'nope' }).ok, false);
  assert.equal(recompute(null).ok, false);
});

test('verifyEpoch: honest majority earns the weight, dissenter earns nothing', () => {
  const spec = { type: 'montecarlo-pi', seed: 42, iters: 20000 };
  const truth = recompute(spec).result;
  const out = verifyEpoch({ jobs: [{
    id: 'pi', weight: 10, spec,
    submissions: [
      { pool: 'A', result: truth },
      { pool: 'B', result: truth },
      { pool: 'C', result: 3.14 },
    ],
  }] });
  assert.equal(out.verified, 1);
  assert.equal(out.rejected, 0);
  assert.equal(out.units.A, 10);
  assert.equal(out.units.B, 10);
  assert.equal(out.units.C, undefined); // lazy/wrong pool gets no work-units
  assert.equal(out.perJob[0].recompute, 'matches-recompute');
});

test('verifyEpoch: a colluding majority that disagrees with the recompute is rejected', () => {
  const spec = { type: 'sum', inputs: [1, 2, 3] }; // truth = 6
  const out = verifyEpoch({ jobs: [{
    id: 'sum', weight: 5, spec,
    submissions: [
      { pool: 'A', result: 999 }, // majority, but wrong
      { pool: 'B', result: 999 },
      { pool: 'C', result: 6 },   // correct, but outvoted
    ],
  }] });
  assert.equal(out.verified, 0);
  assert.equal(out.rejected, 1);
  assert.deepEqual(out.units, Object.create(null)); // nobody paid when consensus != truth
  assert.equal(out.perJob[0].recompute, 'consensus-differs-from-recompute');
});

test('verifyEpoch: weights accumulate across jobs for a pool', () => {
  const out = verifyEpoch({ jobs: [
    { id: 'j1', weight: 3, submissions: [{ pool: 'A', result: 1 }, { pool: 'B', result: 1 }] },
    { id: 'j2', weight: 4, submissions: [{ pool: 'A', result: 2 }, { pool: 'B', result: 2 }] },
  ] });
  assert.equal(out.units.A, 7);
  assert.equal(out.units.B, 7);
  assert.equal(out.verified, 2);
});

test('verifyEpoch: empty / junk epoch soft-fails to an empty vector', () => {
  assert.deepEqual(verifyEpoch({}).units, Object.create(null));
  assert.equal(verifyEpoch(null).jobs, 0);
});
