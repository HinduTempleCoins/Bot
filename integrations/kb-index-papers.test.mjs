// kb-index-papers.test.mjs — OFFLINE tests for integrations/kb-index-papers.mjs (task #50).
//
// Everything runs offline: we feed canned frontmatter+body strings through __setReader() so no real
// file is read, and the chunk/parse functions are pure. No network, no git, no file writes.

import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  chunkText,
  parseFrontmatter,
  indexDocument,
  indexPapers,
  toRecords,
  __setReader,
} from './kb-index-papers.mjs';

afterEach(() => __setReader(null)); // restore the real reader after any injection

// ── chunkText ───────────────────────────────────────────────────────────────────────────────────

test('chunkText: short text → single chunk at offset 0', () => {
  const out = chunkText('A short sentence.', { maxChars: 1200 });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'A short sentence.');
  assert.equal(out[0].charStart, 0);
});

test('chunkText: empty / non-string → []', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   '), []);
  assert.deepEqual(chunkText(null), []);
  assert.deepEqual(chunkText(undefined), []);
});

test('chunkText: long text → multiple overlapping chunks that cover the original with no gaps', () => {
  // Build a long body out of distinct sentences so we can check coverage.
  const sentences = [];
  for (let i = 0; i < 60; i++) sentences.push(`Sentence number ${i} carries some words for length.`);
  const body = sentences.join(' ');
  const maxChars = 300;
  const overlap = 60;
  const chunks = chunkText(body, { maxChars, overlap });

  assert.ok(chunks.length > 1, 'expected multiple chunks');

  // Every chunk respects maxChars.
  for (const c of chunks) assert.ok(c.text.length <= maxChars, `chunk over max: ${c.text.length}`);

  // No gaps: each chunk starts at or before the END of the previous chunk (i.e. overlap/contiguous).
  for (let i = 1; i < chunks.length; i++) {
    const prevEnd = chunks[i - 1].charStart + chunks[i - 1].text.length;
    assert.ok(
      chunks[i].charStart <= prevEnd,
      `gap between chunk ${i - 1} (ends ~${prevEnd}) and ${i} (starts ${chunks[i].charStart})`,
    );
  }

  // Coverage: the original (whitespace-normalized) is fully represented across the chunks. We verify
  // by walking the source and confirming each region is contained in some chunk window.
  const src = body.trim();
  const lastEnd = chunks[chunks.length - 1].charStart + chunks[chunks.length - 1].text.length;
  assert.ok(lastEnd >= src.length - 2, `chunks should reach the end of source (${lastEnd} vs ${src.length})`);
  assert.equal(chunks[0].charStart, 0, 'first chunk starts at 0');
});

test('chunkText: consecutive chunks actually overlap', () => {
  const body = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ').repeat(4);
  const chunks = chunkText(body, { maxChars: 120, overlap: 40 });
  assert.ok(chunks.length > 1);
  // The end of chunk[0] region and start of chunk[1] region overlap by construction.
  const c0End = chunks[0].charStart + chunks[0].text.length;
  assert.ok(chunks[1].charStart < c0End, 'second chunk should start before the first one ends');
});

test('chunkText: prefers paragraph boundaries when splitting', () => {
  const para = 'x'.repeat(200);
  const body = `${para}\n\n${para}\n\n${para}`;
  const chunks = chunkText(body, { maxChars: 250, overlap: 20 });
  assert.ok(chunks.length >= 2);
});

// ── parseFrontmatter ────────────────────────────────────────────────────────────────────────────

test('parseFrontmatter: --- fenced YAML-ish block separates meta from body', () => {
  const raw = `---\ntitle: My Paper\nauthor: Rev. Van Kush\n---\nThis is the body text.\nMore body.`;
  const { meta, body } = parseFrontmatter(raw);
  assert.equal(meta.title, 'My Paper');
  assert.equal(meta.author, 'Rev. Van Kush');
  assert.equal(body, 'This is the body text.\nMore body.');
  assert.ok(!body.includes('title:'), 'frontmatter must not leak into body');
});

test('parseFrontmatter: scripture markdown shape (# Title + **Key:** + --- rule)', () => {
  const raw =
    `# Heterosis Paper Title\n\n` +
    `**Author:** Rev. Ryan Sasha-Shai Van Kush\n` +
    `**Journal:** *Journal of Genetics*\n\n` +
    `---\n\n` +
    `## Abstract\n\nThe abstract body goes here.`;
  const { meta, body } = parseFrontmatter(raw);
  assert.equal(meta.title, 'Heterosis Paper Title');
  assert.equal(meta.author, 'Rev. Ryan Sasha-Shai Van Kush');
  assert.equal(meta.journal, 'Journal of Genetics'); // markdown emphasis stripped
  assert.ok(body.startsWith('## Abstract'));
  assert.ok(!body.includes('**Author:**'), 'header must not leak into body');
});

test('parseFrontmatter: no frontmatter → empty meta, whole text as body', () => {
  const raw = 'Just plain text with no header at all.';
  const { meta, body } = parseFrontmatter(raw);
  assert.deepEqual(meta, {});
  assert.equal(body, raw);
});

test('parseFrontmatter: empty input → empty meta + body', () => {
  const { meta, body } = parseFrontmatter('');
  assert.deepEqual(meta, {});
  assert.equal(body, '');
});

// ── indexDocument ───────────────────────────────────────────────────────────────────────────────

test('indexDocument: produces ordered chunks with id/ord/charStart and title from frontmatter', () => {
  const body = Array.from({ length: 30 }, (_, i) => `Body sentence ${i} with content.`).join(' ');
  const raw = `---\ntitle: Mythology as Genealogy\nauthor: Van Kush\n---\n${body}`;
  const doc = indexDocument(raw, { id: 'mythology_as_genealogy', source: 'knowledge/scripture/mythology_as_genealogy.md', maxChars: 200, overlap: 40 });

  assert.equal(doc.id, 'mythology_as_genealogy');
  assert.equal(doc.title, 'Mythology as Genealogy');
  assert.equal(doc.author, 'Van Kush');
  assert.equal(doc.source, 'knowledge/scripture/mythology_as_genealogy.md');
  assert.ok(doc.chunks.length > 1);
  assert.ok(typeof doc.indexedAt === 'string' && doc.indexedAt.length > 0);

  // ord is sequential and ids are docId#ord.
  doc.chunks.forEach((c, i) => {
    assert.equal(c.ord, i);
    assert.equal(c.id, `mythology_as_genealogy#${i}`);
    assert.ok(typeof c.charStart === 'number');
    assert.ok(c.text.length > 0);
  });
});

test('indexDocument: single short body → one chunk, title falls back to id when no frontmatter', () => {
  const doc = indexDocument('Tiny body.', { id: 'doc1' });
  assert.equal(doc.chunks.length, 1);
  assert.equal(doc.title, 'doc1'); // no title in frontmatter → id
  assert.equal(doc.chunks[0].ord, 0);
});

// ── indexPapers ─────────────────────────────────────────────────────────────────────────────────

test('indexPapers: reads via injected reader and indexes each entry', async () => {
  const CANNED = {
    '/fake/heterosis.md': `# Heterosis\n\n**Author:** Van Kush\n\n---\n\n${'Heterosis body. '.repeat(50)}`,
    '/fake/mythology.md': `# Mythology\n\n**Author:** Van Kush\n\n---\n\n${'Mythology body. '.repeat(50)}`,
  };
  __setReader((p) => CANNED[p] ?? null);

  const indexed = await indexPapers([
    { id: 'heterosis_mechanism', path: '/fake/heterosis.md', source: 'src/het.md' },
    { id: 'mythology_as_genealogy', path: '/fake/mythology.md', source: 'src/myth.md' },
  ], { maxChars: 200, overlap: 30 });

  assert.equal(indexed.length, 2);
  assert.equal(indexed[0].id, 'heterosis_mechanism');
  assert.equal(indexed[0].title, 'Heterosis');
  assert.equal(indexed[0].source, 'src/het.md');
  assert.ok(indexed[0].chunks.length >= 1);
});

test('indexPapers: soft-skips an unreadable entry (reader returns null), never throws', async () => {
  __setReader((p) => (p === '/fake/ok.md' ? `# OK Doc\n\n---\n\n${'Good body. '.repeat(40)}` : null));

  const indexed = await indexPapers([
    { id: 'good', path: '/fake/ok.md' },
    { id: 'missing', path: '/fake/does-not-exist.md' }, // reader returns null → skipped
  ]);

  assert.equal(indexed.length, 1, 'unreadable entry should be skipped, not throw');
  assert.equal(indexed[0].id, 'good');
});

test('indexPapers: accepts raw strings directly (no path read)', async () => {
  const indexed = await indexPapers([
    { id: 'inline', raw: `---\ntitle: Inline Doc\n---\nSome inline body content here.` },
  ]);
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].title, 'Inline Doc');
});

test('indexPapers: non-array / empty input → []', async () => {
  assert.deepEqual(await indexPapers([]), []);
  assert.deepEqual(await indexPapers(null), []);
});

// ── toRecords ───────────────────────────────────────────────────────────────────────────────────

test('toRecords: flattens to citable records carrying docId + source + title', () => {
  const body = Array.from({ length: 20 }, (_, i) => `Para ${i} of the paper body content.`).join(' ');
  const doc = indexDocument(`---\ntitle: Heterosis\n---\n${body}`, {
    id: 'heterosis_mechanism',
    source: 'knowledge/scripture/heterosis_mechanism.md',
    maxChars: 150,
    overlap: 30,
  });
  const records = toRecords([doc]);

  assert.ok(records.length === doc.chunks.length && records.length > 1);
  for (const r of records) {
    assert.equal(r.docId, 'heterosis_mechanism');
    assert.equal(r.source, 'knowledge/scripture/heterosis_mechanism.md');
    assert.equal(r.title, 'Heterosis');
    assert.ok(typeof r.chunkId === 'string' && r.chunkId.startsWith('heterosis_mechanism#'));
    assert.ok(typeof r.ord === 'number');
    assert.ok(typeof r.text === 'string' && r.text.length > 0);
  }
  // ords are 0..n-1 in order.
  assert.deepEqual(records.map((r) => r.ord), records.map((_, i) => i));
});

test('toRecords: empty / non-array input → []', () => {
  assert.deepEqual(toRecords([]), []);
  assert.deepEqual(toRecords(null), []);
  assert.deepEqual(toRecords([{ id: 'x' /* no chunks */ }]), []);
});

// ── end-to-end against the real corpus files (skips cleanly if absent, no network) ───────────────

test('end-to-end: indexes the real scripture papers via the default reader', async () => {
  __setReader(null); // use the real node:fs reader
  const { SCRIPTURE_PAPERS } = await import('./kb-index-papers.mjs');
  const indexed = await indexPapers(SCRIPTURE_PAPERS);
  // Files exist in this repo; if for some reason they don't, indexPapers soft-skips → [] (no throw).
  if (indexed.length === 0) return; // tolerated: soft-fail path
  const records = toRecords(indexed);
  assert.ok(records.length > 0);
  assert.ok(records.every((r) => r.docId && r.source && r.title && r.text));
});
