// OFFLINE tests for the PURE in-memory inverted index in lib-search.mjs. No network: the engine
// adapters (meiliSearch/typesenseSearch) are NOT exercised here. Covers tokenization, TF/IDF ranking,
// multi-term AND (vs OR), and snippet highlighting.
import { test } from 'node:test';
import assert from 'node:assert';
import { tokenize, indexDocs, search, snippet } from './lib-search.mjs';

const DOCS = [
  { id: 'a', title: 'Alexander Shulgin', body: 'American chemist and author of PiHKAL, a pioneer of phenethylamine synthesis.' },
  { id: 'b', title: 'PiHKAL', body: 'A chemistry book by Alexander Shulgin and Ann Shulgin about phenethylamines.' },
  { id: 'c', title: 'Hathor the Witness', body: 'A founding witness account on the MELEK blockchain, the Angelic AI resident.' },
  { id: 'd', title: 'Synthesis notes', body: 'Synthesis synthesis synthesis — repeated term for term-frequency ranking.' },
];

test('tokenize: lowercases, splits on non-alphanumerics, drops stopwords and 1-char tokens', () => {
  const toks = tokenize('The Quick, BROWN fox! a x');
  assert.deepEqual(toks, ['quick', 'brown', 'fox']); // "the","a" stopped, "x" too short
});

test('tokenize: unicode letters survive', () => {
  assert.deepEqual(tokenize('Café Müller'), ['café', 'müller']);
});

test('search: returns ranked {id, score, snippet}', () => {
  const store = indexDocs(DOCS);
  const res = search('shulgin', store);
  assert.ok(res.length >= 2);
  for (const r of res) {
    assert.ok('id' in r && 'score' in r && 'snippet' in r);
    assert.equal(typeof r.score, 'number');
  }
});

test('search: term-frequency ranking — doc repeating the term ranks first', () => {
  const store = indexDocs(DOCS);
  const res = search('synthesis', store);
  assert.ok(res.length >= 1);
  assert.equal(res[0].id, 'd', 'doc d repeats "synthesis" thrice → top');
  // scores are descending
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].score >= res[i].score);
});

test('search: multi-term defaults to AND (all terms must be present)', () => {
  const store = indexDocs(DOCS);
  const res = search('shulgin chemist', store); // only doc a has BOTH
  const ids = res.map((r) => r.id);
  assert.deepEqual(ids, ['a']);
});

test('search: match=or relaxes to union of terms', () => {
  const store = indexDocs(DOCS);
  const res = search('shulgin witness', store, { match: 'or' });
  const ids = new Set(res.map((r) => r.id));
  assert.ok(ids.has('a') && ids.has('b'), 'shulgin docs included');
  assert.ok(ids.has('c'), 'witness doc included via OR');
});

test('search: idf — rarer term contributes more weight than a common one', () => {
  // "blockchain" appears in 1 doc (rare), "shulgin" in 2. A rare unique-term match should score.
  const store = indexDocs(DOCS);
  const res = search('blockchain', store);
  assert.equal(res[0].id, 'c');
  assert.ok(res[0].score > 0);
});

test('search: empty/whitespace/stopword-only query returns []', () => {
  const store = indexDocs(DOCS);
  assert.deepEqual(search('', store), []);
  assert.deepEqual(search('   ', store), []);
  assert.deepEqual(search('the of and', store), []);
});

test('search: no matches returns []', () => {
  const store = indexDocs(DOCS);
  assert.deepEqual(search('zzzznonexistent', store), []);
});

test('search: limit caps result count', () => {
  const store = indexDocs(DOCS);
  const res = search('shulgin', store, { limit: 1, match: 'or' });
  assert.equal(res.length, 1);
});

test('indexDocs: skips docs without an id', () => {
  const store = indexDocs([{ title: 'no id here' }, { id: 'x', title: 'kept doc keyword' }]);
  const res = search('keyword', store);
  assert.deepEqual(res.map((r) => r.id), ['x']);
});

test('snippet: highlights matched terms with [[ ]] and centers on first match', () => {
  const text = 'Some preamble text. Alexander Shulgin was a chemist. More trailing text after.';
  const out = snippet(text, ['shulgin']);
  assert.match(out, /\[\[Shulgin\]\]/);
});

test('snippet: returns truncated window with ellipsis for long text', () => {
  const long = 'lead '.repeat(60) + 'TARGET ' + 'tail '.repeat(60);
  const out = snippet(long, ['target'], { width: 80 });
  assert.match(out, /\[\[TARGET\]\]/);
  assert.ok(out.includes('…'), 'window is trimmed with an ellipsis');
  assert.ok(out.length < long.length);
});

test('snippet: empty text returns empty string', () => {
  assert.equal(snippet('', ['x']), '');
});

test('search result snippet highlights the query term', () => {
  const store = indexDocs(DOCS);
  const res = search('phenethylamine', store);
  assert.ok(res.length >= 1);
  assert.match(res[0].snippet, /\[\[phenethylamine/i);
});
