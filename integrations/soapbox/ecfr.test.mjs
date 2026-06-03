// ecfr.test.mjs — offline tests for the eCFR reader. Network stubbed via __setFetch; no live calls.
// eCFR reads are keyless/open. Run: node --test integrations/soapbox/ecfr.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  titles, titleStructure, partInfo, search, ecfrUrl, collectNodes, normalizeNode,
  renderPage, dataNote, __setFetch,
} from './ecfr.mjs';

const STRUCTURE = {
  type: 'title', identifier: '21', label_description: 'Food and Drugs',
  children: [
    { type: 'chapter', identifier: 'I', label_description: 'FDA', children: [
      { type: 'part', identifier: '1', label_description: 'General Enforcement Regulations' },
      { type: 'part', identifier: '1308', label_description: 'Schedules of Controlled Substances', reserved: false },
    ] },
    { type: 'part', identifier: '99', label_description: 'Dissemination', reserved: true },
  ],
};

function envelopeFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function captureFetch(sink, payload) { return async (u) => { sink.url = String(u); return { ok: true, json: async () => payload }; }; }
function throwingFetch() { return async () => { throw new Error('network down'); }; }

test('ecfrUrl builds title and part reader URLs', () => {
  assert.equal(ecfrUrl(21), 'https://www.ecfr.gov/current/title-21');
  assert.equal(ecfrUrl(21, '1308'), 'https://www.ecfr.gov/current/title-21/part-1308');
  assert.equal(ecfrUrl('bad'), 'https://www.ecfr.gov');
});

test('collectNodes walks the tree gathering nodes of a type', () => {
  const parts = collectNodes(STRUCTURE, 'part');
  assert.equal(parts.length, 3);
  assert.deepEqual(parts.map((p) => p.identifier).sort(), ['1', '1308', '99']);
  assert.deepEqual(collectNodes(null, 'part'), []);
});

test('normalizeNode flattens a part node with public-domain provenance', () => {
  const n = normalizeNode({ type: 'part', identifier: '1308', label_description: 'Schedules of Controlled Substances' }, 21);
  assert.equal(n.identifier, '1308');
  assert.equal(n.heading, 'Schedules of Controlled Substances');
  assert.equal(n.title, 21);
  assert.match(n.url, /title-21\/part-1308$/);
  assert.equal(n.license, 'public-domain');
  assert.equal(normalizeNode(null), null);
  assert.equal(normalizeNode({}), null);
});

test('titles lists CFR titles with latest amendment dates', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, { titles: [{ number: 21, name: 'Food and Drugs', latest_amended_on: '2026-05-01' }] }));
  const ts = await titles();
  __setFetch(null);
  assert.match(sink.url, /\/versioner\/v1\/titles\.json/);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].number, 21);
  assert.equal(ts[0].latestDate, '2026-05-01');
  assert.equal(ts[0].license, 'public-domain');
});

test('titleStructure returns the parts under a title', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, STRUCTURE));
  const parts = await titleStructure(21, { date: '2026-01-01' });
  __setFetch(null);
  assert.match(sink.url, /structure\/2026-01-01\/title-21\.json/);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.type === 'part'));
  assert.deepEqual(await titleStructure('bad'), []);
});

test('titleStructure soft-fails to [] on network error', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await titleStructure(21), []);
  __setFetch(null);
});

test('partInfo finds one part within a title', async () => {
  __setFetch(envelopeFetch(STRUCTURE));
  const p = await partInfo(21, '1308');
  __setFetch(null);
  assert.equal(p.identifier, '1308');
  assert.equal(p.heading, 'Schedules of Controlled Substances');
  __setFetch(envelopeFetch(STRUCTURE));
  assert.equal(await partInfo(21, '9999'), null);
  __setFetch(null);
  assert.equal(await partInfo('bad', '1'), null);
});

test('search returns total + results, narrowed by title', async () => {
  const sink = {};
  __setFetch(captureFetch(sink, {
    meta: { total_count: 7 },
    results: [{ headings: { section: '21 CFR 1308.11' }, hierarchy: { title: 21, part: '1308' }, full_text_excerpt: 'controlled substance' }],
  }));
  const s = await search({ q: 'controlled substance', title: 21 });
  __setFetch(null);
  assert.match(sink.url, /\/search\/v1\/results/);
  assert.match(sink.url, /conditions%5Btitle%5D=21/);
  assert.equal(s.total, 7);
  assert.equal(s.results.length, 1);
  assert.match(s.results[0].url, /title-21\/part-1308$/);
});

test('search soft-fails to empty result on bad query/shape', async () => {
  assert.deepEqual(await search({ q: '' }), { total: 0, results: [] });
  __setFetch(throwingFetch());
  assert.deepEqual(await search({ q: 'x' }), { total: 0, results: [] });
  __setFetch(null);
});

test('renderPage renders title parts and a search list, escaping injection', () => {
  const partsHtml = renderPage({ title: 21, parts: [normalizeNode({ type: 'part', identifier: '1', label_description: '<b>X</b>' }, 21)] });
  assert.ok(!partsHtml.includes('<b>X</b>'));
  assert.ok(partsHtml.includes('&lt;b&gt;'));
  assert.ok(partsHtml.includes('CFR Title 21'));
  const searchHtml = renderPage({ query: 'drugs', search: { total: 2, results: [{ title: 21, part: '1308', heading: 'Schedules', url: ecfrUrl(21, '1308') }] } });
  assert.ok(searchHtml.includes('2 matching section'));
  assert.ok(searchHtml.includes('Part 1308'));
  assert.ok(renderPage({ title: 99, parts: [] }).includes('No parts on record'));
});

test('dataNote names eCFR, public-domain, and the unofficial-compilation caveat', () => {
  const n = dataNote();
  assert.match(n, /eCFR/);
  assert.match(n, /public domain/);
  assert.match(n, /editorial compilation/);
});
