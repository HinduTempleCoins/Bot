// scholar-graph.test.mjs — OFFLINE tests. Injected fetch (no network). Covers ORCID expanded-search
// normalization, COCI citation/reference edge parsing, count parsing, citationCard composition, soft-fail.
//   node --test integrations/soapbox/scholar-graph.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  __setFetch, searchAuthors, citationsOf, referencesOf, citationCount, citationCard, scholarLookup,
} from './scholar-graph.mjs';

function router(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, resp] of routes) {
      if (u.includes(needle)) {
        if (resp.fail) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => resp.json ?? {} };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const ORCID = {
  'expanded-result': [
    { 'orcid-id': '0000-0001-2345-6789', 'given-names': 'Ada', 'family-names': 'Lovelace',
      'other-name': ['A. Lovelace'], 'institution-name': ['Analytical Engine Institute'] },
    { 'orcid-id': null, 'given-names': 'No', 'family-names': 'Id' }, // dropped: no orcid
  ],
};
const COCI_CITATIONS = [
  { citing: '10.1/citer', cited: '10.9/target', creation: '2023-04' },
  { citing: 'https://doi.org/10.2/CITER2', cited: '10.9/target', creation: '2024-01' },
];
const COCI_REFS = [
  { citing: '10.9/target', cited: '10.5/ref1', creation: '2020' },
];
const COCI_COUNT = [{ count: '17' }];

test('searchAuthors normalizes ORCID expanded-search and drops id-less rows', async () => {
  __setFetch(router([['pub.orcid.org/v3.0/expanded-search', { json: ORCID }]]));
  const rows = await searchAuthors('Ada Lovelace');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].orcid, '0000-0001-2345-6789');
  assert.equal(rows[0].name, 'Ada Lovelace');
  assert.equal(rows[0].url, 'https://orcid.org/0000-0001-2345-6789');
  assert.deepEqual(rows[0].institutions, ['Analytical Engine Institute']);
});

test('searchAuthors soft-fails to [] (unreachable / empty query)', async () => {
  __setFetch(router([['pub.orcid.org', { fail: true }]]));
  assert.deepEqual(await searchAuthors('anyone'), []);
  assert.deepEqual(await searchAuthors(''), []);
});

test('citationsOf / referencesOf normalize DOI edges (and strip doi.org prefixes)', async () => {
  __setFetch(router([
    ['coci/api/v1/citations/', { json: COCI_CITATIONS }],
    ['coci/api/v1/references/', { json: COCI_REFS }],
  ]));
  const cites = await citationsOf('https://doi.org/10.9/TARGET');
  assert.equal(cites.length, 2);
  assert.equal(cites[1].citing, '10.2/citer2'); // prefix stripped + lowercased
  const refs = await referencesOf('10.9/target');
  assert.equal(refs[0].cited, '10.5/ref1');
});

test('citationCount parses the count, null on unknown', async () => {
  __setFetch(router([['coci/api/v1/citation-count/', { json: COCI_COUNT }]]));
  assert.equal(await citationCount('10.9/target'), 17);
  __setFetch(router([['coci/api/v1/citation-count/', { json: [] }]]));
  assert.equal(await citationCount('10.9/target'), null);
  assert.equal(await citationCount(''), null);
});

test('citationCard composes all three legs and degrades piecewise', async () => {
  __setFetch(router([
    ['coci/api/v1/citation-count/', { json: COCI_COUNT }],
    ['coci/api/v1/citations/', { json: COCI_CITATIONS }],
    ['coci/api/v1/references/', { fail: true }], // one dead leg
  ]));
  const card = await citationCard('10.9/target', { limit: 5 });
  assert.equal(card.cited, 17);
  assert.equal(card.citedBy.length, 2);
  assert.deepEqual(card.references, []); // dead leg degraded, no throw
});

test('citationCard with no DOI → empty shape', async () => {
  const card = await citationCard('');
  assert.deepEqual(card, { doi: null, cited: null, citedBy: [], references: [] });
});

test('scholarLookup dispatches: DOI → citation-graph shape, name → author-profiles shape', async () => {
  __setFetch(router([
    ['coci/api/v1/citation-count/', { json: COCI_COUNT }],
    ['coci/api/v1/citations/', { json: COCI_CITATIONS }],
    ['coci/api/v1/references/', { json: COCI_REFS }],
    ['pub.orcid.org/v3.0/expanded-search', { json: ORCID }],
  ]));
  const graph = await scholarLookup('10.9/target');
  assert.equal(graph.kind, 'citation-graph');
  assert.equal(graph.openCitationCount, 17);
  assert.equal(graph.citedBy[0].url, 'https://doi.org/10.1/citer');

  const people = await scholarLookup('Ada Lovelace');
  assert.equal(people.kind, 'author-profiles');
  assert.equal(people.authors.length, 1);

  assert.equal(await scholarLookup(''), null);
  __setFetch();
});
