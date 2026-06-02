// booklore.test.mjs — proves the Book Memory System v1 end-to-end WITHOUT touching the live sites.
// We point BOOKLORE_DIR at a temp dir (set before importing the module so it picks it up) and feed
// the scraper a mocked fetch via __setFetch, so ingest()/search() run against a tiny in-memory book.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the store before importing booklore (it reads BOOKLORE_DIR at module load).
const TMP = mkdtempSync(join(tmpdir(), 'booklore-test-'));
process.env.BOOKLORE_DIR = TMP;
process.env.BOOKLORE_DELAY_MS = '0'; // no politeness wait in tests

const { fetchClean, __setFetch } = await import('../scraper.mjs');
const { chunkBook, ingest, search, isIngested, stats } = await import('./booklore.mjs');

// A tiny fixture "page" served as HTML by the mocked fetch (the scraper's fallback path strips tags).
const FIXTURE = `<!doctype html><html><head><title>Hestia, Goddess of the Hearth</title></head>
<body>
<h1>HESTIA</h1>
<p>Hestia was the ancient Greek virgin goddess of the hearth, home, and the family. As the goddess of
the sacrificial flame she received the first portion of every sacrifice offered to the gods.</p>
<p>She was depicted as a modestly veiled woman, sometimes holding a flowering branch. In myth Hestia
was the first born child of the Titans Kronos and Rhea, and a sister of Zeus, Hera, and Poseidon.</p>
<p>Hestia was one of three goddesses immune to the charms of Aphrodite, having sworn to remain a virgin
and tend the eternal flame of Olympus. Apollon and Poseidon both wooed her, but she refused them both.</p>
</body></html>`;

before(() => {
  __setFetch(async (url) => {
    // The scraper tries Jina (r.jina.ai) first; fail that so it falls back to a raw fetch of our HTML.
    if (String(url).includes('r.jina.ai')) {
      return { ok: false, status: 502, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => FIXTURE };
  });
});

after(() => {
  __setFetch(null);
  rmSync(TMP, { recursive: true, force: true });
});

test('chunkBook splits text into bounded passages with idx/offset', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about myth and ritual.`).join(' ');
  const chunks = chunkBook(long);
  assert.ok(chunks.length >= 2, 'long text yields multiple chunks');
  for (const c of chunks) {
    assert.ok(typeof c.chunk === 'string' && c.chunk.length > 0);
    assert.ok(c.chunk.length <= 1600, `chunk within bound (was ${c.chunk.length})`);
    assert.equal(typeof c.idx, 'number');
    assert.equal(typeof c.offset, 'number');
  }
  // idx is sequential
  chunks.forEach((c, i) => assert.equal(c.idx, i));
});

test('chunkBook handles empty / whitespace input', () => {
  assert.deepEqual(chunkBook(''), []);
  assert.deepEqual(chunkBook('   \n\n  '), []);
});

test('ingest stores passages to JSONL and is incremental', async () => {
  const url = 'https://www.theoi.com/Olympios/Hestia.html';
  const r1 = await ingest(url);
  assert.equal(r1.skipped, false);
  assert.ok(r1.chunks >= 1, 'ingested at least one chunk');
  assert.equal(r1.host, 'theoi.com');
  assert.ok(isIngested(url), 'URL recorded as ingested');

  // second ingest of same URL is skipped (incremental)
  const r2 = await ingest(url);
  assert.equal(r2.skipped, true);
  assert.equal(r2.reason, 'already-ingested');
});

test('search ranks the relevant passage first with a citation', async () => {
  const hits = await search('virgin goddess of the hearth', { limit: 3 });
  assert.ok(hits.length >= 1, 'got at least one hit');
  const top = hits[0];
  assert.match(top.title, /Hestia/i, 'top hit is the Hestia page');
  assert.equal(top.host, 'theoi.com');
  assert.match(top.url, /Hestia/);
  assert.ok(top.score > 0);
  assert.ok(top.snippet.length > 0, 'snippet present for display');
  assert.match(top.snippet.toLowerCase(), /hearth|virgin|goddess/);
});

test('search is empty-safe for empty / stopword-only queries', async () => {
  assert.deepEqual(await search(''), []);
  assert.deepEqual(await search('the and of to'), []);
});

test('search can narrow to a host', async () => {
  const hits = await search('Hestia', { host: 'theoi.com' });
  assert.ok(hits.length >= 1);
  const miss = await search('Hestia', { host: 'sacred-texts.com' });
  assert.deepEqual(miss, [], 'no passages stored for that host yet');
});

test('stats reports passage + page counts by host', () => {
  const s = stats();
  assert.ok(s.passages >= 1);
  assert.equal(s.pages, 1);
  assert.ok(s.byHost['theoi.com'] >= 1);
});
