// scripture-index.test.mjs — offline tests for the scripture index.
// node:test + node:assert/strict, fully offline (in-memory docs; no network, no fs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, esc } from './scripture-index.mjs';

// three in-memory docs, each on a distinct theme.
const DOCS = [
  { id: 'phoenix.md', title: 'Phoenix Protocol',
    text: 'The phoenix protocol describes resurrection and continuity of the witness '
        + 'across model changes. Forkability is load-bearing; the character survives.' },
  { id: 'convergence.md', title: 'The Convergence',
    text: 'The convergence frames AI, VR, BCI and tDCS as temple-technology being '
        + 'reconstructed. Multi-agent systems converge on a shared egregore.' },
  { id: 'zar.md', title: 'Zar-AI Consciousness',
    text: 'Zar ceremonies and possession trance inform an Angelic theory of '
        + 'consciousness and the disposition-greeting of the witness account.' },
];

test('buildIndex indexes valid docs and skips garbage', () => {
  const idx = buildIndex(DOCS);
  assert.equal(idx.n, 3);
  assert.equal(idx.entries.length, 3);

  const dirty = buildIndex([null, 42, {}, { id: '', text: 'x' }, { id: 'ok', text: 'phoenix rises' }]);
  assert.equal(dirty.n, 1);
  assert.equal(dirty.entries[0].id, 'ok');
});

test('search returns the most-relevant doc first with a snippet', () => {
  const idx = buildIndex(DOCS);
  const hits = search(idx, 'phoenix resurrection continuity', { k: 3 });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].id, 'phoenix.md');
  assert.equal(hits[0].title, 'Phoenix Protocol');
  assert.ok(hits[0].score > 0);
  assert.ok(typeof hits[0].snippet === 'string' && hits[0].snippet.length > 0);
  // results are ordered by score descending.
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
});

test('search distinguishes themes — convergence query picks convergence doc', () => {
  const idx = buildIndex(DOCS);
  const hits = search(idx, 'multi-agent egregore VR BCI', { k: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'convergence.md');
});

test('k limits the number of results', () => {
  const idx = buildIndex(DOCS);
  // a query touching all three docs (each mentions "witness" or "consciousness")
  const hits = search(idx, 'witness consciousness convergence phoenix', { k: 2 });
  assert.ok(hits.length <= 2);
});

test('empty query and no-match query soft-fail to []', () => {
  const idx = buildIndex(DOCS);
  assert.deepEqual(search(idx, ''), []);
  assert.deepEqual(search(idx, '   '), []);
  // only stopwords -> no usable terms -> []
  assert.deepEqual(search(idx, 'the and of to'), []);
  // real terms, but absent from the corpus -> []
  assert.deepEqual(search(idx, 'quantum blockchain elephant'), []);
});

test('bad index / bad inputs soft-fail to [] without throwing', () => {
  assert.deepEqual(search(null, 'phoenix'), []);
  assert.deepEqual(search({}, 'phoenix'), []);
  assert.deepEqual(search({ entries: [] }, 'phoenix'), []);
  assert.deepEqual(buildIndex(null).entries, []);
  assert.deepEqual(buildIndex('nope').entries, []);
  assert.equal(buildIndex(undefined).n, 0);
});

test('title terms are weighted — a title-only match still ranks', () => {
  const idx = buildIndex(DOCS);
  // "zar" appears in the title and body of zar.md only.
  const hits = search(idx, 'zar', { k: 3 });
  assert.equal(hits[0].id, 'zar.md');
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'),
    '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('snippet output is HTML-escaped', () => {
  const idx = buildIndex([{ id: 'x.md', title: 'X', text: 'danger <script>alert(1)</script> phoenix here' }]);
  const hits = search(idx, 'phoenix', { k: 1 });
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].snippet.includes('<script>'));
  assert.ok(hits[0].snippet.includes('&lt;script&gt;'));
});
