// vehicle-value.test.mjs — OFFLINE tests for the derive-your-own vehicle value index (task #117).
// Focused on the PURE valuation math: median, IQR-based outlier trimming, mileage + condition
// adjusters. Injected listings only — NO network. Run: node --test integrations/soapbox/vehicle-value.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fairMarketRange, mileageAdjust, conditionAdjust, CONDITION_FACTORS, vehicleValueSummary,
} from './vehicle-value.mjs';

test('fairMarketRange: median + Q1/Q3 on a clean set', () => {
  const r = fairMarketRange([10000, 12000, 14000, 16000, 18000]);
  assert.equal(r.median, 14000);
  assert.equal(r.low, 12000);   // Q1
  assert.equal(r.high, 16000);  // Q3
  assert.equal(r.n, 5);
  assert.equal(r.confidence, 'low'); // 3<=n<8
});

test('fairMarketRange: accepts listing objects with various price fields', () => {
  const listings = [
    { price: 20000 }, { list_price: 21000 }, { listing_price: 22000 }, { amount: 23000 },
  ];
  const r = fairMarketRange(listings);
  assert.equal(r.median, 21500);
  assert.equal(r.n, 4);
});

test('fairMarketRange: 1.5×IQR fence trims a high outlier', () => {
  // tight cluster ~19k with one 60k outlier; the outlier must be excluded from the trimmed set.
  const listings = [18000, 18500, 19000, 19200, 19500, 20000, 21000, 60000];
  const r = fairMarketRange(listings);
  assert.equal(r.n, 7, 'outlier should be dropped → 7 kept');
  assert.ok(r.high < 60000, 'high (Q3) must not be the outlier');
  assert.ok(r.median >= 19000 && r.median <= 19500);
});

test('fairMarketRange: trims a low outlier too', () => {
  const listings = [1000, 18000, 18500, 19000, 19200, 19500, 20000, 21000];
  const r = fairMarketRange(listings);
  assert.equal(r.n, 7);
  assert.ok(r.low > 1000, 'the $1000 outlier must be excluded from Q1');
});

test('fairMarketRange: never trims the entire set away', () => {
  // extreme bimodal spread — fence could exclude everything; guard keeps the full set.
  const listings = [1000, 1000, 50000, 50000];
  const r = fairMarketRange(listings);
  assert.ok(r.n >= 1);
  assert.ok(r.median != null);
});

test('fairMarketRange: confidence tiers scale with n', () => {
  const mk = (count) => Array.from({ length: count }, (_, i) => 20000 + i * 10);
  assert.equal(fairMarketRange(mk(25)).confidence, 'high');   // n>=20
  assert.equal(fairMarketRange(mk(10)).confidence, 'medium'); // n>=8
  assert.equal(fairMarketRange(mk(5)).confidence, 'low');     // n>=3
});

test('fairMarketRange: insufficient / empty input is shaped, not thrown', () => {
  const empty = fairMarketRange([]);
  assert.equal(empty.median, null);
  assert.equal(empty.n, 0);
  assert.equal(empty.confidence, 'insufficient');

  const one = fairMarketRange([15000]);
  assert.equal(one.median, 15000);
  assert.equal(one.confidence, 'insufficient'); // n<3

  const bad = fairMarketRange(null);
  assert.equal(bad.median, null);
  assert.equal(bad.n, 0);
});

test('fairMarketRange: ignores non-positive / non-numeric prices', () => {
  const r = fairMarketRange([{ price: 20000 }, { price: -5 }, { price: 0 }, { price: 'abc' }, { price: 22000 }]);
  assert.equal(r.n, 2);
  assert.equal(r.median, 21000);
});

test('fairMarketRange: carries source + fetched_at through', () => {
  const r = fairMarketRange([20000, 21000, 22000], { source: 'marketcheck', fetched_at: '2026-06-03T00:00:00Z' });
  assert.equal(r.source, 'marketcheck');
  assert.equal(r.fetched_at, '2026-06-03T00:00:00Z');
});

test('mileageAdjust: higher-than-expected miles lowers value', () => {
  // 2020 car, "now" 2024 → expected ~48k miles. 80k is 32k over → value down.
  const adj = mileageAdjust(20000, 80000, 2020, { now: 2024 });
  assert.ok(adj < 20000);
});

test('mileageAdjust: lower-than-expected miles raises value', () => {
  const adj = mileageAdjust(20000, 10000, 2020, { now: 2024 }); // expected ~48k, only 10k
  assert.ok(adj > 20000);
});

test('mileageAdjust: swing is clamped to ±40%', () => {
  const high = mileageAdjust(20000, 5_000_000, 2020, { now: 2024 }); // absurd mileage
  assert.ok(high >= 20000 * 0.6, 'clamped at -40%');
  assert.ok(high >= 0);
  const low = mileageAdjust(20000, 0, 2020, { now: 2024 });
  assert.ok(low <= 20000 * 1.4, 'clamped at +40%');
});

test('mileageAdjust: missing/invalid inputs return value unchanged', () => {
  assert.equal(mileageAdjust(20000, undefined, 2020), 20000);
  assert.equal(mileageAdjust(20000, -100, 2020), 20000);
  assert.equal(mileageAdjust(undefined, 50000, 2020), undefined);
});

test('conditionAdjust: string tiers apply the right factor', () => {
  assert.equal(conditionAdjust(20000, 'excellent'), 20000 * CONDITION_FACTORS.excellent);
  assert.equal(conditionAdjust(20000, 'good'), 20000);
  assert.equal(conditionAdjust(20000, 'poor'), 20000 * CONDITION_FACTORS.poor);
});

test('conditionAdjust: case/space-insensitive and unknown→unchanged', () => {
  assert.equal(conditionAdjust(20000, '  Very Good '), 20000 * CONDITION_FACTORS['very good']);
  assert.equal(conditionAdjust(20000, 'mint'), 20000); // unknown → 1.0
});

test('conditionAdjust: numeric multiplier and invalid value', () => {
  assert.equal(conditionAdjust(20000, 0.9), 18000);
  assert.equal(conditionAdjust(undefined, 'good'), undefined);
});

test('adjusters compose: range median → mileage → condition', () => {
  const base = fairMarketRange([19000, 19500, 20000, 20500, 21000]).median;
  const m = mileageAdjust(base, 30000, 2020, { now: 2024 }); // fewer miles than expected → up
  const c = conditionAdjust(m, 'fair'); // → down
  assert.ok(Number.isFinite(c));
  assert.ok(c < m); // 'fair' is < 1.0
});

test('vehicleValueSummary: reports source gating without a key', () => {
  delete process.env.MARKETCHECK_KEY;
  delete process.env.VINAUDIT_KEY;
  const s = vehicleValueSummary();
  assert.equal(s.source, 'none');
  assert.equal(s.available, false);
  assert.equal(s.mileageBaselinePerYear, 12000);
  assert.ok(s.conditionFactors.excellent > 1);
});
