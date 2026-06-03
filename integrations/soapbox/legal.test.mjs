// legal.test.mjs — OFFLINE tests for the Legal vertical. Injected fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchOpinions, court, federalRegister, govInfo, legalSummary, __setFetch } from './legal.mjs';

const ok = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fail = () => ({ ok: false, status: 500, json: async () => ({}) });

test('searchOpinions normalizes results and strips HTML from snippet', async () => {
  __setFetch(async () => ok({ results: [
    { id: 1, caseName: 'Roe v. Wade', court: 'scotus', dateFiled: '1973-01-22',
      citation: ['410 U.S. 113'], docketNumber: '70-18', snippet: '<mark>abortion</mark> right',
      absolute_url: '/opinion/1/roe-v-wade/' },
  ] }));
  const r = await searchOpinions('abortion', { limit: 5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].caseName, 'Roe v. Wade');
  assert.equal(r[0].citation, '410 U.S. 113');
  assert.equal(r[0].snippet, 'abortion right', 'HTML stripped');
  assert.equal(r[0].url, 'https://www.courtlistener.com/opinion/1/roe-v-wade/');
  __setFetch(null);
});

test('searchOpinions returns [] for empty query (no fetch)', async () => {
  let called = false;
  __setFetch(async () => { called = true; return ok({ results: [] }); });
  const r = await searchOpinions('');
  assert.deepEqual(r, []);
  assert.equal(called, false, 'no network call for empty query');
  __setFetch(null);
});

test('searchOpinions soft-fails to [] on a bad response', async () => {
  __setFetch(async () => fail());
  assert.deepEqual(await searchOpinions('anything'), []);
  __setFetch(null);
});

test('searchOpinions respects limit', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i, caseName: `Case ${i}` }));
  __setFetch(async () => ok({ results: many }));
  const r = await searchOpinions('x', { limit: 3 });
  assert.equal(r.length, 3);
  __setFetch(null);
});

test('court normalizes a court record', async () => {
  __setFetch(async () => ok({ id: 'scotus', full_name: 'Supreme Court of the United States',
    jurisdiction: 'F', citation_string: 'U.S.', in_use: true, start_date: '1789-09-24' }));
  const c = await court('scotus');
  assert.equal(c.id, 'scotus');
  assert.equal(c.name, 'Supreme Court of the United States');
  assert.equal(c.inUse, true);
  __setFetch(null);
});

test('court soft-fails to null on empty id and on bad response', async () => {
  __setFetch(async () => fail());
  assert.equal(await court(''), null);
  assert.equal(await court('nope'), null);
  __setFetch(null);
});

test('federalRegister normalizes documents and agency names', async () => {
  __setFetch(async () => ok({ results: [
    { document_number: '2026-001', title: 'Executive Order on AI', type: 'Presidential Document',
      publication_date: '2026-01-15', abstract: 'about AI',
      agencies: [{ name: 'Executive Office of the President' }, { raw_name: 'noname' }],
      html_url: 'https://www.federalregister.gov/d/2026-001' },
  ] }));
  const r = await federalRegister('AI', { limit: 5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].documentNumber, '2026-001');
  assert.equal(r[0].type, 'Presidential Document');
  assert.deepEqual(r[0].agencies, ['Executive Office of the President'], 'nameless agency dropped');
  __setFetch(null);
});

test('federalRegister returns [] for empty query and soft-fails on error', async () => {
  __setFetch(async () => fail());
  assert.deepEqual(await federalRegister(''), []);
  assert.deepEqual(await federalRegister('x'), []);
  __setFetch(null);
});

test('govInfo soft-fails to null when no GOVINFO_API_KEY is set', async () => {
  const saved = process.env.GOVINFO_API_KEY;
  delete process.env.GOVINFO_API_KEY;
  let called = false;
  __setFetch(async () => { called = true; return ok({ results: [] }); });
  const r = await govInfo('tax');
  assert.equal(r, null);
  assert.equal(called, false, 'no request without a key');
  if (saved !== undefined) process.env.GOVINFO_API_KEY = saved;
  __setFetch(null);
});

test('govInfo normalizes results when a key is present', async () => {
  const saved = process.env.GOVINFO_API_KEY;
  process.env.GOVINFO_API_KEY = 'test-key';
  __setFetch(async () => ok({ results: [
    { title: 'Public Law 119-1', collectionName: 'Public and Private Laws', dateIssued: '2026-01-01',
      packageId: 'PLAW-119publ1', download: { pdfLink: 'https://api.govinfo.gov/x.pdf' } },
  ] }));
  const r = await govInfo('law', { limit: 5 });
  assert.equal(r.length, 1);
  assert.equal(r[0].collection, 'Public and Private Laws');
  assert.equal(r[0].url, 'https://api.govinfo.gov/x.pdf');
  if (saved === undefined) delete process.env.GOVINFO_API_KEY; else process.env.GOVINFO_API_KEY = saved;
  __setFetch(null);
});

test('govInfo soft-fails to [] on bad response when key present', async () => {
  const saved = process.env.GOVINFO_API_KEY;
  process.env.GOVINFO_API_KEY = 'test-key';
  __setFetch(async () => fail());
  assert.deepEqual(await govInfo('x'), []);
  if (saved === undefined) delete process.env.GOVINFO_API_KEY; else process.env.GOVINFO_API_KEY = saved;
  __setFetch(null);
});

test('legalSummary aggregates all sources into a well-formed object', async () => {
  const saved = process.env.GOVINFO_API_KEY;
  const savedTok = process.env.COURTLISTENER_TOKEN;
  delete process.env.GOVINFO_API_KEY;
  delete process.env.COURTLISTENER_TOKEN;
  __setFetch(async (url) => {
    if (String(url).includes('/search/?type=o')) return ok({ results: [{ id: 1, caseName: 'A v. B' }] });
    if (String(url).includes('/documents.json')) return ok({ results: [{ document_number: 'd1', title: 'Rule' }] });
    return fail();
  });
  const s = await legalSummary('privacy', { limit: 3 });
  assert.equal(s.query, 'privacy');
  assert.equal(s.opinions.length, 1);
  assert.equal(s.federalRegister.length, 1);
  assert.equal(s.govInfo, null, 'null without a GovInfo key');
  assert.equal(s.sources.courtListener.authed, false);
  assert.equal(s.sources.federalRegister.keyless, true);
  assert.equal(s.sources.govInfo.configured, false);
  if (saved !== undefined) process.env.GOVINFO_API_KEY = saved;
  if (savedTok !== undefined) process.env.COURTLISTENER_TOKEN = savedTok;
  __setFetch(null);
});

test('legalSummary never throws even if every source fails', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const s = await legalSummary('anything');
  assert.deepEqual(s.opinions, []);
  assert.deepEqual(s.federalRegister, []);
  __setFetch(null);
});
