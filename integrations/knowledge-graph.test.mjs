// knowledge-graph.test.mjs — offline tests for Hathor's structured-knowledge readers.
// All network calls stubbed via __setFetch. Run: node --test integrations/knowledge-graph.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entityFacts, sparql, conceptRelations, renderFacts, escapeHtml, dataNote, __setFetch,
} from './knowledge-graph.mjs';

// SPARQL JSON results shape: { results: { bindings: [ { var: { value } }, ... ] } }
function sparqlFetch(bindings, { ok = true } = {}) {
  return async () => ({ ok, json: async () => ({ results: { bindings } }) });
}

test('sparql normalizes binding rows to flat { var: value } objects', async () => {
  __setFetch(sparqlFetch([
    { x: { value: 'Q1' }, xLabel: { value: 'universe' } },
    { x: { value: 'Q2' }, xLabel: { value: 'Earth' } },
  ]));
  const rows = await sparql('SELECT ?x ?xLabel WHERE { ... }');
  __setFetch(null);
  assert.deepEqual(rows, [
    { x: 'Q1', xLabel: 'universe' },
    { x: 'Q2', xLabel: 'Earth' },
  ]);
});

test('sparql soft-fails to [] on empty query / non-ok / network error', async () => {
  assert.deepEqual(await sparql(''), []);
  __setFetch(sparqlFetch([], { ok: false }));
  assert.deepEqual(await sparql('SELECT ...'), []);
  __setFetch(async () => { throw new Error('down'); });
  assert.deepEqual(await sparql('SELECT ...'), []);
  __setFetch(null);
});

test('entityFacts resolves a QID to curated, label-resolved facts with a CC0 citation', async () => {
  __setFetch(sparqlFetch([
    { prop: { value: 'instance of' }, valItemLabel: { value: 'human' }, itemLabel: { value: 'Marie Curie' }, itemDescription: { value: 'Polish-French physicist' } },
    { prop: { value: 'occupation' }, valItemLabel: { value: 'physicist' } },
    { prop: { value: 'occupation' }, valItemLabel: { value: 'chemist' } },
    { prop: { value: 'date of birth' }, valItem: { value: '1867-11-07T00:00:00Z' } },
  ]));
  const f = await entityFacts('Q7186');
  __setFetch(null);
  assert.equal(f.id, 'Q7186');
  assert.equal(f.label, 'Marie Curie');
  assert.match(f.description, /physicist/);
  assert.match(f.source, /CC0/);
  const occ = f.facts.filter((x) => x.property === 'occupation').map((x) => x.value);
  assert.deepEqual(occ, ['physicist', 'chemist']);
  assert.ok(f.facts.some((x) => x.property === 'date of birth' && /1867/.test(x.value)));
});

test('entityFacts de-duplicates identical property/value rows', async () => {
  __setFetch(sparqlFetch([
    { prop: { value: 'instance of' }, valItemLabel: { value: 'human' } },
    { prop: { value: 'instance of' }, valItemLabel: { value: 'human' } }, // dup (label-service echo)
  ]));
  const f = await entityFacts('Q7186');
  __setFetch(null);
  assert.equal(f.facts.length, 1);
});

test('entityFacts rejects a malformed QID and soft-fails on no data', async () => {
  assert.equal(await entityFacts('not-a-qid'), null);
  assert.equal(await entityFacts(''), null);
  __setFetch(sparqlFetch([]));
  assert.equal(await entityFacts('Q999999999'), null);
  __setFetch(null);
});

test('conceptRelations parses ConceptNet edges into compact relation triples', async () => {
  __setFetch(async (url) => {
    assert.match(String(url), /api\.conceptnet\.io\/c\/en\/temple/);
    return { ok: true, json: async () => ({ edges: [
      { rel: { '@id': '/r/IsA' }, start: { '@id': '/c/en/temple/n' }, end: { '@id': '/c/en/building' }, weight: 2.5, surfaceText: 'A [[temple]] is a [[building]]' },
      { rel: { '@id': '/r/UsedFor' }, start: { '@id': '/c/en/temple' }, end: { '@id': '/c/en/worship' }, weight: 1.0 },
    ] }) };
  });
  const c = await conceptRelations('temple');
  __setFetch(null);
  assert.equal(c.term, 'temple');
  assert.equal(c.relations.length, 2);
  assert.deepEqual(c.relations[0], { relation: 'IsA', start: 'temple', end: 'building', weight: 2.5, surface: 'A temple is a building' });
  assert.equal(c.relations[1].relation, 'UsedFor');
  assert.match(c.source, /ConceptNet/);
});

test('conceptRelations slugifies multi-word terms and soft-fails on error/empty', async () => {
  let seen = '';
  __setFetch(async (url) => { seen = String(url); return { ok: true, json: async () => ({ edges: [] }) }; });
  await conceptRelations('New York');
  assert.match(seen, /new_york/);
  __setFetch(async () => { throw new Error('down'); });
  assert.deepEqual((await conceptRelations('x')).relations, []);
  __setFetch(null);
  assert.deepEqual((await conceptRelations('')).relations, []);
});

test('renderFacts escapes source-controlled text (XSS safety) and handles empty input', () => {
  const html = renderFacts({
    id: 'Q1', label: '<script>alert(1)</script>', description: '"quote" & <b>',
    facts: [{ property: 'instance of', value: '<img onerror=x>' }],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<img onerror'));
  assert.ok(html.includes('&amp;'));
  assert.ok(renderFacts(null).includes('No entity'));
  assert.ok(renderFacts({}).includes('No entity'));
});

test('escapeHtml and dataNote behave', () => {
  assert.equal(escapeHtml(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.match(dataNote(), /Wikidata \(CC0\)/);
  assert.match(dataNote(), /ConceptNet/);
});
