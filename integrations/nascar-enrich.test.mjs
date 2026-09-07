import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraph } from './accountability-graph.mjs';
import {
  isCheckable, patches, sharedTies, findActors, enrich,
  renderEnrichment, renderEnrichmentHtml, handler,
} from './nascar-enrich.mjs';

const SRC = { name: 'Texas Ethics Commission', url: 'https://www.ethics.state.tx.us/search/cf/' };

function fixture() {
  const g = createGraph();
  g.addNode({ kind: 'person', id: 'judge-a', name: 'Ada Lovelace', office: '416th District Court' });
  g.addNode({ kind: 'person', id: 'judge-b', name: 'Grace Hopper', office: '254th District Court' });
  g.addNode({ kind: 'person', id: 'lawyer-c', name: 'Solo Practitioner' });
  g.addNode({ kind: 'committee', id: 'pac-x', name: 'Example PAC' });
  g.addNode({ kind: 'committee', id: 'pac-y', name: 'Only-One PAC' });
  g.addNode({ kind: 'org', id: 'firm-z', name: 'Outside Counsel LLP' });
  // pac-x touches BOTH judges — this is the overlap the module exists to find
  g.addEdge({ kind: 'donated-to', from: 'judge-a', to: 'pac-x', amount: '$1,000', asOf: '2020-01-01', source: SRC });
  g.addEdge({ kind: 'donated-to', from: 'judge-b', to: 'pac-x', amount: '$2,500', asOf: '2020-02-01', source: SRC });
  // pac-y touches only one
  g.addEdge({ kind: 'donated-to', from: 'judge-a', to: 'pac-y', amount: '$50', asOf: '2020-03-01', source: SRC });
  // and the firm touches judge-b and the lawyer
  g.addEdge({ kind: 'employed-by', from: 'lawyer-c', to: 'firm-z', asOf: '2019-01-01', source: SRC });
  g.addEdge({ kind: 'donated-to', from: 'judge-b', to: 'firm-z', amount: '$500', asOf: '2021-01-01', source: SRC });
  return g;
}

test('isCheckable requires a named source', () => {
  assert.equal(isCheckable({ source: { name: 'TEC' } }), true);
  assert.equal(isCheckable({ source: { name: '' } }), false);
  assert.equal(isCheckable({}), false);
  assert.equal(isCheckable(null), false);
});

test('patches returns sourced ties with the counterparty exposed', () => {
  const g = fixture();
  const p = patches('judge-a', g);
  assert.ok(p.length >= 2);
  for (const t of p) {
    assert.ok(t.other, 'counterparty must be exposed for intersection');
    assert.ok(isCheckable(t), 'every emitted patch must be checkable');
  }
});

test('patches is empty and does not throw for an unknown person or a bad graph', () => {
  const g = fixture();
  assert.deepEqual(patches('nobody', g), []);
  assert.deepEqual(patches('judge-a', null), []);
  assert.deepEqual(patches('', g), []);
});

test('⭐ sharedTies finds the counterparty touching both judges, and excludes the one-off', () => {
  const g = fixture();
  const rows = sharedTies(['judge-a', 'judge-b'], g);
  const others = rows.map((r) => r.other);
  assert.ok(others.includes('pac-x'), 'the shared PAC must surface');
  assert.ok(!others.includes('pac-y'), 'a PAC touching only one person is not an overlap');
  const x = rows.find((r) => r.other === 'pac-x');
  assert.equal(x.peopleCount, 2);
  assert.equal(x.otherName, 'Example PAC');
  assert.deepEqual(x.people.sort(), ['judge-a', 'judge-b']);
});

test('sharedTies needs at least two people to have an overlap at all', () => {
  const g = fixture();
  assert.deepEqual(sharedTies(['judge-a'], g), []);
  assert.deepEqual(sharedTies([], g), []);
});

test('sharedTies dedupes repeated ids rather than faking an overlap with itself', () => {
  const g = fixture();
  assert.deepEqual(sharedTies(['judge-a', 'judge-a'], g), []);
});

test('sharedTies ranks the most-shared counterparty first', () => {
  const g = fixture();
  const rows = sharedTies(['judge-a', 'judge-b', 'lawyer-c'], g);
  assert.ok(rows.length >= 1);
  assert.ok(rows[0].peopleCount >= rows[rows.length - 1].peopleCount);
});

test('findActors matches full names on a word boundary and marks confidence', () => {
  const g = fixture();
  const hits = findActors('The order was signed by Ada Lovelace on Tuesday.', g);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'judge-a');
  assert.equal(hits[0].confidence, 'exact');
});

test('findActors does not match inside a longer word', () => {
  const g = fixture();
  assert.deepEqual(findActors('Adalovelaceium is a mineral.', g), []);
});

test('findActors is empty for empty text or a bad graph', () => {
  const g = fixture();
  assert.deepEqual(findActors('', g), []);
  assert.deepEqual(findActors('Ada Lovelace', null), []);
});

test('enrich with explicit ids reports actors, overlaps and no unconfirmed names', () => {
  const g = fixture();
  const b = enrich('irrelevant text', g, { actorIds: ['judge-a', 'judge-b'] });
  assert.equal(b.counts.actors, 2);
  assert.ok(b.counts.overlaps >= 1);
  assert.deepEqual(b.unconfirmed, []);
  assert.match(b.caveat, /no verdicts, no scores/i);
});

test('enrich without ids uses only exact matches and returns every candidate for review', () => {
  const g = fixture();
  const b = enrich('Ada Lovelace and Grace Hopper both signed.', g);
  assert.equal(b.counts.actors, 2);
  assert.equal(b.unconfirmed.length, 2, 'detected names must come back for human confirmation');
});

test('renderEnrichment leads with the shared ties and always carries the caveat', () => {
  const g = fixture();
  const txt = renderEnrichment(enrich('x', g, { actorIds: ['judge-a', 'judge-b'] }));
  assert.match(txt, /SHARED TIES/);
  assert.match(txt, /Example PAC/);
  assert.match(txt, /Texas Ethics Commission/);
  assert.match(txt, /no verdicts/i);
  assert.ok(txt.indexOf('SHARED TIES') < txt.indexOf('Ada Lovelace'),
    'the intersection must come before the individual profiles');
});

test('renderEnrichment says so plainly when there is no overlap', () => {
  const g = fixture();
  const txt = renderEnrichment(enrich('x', g, { actorIds: ['lawyer-c'] }));
  assert.match(txt, /none found/i);
});

test('renderEnrichment and the HTML view tolerate an empty block', () => {
  assert.equal(renderEnrichment(null), '');
  assert.equal(renderEnrichmentHtml(null), '');
});

test('the HTML view escapes hostile input', () => {
  const g = createGraph();
  g.addNode({ kind: 'person', id: 'p1', name: '<script>alert(1)</script>' });
  g.addNode({ kind: 'person', id: 'p2', name: 'Second Person' });
  g.addNode({ kind: 'committee', id: 'c1', name: '<img onerror=x>' });
  g.addEdge({ kind: 'donated-to', from: 'p1', to: 'c1', asOf: '2020-01-01', source: SRC });
  g.addEdge({ kind: 'donated-to', from: 'p2', to: 'c1', asOf: '2020-01-01', source: SRC });
  const html = renderEnrichmentHtml(enrich('x', g, { actorIds: ['p1', 'p2'] }));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
  assert.match(html, /&lt;img onerror/);
});

test('an unsourced tie never becomes a patch', () => {
  const g = createGraph();
  g.addNode({ kind: 'person', id: 'p1', name: 'A Person' });
  g.addNode({ kind: 'committee', id: 'c1', name: 'A PAC' });
  // accountability-graph rejects this outright; assert the end state either way
  g.addEdge({ kind: 'donated-to', from: 'p1', to: 'c1', asOf: '2020-01-01' });
  assert.deepEqual(patches('p1', g), []);
});

test('handler describes the module and its rules', () => {
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  handler({ url: '/' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.ok(j.patchKinds.includes('donated-to'));
  assert.ok(j.rules.some((r) => /no source/i.test(r)));
});
