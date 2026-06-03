// usaspending.test.mjs — offline tests for the USAspending awards reader. No network I/O; fetch is
// injected via __setFetch with fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awards, byRecipient, byCFDA, normalizeAward, renderPage, dataNote, esc,
  __setFetch, ENDPOINT, ASSISTANCE_TYPES, CONTRACT_TYPES,
} from './usaspending.mjs';

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

const SAMPLE = {
  results: [
    { 'Award ID': 'A1', 'Recipient Name': 'Acme Farms', 'Awarding Agency': 'USDA', 'Award Amount': 250000, 'CFDA Number': '10.902', 'Award Type': '02', 'Start Date': '2025-01-01', 'End Date': '2026-01-01', Description: 'Conservation' },
    { 'Award ID': 'A2', 'Recipient Name': 'Beta Co', 'Awarding Agency': 'EPA', 'Award Amount': 1200000, 'Award Type': 'A' },
  ],
};

test('normalizeAward — clean row with numeric amount + provenance', () => {
  const a = normalizeAward(SAMPLE.results[0]);
  assert.equal(a.id, 'A1');
  assert.equal(a.recipient, 'Acme Farms');
  assert.equal(a.amount, 250000);
  assert.equal(a.cfda, '10.902');
  assert.equal(a.source, 'USAspending');
  assert.ok(a.fetched_at);
});

test('awards — requires a filter; empty input soft-fails to [] (no network call)', async () => {
  let called = false;
  __setFetch(async () => { called = true; return okJson(SAMPLE); });
  const rows = await awards({});
  __setFetch();
  assert.deepEqual(rows, []);
  assert.equal(called, false, 'no network call when no filter given');
});

test('awards — by recipient POSTs and normalizes results', async () => {
  let captured = null;
  __setFetch(async (url, opts) => { captured = { url, opts }; return okJson(SAMPLE); });
  const rows = await awards({ recipient: 'Acme' });
  __setFetch();
  assert.equal(captured.url, ENDPOINT);
  assert.equal(captured.opts.method, 'POST');
  const body = JSON.parse(captured.opts.body);
  assert.deepEqual(body.filters.recipient_search_text, ['Acme']);
  // recipient-only → contract + assistance types
  assert.deepEqual(body.filters.award_type_codes, [...CONTRACT_TYPES, ...ASSISTANCE_TYPES]);
  assert.equal(rows.length, 2);
});

test('awards — CFDA query uses assistance award types + program_numbers', async () => {
  let body = null;
  __setFetch(async (url, opts) => { body = JSON.parse(opts.body); return okJson(SAMPLE); });
  await awards({ cfda: '10.902' });
  __setFetch();
  assert.deepEqual(body.filters.program_numbers, ['10.902']);
  assert.deepEqual(body.filters.award_type_codes, ASSISTANCE_TYPES);
});

test('awards — soft-fails to [] on non-ok, throw, and non-array payload', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.deepEqual(await awards({ recipient: 'x' }), []);
  __setFetch(async () => { throw new Error('down'); });
  assert.deepEqual(await awards({ recipient: 'x' }), []);
  __setFetch(async () => okJson({ results: 'nope' }));
  assert.deepEqual(await awards({ recipient: 'x' }), []);
  __setFetch();
});

test('byRecipient / byCFDA — empty input soft-fails to []; otherwise forwards', async () => {
  assert.deepEqual(await byRecipient(''), []);
  assert.deepEqual(await byCFDA(''), []);
  __setFetch(async () => okJson(SAMPLE));
  assert.equal((await byRecipient('Acme')).length, 2);
  assert.equal((await byCFDA('10.902')).length, 2);
  __setFetch();
});

test('renderPage — escapes + shows formatted USD + data note; empty placeholder', () => {
  const html = renderPage([
    { recipient: '<b>x</b>', agency: 'A & B', amount: 1200000, cfda: '10.902', award_type: '02', end_date: '2026' },
  ]);
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('$1.20M'));
  assert.ok(html.includes(esc(dataNote())));
  assert.match(renderPage([]), /No federal awards found/);
});

test('dataNote — names USAspending + the already-made caveat', () => {
  assert.match(dataNote(), /USAspending/);
  assert.match(dataNote(), /ALREADY MADE/);
});

test('__setFetch is callable (seam exists)', () => {
  assert.doesNotThrow(() => __setFetch());
});
