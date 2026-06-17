// brain-corpus.test.mjs — offline. Uses a fixture dir + the real repo root. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  corpusManifest, personaDocs, scriptureDocs, datasetCorpora, topLevelDocs, loadPersona, PERSONA_DOCS,
} from './brain-corpus.mjs';

// Build a tiny fixture repo.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-corpus-'));
  fs.writeFileSync(path.join(root, 'BRIEF.md'), '# brief');
  fs.writeFileSync(path.join(root, 'CHARACTER.md'), '# character');
  fs.writeFileSync(path.join(root, 'README.md'), '# readme');
  fs.mkdirSync(path.join(root, 'knowledge', 'scripture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'knowledge', 'scripture', 'phoenix_protocol.md'), 'x');
  fs.mkdirSync(path.join(root, 'knowledge', 'brujeria'), { recursive: true });
  fs.mkdirSync(path.join(root, 'datasets', 'crypto-books'), { recursive: true });
  fs.writeFileSync(path.join(root, 'datasets', 'oilahuasca.jsonl'), '{}');
  return root;
}

test('personaDocs returns only the identity docs present', () => {
  const root = fixture();
  const p = personaDocs(root);
  assert.ok(p.includes('BRIEF.md') && p.includes('CHARACTER.md'));
  assert.ok(!p.includes('README.md')); // README isn't a persona doc
  assert.ok(!p.includes('RULE_1.md')); // absent in fixture → not listed
});

test('topLevelDocs lists every top-level .md (all the files at the top)', () => {
  const root = fixture();
  const t = topLevelDocs(root);
  assert.deepEqual(t, ['BRIEF.md', 'CHARACTER.md', 'README.md']);
});

test('scriptureDocs + datasetCorpora read the right dirs', () => {
  const root = fixture();
  assert.deepEqual(scriptureDocs(root), ['phoenix_protocol.md']);
  const d = datasetCorpora(root);
  assert.ok(d.find((x) => x.name === 'crypto-books' && x.kind === 'corpus'));
  assert.ok(d.find((x) => x.name === 'oilahuasca.jsonl' && x.kind === 'file'));
});

test('corpusManifest assembles four tiers + counts; soft-fails on a bad root', () => {
  const root = fixture();
  const m = corpusManifest(root);
  assert.equal(m.counts.persona, 2);
  assert.equal(m.counts.scripture, 1);
  assert.ok(m.counts.datasets >= 2);
  assert.ok(m.topLevel.length >= 3);
  // bad root → empty tiers, never throws
  const empty = corpusManifest('/no/such/dir');
  assert.deepEqual(empty.counts, { persona: 0, scripture: 0, knowledge: 0, datasets: 0, topLevel: 0 });
});

test('loadPersona returns text per persona doc', () => {
  const root = fixture();
  const docs = loadPersona(root);
  assert.equal(docs.find((d) => d.name === 'BRIEF.md').text, '# brief');
});

test('the LIVE repo corpus is non-empty (persona + scripture + datasets all present)', () => {
  const m = corpusManifest(); // real repo root
  assert.ok(m.counts.persona >= 4, 'persona docs present');
  assert.ok(m.counts.scripture >= 1, 'scripture present');
  assert.ok(m.counts.datasets >= 5, 'datasets present');
  assert.ok(m.persona.includes('BRIEF.md') && m.persona.includes('CHARACTER.md') && m.persona.includes('RULE_1.md'));
});

test('PERSONA_DOCS is the curated identity set', () => {
  assert.ok(PERSONA_DOCS.includes('BRIEF.md') && PERSONA_DOCS.includes('RULE_1.md') && PERSONA_DOCS.includes('LINEAGE.md'));
});
