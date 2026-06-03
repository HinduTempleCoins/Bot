// compute-cite.test.mjs — offline tests for Hathor's compute-and-cite core.
// Network engines are stubbed via __setFetch; the local CAS runs fully in-process (no network).
// Run: node --test integrations/compute-cite.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate, oeisLookup, newton, numberFact, computeAndCite, NEWTON_OPS, __setFetch,
} from './compute-cite.mjs';

// ── local CAS parser (≥10 tests: arithmetic, precedence, parens, functions, errors, injection) ──────

test('CAS: basic addition with provenance stamp', () => {
  const r = evaluate('2 + 3');
  assert.equal(r.value, 5);
  assert.equal(r.method, 'local-cas');
  assert.equal(r.confidence, 1);
  assert.match(r.source, /local CAS/);
});

test('CAS: operator precedence — multiplication binds tighter than addition', () => {
  assert.equal(evaluate('2 + 3 * 4').value, 14);
  assert.equal(evaluate('2 * 3 + 4').value, 10);
});

test('CAS: parentheses override precedence', () => {
  assert.equal(evaluate('(2 + 3) * 4').value, 20);
  assert.equal(evaluate('2 * (3 + 4) * (1 + 1)').value, 28);
});

test('CAS: exponentiation is right-associative', () => {
  assert.equal(evaluate('2 ^ 3 ^ 2').value, 512); // 2^(3^2), not (2^3)^2=64
  assert.equal(evaluate('2 ^ 10').value, 1024);
});

test('CAS: unary minus and mixed signs', () => {
  assert.equal(evaluate('-5 + 3').value, -2);
  assert.equal(evaluate('-(2 + 3)').value, -5);
  assert.equal(evaluate('3 - -2').value, 5);
});

test('CAS: whitelisted functions compute correctly', () => {
  assert.equal(evaluate('sqrt(16)').value, 4);
  assert.equal(evaluate('abs(-7)').value, 7);
  assert.equal(evaluate('log(1000)').value, 3);
  assert.ok(Math.abs(evaluate('ln(e)').value - 1) < 1e-12);
  assert.ok(Math.abs(evaluate('cos(0)').value - 1) < 1e-12);
  assert.ok(Math.abs(evaluate('sin(0)').value) < 1e-12);
});

test('CAS: nested expressions with functions and constants', () => {
  assert.equal(evaluate('2 + 3 * sqrt(16)').value, 14);
  assert.ok(Math.abs(evaluate('2 * pi').value - 2 * Math.PI) < 1e-12);
});

test('CAS: division by zero soft-fails (confidence 0, no throw)', () => {
  const r = evaluate('1 / 0');
  assert.equal(r.value, null);
  assert.equal(r.confidence, 0);
  assert.match(r.error, /division by zero/);
});

test('CAS: sqrt of a negative soft-fails rather than returning NaN', () => {
  const r = evaluate('sqrt(-4)');
  assert.equal(r.value, null);
  assert.equal(r.confidence, 0);
  assert.match(r.error, /negative/);
});

test('CAS: REJECTS injection — JS code, assignment, semicolons, property access', () => {
  for (const bad of [
    'process.exit(1)',
    'globalThis',
    'constructor',
    '1; rm -rf /',
    'x = 5',
    'require("fs")',
    '2 + alert(1)',
    '__proto__',
    'this.foo',
  ]) {
    const r = evaluate(bad);
    assert.equal(r.value, null, `expected null value for "${bad}"`);
    assert.equal(r.confidence, 0, `expected confidence 0 for "${bad}"`);
    assert.ok(r.error, `expected an error for "${bad}"`);
  }
});

test('CAS: rejects unknown function names but allows whitelisted ones', () => {
  assert.equal(evaluate('tan(0)').confidence, 0);      // tan not whitelisted
  assert.equal(evaluate('foo(1)').confidence, 0);
  assert.equal(evaluate('sqrt(4)').confidence, 1);
});

test('CAS: rejects malformed input (trailing operators, empty, bad numbers)', () => {
  assert.equal(evaluate('2 +').confidence, 0);
  assert.equal(evaluate('').confidence, 0);
  assert.equal(evaluate('2 2').confidence, 0);   // trailing input
  assert.equal(evaluate('1.2.3').confidence, 0); // malformed number
  assert.equal(evaluate(')(' ).confidence, 0);
});

test('CAS: scientific notation parses', () => {
  assert.equal(evaluate('1e3').value, 1000);
  assert.equal(evaluate('2.5e-1 * 4').value, 1);
});

// ── OEIS (stubbed) ─────────────────────────────────────────────────────────────────────────────────

function oeisFetch(results) {
  return async () => ({ ok: true, json: async () => ({ results }) });
}

test('oeisLookup identifies a sequence and cites the A-number', async () => {
  __setFetch(oeisFetch([
    { number: 45, name: 'Fibonacci numbers', data: '0,1,1,2,3,5,8' },
  ]));
  const r = await oeisLookup([1, 1, 2, 3, 5, 8]);
  __setFetch(null);
  assert.equal(r.method, 'oeis');
  assert.equal(r.confidence, 1);
  assert.equal(r.value, 'A000045');
  assert.equal(r.results[0].url, 'https://oeis.org/A000045');
  assert.match(r.results[0].name, /Fibonacci/);
});

test('oeisLookup soft-fails to confidence 0 on no match / network error', async () => {
  __setFetch(oeisFetch([]));
  let r = await oeisLookup([7, 7, 7]);
  assert.equal(r.confidence, 0);
  assert.equal(r.value, null);
  __setFetch(async () => { throw new Error('down'); });
  r = await oeisLookup([1, 2, 3]);
  __setFetch(null);
  assert.equal(r.confidence, 0);
});

test('oeisLookup rejects an empty / non-numeric sequence', async () => {
  const r = await oeisLookup('abc xyz');
  assert.equal(r.confidence, 0);
  assert.match(r.error, /empty/);
});

// ── Newton (stubbed) ───────────────────────────────────────────────────────────────────────────────

test('newton returns a symbolic result with provenance', async () => {
  __setFetch(async (url) => {
    assert.match(String(url), /newtonmath\.xyz\/v2\/derive/);
    return { ok: true, json: async () => ({ operation: 'derive', expression: 'x^2', result: '2 x' }) };
  });
  const r = await newton('derive', 'x^2');
  __setFetch(null);
  assert.equal(r.method, 'newton');
  assert.equal(r.value, '2 x');
  assert.equal(r.confidence, 1);
});

test('newton rejects an unsupported operation without calling the network', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  const r = await newton('teleport', 'x');
  __setFetch(null);
  assert.equal(called, false);
  assert.equal(r.confidence, 0);
  assert.ok(NEWTON_OPS.has('integrate'));
});

test('newton soft-fails to confidence 0 on network error', async () => {
  __setFetch(async () => { throw new Error('down'); });
  const r = await newton('simplify', '1 + 1');
  __setFetch(null);
  assert.equal(r.confidence, 0);
  assert.equal(r.value, null);
});

// ── Numbers API (stubbed) ──────────────────────────────────────────────────────────────────────────

test('numberFact returns flavor at capped confidence 0.5', async () => {
  __setFetch(async () => ({ ok: true, text: async () => '42 is the answer to everything' }));
  const r = await numberFact(42);
  __setFetch(null);
  assert.equal(r.method, 'numbers');
  assert.equal(r.confidence, 0.5); // flavor, never authoritative
  assert.match(r.value, /42/);
  assert.equal(r.number, 42);
});

test('numberFact soft-fails on a non-number / error', async () => {
  let r = await numberFact('not-a-number');
  assert.equal(r.confidence, 0);
  __setFetch(async () => { throw new Error('down'); });
  r = await numberFact(7);
  __setFetch(null);
  assert.equal(r.confidence, 0);
});

// ── dispatcher ─────────────────────────────────────────────────────────────────────────────────────

test('computeAndCite routes by kind and always stamps provenance', async () => {
  const expr = await computeAndCite({ kind: 'expression', input: '6 * 7' });
  assert.equal(expr.value, 42);
  assert.equal(expr.method, 'local-cas');

  const unknown = await computeAndCite({ kind: 'wat' });
  assert.equal(unknown.confidence, 0);
  assert.ok(unknown.source);
});
