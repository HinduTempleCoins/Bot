// compute-core.test.mjs — offline tests for Hathor's computational & scientific layer (v3 §12).
// Fully offline: the local path never touches the network; wolframFallback is exercised with no key.
// Run: node --test integrations/compute-core.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  compute, convertUnit, verifyClaim, constant, CONSTANTS, wolframFallback, dataNote,
} from './compute-core.mjs';

// ── compute(): order of operations, parens, sqrt, pi, errors ─────────────────────────────────────────

test('compute: order of operations — multiplication binds tighter than addition', () => {
  const r = compute('2 + 3 * 4');
  assert.equal(r.ok, true);
  assert.equal(r.value, 14);
  assert.match(r.note, /computed locally/);
});

test('compute: parentheses override precedence', () => {
  assert.equal(compute('(2 + 3) * 4').value, 20);
  assert.equal(compute('2 * (3 + 4) * (1 + 1)').value, 28);
});

test('compute: sqrt and pi', () => {
  assert.equal(compute('sqrt(16)').value, 4);
  assert.equal(compute('2 + 3 * sqrt(16)').value, 14);
  assert.ok(Math.abs(compute('pi').value - Math.PI) < 1e-12);
  assert.ok(Math.abs(compute('2 * pi').value - 2 * Math.PI) < 1e-12);
});

test('compute: exponent right-associative, modulo, unary minus', () => {
  assert.equal(compute('2 ^ 3 ^ 2').value, 512);
  assert.equal(compute('10 % 3').value, 1);
  assert.equal(compute('-(2 + 3)').value, -5);
  assert.equal(compute('3 - -2').value, 5);
});

test('compute: variadic min/max', () => {
  assert.equal(compute('max(3, 7, 2)').value, 7);
  assert.equal(compute('min(3, 7, 2)').value, 2);
});

test('compute: includes steps when requested', () => {
  const r = compute('2 + 3', { steps: true });
  assert.ok(Array.isArray(r.steps));
  assert.ok(r.steps.length >= 3);
});

test('compute: rejects an unbalanced expression without throwing', () => {
  const r = compute('(2 + 3');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('compute: rejects garbage without throwing', () => {
  for (const bad of ['', '2 +', '@#$', 'foo(2)', 'process.exit(1)', '2 + + + 3 )']) {
    const r = compute(bad);
    assert.equal(r.ok, false, `expected ok:false for "${bad}"`);
    assert.ok(r.error);
  }
});

test('compute: division by zero is a soft error, not a throw', () => {
  const r = compute('1 / 0');
  assert.equal(r.ok, false);
  assert.match(r.error, /division by zero/);
});

// ── NO eval / NO new Function — verified by grepping the source itself ────────────────────────────────

test('source contains no eval() and no new Function()', () => {
  const src = readFileSync(fileURLToPath(new URL('./compute-core.mjs', import.meta.url)), 'utf8');
  assert.ok(!src.includes('eval('), 'compute-core.mjs must not contain eval(');
  assert.ok(!src.includes('new Function'), 'compute-core.mjs must not contain new Function');
  assert.ok(!/\bFunction\s*\(/.test(src), 'compute-core.mjs must not call Function(...)');
});

// ── CONSTANTS — NIST CODATA with sources ─────────────────────────────────────────────────────────────

test('CONSTANTS has c, h, NA with values, units, and sources', () => {
  assert.equal(CONSTANTS.c.value, 299792458);
  assert.equal(CONSTANTS.c.unit, 'm/s');
  assert.match(CONSTANTS.c.source, /CODATA/);
  assert.ok(Math.abs(CONSTANTS.h.value - 6.62607015e-34) < 1e-44);
  assert.match(CONSTANTS.h.source, /CODATA/);
  assert.ok(Math.abs(CONSTANTS.NA.value - 6.02214076e23) < 1e13);
  assert.match(CONSTANTS.NA.source, /CODATA/);
  // every constant carries units + a source tag
  for (const [k, v] of Object.entries(CONSTANTS)) {
    assert.ok(v.unit, `${k} missing unit`);
    assert.match(v.source, /CODATA/, `${k} missing CODATA source`);
  }
});

test('constant() looks up by key, by symbol, and soft-fails on unknown', () => {
  assert.equal(constant('c').value, 299792458);
  assert.equal(constant('N_A').value, CONSTANTS.NA.value);
  assert.equal(constant('nonsense'), null);
  assert.equal(constant(undefined), null);
});

// ── convertUnit ──────────────────────────────────────────────────────────────────────────────────────

test('convertUnit: km → mi', () => {
  const r = convertUnit(5, 'km', 'mi');
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.value - 3.106855) < 1e-4);
  assert.equal(r.category, 'length');
});

test('convertUnit: C → F (and back)', () => {
  const r = convertUnit(100, 'C', 'F');
  assert.equal(r.ok, true);
  assert.equal(r.value, 212);
  assert.equal(convertUnit(32, 'F', 'C').value, 0);
  assert.ok(Math.abs(convertUnit(0, 'C', 'K').value - 273.15) < 1e-9);
});

test('convertUnit: mass and data categories', () => {
  assert.ok(Math.abs(convertUnit(1, 'kg', 'g').value - 1000) < 1e-9);
  assert.equal(convertUnit(1, 'MB', 'kb').value, 1024);
});

test('convertUnit: soft-fails on unknown unit and on category mismatch', () => {
  const bad = convertUnit(5, 'km', 'kg');
  assert.equal(bad.ok, false);
  const unknown = convertUnit(5, 'km', 'flibbers');
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unknown unit/);
  const nan = convertUnit('not-a-number', 'km', 'mi');
  assert.equal(nan.ok, false);
});

// ── verifyClaim — the anti-hallucination check ───────────────────────────────────────────────────────

test('verifyClaim: catches "2 + 2 = 5" as matches:false', () => {
  const r = verifyClaim('2 + 2 = 5');
  assert.equal(r.ok, true);
  assert.equal(r.matches, false);
  assert.equal(r.computed, 4);
  assert.equal(r.stated, 5);
  assert.equal(r.confidence, 0);
});

test('verifyClaim: confirms "2 + 2 = 4" as matches:true', () => {
  const r = verifyClaim('2 + 2 = 4');
  assert.equal(r.ok, true);
  assert.equal(r.matches, true);
  assert.equal(r.computed, 4);
  assert.equal(r.confidence, 1);
});

test('verifyClaim: handles percent claims', () => {
  const good = verifyClaim('25% of 200 is 50');
  assert.equal(good.matches, true);
  const bad = verifyClaim('25% of 200 is 60');
  assert.equal(bad.matches, false);
});

test('verifyClaim: no checkable claim → soft ok:false', () => {
  const r = verifyClaim('the sky is blue');
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

// ── wolframFallback — env name only, no-app-id when unset ─────────────────────────────────────────────

test('wolframFallback: returns no-app-id when WOLFRAM_APP_ID is unset', async () => {
  const r = await wolframFallback('integrate x^2', { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-app-id');
});

test('wolframFallback: never throws, even with no fetch and a key set', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => 'x^3/3 + C' });
  const r = await wolframFallback('integrate x^2', { env: { WOLFRAM_APP_ID: 'TEST-ID' }, fetch: fakeFetch });
  assert.equal(r.ok, true);
  assert.match(r.value, /x\^3/);
  assert.match(r.source, /Wolfram/);
});

test('wolframFallback: soft-fails when the request fails', async () => {
  const failFetch = async () => { throw new Error('network down'); };
  const r = await wolframFallback('integrate x^2', { env: { WOLFRAM_APP_ID: 'TEST-ID' }, fetch: failFetch });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'request-failed');
});

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────────

test('dataNote names local compute and NIST CODATA', () => {
  assert.match(dataNote(), /computed locally/);
  assert.match(dataNote(), /CODATA/);
});
