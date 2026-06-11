import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTokenSpec,
  validateSymbol,
  normalizeSplit,
  defaultSpec,
  esc,
} from './smt-token-spec.mjs';

// --------------------------------------------------------------------------
// validateSymbol
// --------------------------------------------------------------------------

test('validateSymbol accepts a 1..10 uppercase A-Z symbol', () => {
  assert.deepEqual(validateSymbol('MELEK'), { ok: true, errors: [] });
  assert.equal(validateSymbol('A').ok, true);
  assert.equal(validateSymbol('ABCDEFGHIJ').ok, true); // exactly 10
});

test('validateSymbol rejects lowercase and names the canonical form', () => {
  const r = validateSymbol('melek');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('MELEK')));
});

test('validateSymbol rejects too-long, empty, digits, and non-strings', () => {
  assert.equal(validateSymbol('ABCDEFGHIJK').ok, false); // 11 chars
  assert.equal(validateSymbol('').ok, false);
  assert.equal(validateSymbol('MEL3K').ok, false);
  assert.equal(validateSymbol('ME LEK').ok, false);
  const r = validateSymbol(123);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('symbol must be a string'));
});

// --------------------------------------------------------------------------
// normalizeSplit
// --------------------------------------------------------------------------

test('normalizeSplit returns integers summing to 100', () => {
  for (const pct of [0, 25, 50, 75, 100, 33, 67]) {
    const s = normalizeSplit(pct);
    assert.equal(s.author + s.curator, 100, `sum for ${pct}`);
  }
});

test('normalizeSplit clamps out-of-range and rounds fractional input', () => {
  assert.deepEqual(normalizeSplit(-10), { author: 0, curator: 100 });
  assert.deepEqual(normalizeSplit(140), { author: 100, curator: 0 });
  assert.deepEqual(normalizeSplit(49.6), { author: 50, curator: 50 });
});

test('normalizeSplit falls back to default on non-numeric input', () => {
  const s = normalizeSplit('not-a-number');
  assert.equal(s.author + s.curator, 100);
  assert.equal(s.author, 50);
});

// --------------------------------------------------------------------------
// buildTokenSpec — happy path + defaults
// --------------------------------------------------------------------------

test('buildTokenSpec fills defaults for an empty config', () => {
  const r = buildTokenSpec({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.equal(r.spec.symbol, 'MELEK');
  assert.equal(r.spec.precision, 3);
  assert.equal(r.spec.maxSupply, '1000000000');
  assert.deepEqual(r.spec.tags, ['melek']);
  assert.deepEqual(r.spec.authorCuratorSplit, { author: 50, curator: 50 });
  assert.equal(r.spec.inflationPerDay, '0');
  assert.equal(r.spec.primaryTag, 'melek');
});

test('buildTokenSpec accepts a full custom config and normalizes it', () => {
  const r = buildTokenSpec({
    symbol: 'DRONE',
    precision: 6,
    maxSupply: 5000000,
    tags: ['Mining', 'mining', 'BTC!', '  hardware '],
    authorCuratorSplit: 70,
    inflationPerDay: '100',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.spec.symbol, 'DRONE');
  assert.equal(r.spec.precision, 6);
  assert.equal(r.spec.maxSupply, '5000000');
  // lowercased, de-duped, slugged
  assert.deepEqual(r.spec.tags, ['mining', 'btc', 'hardware']);
  assert.deepEqual(r.spec.authorCuratorSplit, { author: 70, curator: 30 });
  assert.equal(r.spec.inflationPerDay, '100');
});

test('buildTokenSpec accepts comma-separated tag strings', () => {
  const r = buildTokenSpec({ tags: 'alpha, beta beta, gamma' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.spec.tags, ['alpha', 'beta', 'gamma']);
});

test('buildTokenSpec returns a frozen spec', () => {
  const { spec } = buildTokenSpec({});
  assert.ok(Object.isFrozen(spec));
  assert.ok(Object.isFrozen(spec.tags));
  assert.ok(Object.isFrozen(spec.authorCuratorSplit));
});

// --------------------------------------------------------------------------
// buildTokenSpec — soft-fail / edge cases
// --------------------------------------------------------------------------

test('buildTokenSpec soft-fails on a bad symbol (never throws)', () => {
  const r = buildTokenSpec({ symbol: 'lower' });
  assert.equal(r.ok, false);
  assert.equal(r.spec, null);
  assert.ok(r.errors.length > 0);
});

test('buildTokenSpec soft-fails on out-of-range precision', () => {
  assert.equal(buildTokenSpec({ precision: 9 }).ok, false);
  assert.equal(buildTokenSpec({ precision: -1 }).ok, false);
  assert.equal(buildTokenSpec({ precision: 2.5 }).ok, false);
});

test('buildTokenSpec soft-fails on non-integer or non-positive maxSupply', () => {
  assert.equal(buildTokenSpec({ maxSupply: '1.5' }).ok, false);
  assert.equal(buildTokenSpec({ maxSupply: 0 }).ok, false);
  assert.equal(buildTokenSpec({ maxSupply: -5 }).ok, false);
  assert.equal(buildTokenSpec({ maxSupply: 'abc' }).ok, false);
});

test('buildTokenSpec soft-fails when maxSupply exceeds the int64 ceiling', () => {
  const tooBig = '9223372036854775808'; // 2^63
  const r = buildTokenSpec({ maxSupply: tooBig });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('ceiling')));
});

test('buildTokenSpec soft-fails when inflationPerDay exceeds maxSupply', () => {
  const r = buildTokenSpec({ maxSupply: 100, inflationPerDay: 101 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('inflationPerDay')));
});

test('buildTokenSpec soft-fails when all tags slug to empty', () => {
  const r = buildTokenSpec({ tags: ['!!!', '   ', '###'] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('tag')));
});

test('buildTokenSpec accumulates multiple errors', () => {
  const r = buildTokenSpec({ symbol: 'bad!', precision: 99, maxSupply: -1 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 3);
});

test('buildTokenSpec tolerates a non-object argument without throwing', () => {
  assert.doesNotThrow(() => buildTokenSpec(null));
  assert.doesNotThrow(() => buildTokenSpec(42));
  assert.equal(buildTokenSpec(null).ok, true); // treated as empty → defaults
});

// --------------------------------------------------------------------------
// defaultSpec + esc
// --------------------------------------------------------------------------

test('defaultSpec returns a valid canonical spec', () => {
  const s = defaultSpec();
  assert.ok(s);
  assert.equal(s.symbol, 'MELEK');
  // round-trips back through the builder as valid
  const r = buildTokenSpec(s);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
});
