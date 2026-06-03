// nhtsa.test.mjs — offline node:test for the NHTSA vehicle-safety reader (recalls, complaints, vPIC VIN
// decode). All network is via an injected fetch keyed on the requested URL; no real requests are made.
//   node --test integrations/soapbox/nhtsa.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, recalls, complaints, decodeVin, normalizeVin, summary, renderPage, dataNote,
  SOURCE, LICENSE,
} from './nhtsa.mjs';

const boom = () => Promise.reject(new Error('network down'));

// A fetch that dispatches canned JSON by which endpoint the URL hits.
function router(map) {
  return (url) => {
    const u = String(url);
    for (const [needle, json] of Object.entries(map)) {
      if (u.includes(needle)) return Promise.resolve({ ok: true, json: async () => json });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  };
}

const RECALLS = { Count: 2, results: [
  {
    Manufacturer: 'Honda (American Honda Motor Co.)',
    NHTSACampaignNumber: '20V123000',
    Component: 'AIR BAGS',
    Summary: 'The driver air bag inflator may rupture.',
    Consequence: 'An inflator rupture may result in injury or death.',
    Remedy: 'Dealers will replace the air bag inflator, free of charge.',
    ReportReceivedDate: '15/03/2020',
  },
  {
    Manufacturer: 'Honda (American Honda Motor Co.)',
    NHTSACampaignNumber: '21V456000',
    Component: 'FUEL SYSTEM',
    Summary: 'Fuel pump may fail.',
    Consequence: 'A fuel pump failure can cause an engine stall.',
    Remedy: 'Dealers will replace the fuel pump.',
    ReportReceivedDate: '2021-06-01T00:00:00',
  },
] };

const COMPLAINTS = { count: 2, results: [
  {
    odiNumber: 11111111,
    components: 'ELECTRICAL SYSTEM',
    summary: 'Vehicle lost power while driving.',
    crash: 'No', fire: 'No',
    numberOfInjuries: 0, numberOfDeaths: 0,
    dateOfIncident: '01/02/2021', dateComplaintFiled: '05/02/2021',
  },
  {
    odiNumber: 22222222,
    components: 'ENGINE',
    summary: 'Engine caught fire.',
    crash: 'No', fire: 'Yes',
    numberOfInjuries: 1, numberOfDeaths: 0,
    dateOfIncident: '2021-03-10', dateComplaintFiled: '2021-03-12',
  },
] };

const VIN = { Count: 1, Message: 'Results returned successfully', Results: [{
  Make: 'HONDA', Model: 'Accord', ModelYear: '2003', BodyClass: 'Sedan/Saloon',
  VehicleType: 'PASSENGER CAR', Manufacturer: 'HONDA', PlantCountry: 'UNITED STATES (USA)',
  EngineCylinders: '4', FuelTypePrimary: 'Gasoline',
}] };

// ── normalizeVin: validates the 17-char VIN grammar ──────────────────────────────────────────────────
test('normalizeVin accepts a valid VIN and rejects bad ones', () => {
  assert.equal(normalizeVin('1hgcm82633a004352'), '1HGCM82633A004352'); // upcased
  assert.equal(normalizeVin('SHORTVIN'), null);                          // too short
  assert.equal(normalizeVin('1HGCM82633A00435I'), null);                 // contains I (illegal)
  assert.equal(normalizeVin(''), null);
});

// ── recalls ──────────────────────────────────────────────────────────────────────────────────────────
test('recalls normalizes vehicle recalls with provenance and date formats', async () => {
  __setFetch(router({ 'recallsByVehicle': RECALLS }));
  const rows = await recalls({ make: 'Honda', model: 'Accord', modelYear: '2020' });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].campaign, '20V123000');
  assert.equal(rows[0].component, 'AIR BAGS');
  assert.equal(rows[0].date, '2020-03-15'); // DD/MM/YYYY → ISO
  assert.equal(rows[1].date, '2021-06-01'); // ISO timestamp → ISO date
  assert.equal(rows[0].make, 'HONDA');
  assert.equal(rows[0].source, SOURCE);
  assert.equal(rows[0].license, 'public-domain');
  assert.ok(rows[0].fetchedAt);
});

test('recalls requires make+model+year (soft-fails to [])', async () => {
  __setFetch(router({ 'recallsByVehicle': RECALLS }));
  const missing = await recalls({ make: 'Honda', model: '', modelYear: '2020' });
  __setFetch(null);
  assert.deepEqual(missing, []);
});

test('recalls soft-fails to [] when fetch throws', async () => {
  __setFetch(boom);
  const rows = await recalls({ make: 'Honda', model: 'Accord', modelYear: '2020' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── complaints ───────────────────────────────────────────────────────────────────────────────────────
test('complaints normalizes crash/fire/injury fields with provenance', async () => {
  __setFetch(router({ 'complaintsByVehicle': COMPLAINTS }));
  const rows = await complaints({ make: 'Honda', model: 'Accord', modelYear: '2021' });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].fire, true);
  assert.equal(rows[1].injuries, 1);
  assert.equal(rows[0].fire, false);
  assert.equal(rows[1].dateFiled, '2021-03-12');
  assert.equal(rows[0].source, SOURCE);
  assert.equal(rows[0].license, LICENSE);
});

test('complaints soft-fails to [] on a non-ok response', async () => {
  __setFetch(() => Promise.resolve({ ok: false, json: async () => ({}) }));
  const rows = await complaints({ make: 'Honda', model: 'Accord', modelYear: '2021' });
  __setFetch(null);
  assert.deepEqual(rows, []);
});

// ── decodeVin (vPIC) ─────────────────────────────────────────────────────────────────────────────────
test('decodeVin returns a normalized decode with provenance', async () => {
  __setFetch(router({ 'DecodeVinValues': VIN }));
  const d = await decodeVin('1HGCM82633A004352');
  __setFetch(null);
  assert.equal(d.make, 'HONDA');
  assert.equal(d.model, 'Accord');
  assert.equal(d.modelYear, '2003');
  assert.equal(d.bodyClass, 'Sedan/Saloon');
  assert.equal(d.fuelType, 'Gasoline');
  assert.equal(d.vin, '1HGCM82633A004352');
  assert.equal(d.source, SOURCE);
  assert.equal(d.license, 'public-domain');
});

test('decodeVin returns null for an invalid VIN without fetching', async () => {
  let called = false;
  __setFetch(() => { called = true; return Promise.resolve({ ok: true, json: async () => VIN }); });
  const d = await decodeVin('NOT-A-VIN');
  __setFetch(null);
  assert.equal(d, null);
  assert.equal(called, false); // rejected before any network call
});

// ── summary ──────────────────────────────────────────────────────────────────────────────────────────
test('summary aggregates recalls + complaints with fire/injury tallies', async () => {
  __setFetch(router({ 'recallsByVehicle': RECALLS, 'complaintsByVehicle': COMPLAINTS }));
  const s = await summary({ make: 'Honda', model: 'Accord', modelYear: '2021' });
  __setFetch(null);
  assert.equal(s.recalls, 2);
  assert.equal(s.complaints, 2);
  assert.equal(s.fires, 1);
  assert.equal(s.injuries, 1);
  assert.equal(s.deaths, 0);
  assert.equal(s.source, SOURCE);
  assert.equal(s.license, 'public-domain');
});

// ── renderPage: three views, all escaped ─────────────────────────────────────────────────────────────
test('renderPage renders an escaped recalls table', () => {
  const html = renderPage({ recalls: [{
    campaign: '20V<script>', component: 'AIR BAGS', summary: 'a & b', consequence: 'c',
    remedy: 'r', date: '2020-03-15',
  }] });
  assert.equal(html.includes('<script>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('NHTSA'));
});

test('renderPage renders an escaped VIN-decode card and a complaints table', () => {
  const vinHtml = renderPage({ vin: { vin: '1HGCM82633A004352', make: 'HONDA', model: '<b>x</b>', modelYear: '2003' } });
  assert.ok(vinHtml.includes('VIN Decode'));
  assert.equal(vinHtml.includes('<b>x</b>'), false);
  assert.ok(vinHtml.includes('&lt;b&gt;x&lt;/b&gt;'));
  const compHtml = renderPage({ complaints: [] });
  assert.ok(compHtml.includes('No complaints found.'));
});

// ── dataNote ─────────────────────────────────────────────────────────────────────────────────────────
test('dataNote includes NHTSA source, public domain, and an as-of date', () => {
  const note = dataNote();
  assert.ok(/NHTSA/i.test(note));
  assert.ok(/public domain/i.test(note));
  assert.ok(/as of \d{4}-\d{2}-\d{2}/i.test(note));
});
