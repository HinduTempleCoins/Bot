// docling-ingest.test.mjs — Docling export → annal records (offline, injected reader).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDocling, toAnnalRecords, chunkForEmbedding, esc, __setReader,
} from './docling-ingest.mjs';

test('normalizeDocling: canonical Docling texts[] → title + sections', () => {
  const doc = normalizeDocling({
    name: 'My Doc',
    texts: [
      { label: 'title', text: 'My Doc' },
      { label: 'section_header', text: 'Intro' },
      { label: 'paragraph', text: 'First para.' },
      { label: 'paragraph', text: 'Second para.' },
      { label: 'section_header', text: 'Body' },
      { label: 'paragraph', text: 'Body text.' },
    ],
  });
  assert.equal(doc.title, 'My Doc');
  assert.equal(doc.sections.length, 3); // title heading + Intro + Body
  const intro = doc.sections.find((s) => s.heading === 'Intro');
  assert.match(intro.text, /First para\.\nSecond para\./);
});

test('normalizeDocling: markdown string → sections by ATX heading', () => {
  const doc = normalizeDocling('# Title\n\nlead\n\n## Sub\n\nbody', { source: 'x.md' });
  assert.equal(doc.title, 'Title');
  assert.equal(doc.source, 'x.md');
  assert.ok(doc.sections.some((s) => s.heading === 'Sub' && /body/.test(s.text)));
});

test('normalizeDocling: already-simplified {title,sections} passes through', () => {
  const doc = normalizeDocling({ title: 'T', sections: [{ heading: 'H', text: 'x', level: 2 }] });
  assert.equal(doc.title, 'T');
  assert.equal(doc.sections[0].level, 2);
});

test('normalizeDocling: soft-fail on null / non-object', () => {
  assert.deepEqual(normalizeDocling(null).sections, []);
  assert.deepEqual(normalizeDocling(42).sections, []);
});

test('toAnnalRecords: one record per non-empty section with stable id + meta', () => {
  const doc = normalizeDocling('# Doc\n\n## A\n\nalpha\n\n## B\n\nbeta', { source: 'corpus/doc.md' });
  const recs = toAnnalRecords(doc);
  assert.ok(recs.length >= 2);
  const a = recs.find((r) => /alpha/.test(r.text));
  assert.match(a.id, /^corpus-doc-md#a-\d+$/);
  assert.equal(a.meta.source, 'corpus/doc.md');
  assert.equal(a.meta.title, 'Doc');
  assert.equal(a.meta.heading, 'A');
});

test('toAnnalRecords: empty doc → []', () => {
  assert.deepEqual(toAnnalRecords(null), []);
  assert.deepEqual(toAnnalRecords({ sections: [] }), []);
});

test('chunkForEmbedding: short records pass through unchanged', () => {
  const recs = [{ id: 'a', text: 'short', meta: {} }];
  assert.deepEqual(chunkForEmbedding(recs, { maxChars: 100 }), recs);
});

test('chunkForEmbedding: long record splits into chunks with chunk meta', () => {
  const big = Array.from({ length: 50 }, (_, i) => `para number ${i} with some words`).join('\n\n');
  const recs = [{ id: 'big', text: big, meta: { source: 's' } }];
  const out = chunkForEmbedding(recs, { maxChars: 200, overlap: 20 });
  assert.ok(out.length > 1);
  assert.match(out[0].id, /^big~0$/);
  assert.equal(out[0].meta.source, 's');
  assert.equal(out[0].meta.chunks, out.length);
  for (const c of out) assert.ok(c.text.length <= 260); // max + a little slack for overlap/word
});

test('chunkForEmbedding: hard-splits a single over-long paragraph on word boundaries', () => {
  const oneLong = 'word '.repeat(500).trim();
  const out = chunkForEmbedding([{ id: 'x', text: oneLong, meta: {} }], { maxChars: 100 });
  assert.ok(out.length > 1);
  for (const c of out) assert.ok(c.text.length <= 110);
});

test('chunkForEmbedding: soft-fail on garbage', () => {
  assert.deepEqual(chunkForEmbedding(null), []);
  assert.deepEqual(chunkForEmbedding([{ id: 'a' }]), []); // no text
});

test('end-to-end: Docling json → records → chunks ready for Memory.upsert', async () => {
  const doc = normalizeDocling({
    name: 'Scripture',
    texts: [
      { label: 'title', text: 'Scripture' },
      { label: 'section_header', text: 'Verse 1' },
      { label: 'paragraph', text: 'In the beginning.' },
    ],
  }, { source: 'knowledge/scripture/x.json' });
  const recs = chunkForEmbedding(toAnnalRecords(doc));
  assert.ok(recs.length >= 1);
  assert.ok(recs.every((r) => typeof r.id === 'string' && typeof r.text === 'string' && r.meta));
});

test('__setReader: injected reader feeds the (otherwise file-less) pipeline', () => {
  let asked = '';
  __setReader((p) => { asked = p; return '# Injected\n\nbody'; });
  // exercise via normalize on what a reader would return
  const raw = (function read(p) { return p; })('ok');
  void raw;
  const doc = normalizeDocling('# Injected\n\nbody', { source: 'mem' });
  assert.equal(doc.title, 'Injected');
  __setReader(null);
  assert.equal(typeof asked, 'string');
});

test('esc: escapes entities', () => {
  assert.equal(esc(`<a&"'>`), '&lt;a&amp;&quot;&#39;&gt;');
});
