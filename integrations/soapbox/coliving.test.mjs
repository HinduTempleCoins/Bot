// coliving.test.mjs — OFFLINE tests for the cost-of-living vertical (queue task #101).
// Focus: the PURE fusion + provenance-tagging logic with injected data. No network.
// Run: node --test integrations/soapbox/coliving.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshnessLabel,
  freshnessWeight,
  parseObsDate,
  provenanceTag,
  fuseRecords,
  costOfLiving,
  __setFetch,
  FRESHNESS_BANDS,
  SOURCE_TRUST,
  vehicleOwnershipCost,
  vehicleSummaryLine,
  DEFAULT_FUEL_PRICE_PER_GAL,
} from './coliving.mjs';

const NOW = Date.parse('2026-06-03T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('freshnessLabel buckets by age', () => {
  assert.equal(freshnessLabel(NOW - 1 * DAY, NOW), 'fresh');
  assert.equal(freshnessLabel(NOW - 60 * DAY, NOW), 'recent');
  assert.equal(freshnessLabel(NOW - 200 * DAY, NOW), 'aging');
  assert.equal(freshnessLabel(NOW - 500 * DAY, NOW), 'stale');
  assert.equal(freshnessLabel(null, NOW), 'unknown');
  assert.equal(freshnessLabel('not-a-number', NOW), 'unknown');
});

test('freshnessLabel treats future-dated prints as fresh', () => {
  assert.equal(freshnessLabel(NOW + 10 * DAY, NOW), 'fresh');
});

test('freshnessLabel band edges align with FRESHNESS_BANDS', () => {
  assert.equal(freshnessLabel(NOW - (FRESHNESS_BANDS.fresh - 1000), NOW), 'fresh');
  assert.equal(freshnessLabel(NOW - (FRESHNESS_BANDS.fresh + 1000), NOW), 'recent');
});

test('freshnessWeight is monotonic by freshness', () => {
  assert.ok(freshnessWeight('fresh') > freshnessWeight('recent'));
  assert.ok(freshnessWeight('recent') > freshnessWeight('aging'));
  assert.ok(freshnessWeight('aging') > freshnessWeight('stale'));
  assert.equal(freshnessWeight('whatever'), 0.4);
});

test('parseObsDate handles year, year-month, full date, and junk', () => {
  assert.equal(parseObsDate('2026'), Date.parse('2026-01-01'));
  assert.equal(parseObsDate('2026-04'), Date.parse('2026-04-01'));
  assert.equal(parseObsDate('2026-04-15'), Date.parse('2026-04-15'));
  assert.equal(parseObsDate(''), null);
  assert.equal(parseObsDate(null), null);
  assert.equal(parseObsDate('garbage'), null);
});

test('provenanceTag shape + confidence = trust × freshnessWeight', () => {
  const r = provenanceTag({ value: 300, source: 'fred', observedAt: NOW - 1 * DAY, nowMs: NOW });
  assert.deepEqual(Object.keys(r).sort(), ['confidence', 'fetched_at', 'freshness', 'source', 'value'].sort());
  assert.equal(r.value, 300);
  assert.equal(r.source, 'fred');
  assert.equal(r.freshness, 'fresh');
  assert.equal(r.fetched_at, new Date(NOW).toISOString());
  // 0.95 trust × 1.0 fresh = 0.95
  assert.equal(r.confidence, 0.95);
});

test('provenanceTag down-ranks confidence for stale data', () => {
  const fresh = provenanceTag({ value: 1, source: 'usda', observedAt: NOW - 1 * DAY, nowMs: NOW });
  const stale = provenanceTag({ value: 1, source: 'usda', observedAt: NOW - 500 * DAY, nowMs: NOW });
  assert.ok(stale.confidence < fresh.confidence);
  // 0.7 × 0.3 = 0.21
  assert.equal(stale.confidence, 0.21);
});

test('provenanceTag null value → null value + zero confidence', () => {
  const r = provenanceTag({ value: null, source: 'census', observedAt: NOW, nowMs: NOW });
  assert.equal(r.value, null);
  assert.equal(r.confidence, 0);
});

test('provenanceTag respects explicit trust override + clamps to [0,1]', () => {
  const r = provenanceTag({ value: 5, source: 'fred', observedAt: NOW, nowMs: NOW, trust: 5 });
  assert.equal(r.confidence, 1); // clamped
  assert.equal(SOURCE_TRUST.fred, 0.95); // sanity on the table
});

test('provenanceTag unknown source falls back to 0.5 trust', () => {
  const r = provenanceTag({ value: 10, source: 'mystery', observedAt: NOW - 1 * DAY, nowMs: NOW });
  assert.equal(r.confidence, 0.5); // 0.5 × 1.0
});

test('fuseRecords confidence-weighted average of component values', () => {
  const components = {
    cpi: provenanceTag({ value: 100, source: 'fred', observedAt: NOW - 1 * DAY, nowMs: NOW }),   // conf 0.95
    groceries: provenanceTag({ value: 200, source: 'usda', observedAt: NOW - 1 * DAY, nowMs: NOW }), // conf 0.70
  };
  const f = fuseRecords(components, { nowMs: NOW });
  assert.equal(f.source, 'fused');
  // weighted: (100*0.95 + 200*0.70) / (0.95+0.70) = 235/1.65 ≈ 142.42
  assert.equal(f.value, 142.42);
  assert.ok(f.components.cpi && f.components.groceries);
});

test('fuseRecords freshness = worst present component', () => {
  const components = {
    a: provenanceTag({ value: 10, source: 'fred', observedAt: NOW - 1 * DAY, nowMs: NOW }),    // fresh
    b: provenanceTag({ value: 20, source: 'usda', observedAt: NOW - 500 * DAY, nowMs: NOW }),  // stale
  };
  const f = fuseRecords(components, { nowMs: NOW });
  assert.equal(f.freshness, 'stale');
});

test('fuseRecords coverage lowers confidence when a component is missing', () => {
  const both = fuseRecords({
    a: provenanceTag({ value: 10, source: 'fred', observedAt: NOW - 1 * DAY, nowMs: NOW }),
    b: provenanceTag({ value: 20, source: 'usda', observedAt: NOW - 1 * DAY, nowMs: NOW }),
  }, { nowMs: NOW });
  const half = fuseRecords({
    a: provenanceTag({ value: 10, source: 'fred', observedAt: NOW - 1 * DAY, nowMs: NOW }),
    b: provenanceTag({ value: null, source: 'usda', observedAt: null, nowMs: NOW }),
  }, { nowMs: NOW });
  assert.ok(half.confidence < both.confidence);
  // half: meanConf of present (just 0.95) × coverage 0.5 = 0.475 → 0.48
  assert.equal(half.confidence, 0.48);
});

test('fuseRecords all-null → null value, zero confidence, unknown freshness', () => {
  const f = fuseRecords({
    a: provenanceTag({ value: null, source: 'fred', observedAt: null, nowMs: NOW }),
    b: provenanceTag({ value: null, source: 'usda', observedAt: null, nowMs: NOW }),
  }, { nowMs: NOW });
  assert.equal(f.value, null);
  assert.equal(f.confidence, 0);
  assert.equal(f.freshness, 'unknown');
});

test('fuseRecords ignores non-finite component values in the average', () => {
  const f = fuseRecords({
    a: provenanceTag({ value: 100, source: 'fred', observedAt: NOW - 1 * DAY, nowMs: NOW }),
    b: { value: 'NaN-ish', source: 'usda', freshness: 'fresh', confidence: 0.5, fetched_at: 'x' },
  }, { nowMs: NOW });
  // only `a` is finite → value === 100
  assert.equal(f.value, 100);
});

test('costOfLiving fuses injected sources offline (no network) and tags provenance', async () => {
  // Inject a fetch that serves FRED CPI, BLS gas, and USDA grocery JSON shapes by URL.
  __setFetch(async (url, opts) => {
    const u = String(url);
    if (u.includes('stlouisfed.org')) {
      return { ok: true, json: async () => ({ observations: [{ date: '2026-05-01', value: '320.5' }] }) };
    }
    if (u.includes('quickstats.nass.usda.gov')) {
      return { ok: true, json: async () => ({ data: [{ year: '2026', Value: '24.30', reference_period_desc: 'MARKETING YEAR' }] }) };
    }
    if (u.includes('api.bls.gov')) {
      return { ok: true, json: async () => ({ Results: { series: [{ data: [{ year: '2026', period: 'M05', value: '3.45' }] }] } }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  // ensure FRED + USDA keys are seen by the code paths (values irrelevant; injected fetch handles them)
  process.env.FRED_API_KEY = 'test-fred';
  process.env.USDA_API_KEY = 'test-usda';

  const rec = await costOfLiving({ metro: 'Austin', includeGas: true, nowMs: NOW });
  assert.equal(rec.source, 'fused');
  assert.equal(rec.metro, 'Austin');
  assert.equal(typeof rec.value, 'number');
  assert.ok(rec.value > 0);
  // cpi, groceries, metro (census - no key/match → null record), gas all present as components
  assert.deepEqual(Object.keys(rec.components).sort(), ['cpi', 'gas', 'groceries', 'metro'].sort());
  assert.equal(rec.components.cpi.value, 320.5);
  assert.equal(rec.components.cpi.source, 'fred');
  assert.equal(rec.components.groceries.value, 24.3);
  assert.equal(rec.components.gas.value, 3.45);
  // census got no usable response → null-valued provenance record, never throws
  assert.equal(rec.components.metro.value, null);
  assert.ok(rec.confidence > 0 && rec.confidence <= 1);

  delete process.env.FRED_API_KEY;
  delete process.env.USDA_API_KEY;
  __setFetch(null);
});

// ---------------------------------------------------------------------------
// vehicle ownership-cost (queue task #119)
// ---------------------------------------------------------------------------

test('vehicleOwnershipCost computes correct all-in monthly figure', () => {
  const c = vehicleOwnershipCost({
    mpg: 25, milesPerYear: 12000, fuelPricePerGal: 4.0,
    insuranceMonthly: 150, maintenanceYearly: 600, paymentMonthly: 400,
  });
  // fuel: (12000/25)*4.0/12 = 480*4/12 = 160 ; maintenance: 600/12 = 50
  assert.equal(c.fuel, 160);
  assert.equal(c.insurance, 150);
  assert.equal(c.maintenance, 50);
  assert.equal(c.payment, 400);
  // total: 160 + 150 + 50 + 400 = 760
  assert.equal(c.monthly, 760);
});

test('vehicleOwnershipCost falls back to DEFAULT_FUEL_PRICE_PER_GAL when price omitted', () => {
  const c = vehicleOwnershipCost({ mpg: 30, milesPerYear: 9000 });
  // fuel: (9000/30)*DEFAULT/12 = 300*3.5/12 = 87.5
  const expected = Math.round((9000 / 30) * DEFAULT_FUEL_PRICE_PER_GAL / 12 * 100) / 100;
  assert.equal(c.fuel, expected);
  assert.equal(c.monthly, expected);
  assert.equal(c.breakdown.fuelPricePerGal, DEFAULT_FUEL_PRICE_PER_GAL);
});

test('vehicleOwnershipCost soft-fails non-finite buckets to 0, never throws', () => {
  const c = vehicleOwnershipCost({ mpg: 'x', milesPerYear: null, insuranceMonthly: 100 });
  assert.equal(c.fuel, 0); // no usable mpg/miles
  assert.equal(c.insurance, 100);
  assert.equal(c.monthly, 100);
});

test('vehicleOwnershipCost with no usable input → monthly null', () => {
  const c = vehicleOwnershipCost({});
  assert.equal(c.monthly, null);
  assert.equal(c.breakdown, null);
});

test('vehicleSummaryLine renders an escaped Transportation line when present, else null', () => {
  const c = vehicleOwnershipCost({ mpg: 25, milesPerYear: 12000, fuelPricePerGal: 4.0, insuranceMonthly: 150 });
  const line = vehicleSummaryLine(c);
  assert.ok(line.startsWith('Transportation: $'));
  assert.ok(line.includes('fuel $'));
  assert.ok(line.includes('insurance $'));
  // no raw HTML metacharacters leak through (escaped output)
  assert.ok(!/[<>]/.test(line));
  assert.equal(vehicleSummaryLine(null), null);
  assert.equal(vehicleSummaryLine({ monthly: null }), null);
});

test('costOfLiving total is UNCHANGED when vehicle omitted (backward-compat)', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('stlouisfed.org')) return { ok: true, json: async () => ({ observations: [{ date: '2026-05-01', value: '320.5' }] }) };
    if (u.includes('quickstats.nass.usda.gov')) return { ok: true, json: async () => ({ data: [{ year: '2026', Value: '24.30' }] }) };
    if (u.includes('api.bls.gov')) return { ok: true, json: async () => ({ Results: { series: [{ data: [{ year: '2026', period: 'M05', value: '3.45' }] }] } }) };
    return { ok: false, json: async () => ({}) };
  });
  process.env.FRED_API_KEY = 'test-fred';
  process.env.USDA_API_KEY = 'test-usda';

  const baseline = await costOfLiving({ metro: 'Austin', includeGas: true, nowMs: NOW });
  // no vehicle field, no monthlyTotal, value/components exactly as the pre-existing test asserts
  assert.equal('vehicle' in baseline, false);
  assert.equal('monthlyTotal' in baseline, false);
  assert.equal(baseline.components.cpi.value, 320.5);
  assert.equal(baseline.components.groceries.value, 24.3);

  delete process.env.FRED_API_KEY;
  delete process.env.USDA_API_KEY;
  __setFetch(null);
});

test('costOfLiving folds vehicle cost in ADDITIVELY when provided', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('stlouisfed.org')) return { ok: true, json: async () => ({ observations: [{ date: '2026-05-01', value: '320.5' }] }) };
    if (u.includes('quickstats.nass.usda.gov')) return { ok: true, json: async () => ({ data: [{ year: '2026', Value: '24.30' }] }) };
    if (u.includes('api.bls.gov')) return { ok: true, json: async () => ({ Results: { series: [{ data: [{ year: '2026', period: 'M05', value: '3.45' }] }] } }) };
    return { ok: false, json: async () => ({}) };
  });
  process.env.FRED_API_KEY = 'test-fred';
  process.env.USDA_API_KEY = 'test-usda';

  const opts = { metro: 'Austin', includeGas: true, nowMs: NOW };
  const baseline = await costOfLiving({ ...opts });
  const withVeh = await costOfLiving({
    ...opts,
    vehicle: { mpg: 25, milesPerYear: 12000, fuelPricePerGal: 4.0, insuranceMonthly: 150, maintenanceYearly: 600, paymentMonthly: 400 },
  });

  // fused value/components are left untouched — only additive fields appear
  assert.equal(withVeh.value, baseline.value);
  assert.deepEqual(Object.keys(withVeh.components).sort(), Object.keys(baseline.components).sort());
  assert.ok(withVeh.vehicle);
  assert.equal(withVeh.vehicle.monthly, 760);
  assert.ok(withVeh.vehicle.line.startsWith('Transportation: $'));
  // monthlyTotal = fused value + vehicle monthly
  assert.equal(withVeh.monthlyTotal, Math.round((Number(baseline.value) + 760) * 100) / 100);

  delete process.env.FRED_API_KEY;
  delete process.env.USDA_API_KEY;
  __setFetch(null);
});

test('costOfLiving resolves live fuel price from the gas series when not supplied', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('api.bls.gov')) return { ok: true, json: async () => ({ Results: { series: [{ data: [{ year: '2026', period: 'M05', value: '5.00' }] }] } }) };
    return { ok: false, json: async () => ({}) };
  });
  delete process.env.FRED_API_KEY;
  delete process.env.USDA_API_KEY;
  delete process.env.CENSUS_API_KEY;

  const rec = await costOfLiving({
    nowMs: NOW,
    vehicle: { mpg: 25, milesPerYear: 12000 }, // no fuelPricePerGal → pulls live $5.00/gal
  });
  // fuel: (12000/25)*5.00/12 = 480*5/12 = 200
  assert.equal(rec.vehicle.fuel, 200);
  assert.equal(rec.vehicle.monthly, 200);
  __setFetch(null);
});

test('costOfLiving never throws when all sources fail', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  delete process.env.FRED_API_KEY;
  delete process.env.BLS_API_KEY;
  delete process.env.USDA_API_KEY;
  delete process.env.CENSUS_API_KEY;
  const rec = await costOfLiving({ metro: 'Nowhere', nowMs: NOW });
  assert.equal(rec.source, 'fused');
  assert.equal(rec.value, null);
  assert.equal(rec.confidence, 0);
  __setFetch(null);
});
