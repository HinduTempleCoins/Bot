// accountability-apis.test.mjs — OFFLINE. Injected fetch, no network. Readers soft-fail to [].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_REGISTRY, apisFor, keylessApis, __setFetch,
  gdeltArticles, discoverMedia, congressTrades, secEdgarFullText,
} from './accountability-apis.mjs';

const ok = (json) => async () => ({ ok: true, json: async () => json });
const fail = async () => ({ ok: false, status: 500, json: async () => ({}) });

test('registry catalogs gov + media APIs across every dossier dimension', () => {
  assert.ok(API_REGISTRY.length >= 12);
  assert.ok(keylessApis().length >= 4, 'several keyless engines');
  assert.ok(apisFor('holdings').some((a) => a.id === 'sec-edgar'));
  assert.ok(apisFor('resignation-call').some((a) => a.id === 'gdelt'));
  assert.ok(apisFor('donations').some((a) => a.id === 'openfec'));
  // every entry is well-formed
  for (const a of API_REGISTRY) {
    assert.ok(a.id && a.name && a.base && a.auth && Array.isArray(a.serves));
    assert.ok(['none', 'key', 'scrape'].includes(a.auth));
  }
});

test('gdeltArticles maps the GDELT ArtList into sourced records', async () => {
  __setFetch(ok({ articles: [
    { title: 'Lawmaker calls on Paxton to resign', url: 'https://x.com/a', domain: 'x.com', seendate: '20260619T101500Z' },
    { title: 'no url here', domain: 'y.com' },
  ] }));
  const arts = await gdeltArticles('Paxton resign');
  assert.equal(arts.length, 1, 'drops the url-less article');
  assert.equal(arts[0].asOf, '2026-06-19');
  assert.equal(arts[0].source.name, 'x.com');
  __setFetch(null);
});

test('discoverMedia classifies headlines into candidate event records', async () => {
  __setFetch(ok({ articles: [
    { title: 'Senator Doe indicted on bribery charges', url: 'https://n/1', domain: 'n', seendate: '20230922T000000Z' },
    { title: 'Colleagues call on Doe to resign', url: 'https://n/2', domain: 'n', seendate: '20230923T000000Z' },
    { title: 'Doe attends a ribbon-cutting', url: 'https://n/3', domain: 'n', seendate: '20230924T000000Z' },
  ] }));
  const evs = await discoverMedia('Jane Doe');
  const kinds = evs.map((e) => e.type);
  assert.ok(kinds.includes('charge'));
  assert.ok(kinds.includes('resignation-call'));
  assert.ok(evs.every((e) => e.candidate === true), 'flagged as draft candidates');
  assert.ok(evs.every((e) => e.source && e.source.url), 'each carries a source');
  __setFetch(null);
});

test('congressTrades filters the watcher dataset by member + marks sold', async () => {
  __setFetch(ok([
    { senator: 'Jane Doe', ticker: 'ACME', type: 'Sale (Full)', amount: '$1,001 - $15,000', asset_description: 'Acme Corp', transaction_date: '2024-01-02' },
    { senator: 'Other Person', ticker: 'XYZ', type: 'Purchase', amount: '$1', asset_description: 'XYZ', transaction_date: '2024-01-03' },
  ]));
  const t = await congressTrades('Jane Doe');
  assert.equal(t.length, 1);
  assert.equal(t[0].status, 'sold');
  assert.equal(t[0].type, 'investment');
  __setFetch(null);
});

test('readers SOFT-FAIL to [] on a bad response (never throw)', async () => {
  __setFetch(fail);
  assert.deepEqual(await gdeltArticles('x'), []);
  assert.deepEqual(await discoverMedia('x'), []);
  assert.deepEqual(await congressTrades('x'), []);
  assert.deepEqual(await secEdgarFullText('x'), []);
  __setFetch(null);
});

test('empty queries return [] without a fetch', async () => {
  __setFetch(() => { throw new Error('should not fetch'); });
  assert.deepEqual(await gdeltArticles(''), []);
  assert.deepEqual(await secEdgarFullText(''), []);
  __setFetch(null);
});
