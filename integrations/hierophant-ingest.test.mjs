import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gutenbergTextUrl, stripGutenberg, ingestable, ingestOne, ingest } from './hierophant-ingest.mjs';

test('gutenbergTextUrl derives the plain-text url from an ebook url', () => {
  assert.equal(gutenbergTextUrl('https://www.gutenberg.org/ebooks/11000'), 'https://www.gutenberg.org/cache/epub/11000/pg11000.txt');
  assert.equal(gutenbergTextUrl('https://sacred-texts.com/x'), null);
});

test('stripGutenberg removes header/footer boilerplate', () => {
  const raw = 'LICENSE BLAH\n*** START OF THE PROJECT GUTENBERG EBOOK GILGAMESH ***\n\nThe real text here.\n\n*** END OF THE PROJECT GUTENBERG EBOOK GILGAMESH ***\nfooter junk';
  assert.equal(stripGutenberg(raw), 'The real text here.');
});

test('ingestable lists catalog texts that have a gutenberg source', () => {
  const list = ingestable();
  assert.ok(list.length >= 10, 'has public-domain texts to ingest');
  assert.ok(list.every((t) => /gutenberg\.org\/cache\/epub/.test(t.url)));
});

test('ingestOne fetches + cleans with an injected fetch (no network)', async () => {
  const fetch = async () => ({ ok: true, status: 200, text: async () => '*** START OF THE PROJECT GUTENBERG EBOOK X ***\n' + 'word '.repeat(100) + '\n*** END OF THE PROJECT GUTENBERG EBOOK X ***' });
  const rec = await ingestOne({ id: 'gilgamesh', title: 'Gilgamesh', tradition: 'mesopotamian', url: 'u' }, { fetch });
  assert.equal(rec.id, 'gilgamesh');
  assert.ok(rec.chars > 200);
  assert.match(rec.license, /public-domain/);
  assert.doesNotMatch(rec.text, /PROJECT GUTENBERG/);
});

test('ingest dry-run reports candidates without writing; soft-fails a bad source', async () => {
  let n = 0;
  const fetch = async () => (++n === 1 ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => 'x'.repeat(500) });
  const r = await ingest({ fetch, apply: false, limit: 3, throttleMs: 0 });
  assert.equal(r.applied, false);
  assert.ok(r.candidates >= 1);
  assert.ok(r.ingested + r.failed === Math.min(3, r.candidates));
});
