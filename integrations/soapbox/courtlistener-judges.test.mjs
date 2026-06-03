// courtlistener-judges.test.mjs — offline tests for the CourtListener v4 people/judges reader.
// Network stubbed via __setFetch; no live calls. Works keyless (no token required).
// Run: node --test integrations/soapbox/courtlistener-judges.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchJudges, judgeProfile, judgePositions, authoredOpinionCount, financialDisclosures,
  normalizeJudge, normalizePosition, idFromUrl, slugFromUrl, renderPage, dataNote, __setFetch,
} from './courtlistener-judges.mjs';

const RAW_PERSON = {
  id: 2724, name_first: 'Sonia', name_middle: 'Maria', name_last: 'Sotomayor',
  date_dob: '1954-06-25', fjc_id: 2189,
  positions: [{}, {}, {}], financial_disclosures: [{}, {}],
  resource_uri: 'https://www.courtlistener.com/api/rest/v4/people/2724/',
};
const RAW_POSITIONS = [
  { position_type: 'Justice', court_str: 'Supreme Court of the United States', date_start: '2009-08-08',
    date_termination: '', how_selected: 'Appointment Presidential', nomination_process: 'U.S. Senate',
    appointer: 'https://www.courtlistener.com/api/rest/v4/positions/9999/' },
  { position_type: 'Judge', court: 'https://www.courtlistener.com/api/rest/v4/courts/ca2/',
    date_start: '1998-10-13', date_termination: '2009-08-08', how_selected: 'Appointment Presidential' },
];

function envelopeFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function captureFetch(sink, payload) {
  return async (u) => { sink.url = String(u); return { ok: true, json: async () => payload }; };
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('idFromUrl extracts the numeric id from a resource URL', () => {
  assert.equal(idFromUrl('https://www.courtlistener.com/api/rest/v4/people/2724/'), '2724');
  assert.equal(idFromUrl('.../positions/9999'), '9999');
  assert.equal(idFromUrl(''), '');
  assert.equal(idFromUrl(null), '');
});

test('slugFromUrl extracts alphanumeric court slugs', () => {
  assert.equal(slugFromUrl('https://www.courtlistener.com/api/rest/v4/courts/ca2/'), 'ca2');
  assert.equal(slugFromUrl('.../courts/scotus/'), 'scotus');
  assert.equal(slugFromUrl(''), '');
});

test('normalizeJudge flattens a person record with provenance', () => {
  const j = normalizeJudge(RAW_PERSON);
  assert.equal(j.personId, '2724');
  assert.equal(j.name, 'Sonia Maria Sotomayor');
  assert.equal(j.positionCount, 3);
  assert.equal(j.hasFinancialDisclosures, true);
  assert.match(j.resourceUrl, /\/people\/2724\/$/);
  assert.equal(j.source, 'CourtListener (Free Law Project)');
  assert.match(j.license, /Free Law Project/);
});

test('normalizeJudge falls back to resource_uri id and returns null when unusable', () => {
  const j = normalizeJudge({ name_last: 'Doe', resource_uri: '.../people/55/' });
  assert.equal(j.personId, '55');
  assert.equal(normalizeJudge(null), null);
  assert.equal(normalizeJudge({}), null);
});

test('normalizePosition extracts court + appointment facts (no verdict)', () => {
  const p0 = normalizePosition(RAW_POSITIONS[0]);
  assert.equal(p0.positionType, 'Justice');
  assert.equal(p0.court, 'Supreme Court of the United States');
  assert.equal(p0.dateStart, '2009-08-08');
  assert.equal(p0.appointer, '9999'); // pulled from the appointer URL
  const p1 = normalizePosition(RAW_POSITIONS[1]);
  assert.equal(p1.court, 'ca2'); // court id pulled from URL when court_str absent
  assert.equal(normalizePosition(null), null);
});

test('searchJudges queries name_last and normalizes results', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_PERSON] }));
  const rows = await searchJudges({ q: 'Sotomayor' });
  __setFetch(null);
  assert.match(sink.url, /name_last=Sotomayor/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Sonia Maria Sotomayor');
});

test('searchJudges soft-fails to [] on empty query, error, and bad shape', async () => {
  assert.deepEqual(await searchJudges({ q: '' }), []);
  __setFetch(throwingFetch());
  assert.deepEqual(await searchJudges({ q: 'x' }), []);
  __setFetch(envelopeFetch({ nope: true }));
  assert.deepEqual(await searchJudges({ q: 'x' }), []);
  __setFetch(null);
});

test('judgeProfile returns one normalized card or null', async () => {
  __setFetch(envelopeFetch(RAW_PERSON));
  const j = await judgeProfile(2724);
  __setFetch(null);
  assert.equal(j.personId, '2724');
  assert.equal(await judgeProfile(''), null);
});

test('judgePositions normalizes the positions list', async () => {
  __setFetch(envelopeFetch({ results: RAW_POSITIONS }));
  const ps = await judgePositions(2724);
  __setFetch(null);
  assert.equal(ps.length, 2);
  assert.equal(ps[0].positionType, 'Justice');
  assert.equal(ps[1].dateTermination, '2009-08-08');
  assert.deepEqual(await judgePositions(''), []);
});

test('authoredOpinionCount reads the count envelope field', async () => {
  __setFetch(envelopeFetch({ count: 1234, results: [] }));
  const n = await authoredOpinionCount(2724);
  __setFetch(null);
  assert.equal(n, 1234);
  assert.equal(await authoredOpinionCount(''), null);
  __setFetch(envelopeFetch({ results: [] })); // no count → null
  assert.equal(await authoredOpinionCount(2724), null);
  __setFetch(null);
});

test('financialDisclosures returns POINTERS only (year + url), not line items', async () => {
  __setFetch(envelopeFetch({ results: [
    { id: 501, year: 2022 },
    { resource_uri: '.../financial-disclosures/502/', year: 2021 },
    { year: 2020 }, // no id → dropped
  ] }));
  const ds = await financialDisclosures(2724);
  __setFetch(null);
  assert.equal(ds.length, 2);
  assert.equal(ds[0].disclosureId, '501');
  assert.equal(ds[0].year, 2022);
  assert.match(ds[0].url, /\/financial-disclosures\/501\/$/);
  assert.equal(ds[1].disclosureId, '502');
  assert.deepEqual(await financialDisclosures(''), []);
});

test('renderPage renders facts (positions, opinion count, disclosure links) and escapes injection', () => {
  const html = renderPage({
    judge: { name: '<script>x</script>', personId: '2724' },
    opinionCount: 1234,
    positions: [{ positionType: 'Justice', court: 'SCOTUS', dateStart: '2009-08-08', dateTermination: '', howSelected: 'Appointment Presidential' }],
    disclosures: [{ disclosureId: '501', year: 2022, url: 'https://www.courtlistener.com/api/rest/v4/financial-disclosures/501/' }],
  });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Authored opinions on record: 1234'));
  assert.ok(html.includes('SCOTUS'));
  assert.ok(html.includes('financial-disclosures/501'));
  assert.ok(html.includes('source: CourtListener'));
});

test('renderPage handles missing data without throwing', () => {
  assert.ok(renderPage({}).includes('No positions on record'));
  assert.ok(renderPage({ judge: {}, positions: [] }).includes('</section>'));
});

test('dataNote names CourtListener / Free Law Project + right-of-reply path', () => {
  const n = dataNote();
  assert.match(n, /CourtListener/);
  assert.match(n, /Free Law Project/);
  assert.match(n, /corrections via/);
});
