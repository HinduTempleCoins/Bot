/**
 * decimal.test.mjs — OFFLINE tests for the safe fixed-precision token math.
 *
 * decimal.mjs is pure BigInt arithmetic: no network, no clock, no fs, no keys,
 * so there is nothing to inject. We exercise the happy path, edge cases
 * (precision 0 and 8, padding, large values), the round-trip invariant
 * (fromBaseUnits(toBaseUnits(x)) === x), and the documented throw paths
 * (bad precision, non-string, malformed, too many decimals). Per the security
 * study these functions are the only thing standing between the engine and a
 * float-bleed bug, so the rejection paths are tested as hard as the math.
 *
 * Run: node --test engine/test/decimal.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidPrecision,
  toBaseUnits,
  fromBaseUnits,
  isPositive,
  maxSupplyBaseUnits,
  MAX_PRECISION,
  MAX_SUPPLY_WHOLE,
} from '../lib/decimal.mjs';

test('constants — MAX_PRECISION and MAX_SUPPLY_WHOLE', () => {
  assert.equal(MAX_PRECISION, 8);
  assert.equal(typeof MAX_SUPPLY_WHOLE, 'bigint');
  assert.equal(MAX_SUPPLY_WHOLE, BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(MAX_SUPPLY_WHOLE, 9007199254740991n);
});

test('isValidPrecision — accepts 0..8 integers', () => {
  for (let p = 0; p <= 8; p++) assert.equal(isValidPrecision(p), true, `p=${p}`);
});

test('isValidPrecision — rejects out-of-range, non-integer, non-number', () => {
  assert.equal(isValidPrecision(-1), false);
  assert.equal(isValidPrecision(9), false);
  assert.equal(isValidPrecision(1.5), false);
  assert.equal(isValidPrecision(NaN), false);
  assert.equal(isValidPrecision(Infinity), false);
  assert.equal(isValidPrecision('3'), false);
  assert.equal(isValidPrecision(null), false);
  assert.equal(isValidPrecision(undefined), false);
  assert.equal(isValidPrecision(3n), false); // BigInt is not Number.isInteger
});

test('toBaseUnits — happy path at precision 3 ("1.5" -> 1500)', () => {
  assert.equal(toBaseUnits('1.5', 3), 1500n);
  assert.equal(toBaseUnits('1.500', 3), 1500n);
  assert.equal(toBaseUnits('0.001', 3), 1n);
  assert.equal(toBaseUnits('1', 3), 1000n);
});

test('toBaseUnits — precision 0 (whole units only)', () => {
  assert.equal(toBaseUnits('0', 0), 0n);
  assert.equal(toBaseUnits('42', 0), 42n);
});

test('toBaseUnits — precision 8 and zero variants', () => {
  assert.equal(toBaseUnits('0.00000001', 8), 1n);
  assert.equal(toBaseUnits('0', 8), 0n);
  assert.equal(toBaseUnits('0.0', 8), 0n);
  assert.equal(toBaseUnits('0.00000000', 8), 0n);
});

test('toBaseUnits — trims surrounding whitespace', () => {
  assert.equal(toBaseUnits('  2.25  ', 2), 225n);
});

test('toBaseUnits — accepts an integer number (coerced to string)', () => {
  assert.equal(toBaseUnits(5, 2), 500n);
  assert.equal(toBaseUnits(0, 4), 0n);
});

test('toBaseUnits — handles values beyond Number.MAX_SAFE_INTEGER without loss', () => {
  // 9_007_199_254_740_993 whole units * 10^2 — would lose precision as a float.
  assert.equal(toBaseUnits('9007199254740993', 2), 900719925474099300n);
});

test('toBaseUnits — throws on bad precision', () => {
  assert.throws(() => toBaseUnits('1.0', 9), /bad precision 9/);
  assert.throws(() => toBaseUnits('1.0', -1), /bad precision/);
  assert.throws(() => toBaseUnits('1.0', 1.5), /bad precision/);
});

test('toBaseUnits — throws on non-string / non-integer-number input', () => {
  assert.throws(() => toBaseUnits(1.5, 3), /quantity must be a string/);
  assert.throws(() => toBaseUnits(null, 3), /quantity must be a string/);
  assert.throws(() => toBaseUnits(undefined, 3), /quantity must be a string/);
  assert.throws(() => toBaseUnits({}, 3), /quantity must be a string/);
  assert.throws(() => toBaseUnits(true, 3), /quantity must be a string/);
});

test('toBaseUnits — throws on malformed strings (signs, exponents, empties, junk)', () => {
  assert.throws(() => toBaseUnits('', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('-1', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('+1', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('1e3', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('1.', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('.5', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('1.2.3', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('abc', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('NaN', 3), /malformed quantity/);
  assert.throws(() => toBaseUnits('0x10', 3), /malformed quantity/);
});

test('toBaseUnits — throws when fractional digits exceed precision', () => {
  assert.throws(() => toBaseUnits('1.123', 2), /exceeds precision 2/);
  assert.throws(() => toBaseUnits('0.1', 0), /exceeds precision 0/);
});

test('fromBaseUnits — happy path mirrors toBaseUnits', () => {
  assert.equal(fromBaseUnits(1500n, 3), '1.500');
  assert.equal(fromBaseUnits(1n, 3), '0.001');
  assert.equal(fromBaseUnits(0n, 3), '0.000');
  assert.equal(fromBaseUnits(1000n, 3), '1.000');
});

test('fromBaseUnits — precision 0 emits no decimal point', () => {
  assert.equal(fromBaseUnits(42n, 0), '42');
  assert.equal(fromBaseUnits(0n, 0), '0');
});

test('fromBaseUnits — pads leading zeros in the fractional part', () => {
  assert.equal(fromBaseUnits(5n, 8), '0.00000005');
  assert.equal(fromBaseUnits(100000001n, 8), '1.00000001');
});

test('fromBaseUnits — coerces non-bigint input', () => {
  assert.equal(fromBaseUnits(1500, 3), '1.500');
  assert.equal(fromBaseUnits('1500', 3), '1.500');
});

test('fromBaseUnits — formats negative base units with a leading sign', () => {
  assert.equal(fromBaseUnits(-1500n, 3), '-1.500');
  assert.equal(fromBaseUnits(-1n, 3), '-0.001');
});

test('fromBaseUnits — throws on bad precision', () => {
  assert.throws(() => fromBaseUnits(1n, 9), /bad precision/);
  assert.throws(() => fromBaseUnits(1n, -1), /bad precision/);
});

test('round-trip — fromBaseUnits(toBaseUnits(x)) === x for several precisions', () => {
  const cases = [
    ['0', 0],
    ['42', 0],
    ['1.500', 3],
    ['0.001', 3],
    ['123.45000000', 8],
    ['0.00000001', 8],
    ['9007199254740991.00', 2],
  ];
  for (const [qty, p] of cases) {
    assert.equal(fromBaseUnits(toBaseUnits(qty, p), p), qty, `${qty}@${p}`);
  }
});

test('isPositive — strictly greater than zero', () => {
  assert.equal(isPositive('0.001', 3), true);
  assert.equal(isPositive('1', 3), true);
  assert.equal(isPositive('0', 3), false);
  assert.equal(isPositive('0.000', 3), false);
  assert.equal(isPositive('0', 0), false);
});

test('isPositive — propagates the throw on malformed input', () => {
  assert.throws(() => isPositive('-1', 3), /malformed quantity/);
  assert.throws(() => isPositive('', 3), /malformed quantity/);
});

test('maxSupplyBaseUnits — ceiling scales by 10^precision', () => {
  assert.equal(maxSupplyBaseUnits(0), MAX_SUPPLY_WHOLE);
  assert.equal(maxSupplyBaseUnits(3), MAX_SUPPLY_WHOLE * 1000n);
  assert.equal(maxSupplyBaseUnits(8), MAX_SUPPLY_WHOLE * 100000000n);
  assert.equal(maxSupplyBaseUnits(2), 900719925474099100n);
});
