import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  vestsToPower,
  powerToVests,
  formatPower,
  ratio,
  esc,
} from './vests-converter.mjs';

const PROPS = {
  totalVestingFund: 1000000, // 1,000,000 power units in the fund
  totalVestingShares: 2000000000, // 2e9 VESTS
};
// ratio = 1e6 / 2e9 = 0.0005 power per VEST

test('ratio returns fund/shares', () => {
  assert.equal(ratio(PROPS), 0.0005);
});

test('vestsToPower applies the ratio', () => {
  // 1,000,000 VESTS -> 500 power
  assert.equal(vestsToPower(1000000, PROPS), 500);
});

test('powerToVests inverts the ratio', () => {
  assert.equal(powerToVests(500, PROPS), 1000000);
});

test('round-trip vests -> power -> vests within epsilon', () => {
  const start = 1234567.891234;
  const back = powerToVests(vestsToPower(start, PROPS), PROPS);
  assert.ok(Math.abs(back - start) < 1e-6, `round trip drifted: ${back} vs ${start}`);
});

test('accepts Graphene asset strings for props', () => {
  const strProps = {
    totalVestingFund: '1000000.000 MELEK',
    totalVestingShares: '2000000000.000000 VESTS',
  };
  assert.equal(ratio(strProps), 0.0005);
  assert.equal(vestsToPower('1000000.000000 VESTS', strProps), 500);
});

// ---- soft-fail / edge guards ----

test('zero shares -> 0, never divides by zero', () => {
  const bad = { totalVestingFund: 1000, totalVestingShares: 0 };
  assert.equal(ratio(bad), 0);
  assert.equal(vestsToPower(1000, bad), 0);
  assert.equal(powerToVests(1000, bad), 0);
});

test('negative / NaN shares -> 0', () => {
  assert.equal(ratio({ totalVestingFund: 10, totalVestingShares: -5 }), 0);
  assert.equal(ratio({ totalVestingFund: 10, totalVestingShares: NaN }), 0);
  assert.equal(ratio({ totalVestingFund: 10, totalVestingShares: 'oops' }), 0);
});

test('negative / NaN fund -> 0', () => {
  assert.equal(ratio({ totalVestingFund: -1, totalVestingShares: 100 }), 0);
  assert.equal(ratio({ totalVestingFund: NaN, totalVestingShares: 100 }), 0);
});

test('missing / undefined props -> 0', () => {
  assert.equal(ratio(undefined), 0);
  assert.equal(ratio({}), 0);
  assert.equal(vestsToPower(100, undefined), 0);
  assert.equal(powerToVests(100, null), 0);
});

test('bad amount inputs -> 0', () => {
  assert.equal(vestsToPower(NaN, PROPS), 0);
  assert.equal(vestsToPower('not-a-number', PROPS), 0);
  assert.equal(powerToVests(undefined, PROPS), 0);
});

// ---- formatting ----

test('formatPower default decimals (3) and default symbol (MP)', () => {
  assert.equal(formatPower(1000000, PROPS), '500.000 MP');
});

test('formatPower honors decimals', () => {
  assert.equal(formatPower(1000000, PROPS, { decimals: 0 }), '500 MP');
  assert.equal(formatPower(1000000, PROPS, { decimals: 6 }), '500.000000 MP');
});

test('formatPower symbol injection', () => {
  assert.equal(formatPower(1000000, PROPS, { symbol: 'HP' }), '500.000 HP');
  assert.equal(formatPower(1000000, PROPS, { symbol: 'MELEK', decimals: 2 }), '500.00 MELEK');
});

test('formatPower soft-fails to 0 on bad props', () => {
  assert.equal(formatPower(1000, { totalVestingShares: 0 }, { symbol: 'MP' }), '0.000 MP');
});

test('formatPower invalid decimals falls back to 3', () => {
  assert.equal(formatPower(1000000, PROPS, { decimals: -1 }), '500.000 MP');
  assert.equal(formatPower(1000000, PROPS, { decimals: 2.5 }), '500.000 MP');
});

test('formatPower escapes the symbol for HTML safety', () => {
  const out = formatPower(1000000, PROPS, { symbol: '<x>' });
  assert.equal(out, '500.000 &lt;x&gt;');
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
