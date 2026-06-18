// congress-legislators.test.mjs — offline tests for the @unitedstates/congress-legislators reader.
// All network is stubbed via __setFetch with canned JSON; no live calls, no keys.
// Run: node --test integrations/soapbox/congress-legislators.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  currentLegislators, findByBioguide, findByName, committees,
  idCrosswalk, normalizeLegislator, renderPage, dataNote, SOURCE_URLS, __setFetch,
} from './congress-legislators.mjs';

// raw legislators-current.json fixture (trimmed to the fields the reader uses).
const RAW_LEGISLATORS = [
  {
    id: { bioguide: 'W000817', fec: ['S0MA00170'], opensecrets: 'N00033492', govtrack: 412542, wikidata: 'Q434706', icpsr: 41301 },
    name: { first: 'Elizabeth', last: 'Warren', official_full: 'Elizabeth Warren' },
    bio: { gender: 'F' },
    terms: [{ type: 'sen', state: 'MA', party: 'Democrat', start: '2013-01-03', end: '2025-01-03' }],
  },
  {
    id: { bioguide: 'O000172', fec: ['H8NY15148'], govtrack: 412804 },
    name: { first: 'Alexandria', last: 'Ocasio-Cortez', official_full: 'Alexandria Ocasio-Cortez' },
    terms: [{ type: 'rep', state: 'NY', district: 14, party: 'Democrat', start: '2023-01-03', end: '2025-01-03' }],
  },
  {
    id: { bioguide: 'C001098' },
    name: { first: 'Ted', last: 'Cruz', official_full: 'Ted Cruz' },
    terms: [{ type: 'sen', state: 'TX', party: 'Republican', start: '2013-01-03', end: '2025-01-03' }],
  },
  { name: {}, terms: [] }, // unusable → dropped
];

const RAW_COMMITTEES = [
  { type: 'senate', name: 'Committee on Banking, Housing, and Urban Affairs', thomas_id: 'SSBK', url: 'https://www.banking.senate.gov',
    subcommittees: [{ name: 'Securities, Insurance, and Investment', thomas_id: '01' }] },
  { type: 'house', name: 'Committee on Oversight and Accountability', thomas_id: 'HSGO', subcommittees: [] },
];

function jsonFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function byUrlFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find((k) => String(url).includes(k));
    return { ok: true, json: async () => (key ? map[key] : null) };
  };
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('normalizeLegislator flattens a senator into a public-record card', () => {
  const r = normalizeLegislator(RAW_LEGISLATORS[0]);
  assert.equal(r.bioguide, 'W000817');
  assert.equal(r.name, 'Elizabeth Warren');
  assert.equal(r.chamber, 'Senate');
  assert.equal(r.state, 'MA');
  assert.equal(r.party, 'Democrat');
  assert.equal(r.district, '');
  assert.deepEqual(r.ids.fec, ['S0MA00170']);
});

test('normalizeLegislator maps a representative with a district', () => {
  const r = normalizeLegislator(RAW_LEGISLATORS[1]);
  assert.equal(r.chamber, 'House');
  assert.equal(r.state, 'NY');
  assert.equal(r.district, '14');
});

test('normalizeLegislator returns null for unusable input', () => {
  assert.equal(normalizeLegislator(null), null);
  assert.equal(normalizeLegislator({ name: {}, terms: [] }), null);
  assert.equal(normalizeLegislator('nope'), null);
});

test('idCrosswalk surfaces the join keys, omitting empties', () => {
  const x = idCrosswalk(RAW_LEGISLATORS[0]);
  assert.equal(x.bioguide, 'W000817');
  assert.deepEqual(x.fec, ['S0MA00170']);
  assert.equal(x.opensecrets, 'N00033492');
  assert.equal(x.govtrack, '412542');
  assert.equal(x.wikidata, 'Q434706');
  // a member with only a bioguide has no fec/opensecrets keys
  const y = idCrosswalk(RAW_LEGISLATORS[2]);
  assert.equal(y.bioguide, 'C001098');
  assert.ok(!('fec' in y));
  assert.ok(!('opensecrets' in y));
});

test('currentLegislators normalizes, tags provenance, drops the unusable row', async () => {
  __setFetch(jsonFetch(RAW_LEGISLATORS));
  const rows = await currentLegislators();
  __setFetch(null);
  assert.equal(rows.length, 3); // the empty 4th row dropped
  assert.equal(rows[0].source, '@unitedstates/congress-legislators');
  assert.match(rows[0].license, /CC0/);
  assert.ok(rows[0].fetchedAt);
});

test('currentLegislators filters by chamber and state (public-capacity)', async () => {
  __setFetch(jsonFetch(RAW_LEGISLATORS));
  const senate = await currentLegislators({ chamber: 'Senate' });
  const ma = await currentLegislators({ state: 'ma' });
  __setFetch(null);
  assert.equal(senate.length, 2); // Warren + Cruz
  assert.equal(ma.length, 1);
  assert.equal(ma[0].name, 'Elizabeth Warren');
});

test('currentLegislators soft-fails to [] on network error and bad shape', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await currentLegislators(), []);
  __setFetch(jsonFetch({ not: 'an array' }));
  assert.deepEqual(await currentLegislators(), []);
  __setFetch(null);
});

test('findByBioguide returns the matching member or null', async () => {
  __setFetch(jsonFetch(RAW_LEGISLATORS));
  const r = await findByBioguide('o000172'); // case-insensitive
  const miss = await findByBioguide('Z999999');
  __setFetch(null);
  assert.equal(r.name, 'Alexandria Ocasio-Cortez');
  assert.equal(miss, null);
  assert.equal(await findByBioguide(''), null);
});

test('findByName does case-insensitive substring matching', async () => {
  __setFetch(jsonFetch(RAW_LEGISLATORS));
  const rows = await findByName('cru');
  __setFetch(null);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Ted Cruz');
  assert.deepEqual(await findByName(''), []);
});

test('committees normalizes standing committees + subcommittees', async () => {
  __setFetch(byUrlFetch({ 'committees-current.json': RAW_COMMITTEES }));
  const cs = await committees();
  __setFetch(null);
  assert.equal(cs.length, 2);
  assert.equal(cs[0].name, 'Committee on Banking, Housing, and Urban Affairs');
  assert.equal(cs[0].thomasId, 'SSBK');
  assert.equal(cs[0].subcommittees.length, 1);
  assert.equal(cs[0].subcommittees[0].name, 'Securities, Insurance, and Investment');
  assert.match(cs[0].license, /CC0/);
});

test('committees soft-fails to [] on bad shape', async () => {
  __setFetch(jsonFetch(null));
  assert.deepEqual(await committees(), []);
  __setFetch(null);
});

test('renderPage renders members as facts and escapes injection', () => {
  const html = renderPage([
    { name: '<script>x</script>', chamber: 'Senate', state: 'MA', district: '', party: 'Democrat', bioguide: 'W000817' },
  ]);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Members of Congress'));
  assert.ok(html.includes('source:'));
});

test('renderPage handles a single card and empty input without throwing', () => {
  const one = renderPage({ name: 'Ted Cruz', chamber: 'Senate', state: 'TX', district: '', party: 'Republican', bioguide: 'C001098' });
  assert.ok(one.includes('Ted Cruz'));
  assert.ok(renderPage([]).includes('No members found'));
  assert.ok(renderPage(null).includes('No members found'));
});

test('dataNote names the open dataset, license, and right-of-reply path', () => {
  const n = dataNote();
  assert.match(n, /congress-legislators/);
  assert.match(n, /CC0/);
  assert.match(n, /corrections via github\.com/);
});

test('SOURCE_URLS point at the published congress-legislators JSON', () => {
  assert.match(SOURCE_URLS.legislators, /legislators-current\.json$/);
  assert.match(SOURCE_URLS.committees, /committees-current\.json$/);
  // generated JSON lives on the project GitHub Pages site (the old raw .../main/*.json 404s)
  assert.match(SOURCE_URLS.legislators, /^https:\/\/unitedstates\.github\.io\/congress-legislators\//);
});
