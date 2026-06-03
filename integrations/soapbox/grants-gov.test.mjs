// grants-gov.test.mjs — offline tests for the Grants.gov Search2 reader. No network I/O; fetch is
// injected via __setFetch with fixtures, so no real request is ever made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  search, byAgency, normalizeHit, normalizeStatuses, OPP_STATUSES,
  renderPage, dataNote, esc, __setFetch, ENDPOINT,
} from './grants-gov.mjs';

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

const SAMPLE = {
  data: {
    oppHits: [
      { id: '350123', number: 'USDA-NRCS-2026', title: 'High Tunnel Conservation', agencyName: 'USDA NRCS', agencyCode: 'USDA-NRCS', oppStatus: 'posted', openDate: '01/01/2026', closeDate: '06/30/2026' },
      { id: '350124', number: 'EPA-WATER-2026', title: 'Clean Water Grant', agencyName: 'EPA', oppStatus: 'forecasted' },
    ],
  },
};

test('normalizeStatuses — cleans, drops unknowns, defaults to live set', () => {
  assert.equal(normalizeStatuses('posted'), 'posted');
  assert.equal(normalizeStatuses(['posted', 'closed']), 'posted|closed');
  assert.equal(normalizeStatuses('bogus'), 'forecasted|posted'); // unknown dropped → default
  assert.equal(normalizeStatuses(''), 'forecasted|posted');
  for (const s of OPP_STATUSES) assert.ok(normalizeStatuses(s).includes(s));
});

test('normalizeHit — builds a clean row + detail URL with provenance', () => {
  const row = normalizeHit(SAMPLE.data.oppHits[0]);
  assert.equal(row.type, 'grant');
  assert.equal(row.title, 'High Tunnel Conservation');
  assert.equal(row.agency, 'USDA NRCS');
  assert.equal(row.status, 'posted');
  assert.match(row.url, /search-results-detail\/350123/);
  assert.equal(row.source, 'Grants.gov');
  assert.ok(row.fetched_at);
});

test('search — POSTs to Search2 and normalizes oppHits', async () => {
  let captured = null;
  __setFetch(async (url, opts) => { captured = { url, opts }; return okJson(SAMPLE); });
  const rows = await search({ keyword: 'high tunnel', agency: 'USDA', status: 'posted' });
  __setFetch();
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.opts.method, 'POST');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.keyword, 'high tunnel');
  assert.equal(body.oppStatuses, 'posted');
  assert.deepEqual(body.agencies, ['USDA']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'High Tunnel Conservation');
});

test('search — soft-fails to [] on non-ok response', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const rows = await search({ keyword: 'x' });
  __setFetch();
  assert.deepEqual(rows, []);
});

test('search — soft-fails to [] on thrown fetch and on a non-array payload', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await search({ keyword: 'x' }), []);
  __setFetch(async () => okJson({ data: { oppHits: 'nope' } }));
  assert.deepEqual(await search({ keyword: 'x' }), []);
  __setFetch();
});

test('byAgency — empty agency soft-fails to []; otherwise forwards', async () => {
  assert.deepEqual(await byAgency(''), []);
  __setFetch(async () => okJson(SAMPLE));
  const rows = await byAgency('USDA', { keyword: 'water' });
  __setFetch();
  assert.equal(rows.length, 2);
});

test('renderPage — escapes hostile text + carries the data note; empty renders a placeholder', () => {
  const html = renderPage([
    { title: '<script>x</script>', agency: 'A & B', opportunity_number: 'N1', status: 'posted', close_date: '2026', url: 'https://x?a=1&b=2' },
  ]);
  assert.ok(!html.includes('<script>x</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('a=1&amp;b=2'));
  assert.ok(html.includes(esc(dataNote())));
  assert.match(renderPage([]), /No grant opportunities found/);
});

test('dataNote — names Grants.gov + a verify caveat', () => {
  assert.match(dataNote(), /Grants\.gov/);
  assert.match(dataNote(), /eligibility/i);
});

test('__setFetch is callable (seam exists)', () => {
  assert.doesNotThrow(() => __setFetch());
});
