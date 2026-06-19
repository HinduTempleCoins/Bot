// lora-dataset.test.mjs — corpus → LoRA training JSONL. Pure transforms + injected fs; offline.
import { test } from 'node:test';
import assert from 'node:assert';
import { parseCedict, chunkText, buildFromDataset, buildAll, toJsonl } from './lora-dataset.mjs';

test('parseCedict turns dictionary lines into {word,pinyin,meaning}', () => {
  const t = '# comment\n傳統 传统 [chuan2 tong3] /tradition/traditional/\n你好 你好 [ni3 hao3] /hello/hi/\nbad line\n';
  const e = parseCedict(t);
  assert.equal(e.length, 2);
  assert.equal(e[1].word, '你好');
  assert.equal(e[1].pinyin, 'ni3 hao3');
  assert.match(e[1].meaning, /hello/);
});

test('chunkText splits raw corpus into reading blocks, dropping tiny fragments', () => {
  const text = ('In the beginning was the Word. '.repeat(40) + '\n\n' + 'And the Word was with God. '.repeat(40));
  const chunks = chunkText(text, 400);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => c.length >= 40));
});

test('buildFromDataset: CC-CEDICT → instruction sentences', () => {
  const ds = { id: 'cc-cedict', language: 'mandarin', via: 'CC-CEDICT', content: '你好 你好 [ni3 hao3] /hello/' };
  const ex = buildFromDataset(ds);
  assert.equal(ex.length, 1);
  assert.match(ex[0].text, /In Mandarin, 你好 \(ni3 hao3\) means: hello\./);
  assert.equal(ex[0].language, 'mandarin');
});

test('buildFromDataset: raw corpus → continued-pretraining reading chunks', () => {
  const ds = { id: 'sblgnt-data', language: 'koine-greek', content: 'Ἐν ἀρχῇ ἦν ὁ λόγος. '.repeat(60) };
  const ex = buildFromDataset(ds);
  assert.ok(ex.length >= 1);
  assert.match(ex[0].text, /\[Koine Greek reading\]/);
});

test('buildAll reads a dir via injected fs, aggregates + counts per source', async () => {
  const files = { 'cc-cedict.json': JSON.stringify({ id: 'cc-cedict', language: 'mandarin', via: 'CC-CEDICT', content: '好 好 [hao3] /good/' }),
    'oshb-data.json': JSON.stringify({ id: 'oshb-data', language: 'biblical-hebrew', content: 'בְּרֵאשִׁית בָּרָא אֱלֹהִים '.repeat(60) }),
    'manifest.json': '{}' };
  const r = await buildAll({ dir: '/x', readdir: async () => Object.keys(files), readFile: async (p) => files[p.split('/').pop()] });
  assert.equal(r.stats.sources, 2);                 // manifest.json excluded
  assert.ok(r.examples.length >= 2);
  assert.ok(r.stats.bySource['cc-cedict'] >= 1);
});

test('buildAll soft-fails on a bad dir / bad json (never throws)', async () => {
  const r = await buildAll({ dir: '/nope', readdir: async () => { throw new Error('no dir'); } });
  assert.equal(r.examples.length, 0);
});

test('toJsonl emits one JSON object per line with a text field', () => {
  const jl = toJsonl([{ text: 'a', language: 'x', source: 's' }, { text: 'b', language: 'y', source: 't' }]);
  const lines = jl.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).text, 'a');
});
