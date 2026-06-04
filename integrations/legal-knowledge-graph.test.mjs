// legal-knowledge-graph.test.mjs — OFFLINE tests for the legal knowledge graph (#219, v3 §11).
// Pure graph logic + treatment NLP heuristic. No network, no fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGraph, ingestCase, detectTreatment, query,
  renderGraph, renderNode, matchCategories,
  SEED_CATEGORIES, NODE_TYPES, EDGE_TYPES, NEGATIVE_TREATMENTS, escapeHtml,
} from './legal-knowledge-graph.mjs';

test('SEED_CATEGORIES are present as first-class category nodes on a fresh graph', () => {
  const g = createGraph();
  const cats = g.nodesByType('category');
  assert.equal(cats.length, SEED_CATEGORIES.length, 'one node per seed category');
  // the founder's six categories by name
  const names = cats.map((c) => c.name);
  for (const wanted of ['Definitions', 'Coercion', 'Captive-Audience/Forced-to-Listen',
    'Music-as-torture', 'Cyberstalking', 'Free-Speech/Sedition']) {
    assert.ok(names.includes(wanted), `category present: ${wanted}`);
  }
  // they are real nodes addressable by id
  assert.ok(g.node('cat:coercion'));
  assert.equal(g.node('cat:coercion').type, 'category');
});

test('addNode / addEdge / neighbors work and reject bad input', () => {
  const g = createGraph();
  assert.equal(g.addNode({ type: 'bogus', id: 'x' }), null, 'unknown type rejected');
  assert.equal(g.addNode(null), null);
  const a = g.addNode({ type: 'case', id: 'A', name: 'Case A' });
  const b = g.addNode({ type: 'case', id: 'B', name: 'Case B' });
  assert.ok(a && b);
  // edge with unknown type rejected
  assert.equal(g.addEdge({ type: 'bribes', from: 'A', to: 'B' }), null);
  // missing endpoint rejected
  assert.equal(g.addEdge({ type: 'cites', from: 'A' }), null);
  const e = g.addEdge({ type: 'cites', from: 'A', to: 'B' });
  assert.ok(e);
  const nb = g.neighbors('A');
  assert.equal(nb.length, 1);
  assert.equal(nb[0].other, 'B');
  assert.equal(nb[0].direction, 'out');
  // nodesByType / edgesByType / size
  assert.equal(g.nodesByType('case').length, 2);
  assert.equal(g.edgesByType('cites').length, 1);
  assert.equal(g.size().edges, 1);
});

test('detectTreatment finds "we overrule" as overruled w/ confidence + disclaimer flag', () => {
  const t = detectTreatment('For these reasons, we overrule Smith v. Jones.');
  assert.equal(t.type, 'overruled');
  assert.ok(t.confidence > 0 && t.confidence <= 1, 'confidence scored 0..1');
  assert.equal(t.authoritative, false, 'NEVER authoritative');
  assert.match(t.evidence, /we\s+overrule/i);
  assert.ok(t.disclaimer && /not authoritative/i.test(t.disclaimer), 'carries not-authoritative disclaimer');
  assert.ok(NEGATIVE_TREATMENTS.includes(t.type), 'overruled is a negative treatment');
});

test('detectTreatment on plain text → no treatment, still carries disclaimer + non-authoritative', () => {
  const t = detectTreatment('The parties stipulated to the facts and the court accepted them.');
  assert.equal(t.type, 'none');
  assert.equal(t.confidence, 0);
  assert.equal(t.evidence, null);
  assert.equal(t.authoritative, false);
  assert.ok(t.disclaimer, 'even a no-signal result carries the disclaimer');
  // empty input is soft-handled
  assert.equal(detectTreatment('').type, 'none');
  assert.equal(detectTreatment(null).type, 'none');
});

test('matchCategories maps keywords to the founder taxonomy', () => {
  assert.deepEqual(matchCategories('this is about coercion of business reputation and credit').sort(),
    ['cat:coercion']);
  assert.ok(matchCategories('a captive audience forced to listen').includes('cat:captive-audience'));
  assert.deepEqual(matchCategories('nothing legal here'), []);
});

test('ingestCase wires case → category + case → cited edges from a canned record', () => {
  const g = createGraph();
  const out = ingestCase({
    id: 'us:smith-v-jones',
    caseName: 'Smith v. Jones',
    citation: '123 U.S. 456',
    court: 'SCOTUS',
    dateFiled: '1990-01-01',
    judge: 'Hon. Example J.',
    cites: [{ id: 'us:doe-v-roe', caseName: 'Doe v. Roe' }],
    categories: ['Coercion'],
    opinionText: 'We hold the conduct amounted to coercion harming business reputation and credit.',
    url: 'https://www.courtlistener.com/opinion/1/smith-v-jones/',
  }, g);
  assert.ok(out);
  assert.equal(out.caseId, 'us:smith-v-jones');

  // case node added
  const c = g.node('us:smith-v-jones');
  assert.ok(c);
  assert.equal(c.type, 'case');

  // case → category edge (Coercion, by explicit name AND keyword match → deduped)
  const catEdges = g.neighbors('us:smith-v-jones').filter((e) => e.type === 'falls-under-category');
  assert.ok(catEdges.some((e) => e.other === 'cat:coercion'), 'falls-under Coercion');

  // case → cited edge
  const citeEdges = g.neighbors('us:smith-v-jones').filter((e) => e.type === 'cites' && e.direction === 'out');
  assert.equal(citeEdges.length, 1);
  assert.equal(citeEdges[0].other, 'us:doe-v-roe');
  assert.ok(g.node('us:doe-v-roe'), 'cited case node stubbed');

  // authored-by judge edge — the §6A.2 cross-link target
  const authored = g.neighbors('us:smith-v-jones').filter((e) => e.type === 'authored-by');
  assert.equal(authored.length, 1);
  const judge = g.node(authored[0].other);
  assert.ok(judge && judge.type === 'judge');

  // bad record soft-fails
  assert.equal(ingestCase(null), null);
  assert.equal(ingestCase({}), null);
});

test('query returns cases under a category filtered by treatment', () => {
  const g = createGraph();
  // overruled coercion case
  ingestCase({
    id: 'case:overruled',
    caseName: 'Overruled Coercion Case',
    categories: ['Coercion'],
    opinionText: 'we overrule the prior coercion holding',
  }, g);
  // still-good coercion case (no negative treatment)
  ingestCase({
    id: 'case:good',
    caseName: 'Good Coercion Case',
    categories: ['Coercion'],
    opinionText: 'the coercion claim is well supported by the record',
  }, g);
  // a cyberstalking case (different category)
  ingestCase({
    id: 'case:cyber',
    caseName: 'Cyberstalking Case',
    categories: ['Cyberstalking'],
    opinionText: 'we overrule earlier cyberstalking precedent',
  }, g);

  // every case under Coercion
  const allCoercion = query(g, { category: 'Coercion' }).map((c) => c.id).sort();
  assert.deepEqual(allCoercion, ['case:good', 'case:overruled']);

  // Coercion + negative treatment → only the overruled one
  const negCoercion = query(g, { category: 'Coercion', treatment: 'negative' }).map((c) => c.id);
  assert.deepEqual(negCoercion, ['case:overruled']);

  // specific treatment type
  const overruled = query(g, { treatment: 'overruled' }).map((c) => c.id).sort();
  assert.deepEqual(overruled, ['case:cyber', 'case:overruled']);

  // graph guard
  assert.deepEqual(query(null, { category: 'Coercion' }), []);
});

test('renderNode escapes a malicious case name + shows the not-authoritative disclaimer', () => {
  const g = createGraph();
  ingestCase({
    id: 'evil',
    caseName: '<script>alert(1)</script> v. "Bobby"',
    categories: ['Coercion'],
    cites: [{ id: 'cited:1', caseName: 'Cited & Co. <b>' }],
    opinionText: 'we overrule the prior coercion holding',
  }, g);
  const html = renderNode(g.node('evil'), g);
  // XSS escaped
  assert.ok(!html.includes('<script>'), 'no raw <script>');
  assert.ok(html.includes('&lt;script&gt;'), 'name HTML-escaped');
  assert.ok(html.includes('&quot;Bobby&quot;') || html.includes('&#39;Bobby'), 'quotes escaped');
  // cited list escaped too
  assert.ok(!html.includes('Cited & Co. <b>'), 'cited name escaped');
  assert.ok(html.includes('Cited &amp; Co. &lt;b&gt;'));
  // treatment block present with confidence + not-authoritative disclaimer
  assert.match(html, /Treatment:/);
  assert.match(html, /confidence/i);
  assert.match(html, /not authoritative/i);
  assert.ok(html.includes('data-authoritative="false"'));
});

test('renderGraph escapes + carries the never-authoritative banner; escapeHtml/vocabs exported', () => {
  const g = createGraph();
  const html = renderGraph(g);
  assert.match(html, /Founder’s categories/);
  assert.match(html, /NOT authoritative/i);
  assert.equal(escapeHtml('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.ok(NODE_TYPES.includes('category') && NODE_TYPES.includes('judge'));
  assert.ok(EDGE_TYPES.includes('falls-under-category') && EDGE_TYPES.includes('authored-by'));
});
