// epa-enviro.test.mjs — OFFLINE guards for the SoapBox "is my air/water/neighborhood safe" reader. Fake
// fetch only; asserts normalization + soft-fail + summary aggregation + escaping + keyless-by-default with
// AIRNOW_API_KEY read by env NAME. No network.
// Run: node --test integrations/soapbox/epa-enviro.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, airQuality, facilitiesNear, toxicReleases, summary, renderPage, dataNote,
} from './epa-enviro.mjs';

// minimal Response-like stub
const res = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// route a fake fetch by URL substring.
function route(map) {
  __setFetch(async (url) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(map)) {
      if (u.includes(needle)) return typeof body === 'function' ? body(u) : res(body);
    }
    return res({}, false); // unmatched → not-ok → source soft-fails
  });
}

const restore = () => { __setFetch(null); delete process.env.AIRNOW_API_KEY; };

test('airQuality() normalizes a canned AQI (keyless Open-Meteo fallback)', async () => {
  // no AIRNOW_API_KEY → keyless fallback path via coords.
  route({
    'air-quality-api.open-meteo.com': {
      current: { time: '2026-06-03T12:00', us_aqi: 142, pm2_5: 55.3, pm10: 60, ozone: 30, nitrogen_dioxide: 10 },
    },
  });
  const aq = await airQuality({ lat: 34.07, lon: -118.40 });
  assert.equal(aq.aqi, 142);
  assert.equal(aq.category, 'Unhealthy for Sensitive Groups');
  assert.equal(aq.pollutant, 'PM10'); // pm10=60 is the highest raw concentration
  assert.match(aq.source, /keyless fallback/);
  restore();
});

test('airQuality() uses AirNow when AIRNOW_API_KEY is set (and normalizes worst row)', async () => {
  process.env.AIRNOW_API_KEY = 'unit-test-key';
  let seen = '';
  __setFetch(async (url) => {
    seen = String(url);
    if (seen.includes('airnowapi.org')) {
      return res([
        { ParameterName: 'O3', AQI: 48, Category: { Name: 'Good' }, DateObserved: '2026-06-03' },
        { ParameterName: 'PM2.5', AQI: 88, Category: { Name: 'Moderate' }, DateObserved: '2026-06-03' },
      ]);
    }
    return res({}, false);
  });
  const aq = await airQuality({ zip: '90210' });
  assert.match(seen, /airnowapi\.org/);
  assert.match(seen, /API_KEY=unit-test-key/); // key read by NAME from env, attached to AirNow URL
  assert.equal(aq.aqi, 88); // worst of the two rows
  assert.equal(aq.category, 'Moderate');
  assert.equal(aq.pollutant, 'PM2.5');
  assert.equal(aq.source, 'EPA AirNow');
  restore();
});

test('airQuality() soft-fails to null', async () => {
  route({}); // everything unmatched → not-ok
  assert.equal(await airQuality({ lat: 1, lon: 2 }), null);
  assert.equal(await airQuality({}), null, 'no zip + no coords → null, no network');
  restore();
});

test('facilitiesNear() normalizes ECHO facilities + flags violations', async () => {
  route({
    'echodata.epa.gov': {
      Results: {
        Facilities: [
          { FacName: 'Acme Plating', StatuteCodes: 'CWA', CurrVioFlag: 'Y', LastInspDate: '2025-09-01' },
          { FacName: 'Clean Co', StatuteCodes: 'CAA', CurrVioFlag: 'N', ComplianceStatus: 'In compliance', LastInspDate: '2026-01-15' },
          { FacName: '' }, // no name + no program → dropped
        ],
      },
    },
  });
  const f = await facilitiesNear({ lat: 34.07, lon: -118.40, radiusMiles: 3 });
  assert.equal(f.length, 2, 'empty facility dropped');
  assert.equal(f[0].name, 'Acme Plating');
  assert.equal(f[0].program, 'CWA');
  assert.equal(f[0].inViolation, true);
  assert.equal(f[0].lastInspection, '2025-09-01');
  assert.equal(f[0].source, 'EPA ECHO');
  assert.equal(f[1].inViolation, false);
  assert.equal(f[1].status, 'In compliance');
  restore();
});

test('facilitiesNear() soft-fails to [] (bad response + missing coords)', async () => {
  route({});
  assert.deepEqual(await facilitiesNear({ lat: 1, lon: 2 }), []);
  assert.deepEqual(await facilitiesNear({}), [], 'no coords → [] without network');
  restore();
});

test('toxicReleases() normalizes TRI facilities from Envirofacts', async () => {
  route({
    'data.epa.gov/efservice/TRI_FACILITY': [
      { FACILITY_NAME: 'Industrial Solvents Inc', CHEMICAL: 'Toluene', TOTAL_RELEASES: 12500, REPORTING_YEAR: 2024, CITY_NAME: 'Beverly Hills', STATE_ABBR: 'CA', ZIP_CODE: '90210' },
      { facility_name: 'Paint Works', chem_name: 'Xylene', total_releases: 800 },
      { CHEMICAL: 'NoName' }, // no facility name → dropped
    ],
  });
  const t = await toxicReleases({ zip: '90210', year: 2024 });
  assert.equal(t.length, 2, 'rows without a facility name are dropped');
  assert.equal(t[0].name, 'Industrial Solvents Inc');
  assert.equal(t[0].chemical, 'Toluene');
  assert.equal(t[0].releaseLbs, 12500);
  assert.equal(t[0].year, 2024);
  assert.equal(t[0].state, 'CA');
  assert.equal(t[0].source, 'EPA Envirofacts (TRI)');
  assert.equal(t[1].year, 2024, 'falls back to requested year when row omits it');
  restore();
});

test('toxicReleases() soft-fails to [] (bad response + missing zip)', async () => {
  route({});
  assert.deepEqual(await toxicReleases({ zip: '90210' }), []);
  assert.deepEqual(await toxicReleases({}), [], 'no zip → [] without network');
  restore();
});

test('summary() aggregates AQI + facility count + violations + toxic pounds', () => {
  const s = summary({
    air: { aqi: 142, category: 'Unhealthy for Sensitive Groups', pollutant: 'PM2.5' },
    facilities: [
      { name: 'A', inViolation: true },
      { name: 'B', inViolation: false },
      { name: 'C', inViolation: true },
    ],
    toxics: [{ name: 'X', releaseLbs: 1000 }, { name: 'Y', releaseLbs: 250.5 }],
  });
  assert.equal(s.aqi, 142);
  assert.equal(s.facilityCount, 3);
  assert.equal(s.violationCount, 2);
  assert.equal(s.toxicFacilityCount, 2);
  assert.equal(s.toxicReleaseLbs, 1251); // rounded total
  assert.equal(s.concern, true); // bad air + violations + releases
});

test('summary() is safe on empty input (no concern flagged)', () => {
  const s = summary({});
  assert.equal(s.aqi, null);
  assert.equal(s.facilityCount, 0);
  assert.equal(s.violationCount, 0);
  assert.equal(s.toxicReleaseLbs, 0);
  assert.equal(s.concern, false);
  assert.equal(s.aqiCategory, 'Unknown');
});

test('renderPage() escapes a malicious facility name', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    air: { aqi: 40, category: 'Good', pollutant: 'Ozone', source: 'EPA AirNow' },
    facilities: [{ name: evil, program: 'CWA', status: 'Current violation', lastInspection: '2025-01-01', inViolation: true }],
    toxics: [{ name: evil, chemical: 'Toluene', releaseLbs: 100, year: 2024 }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not survive');
  assert.ok(html.includes('&lt;script&gt;'), 'facility name is HTML-escaped');
  assert.ok(html.includes('EPA AirNow'), 'air source rendered');
});

test('dataNote() carries the source + an as-of date', () => {
  const n = dataNote();
  assert.match(n, /EPA AirNow \/ ECHO \/ Envirofacts/);
  assert.match(n, /as of \d{4}-\d{2}-\d{2}/);
});

test('module is keyless by default — AIRNOW_API_KEY is referenced by env NAME, never literal', async () => {
  // Source has no hard-coded key literal.
  const src = await import('node:fs').then((fs) => fs.promises.readFile(new URL('./epa-enviro.mjs', import.meta.url), 'utf8'));
  assert.match(src, /process\.env\.AIRNOW_API_KEY/, 'key read by env name');

  // Without the key, airQuality never touches AirNow — it uses the keyless source.
  let hitAirNow = false;
  __setFetch(async (url) => {
    if (String(url).includes('airnowapi.org')) hitAirNow = true;
    return res({ current: { time: 't', us_aqi: 20, pm2_5: 5 } });
  });
  const aq = await airQuality({ lat: 1, lon: 1 });
  assert.equal(hitAirNow, false, 'no key → AirNow not called');
  assert.match(aq.source, /keyless fallback/);
  restore();
});
