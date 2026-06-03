// vehicle.test.mjs — OFFLINE tests. No network: a fake fetch is injected via __setFetch and the shared
// cache is invalidated before each test. Covers vPIC VIN-field normalization (incl. '' / 'Not Applicable'
// → null and the VIN-shape guard) and that decodeVin caches (a second call does NOT re-fetch).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { invalidate } from './cache.mjs';
import {
  __setFetch, isVinish, normalizeVin, decodeVin, recalls, safetyRatings, fuelEconomy, vehicleSummary,
} from './vehicle.mjs';

// helper: a fake Response with a json() body.
const jsonResp = (body, ok = true) => ({ ok, json: async () => body });

beforeEach(() => {
  invalidate();            // clear cache between tests so caching assertions are clean
  __setFetch(undefined);   // reset to default; each test installs its own as needed
});

test('isVinish accepts 17-char VINs and rejects junk / forbidden letters', () => {
  assert.ok(isVinish('1HGCM82633A004352'));
  assert.ok(isVinish(' 1hgcm82633a004352 ')); // trimmed + case-insensitive
  assert.ok(!isVinish('hello'));
  assert.ok(!isVinish('1HGCM82633A00435I')); // contains forbidden I
  assert.ok(!isVinish(''));
  assert.ok(!isVinish(null));
});

test('normalizeVin maps vPIC fields and turns empty / Not Applicable into null', () => {
  const rec = {
    Make: 'HONDA', Model: 'Accord', ModelYear: '2003', Manufacturer: 'HONDA OF AMERICA',
    BodyClass: '', Trim: 'Not Applicable', FuelTypePrimary: 'Gasoline', ErrorCode: '0', ErrorText: '0 - ...',
  };
  const n = normalizeVin(rec);
  assert.equal(n.make, 'HONDA');
  assert.equal(n.model, 'Accord');
  assert.equal(n.year, '2003');
  assert.equal(n.bodyClass, null, "'' becomes null");
  assert.equal(n.trim, null, "'Not Applicable' becomes null");
  assert.equal(n.fuelType, 'Gasoline');
  assert.equal(n.decoded, true, "ErrorCode '0' => decoded");
});

test('normalizeVin returns null for non-objects', () => {
  assert.equal(normalizeVin(null), null);
  assert.equal(normalizeVin('nope'), null);
});

test('normalizeVin marks decoded=false when no clean ErrorCode and no make/model', () => {
  const n = normalizeVin({ ErrorCode: '11', Make: '', Model: '' });
  assert.equal(n.decoded, false);
});

test('decodeVin rejects non-VIN input without fetching', async () => {
  let calls = 0;
  __setFetch(async () => { calls++; return jsonResp({}); });
  const out = await decodeVin('not-a-vin');
  assert.equal(out, null);
  assert.equal(calls, 0, 'guard short-circuits before any network call');
});

test('decodeVin normalizes the vPIC payload', async () => {
  __setFetch(async () => jsonResp({ Results: [{ Make: 'TOYOTA', Model: 'Camry', ModelYear: '2015', ErrorCode: '0' }] }));
  const out = await decodeVin('4T1BF1FK5FU000000');
  assert.equal(out.make, 'TOYOTA');
  assert.equal(out.model, 'Camry');
  assert.equal(out.year, '2015');
  assert.equal(out.decoded, true);
});

test('decodeVin caches — a second call for the same VIN does not re-fetch', async () => {
  let calls = 0;
  __setFetch(async () => { calls++; return jsonResp({ Results: [{ Make: 'FORD', Model: 'F-150', ModelYear: '2018', ErrorCode: '0' }] }); });
  const a = await decodeVin('1FTEW1EP0JF000000');
  const b = await decodeVin('1FTEW1EP0JF000000');
  assert.equal(calls, 1, 'vPIC is slow (~3s) — the same VIN must hit cache the second time');
  assert.deepEqual(a, b);
});

test('decodeVin soft-fails to null on a non-ok response (never throws)', async () => {
  __setFetch(async () => jsonResp(null, false));
  const out = await decodeVin('1FTEW1EP0JF000001');
  assert.equal(out, null);
});

test('recalls returns null without make/model/year and shapes results otherwise', async () => {
  assert.equal(await recalls({ make: 'Honda' }), null);
  __setFetch(async () => jsonResp({ results: [{ NHTSACampaignNumber: '03V001', Component: 'BRAKES', Summary: 'x', Consequence: 'y', Remedy: 'z', ReportReceivedDate: '20030101' }] }));
  const r = await recalls({ make: 'Honda', model: 'Accord', year: 2003 });
  assert.equal(r.count, 1);
  assert.equal(r.recalls[0].campaign, '03V001');
  assert.equal(r.recalls[0].component, 'BRAKES');
  assert.equal(r.year, '2003');
});

test('safetyRatings does the two-step list→detail lookup', async () => {
  let n = 0;
  __setFetch(async (url) => {
    n++;
    if (String(url).includes('/VehicleId/')) {
      return jsonResp({ Results: [{ VehicleDescription: '2015 Toyota Camry', OverallRating: '5', OverallFrontCrashRating: '4', OverallSideCrashRating: '5', RolloverRating: '4' }] });
    }
    return jsonResp({ Results: [{ VehicleId: 9999, VehicleDescription: '2015 Toyota Camry' }] });
  });
  const s = await safetyRatings({ make: 'Toyota', model: 'Camry', year: 2015 });
  assert.equal(n, 2, 'list call + detail call');
  assert.equal(s.variants.length, 1);
  assert.equal(s.rating.overall, '5');
  assert.equal(s.rating.vehicleId, 9999);
});

test('safetyRatings returns empty rating when no variants', async () => {
  __setFetch(async () => jsonResp({ Results: [] }));
  const s = await safetyRatings({ make: 'Nobody', model: 'Nothing', year: 2099 });
  assert.deepEqual(s.variants, []);
  assert.equal(s.rating, null);
});

test('fuelEconomy normalizes a single (non-array) menu item and numeric MPG', async () => {
  __setFetch(async (url) => {
    if (String(url).includes('/menu/options')) return jsonResp({ menuItem: { value: '12345', text: 'Auto 4cyl' } });
    return jsonResp({ city08: '24', highway08: '35', comb08: '28', fuelType: 'Regular', fuelCost08: '1850', co2TailpipeGpm: '316' });
  });
  const fe = await fuelEconomy({ make: 'Toyota', model: 'Camry', year: 2015 });
  assert.equal(fe.options.length, 1);
  assert.equal(fe.economy.city, 24);
  assert.equal(fe.economy.combined, 28);
  assert.equal(fe.economy.annualFuelCost, 1850);
  assert.equal(typeof fe.economy.highway, 'number');
});

test('fuelEconomy returns empty options when EPA has no menu', async () => {
  __setFetch(async () => jsonResp({}));
  const fe = await fuelEconomy({ make: 'X', model: 'Y', year: 2000 });
  assert.deepEqual(fe.options, []);
  assert.equal(fe.economy, null);
});

test('vehicleSummary decodes then fans out to the three sub-lookups', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    if (u.includes('/DecodeVinValues/')) return jsonResp({ Results: [{ Make: 'Toyota', Model: 'Camry', ModelYear: '2015', ErrorCode: '0' }] });
    if (u.includes('/recalls/')) return jsonResp({ results: [{ NHTSACampaignNumber: '15V001' }] });
    if (u.includes('/SafetyRatings/VehicleId/')) return jsonResp({ Results: [{ OverallRating: '5' }] });
    if (u.includes('/SafetyRatings/')) return jsonResp({ Results: [{ VehicleId: 1, VehicleDescription: 'Camry' }] });
    if (u.includes('/menu/options')) return jsonResp({ menuItem: [{ value: '1', text: 'base' }] });
    return jsonResp({ comb08: '28' });
  });
  const s = await vehicleSummary('4T1BF1FK5FU000000');
  assert.equal(s.vehicle.make, 'Toyota');
  assert.equal(s.recalls.count, 1);
  assert.equal(s.safety.rating.overall, '5');
  assert.equal(s.fuelEconomy.economy.combined, 28);
  assert.equal(s.vin, '4T1BF1FK5FU000000');
});

test('vehicleSummary returns null sub-sections when the VIN cannot be decoded', async () => {
  __setFetch(async () => jsonResp({ Results: [{ Make: '', Model: '', ErrorCode: '11' }] }));
  const s = await vehicleSummary('1FTEW1EP0JF999999');
  assert.equal(s.vehicle.decoded, false);
  assert.equal(s.recalls, null);
  assert.equal(s.safety, null);
  assert.equal(s.fuelEconomy, null);
});
