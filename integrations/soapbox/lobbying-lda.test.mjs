// lobbying-lda.test.mjs — offline tests for the Senate LDA lobbying-disclosure reader.
// Network stubbed via __setFetch; no live calls. Works unauthenticated (no key required).
// Run: node --test integrations/soapbox/lobbying-lda.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filingsByRegistrant, filingsByClient, searchFilings,
  normalizeFiling, renderPage, dataNote, __setFetch,
} from './lobbying-lda.mjs';

const RAW_FILINGS = [
  {
    filing_uuid: 'aaaa-1111', filing_year: 2024, filing_period_display: 'First Quarter', dt_posted: '2024-04-20',
    filing_type_display: 'Quarterly Report', income: 250000, expenses: null,
    registrant: { name: 'Akin Gump Strauss Hauer & Feld LLP' },
    client: { name: 'Pfizer Inc.', general_description: 'Pharmaceutical manufacturer' },
    lobbying_activities: [
      { general_issue_code_display: 'Health Issues' },
      { general_issue_code_display: 'Medicare/Medicaid' },
      { general_issue_code_display: 'Health Issues' }, // dup → deduped
    ],
    filing_document_url: 'https://lda.senate.gov/filings/public/filing/aaaa-1111/print/',
  },
  {
    filing_uuid: 'bbbb-2222', filing_year: 2022, filing_period_display: 'Year-End', dt_posted: '2023-01-20',
    income: null, expenses: 40000,
    registrant: { name: 'Akin Gump Strauss Hauer & Feld LLP' },
    client: { name: 'Pfizer Inc.' },
    lobbying_activities: [{ general_issue_code_display: 'Trade (Domestic & Foreign)' }],
  },
  { filing_uuid: '', registrant: {}, client: {} }, // unusable → dropped
];

function paginatedFetch(results, { ok = true } = {}) {
  return async () => ({ ok, json: async () => ({ count: results == null ? 0 : results.length, results }) });
}
function captureFetch(sink, results) {
  return async (u) => { sink.url = String(u); return { ok: true, json: async () => ({ results }) }; };
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('normalizeFiling flattens a filing and dedupes issue codes', () => {
  const f = normalizeFiling(RAW_FILINGS[0]);
  assert.equal(f.filingId, 'aaaa-1111');
  assert.equal(f.year, 2024);
  assert.equal(f.registrant, 'Akin Gump Strauss Hauer & Feld LLP');
  assert.equal(f.client, 'Pfizer Inc.');
  assert.equal(f.income, 250000);
  assert.deepEqual(f.issues, ['Health Issues', 'Medicare/Medicaid']); // deduped
  assert.match(f.documentUrl, /lda\.senate\.gov/);
  assert.equal(f.source, 'U.S. Senate LDA disclosures');
  assert.match(f.license, /public record/);
});

test('normalizeFiling returns null for unusable input', () => {
  assert.equal(normalizeFiling(null), null);
  assert.equal(normalizeFiling({ filing_uuid: '', registrant: {}, client: {} }), null);
  assert.equal(normalizeFiling('x'), null);
});

test('filingsByRegistrant normalizes + sorts newest year first', async () => {
  __setFetch(paginatedFetch(RAW_FILINGS));
  const rows = await filingsByRegistrant({ name: 'Akin Gump' });
  __setFetch(null);
  assert.equal(rows.length, 2); // unusable dropped
  assert.equal(rows[0].year, 2024); // newest first
  assert.equal(rows[1].year, 2022);
});

test('filingsByRegistrant sends the registrant_name query param', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, [RAW_FILINGS[0]]));
  await filingsByRegistrant({ name: 'Akin Gump', year: 2024 });
  __setFetch(null);
  assert.match(sink.url, /registrant_name=Akin\+Gump/);
  assert.match(sink.url, /filing_year=2024/);
});

test('filingsByClient sends the client_name query param', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, RAW_FILINGS));
  const rows = await filingsByClient({ name: 'Pfizer' });
  __setFetch(null);
  assert.match(sink.url, /client_name=Pfizer/);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].client, 'Pfizer Inc.');
});

test('searchFilings uses the generic search param', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, [RAW_FILINGS[0]]));
  await searchFilings({ q: 'Medicare' });
  __setFetch(null);
  assert.match(sink.url, /search=Medicare/);
});

test('readers soft-fail to [] on empty arg, network error, and bad shape', async () => {
  assert.deepEqual(await filingsByRegistrant({ name: '' }), []);
  assert.deepEqual(await filingsByClient({ name: '' }), []);
  assert.deepEqual(await searchFilings({ q: '' }), []);
  __setFetch(throwingFetch());
  assert.deepEqual(await filingsByRegistrant({ name: 'x' }), []);
  __setFetch(paginatedFetch(null));
  assert.deepEqual(await filingsByClient({ name: 'x' }), []);
  __setFetch(null);
});

test('renderPage renders disclosed facts and escapes injection', () => {
  const html = renderPage([
    { year: 2024, registrant: '<i>R</i>', client: 'Pfizer Inc.', issues: ['Health Issues'], income: 250000, expenses: null },
  ]);
  assert.ok(!html.includes('<i>R</i>'));
  assert.ok(html.includes('&lt;i&gt;'));
  assert.ok(html.includes('Federal lobbying disclosures'));
  assert.ok(html.includes('$250.0K'));
  assert.ok(html.includes('Health Issues'));
  assert.ok(html.includes('source: U.S. Senate LDA'));
});

test('renderPage falls back to expenses when income is null, handles empty', () => {
  const html = renderPage([{ year: 2022, registrant: 'R', client: 'C', issues: [], income: null, expenses: 40000 }]);
  assert.ok(html.includes('$40.0K'));
  assert.ok(renderPage([]).includes('No filings found'));
  assert.ok(renderPage(null).includes('No filings found'));
});

test('dataNote names the Senate LDA, public record, and amended-filing right of reply', () => {
  const n = dataNote();
  assert.match(n, /Senate LDA/);
  assert.match(n, /Lobbying Disclosure Act/);
  assert.match(n, /amended filings/);
});
