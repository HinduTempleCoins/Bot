// federal-register.test.mjs — offline tests for the Federal Register reader. Network stubbed via
// __setFetch; no live calls. FR reads are keyless/open. Run:
//   node --test integrations/soapbox/federal-register.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TYPES, listDocuments, documentByNumber, recentByAgency, normalizeDoc,
  renderPage, dataNote, __setFetch,
} from './federal-register.mjs';

const RAW_DOC = {
  document_number: '2024-12345', title: 'National Ambient Air Quality Standards', type: 'Rule',
  publication_date: '2024-03-15', abstract: 'EPA is revising the standards for particulate matter.',
  agencies: [{ name: 'Environmental Protection Agency' }],
  html_url: 'https://www.federalregister.gov/documents/2024/03/15/2024-12345/naaqs',
  pdf_url: 'https://www.govinfo.gov/content/pkg/FR-2024-03-15/pdf/2024-12345.pdf',
};

function envelopeFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function captureFetch(sink, payload) { return async (u) => { sink.url = String(u); return { ok: true, json: async () => payload }; }; }
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('TYPES maps friendly slugs to FR API type codes', () => {
  assert.equal(TYPES.rule, 'RULE');
  assert.equal(TYPES['proposed-rule'], 'PRORULE');
  assert.equal(TYPES.notice, 'NOTICE');
  assert.equal(TYPES.presidential, 'PRESDOCU');
});

test('normalizeDoc flattens a document with public-domain provenance', () => {
  const d = normalizeDoc(RAW_DOC);
  assert.equal(d.documentNumber, '2024-12345');
  assert.equal(d.title, 'National Ambient Air Quality Standards');
  assert.equal(d.type, 'Rule');
  assert.deepEqual(d.agencies, ['Environmental Protection Agency']);
  assert.equal(d.publicationDate, '2024-03-15');
  assert.match(d.abstract, /particulate matter/);
  assert.equal(d.htmlUrl, RAW_DOC.html_url);
  assert.equal(d.license, 'public-domain');
  assert.match(d.source, /Federal Register/);
  assert.equal(normalizeDoc(null), null);
  assert.equal(normalizeDoc({}), null);
});

test('listDocuments filters by agency + friendly type + since date', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_DOC] }));
  const docs = await listDocuments({ agency: 'environmental-protection-agency', type: 'rule', since: '2024-01-01' });
  __setFetch(null);
  assert.match(sink.url, /\/documents\.json/);
  assert.match(sink.url, /conditions%5Bagencies%5D%5B%5D=environmental-protection-agency/);
  assert.match(sink.url, /conditions%5Btype%5D%5B%5D=RULE/);
  assert.match(sink.url, /conditions%5Bpublication_date%5D%5Bgte%5D=2024-01-01/);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].documentNumber, '2024-12345');
});

test('listDocuments ignores an unknown friendly type and still queries', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [] }));
  await listDocuments({ type: 'not-a-type' });
  __setFetch(null);
  assert.ok(!/conditions%5Btype%5D/.test(sink.url));
});

test('listDocuments soft-fails to [] on network error and bad shape', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await listDocuments({ agency: 'x' }), []);
  __setFetch(envelopeFetch({ nope: true }));
  assert.deepEqual(await listDocuments({ agency: 'x' }), []);
  __setFetch(null);
});

test('documentByNumber fetches one document by number', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, RAW_DOC));
  const d = await documentByNumber('2024-12345');
  __setFetch(null);
  assert.match(sink.url, /\/documents\/2024-12345\.json/);
  assert.equal(d.title, 'National Ambient Air Quality Standards');
  assert.equal(await documentByNumber(''), null);
});

test('recentByAgency delegates to listDocuments for one agency', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { results: [RAW_DOC] }));
  const docs = await recentByAgency('environmental-protection-agency');
  __setFetch(null);
  assert.match(sink.url, /conditions%5Bagencies%5D%5B%5D=environmental-protection-agency/);
  assert.equal(docs.length, 1);
});

test('renderPage renders a document list and escapes injection', () => {
  const html = renderPage({ query: 'EPA', documents: [normalizeDoc({ ...RAW_DOC, title: '<script>x</script>' })] });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('2024-03-15'));
  assert.ok(html.includes('Environmental Protection Agency'));
  assert.ok(html.includes('source: Federal Register'));
});

test('renderPage renders a single document with abstract + official links, handles empty', () => {
  const html = renderPage({ document: normalizeDoc(RAW_DOC) });
  assert.ok(html.includes('Type: Rule'));
  assert.ok(html.includes('particulate matter'));
  assert.ok(html.includes('official HTML'));
  assert.ok(html.includes('PDF'));
  assert.ok(renderPage({ documents: [] }).includes('No documents on record'));
});

test('dataNote names the Federal Register, public-domain, host-forever', () => {
  const n = dataNote();
  assert.match(n, /Federal Register/);
  assert.match(n, /public domain/);
  assert.match(n, /host-forever/);
});
