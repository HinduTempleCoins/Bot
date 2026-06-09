// Offline test for library-index.mjs — no network, no model. Injected embedder + temp repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libidx-'));
const repo = path.join(tmp, 'repo');
const idxDir = path.join(tmp, 'cache');
fs.mkdirSync(path.join(repo, 'knowledge/oilahuasca'), { recursive: true });
fs.mkdirSync(path.join(repo, 'knowledge/scripture'), { recursive: true });
fs.mkdirSync(path.join(repo, 'datasets/hive-devportal'), { recursive: true });
fs.writeFileSync(path.join(repo, 'knowledge/oilahuasca/alkaloids.md'),
  '# Alkaloids\nAllylbenzene alkaloid precursors and terpene synergy in oral preparations. '.repeat(30));
fs.writeFileSync(path.join(repo, 'knowledge/scripture/phoenix.md'),
  '# Phoenix Protocol\nContinuity of the work across instantiations and models.');
fs.writeFileSync(path.join(repo, 'datasets/hive-devportal/witness.md'),
  '# Witness\nA Graphene witness produces blocks; missed blocks reduce reliability; vote ops use the active key.');
fs.writeFileSync(path.join(repo, 'knowledge/oilahuasca/tiny.md'), 'too short');

process.env.MELEK_REPO = repo;
process.env.LIB_IDX_DIR = idxDir;
const mod = await import('./library-index.mjs');

const VOCAB = ['alkaloid', 'terpene', 'phoenix', 'witness', 'block', 'graphene', 'continuity', 'vote'];
const fakeEmbed = async (text) => {
  const t = (text || '').toLowerCase();
  return VOCAB.map((w) => (t.match(new RegExp(w, 'g')) || []).length + 0.01);
};

test('libraryItems walks, chunks, domain-tags, skips tiny', () => {
  const items = mod.libraryItems({ repo });
  const domains = new Set(items.map((i) => i.domain));
  assert.ok(domains.has('healer') && domains.has('scripture') && domains.has('chain'));
  assert.ok(items.filter((i) => i.relPath.endsWith('alkaloids.md')).length > 1, 'long file chunked');
  assert.ok(!items.some((i) => i.relPath.endsWith('tiny.md')), 'tiny skipped');
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
});

test('buildIndex + recall with injected embedder; domain filter', async () => {
  mod.__setEmbedder(fakeEmbed);
  const r = await mod.buildIndex({ full: true });
  assert.equal(r.indexed, r.total);
  assert.equal(r.remaining, 0);
  const hits = await mod.recall('alkaloid terpene synergy', { k: 5 });
  assert.equal(hits[0].domain, 'healer', 'healer ranks top for alkaloid query');
  const chain = await mod.recall('graphene witness block', { domain: 'chain', k: 5 });
  assert.ok(chain.length && chain.every((h) => h.domain === 'chain'), 'domain filter');
  assert.ok(chain[0].relPath.includes('witness'));
});

test('buildIndex is resumable under --limit', async () => {
  mod.__setEmbedder(fakeEmbed);
  await mod.buildIndex({ full: true });
  fs.rmSync(path.join(idxDir, 'vectors.json'));
  const first = await mod.buildIndex({ limit: 2 });
  assert.equal(first.fresh, 2);
  assert.ok(first.remaining > 0);
  const second = await mod.buildIndex({ limit: 1000 });
  assert.equal(second.remaining, 0);
  assert.equal(second.indexed, second.total);
});

test('soft-fall to word-bag when embedder returns null (still recalls, never throws)', async () => {
  mod.__setEmbedder(async () => null); // no real embedder → fallback path
  const r = await mod.buildIndex({ full: true });
  assert.equal(r.indexed, r.total, 'indexed via word-bag fallback');
  const hits = await mod.recall('alkaloid terpene', { k: 3 });
  assert.ok(hits.length > 0, 'fallback still returns hits');
});

test('buildCatalog yields domain→files with keywords (the committed Index)', () => {
  const cat = mod.buildCatalog({ repo });
  assert.ok(cat.fileCount >= 3);
  assert.ok(cat.byDomain.healer.some((f) => f.path.endsWith('alkaloids.md')));
  const alk = cat.byDomain.healer.find((f) => f.path.endsWith('alkaloids.md'));
  assert.ok(alk.keywords.includes('alkaloid') || alk.keywords.includes('terpene'), 'keywords extracted');
  assert.ok(alk.title.toLowerCase().includes('alkaloid'), 'title from heading');
});

test('catalogLookup: instant keyword recall over the written catalog (no embeddings)', () => {
  mod.writeCatalog({ repo }); // ensure the catalog exists for the lookup
  const hits = mod.catalogLookup('alkaloid terpene', { k: 5 });
  assert.ok(hits.length > 0, 'keyword hits');
  assert.ok(hits[0].path.endsWith('alkaloids.md'), 'alkaloids file ranks top');
  const chain = mod.catalogLookup('graphene witness', { domain: 'chain', k: 5 });
  assert.ok(chain.every((h) => h.domain === 'chain'), 'domain filter');
  assert.deepEqual(mod.catalogLookup('   '), [], 'empty query → []');
});

test('recall on empty index returns [] (never throws)', async () => {
  fs.rmSync(path.join(idxDir, 'vectors.json'), { force: true });
  assert.deepEqual(await mod.recall('anything'), []);
});
