// library-federation.test.mjs — offline tests for the federation readers (LoC keyless; DPLA/Europeana
// keyed soft-skip). All network is stubbed via __setFetch; keyed sources are exercised by setting their
// env key before importing-time reads are bypassed (we test the keyless path and the merge directly).
// Run: node --test integrations/soapbox/library-federation.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchFederation, loc, dpla, europeana, __setFetch,
} from './library-federation.mjs';

// LoC JSON-API shape: { results: [ { title, id, date, original_format, rights, ... } ] }
function locFetch(results, { ok = true } = {}) {
  return async () => ({ ok, json: async () => ({ results }) });
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }
function notOkFetch() { return async () => ({ ok: false, json: async () => ({}) }); }

const locRows = [
  { title: 'Civil War photographs', id: 'https://www.loc.gov/item/123/', date: '1863',
    original_format: ['photo'], contributor: ['Brady, Mathew'], rights: 'No known restrictions on publication.' },
  { title: 'A restricted item', id: 'https://www.loc.gov/item/456/', date: '1990',
    original_format: ['manuscript'], rights: 'Access restricted.' },
  { id: 'https://www.loc.gov/item/789/' }, // no title → dropped
];

test('loc parses the JSON-API results, dropping title-less rows', async () => {
  __setFetch(locFetch(locRows));
  const rows = await loc('civil war photographs');
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'loc');
  assert.equal(rows[0].provider, 'Library of Congress');
  assert.equal(rows[0].title, 'Civil War photographs');
  assert.equal(rows[0].year, 1863);
  assert.deepEqual(rows[0].authors, ['Brady, Mathew']);
});

test('loc flags openAccess from a "no known restrictions" rights string', async () => {
  __setFetch(locFetch(locRows));
  const rows = await loc('x');
  __setFetch(null);
  assert.equal(rows[0].openAccess, true, '"No known restrictions" → open');
  assert.equal(rows[1].openAccess, false, 'restricted item → not open');
});

test('loc soft-fails to [] on network error and on a non-ok response', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await loc('x'), []);
  __setFetch(notOkFetch());
  assert.deepEqual(await loc('x'), []);
  __setFetch(null);
  assert.deepEqual(await loc(''), [], 'empty query → []');
});

test('dpla soft-skips (returns []) when DPLA_API_KEY is absent', async () => {
  // No env key in the test process → the keyed reader must skip without any fetch.
  __setFetch(throwingFetch()); // proves it does not even attempt the call
  const rows = await dpla('anything');
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('europeana soft-skips (returns []) when EUROPEANA_API_KEY is absent', async () => {
  __setFetch(throwingFetch());
  const rows = await europeana('anything');
  __setFetch(null);
  assert.deepEqual(rows, []);
});

test('searchFederation returns LoC rows keyless and reports skipped keyed sources', async () => {
  __setFetch(locFetch(locRows));
  const out = await searchFederation('civil war photographs');
  __setFetch(null);
  assert.equal(out.query, 'civil war photographs');
  assert.equal(out.total, 2);
  assert.deepEqual(out.sources, ['loc'], 'only the keyless source contributed');
  assert.ok(out.skipped.some((s) => s.startsWith('dpla')), 'DPLA reported as skipped (no key)');
  assert.ok(out.skipped.some((s) => s.startsWith('europeana')), 'Europeana reported as skipped (no key)');
  assert.ok(out.results.every((r) => r.source && 'license' in r && 'rights' in r), 'provenance + license fields present');
});

test('searchFederation de-dups overlapping rows by url', async () => {
  const dupRows = [
    { title: 'Same item', id: 'https://www.loc.gov/item/X/', date: '1900' },
    { title: 'Same item', id: 'https://www.loc.gov/item/X/', date: '1900' }, // dup url
    { title: 'Other item', id: 'https://www.loc.gov/item/Y/', date: '1901' },
  ];
  __setFetch(locFetch(dupRows));
  const out = await searchFederation('dup');
  __setFetch(null);
  assert.equal(out.total, 2, 'duplicate url collapsed');
});

test('searchFederation soft-fails to a structured empty result and never throws', async () => {
  __setFetch(throwingFetch());
  const out = await searchFederation('boom');
  __setFetch(null);
  assert.equal(out.total, 0);
  assert.deepEqual(out.results, []);
  assert.deepEqual(out.sources, []);
  // empty query path
  const empty = await searchFederation('');
  assert.equal(empty.total, 0);
});
