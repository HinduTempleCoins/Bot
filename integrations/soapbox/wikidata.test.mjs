// wikidata.test.mjs — offline tests for the Wikidata reader. Injected fetch returns canned Wikidata
// JSON; nothing hits the network. Run: node --test integrations/soapbox/wikidata.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchEntities, entityFacts, sparql, factsAbout,
  renderPage, dataNote, escapeHtml, __setFetch,
} from './wikidata.mjs';

// Build a fake fetch that records its calls and returns a canned JSON body.
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const body = handler(String(url), opts);
    if (body === '__NOTOK__') return { ok: false, status: 500, json: async () => ({}) };
    if (body === '__THROW__') throw new Error('network down');
    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

const SEARCH_JSON = {
  search: [
    { id: 'Q7186', label: 'Marie Curie', description: 'Polish-French physicist and chemist (1867–1934)' },
    { id: 'Q37463', label: 'Curie', description: 'unit of radioactivity' },
  ],
};

// wbgetentities for Q7186 with a couple of common-prop claims (item + time values).
const ENTITY_JSON = {
  entities: {
    Q7186: {
      id: 'Q7186',
      labels: { en: { value: 'Marie Curie' } },
      descriptions: { en: { value: 'Polish-French physicist and chemist' } },
      claims: {
        P31: [{ mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id: 'Q5', 'numeric-id': 5 } } } }],
        P569: [{ mainsnak: { datavalue: { type: 'time', value: { time: '+1867-11-07T00:00:00Z' } } } }],
        P106: [{ mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id: 'Q169470', 'numeric-id': 169470 } } } }],
        P856: [{ mainsnak: { datavalue: { type: 'string', value: 'https://example.org' } } }],
      },
    },
  },
};

// label-only follow-up for the referenced QIDs (Q5 = human, Q169470 = physicist).
const REF_LABELS_JSON = {
  entities: {
    Q5: { id: 'Q5', labels: { en: { value: 'human' } } },
    Q169470: { id: 'Q169470', labels: { en: { value: 'physicist' } } },
  },
};

const SPARQL_JSON = {
  results: {
    bindings: [
      { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q7186' }, itemLabel: { type: 'literal', value: 'Marie Curie' } },
      { item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q42' }, itemLabel: { type: 'literal', value: 'Douglas Adams' } },
    ],
  },
};

// route a single fetch by which API/params it is hitting.
function routedFetch() {
  return fakeFetch((url) => {
    if (url.includes('wbsearchentities')) return SEARCH_JSON;
    // ref-label follow-up asks for props=labels only (no claims); the main call asks for claims.
    if (url.includes('wbgetentities') && url.includes('props=labels') && !url.includes('claims')) return REF_LABELS_JSON;
    if (url.includes('wbgetentities')) return ENTITY_JSON;
    if (url.includes('/sparql')) return SPARQL_JSON;
    return {};
  });
}

test('searchEntities normalizes wbsearchentities results', async () => {
  __setFetch(routedFetch());
  const out = await searchEntities('marie curie');
  __setFetch(null);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 'Q7186', label: 'Marie Curie', description: 'Polish-French physicist and chemist (1867–1934)' });
});

test('searchEntities soft-fails to [] on error / empty query', async () => {
  __setFetch(fakeFetch(() => '__THROW__'));
  assert.deepEqual(await searchEntities('x'), []);
  __setFetch(fakeFetch(() => '__NOTOK__'));
  assert.deepEqual(await searchEntities('x'), []);
  __setFetch(null);
  assert.deepEqual(await searchEntities(''), []);
});

test('entityFacts extracts facts from wbgetentities + resolves item labels', async () => {
  __setFetch(routedFetch());
  const f = await entityFacts('Q7186');
  __setFetch(null);
  assert.equal(f.id, 'Q7186');
  assert.equal(f.label, 'Marie Curie');
  assert.equal(f.description, 'Polish-French physicist and chemist');
  const byProp = Object.fromEntries(f.facts.map((x) => [x.property, x.value]));
  assert.equal(byProp['instance of'], 'human');        // Q5 resolved to label
  assert.equal(byProp['occupation'], 'physicist');     // Q169470 resolved to label
  assert.equal(byProp['date of birth'], '1867-11-07'); // time rendered
  assert.equal(byProp['official website'], 'https://example.org'); // string inline
});

test('entityFacts soft-fails to null on error / missing entity / empty id', async () => {
  __setFetch(fakeFetch(() => '__THROW__'));
  assert.equal(await entityFacts('Q1'), null);
  __setFetch(fakeFetch(() => ({ entities: { Q1: { id: 'Q1', missing: '' } } })));
  assert.equal(await entityFacts('Q1'), null);
  __setFetch(null);
  assert.equal(await entityFacts(''), null);
});

test('sparql normalizes bindings to plain rows', async () => {
  __setFetch(routedFetch());
  const rows = await sparql('SELECT ?item ?itemLabel WHERE { ?item wdt:P31 wd:Q5 } LIMIT 2');
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { item: 'http://www.wikidata.org/entity/Q7186', itemLabel: 'Marie Curie' });
  assert.equal(rows[1].itemLabel, 'Douglas Adams');
});

test('sparql soft-fails to [] on error / empty query / bad shape', async () => {
  __setFetch(fakeFetch(() => '__NOTOK__'));
  assert.deepEqual(await sparql('SELECT * WHERE {}'), []);
  __setFetch(fakeFetch(() => '__THROW__'));
  assert.deepEqual(await sparql('SELECT * WHERE {}'), []);
  __setFetch(fakeFetch(() => ({ results: {} })));
  assert.deepEqual(await sparql('SELECT * WHERE {}'), []);
  __setFetch(null);
  assert.deepEqual(await sparql(''), []);
});

test('factsAbout chains search → top entity → entityFacts', async () => {
  __setFetch(routedFetch());
  const f = await factsAbout('marie curie');
  __setFetch(null);
  assert.equal(f.id, 'Q7186');
  assert.equal(f.label, 'Marie Curie');
  assert.ok(f.facts.length >= 3);
});

test('factsAbout returns null when nothing matches', async () => {
  __setFetch(fakeFetch(() => ({ search: [] })));
  assert.equal(await factsAbout('zzzznomatch'), null);
  __setFetch(null);
});

test('renderPage escapes a malicious label', async () => {
  const html = renderPage({
    id: 'Q1',
    label: '<script>alert(1)</script>',
    description: 'a & b "c" <d>',
    facts: [{ property: 'instance of', value: '<img src=x onerror=alert(2)>' }],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;'));
});

test('renderPage handles empty / null input', () => {
  assert.ok(renderPage(null).includes('No Wikidata entity'));
  assert.ok(renderPage({ id: 'Q1', label: 'X', facts: [] }).includes('No key facts'));
});

test('dataNote names Wikidata + CC0 + an as-of date', () => {
  const note = dataNote();
  assert.match(note, /Wikidata/);
  assert.match(note, /CC0/);
  assert.match(note, /as of \d{4}-\d{2}-\d{2}/);
});

test('escapeHtml escapes all five HTML metacharacters', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('a proper User-Agent header is set on every request', async () => {
  const f = routedFetch();
  __setFetch(f);
  await searchEntities('marie curie');
  await entityFacts('Q7186');
  await sparql('SELECT * WHERE {} LIMIT 1');
  __setFetch(null);
  assert.ok(f.calls.length >= 3);
  for (const c of f.calls) {
    const ua = c.opts?.headers?.['User-Agent'];
    assert.ok(ua && /SoapBoxData/.test(ua), `missing UA on ${c.url}`);
  }
});

test('endpoints are keyless — no api key / token in any request URL', async () => {
  const f = routedFetch();
  __setFetch(f);
  await searchEntities('x');
  await sparql('SELECT * WHERE {} LIMIT 1');
  __setFetch(null);
  for (const c of f.calls) {
    assert.ok(!/api[_-]?key|access[_-]?token|[?&]key=/i.test(c.url), `unexpected secret in ${c.url}`);
  }
});
