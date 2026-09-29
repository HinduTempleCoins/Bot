// OFFLINE. Reads the real knowledge/ tree — no network, no LLM, no key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ask, retrieve, corpusFiles, readDoc, terms, stats } from './corpus-rag.mjs';

test('⛔ the corpus is reachable at all — this is the bug that prompted the module', () => {
  // site/hierophant said it answered over "the Temple's OWN corpus (the knowledge/ tree)". It did not:
  // library-rag.mjs queries the wiki search API, a different corpus, so the Temple's own research came
  // back as "The Library doesn't cover that" with 300KB of it on disk beside the question.
  const s = stats();
  assert.ok(s.files > 200, `expected the knowledge tree, found ${s.files} files`);
  assert.ok(s.bytes > 1_000_000);
});

test('it finds the Phoenician research the library could not', () => {
  const r = ask('Punt Havilah Phoenician');
  assert.equal(r.grounded, true);
  assert.ok(r.sources.some((s) => /phoenician\//.test(s.source)), JSON.stringify(r.sources));
  assert.ok(r.passages[0].text.length > 100, 'a hit must carry readable text, not just a filename');
});

test('⚠️ covering MORE of the question beats repeating one word of it', () => {
  // A file that says "Punt" ninety times and never "Havilah" must not outrank the file about both.
  const hits = retrieve('Punt Havilah', { topK: 5 });
  assert.ok(hits.length);
  assert.ok(hits.every((h) => h.matched >= 1));
  const top = hits[0];
  assert.equal(top.of, 2);
  assert.ok(top.matched === 2 || hits.every((h) => h.matched === 1),
    'if any document matches both terms, a one-term document must not be first');
});

test('⭐ a JSON doc scores on its VALUES, not its key names', () => {
  // Stringifying the tree would make every file match "overview", "title", "source" and rank on schema.
  const noise = retrieve('overview source author title', { topK: 3 });
  const real = retrieve('Melqart Carthage tin', { topK: 3 });
  assert.ok(real.length, 'a real subject must retrieve');
  assert.ok(real[0].score > (noise[0] ? noise[0].score : 0) || !noise.length,
    'schema words must not outrank subject matter');
});

test('the empty state is honest — it never invents', () => {
  const r = ask('xyzzy plugh frobnicate quuxbaz');
  assert.equal(r.grounded, false);
  assert.match(r.answer, /does not cover that/);
  assert.deepEqual(r.sources, []);
  assert.deepEqual(r.passages, []);
});

test('generated index files are excluded so filenames cannot swamp a query', () => {
  const files = corpusFiles();
  assert.ok(!files.some((f) => /_keyword_index|_library_catalog/.test(f)),
    'the machine-written indexes would match nearly every query on filename noise');
  assert.ok(!files.some((f) => f.endsWith('.mjs')), 'code is not corpus');
});

test('malformed and empty inputs degrade instead of throwing', () => {
  for (const q of ['', '   ', null, undefined, 'a an the of']) {
    assert.deepEqual(retrieve(q), [], `"${q}" should retrieve nothing`);
  }
  assert.equal(readDoc('/nonexistent/path.json'), null);
  assert.deepEqual(terms('the a of IT'), []);
  // a possessive or a hyphen must not create a token that can never match the text
  assert.deepEqual(terms("Punt's Havilah-network"), ['punt', 'havilah', 'network']);
  assert.ok(retrieve("Punt's network").length, 'a possessive question must still retrieve');
});

test('retrieval weights rare words: filler like "tell me about" does not decide the answer', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const d = mkdtempSync(join(tmpdir(), 'rag-'));
  for (let i = 0; i < 6; i++) writeFileSync(join(d, `common${i}.md`), `# Doc ${i}\n\n${'We tell you about many things, and we tell it well, about law and about time. '.repeat(20)}`);
  writeFileSync(join(d, 'odin.md'), '# Norse notes\n\nOdin hung on the world-tree for nine nights to win the runes; Odin gave an eye at the well of Mimir.');
  const { retrieve } = await import('./corpus-rag.mjs');
  const hits = retrieve('tell me about Odin', { root: d });
  assert.equal(hits[0].title, 'Norse notes');
  assert.equal(hits.length, 1, 'documents that only share filler words are not returned');
});

test('exclude keeps a surface from answering out of folders/files it should not', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'crag-'));
  mkdirSync(join(root, 'ops')); mkdirSync(join(root, 'myth'));
  writeFileSync(join(root, 'ops', 'notes.md'), '# Notes\nzephyrine setup notes about the zephyrine mailbox triage workflow');
  writeFileSync(join(root, 'myth', 'z.md'), '# Zephyrine\nzephyrine was a wind spirit honoured with offerings at dawn by sailors');
  const all = retrieve('zephyrine', { root });
  assert.equal(all.length, 2);
  const scoped = retrieve('zephyrine', { root, exclude: ['ops'] });
  assert.deepEqual(scoped.map((h) => h.source), ['myth/z.md']);
});
