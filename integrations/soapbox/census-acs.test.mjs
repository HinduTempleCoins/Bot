// census-acs.test.mjs — OFFLINE tests for the ACS "know your community" reader.
// All network is mocked via __setFetch with canned Census JSON (header-row + data-row shape).
// Run: node --test integrations/soapbox/census-acs.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  profile,
  variable,
  compare,
  renderPage,
  dataNote,
  buildUrl,
  geoClause,
  parseAcsRow,
  deriveProfile,
  __setFetch,
  VINTAGE,
  PROFILE_VARS,
} from './census-acs.mjs';

// A canned ACS response: header row then one data row. Variable order matches NAME + PROFILE_VARS.
// Values: pop=864816, MHI=126187, age=38.3, rent=2086, occUnits=362648, ownerUnits=132306,
//   edu25plus=700000, bach=180000, mast=90000, prof=20000, doc=15000, povUniv=850000, povBelow=85000.
function cannedRow(name = 'San Francisco city, California') {
  const header = ['NAME', ...PROFILE_VARS, 'state', 'place'];
  const row = [
    name,
    '864816', '126187', '38.3', '2086',
    '362648', '132306',
    '700000', '180000', '90000', '20000', '15000',
    '850000', '85000',
    '06', '67000',
  ];
  return [header, row];
}

function mockFetch(json, { ok = true } = {}) {
  return async () => ({ ok, json: async () => json });
}

test('parseAcsRow flattens header + first data row into a var map', () => {
  const map = parseAcsRow(cannedRow());
  assert.equal(map.NAME, 'San Francisco city, California');
  assert.equal(map.B01003_001E, '864816');
  assert.equal(map.B19013_001E, '126187');
});

test('parseAcsRow soft-fails on malformed shape', () => {
  assert.equal(parseAcsRow(null), null);
  assert.equal(parseAcsRow([]), null);
  assert.equal(parseAcsRow([['only-header']]), null);
  assert.equal(parseAcsRow('nope'), null);
});

test('deriveProfile computes stats + derived percentages', () => {
  const p = deriveProfile(parseAcsRow(cannedRow()));
  assert.equal(p.population, 864816);
  assert.equal(p.medianHouseholdIncome, 126187);
  assert.equal(p.medianAge, 38.3);
  assert.equal(p.medianRent, 2086);
  assert.equal(p.ownerOccupiedPct, 36.5); // 132306/362648
  assert.equal(p.bachelorsPlusPct, 43.6); // (180000+90000+20000+15000)/700000
  assert.equal(p.povertyPct, 10);          // 85000/850000
  assert.equal(p.vintage, VINTAGE);
});

test('deriveProfile treats ACS negative sentinels + missing as null', () => {
  const header = ['NAME', 'B01003_001E', 'B19013_001E'];
  const row = ['Nowhere', '-666666666', ''];
  const p = deriveProfile(parseAcsRow([header, row]));
  assert.equal(p.population, null);
  assert.equal(p.medianHouseholdIncome, null);
  // missing tenure vars → pct null, never throws
  assert.equal(p.ownerOccupiedPct, null);
});

test('profile parses the canned ACS response into the stats', async () => {
  __setFetch(mockFetch(cannedRow()));
  const p = await profile({ state: '06', place: '67000' });
  assert.equal(p.name, 'San Francisco city, California');
  assert.equal(p.population, 864816);
  assert.equal(p.medianHouseholdIncome, 126187);
  assert.equal(p.ownerOccupiedPct, 36.5);
  __setFetch(null);
});

test('profile soft-fails to null on fetch error', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.equal(await profile({ state: '06' }), null);
  __setFetch(mockFetch(null, { ok: false }));
  assert.equal(await profile({ state: '06' }), null);
  __setFetch(null);
});

test('variable builds the get=...&for=... query and returns the var map', async () => {
  let seenUrl = null;
  __setFetch(async (url) => { seenUrl = url; return { ok: true, json: async () => cannedRow() }; });
  const map = await variable({ geo: { state: '06', place: '67000' }, vars: ['B01003_001E'] });
  assert.ok(seenUrl.includes('get=NAME,B01003_001E'), `get clause missing: ${seenUrl}`);
  assert.ok(seenUrl.includes('for=place:67000'), `for clause missing: ${seenUrl}`);
  assert.ok(seenUrl.includes('in=state:06'), `in clause missing: ${seenUrl}`);
  assert.equal(map.B01003_001E, '864816');
  __setFetch(null);
});

test('geoClause picks the most-specific geography', () => {
  assert.equal(geoClause({ state: '06', place: '67000' }), 'for=place:67000&in=state:06');
  assert.equal(geoClause({ state: '06', county: '075' }), 'for=county:075&in=state:06');
  assert.equal(geoClause({ state: '06' }), 'for=state:06');
  assert.equal(geoClause({}), 'for=us:1');
});

test('compare lines up profiles for several places', async () => {
  __setFetch(async (url) => ({
    ok: true,
    json: async () => (url.includes('place:67000')
      ? cannedRow('San Francisco city, California')
      : cannedRow('Oakland city, California')),
  }));
  const out = await compare([
    { state: '06', place: '67000' },
    { state: '06', place: '53000' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'San Francisco city, California');
  assert.equal(out[1].name, 'Oakland city, California');
  __setFetch(null);
});

test('compare keeps a failed place as null without sinking the rest', async () => {
  let n = 0;
  __setFetch(async () => {
    n += 1;
    if (n === 1) throw new Error('boom');
    return { ok: true, json: async () => cannedRow('Oakland city, California') };
  });
  const out = await compare([{ state: '06', place: '00000' }, { state: '06', place: '53000' }]);
  assert.equal(out[0], null);
  assert.equal(out[1].name, 'Oakland city, California');
  __setFetch(null);
});

test('renderPage escapes a malicious place name', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage(deriveProfile(parseAcsRow(cannedRow(evil))));
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag leaked');
  assert.ok(html.includes('&lt;script&gt;'), 'name not HTML-escaped');
});

test('renderPage renders a compare panel and a no-data fallback', () => {
  const a = deriveProfile(parseAcsRow(cannedRow('A')));
  const b = deriveProfile(parseAcsRow(cannedRow('B')));
  const html = renderPage({ profiles: [a, b] });
  assert.ok(html.includes('<th>A</th>') && html.includes('<th>B</th>'));
  assert.ok(renderPage(null).includes('No Census data'));
});

test('dataNote names ACS + vintage', () => {
  const note = dataNote();
  assert.ok(/American Community Survey|ACS/.test(note));
  assert.ok(note.includes(String(VINTAGE)));
  assert.ok(dataNote({ vintage: 2099 }).includes('2099'));
});

test('CENSUS_API_KEY is referenced by env NAME only (no literal key), appended when set', () => {
  const src = readSource();
  assert.ok(src.includes('process.env.CENSUS_API_KEY'), 'should read key by env name');

  const prev = process.env.CENSUS_API_KEY;
  delete process.env.CENSUS_API_KEY;
  const keyless = buildUrl({ geo: { state: '06' } });
  assert.ok(!keyless.includes('key='), `keyless URL should omit key: ${keyless}`);

  process.env.CENSUS_API_KEY = 'ENV_PROVIDED_TOKEN';
  const keyed = buildUrl({ geo: { state: '06' } });
  assert.ok(keyed.includes('key=ENV_PROVIDED_TOKEN'), 'key from env should appear in URL');

  if (prev == null) delete process.env.CENSUS_API_KEY; else process.env.CENSUS_API_KEY = prev;
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
function readSource() {
  return readFileSync(fileURLToPath(new URL('./census-acs.mjs', import.meta.url)), 'utf8');
}
