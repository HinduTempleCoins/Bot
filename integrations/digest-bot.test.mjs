import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __setLLM, parseChunkJson, mergeDigest, renderMarkdown, digest, watchOnce, extractText, slugOf, chunkPrompt } from './digest-bot.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'digest-bot-'));
const book = () => {
  const paras = [];
  for (let i = 0; i < 30; i++) paras.push(`Paragraph ${i}. Haplogroup J2a is discussed here with mtDNA and the Y chromosome. A test costs $39 during a sale. Researchers measured ancient DNA from the petrous bone at site ${i}.`);
  return '# The Test Book\n\n' + paras.join('\n\n');
};
const good = (over = {}) => JSON.stringify({
  summary: 'This part discusses haplogroups and testing.',
  claims: [{ text: 'A test costs $39 on sale', kind: 'measured', confidence: 0.9 }, { text: 'Myths may preserve migrations', kind: 'speculation', confidence: 0.4 }],
  entities: { people: ['Tovia Singer'], places: ['Southern Africa'], groups: ['Lemba'], tools: ['GEDmatch', 'gedmatch'], laws: ['Privacy Act'], genes: ['J2a', 'Cohen Modal Haplotype'] },
  numbers: [{ value: '$39', what: 'sale price' }],
  questions_raised: ['Which markers were measured?'], action_items: ['Download the raw data'], sources_cited: ['ISOGG'], ...over,
});

test('parseChunkJson: extracts, normalises, rejects junk', () => {
  const j = parseChunkJson('Here you go:\n```json\n' + good({ claims: [{ text: 'x', kind: 'WEIRD', confidence: 7 }, 'bare string claim'] }) + '\n```');
  assert.equal(j.summary, 'This part discusses haplogroups and testing.');
  assert.equal(j.claims[0].kind, 'inference');           // unknown kind → inference
  assert.equal(j.claims[0].confidence, 1);               // clamped
  assert.equal(j.claims[1].text, 'bare string claim');
  assert.deepEqual(j.entities.tools, ['GEDmatch', 'gedmatch']);
  assert.equal(parseChunkJson('no json here'), null);
  assert.equal(parseChunkJson('{"claims":[]}'), null);   // no summary → unusable
  assert.equal(parseChunkJson('{bad json'), null);
});

test('mergeDigest dedupes entities/claims across chunks and keeps labels', () => {
  const a = { index: 0, llm: true, ...parseChunkJson(good()) };
  const b = { index: 1, llm: true, ...parseChunkJson(good({ claims: [{ text: 'A test costs $39 on sale!', kind: 'measured', confidence: 0.95 }] })) };
  const d = mergeDigest([a, b], { title: 'T', source: 't.md' });
  assert.equal(d.entities.tools.find((e) => e.name === 'GEDmatch').count, 4);   // case-insensitive dedupe
  assert.equal(d.claims.measured.length, 1);
  assert.equal(d.claims.measured[0].confidence, 0.95);                        // higher confidence wins
  assert.equal(d.claims.speculation.length, 1);
  assert.equal(d.action_items.length, 1);
  const md = renderMarkdown(d);
  assert.match(md, /## Action items/);
  assert.match(md, /Speculation/);
  assert.match(md, /Genes, haplogroups, markers/);
});

test('digest: end to end with injected LLM, resumes from cache', async () => {
  const dir = tmp(); const f = path.join(dir, 'The Test Book.md'); fs.writeFileSync(f, book());
  let calls = 0;
  __setLLM(async () => { calls++; return { text: good(), provider: 'fake' }; });
  const r1 = await digest(f, { outRoot: path.join(dir, 'out'), words: 60, overlap: 5 });
  assert.ok(r1.ok, r1.error);
  assert.ok(r1.chunks > 3);
  assert.equal(r1.llmChunks, r1.chunks);
  assert.equal(calls, r1.chunks);
  const md = fs.readFileSync(path.join(r1.outDir, 'digest.md'), 'utf8');
  assert.match(md, /# Digest: The Test Book/);
  assert.ok(fs.readFileSync(path.join(r1.outDir, 'chunks.jsonl'), 'utf8').split('\n').filter(Boolean).length === r1.chunks);
  const r2 = await digest(f, { outRoot: path.join(dir, 'out'), words: 60, overlap: 5 });
  assert.equal(r2.cached, r1.chunks);
  assert.equal(calls, r1.chunks);                          // no new LLM calls
  __setLLM(null);
});

test('digest: LLM failure falls back to extractive and retries next run', async () => {
  const dir = tmp(); const f = path.join(dir, 'b.md'); fs.writeFileSync(f, book());
  __setLLM(async () => { throw new Error('down'); });
  const r1 = await digest(f, { outRoot: dir, words: 80, overlap: 5 });
  assert.ok(r1.ok);
  assert.equal(r1.llmChunks, 0);
  const d = JSON.parse(fs.readFileSync(path.join(r1.outDir, 'digest.json'), 'utf8'));
  assert.ok(d.outline.every((o) => o.summary.length > 0));  // extractive summaries present
  __setLLM(async () => ({ text: good() }));
  const r2 = await digest(f, { outRoot: dir, words: 80, overlap: 5 });
  assert.equal(r2.llmChunks, r2.chunks);                    // failed chunks retried
  assert.equal(r2.cached, 0);
  __setLLM(null);
});

test('digest: unreadable input soft-fails', async () => {
  const r = await digest('/nonexistent/file.md', { outRoot: tmp() });
  assert.equal(r.ok, false);
});

test('watchOnce moves finished documents to done/', async () => {
  const dir = tmp(); fs.writeFileSync(path.join(dir, 'one.txt'), book()); fs.writeFileSync(path.join(dir, 'ignore.bin'), 'x');
  __setLLM(async () => ({ text: good() }));
  const res = await watchOnce(dir, { outRoot: path.join(dir, 'out'), words: 200 });
  assert.equal(res.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'done', 'one.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'ignore.bin')));
  __setLLM(null);
});

test('extractText strips front matter; slugOf; prompt carries the text', () => {
  const dir = tmp(); const f = path.join(dir, 'x.md'); fs.writeFileSync(f, '---\nsource: a\n---\n# Hi\n\nBody.');
  assert.equal(extractText(f).trim(), '# Hi\n\nBody.');
  assert.equal(slugOf('/a/2026-09-30 DNA!.md'), '2026-09-30-dna');
  assert.match(chunkPrompt('SOMETEXT', { title: 'T', index: 1, total: 3 }), /part 2 of 3[\s\S]*SOMETEXT/);
});

test('LLM_NO_KEYLESS=1 removes the keyless provider from the router', async () => {
  const { availableProviders } = await import('./llm-router.mjs');
  const before = availableProviders().pollinations;
  process.env.LLM_NO_KEYLESS = '1';
  try { assert.equal(availableProviders().pollinations, false); } finally { delete process.env.LLM_NO_KEYLESS; }
  assert.equal(availableProviders().pollinations, before);
});
