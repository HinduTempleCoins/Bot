import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { wikiToPlain, collectArticles, buildRecords, writeExport } from './wiki-export.mjs';

test('wikiToPlain strips markup to readable text', () => {
  const t = wikiToPlain("'''Cannabis''' is a [[plant genus|plant]].\n\n== History ==\nUsed ''for millennia''. See [https://x.org source].");
  assert.match(t, /Cannabis is a plant\./);
  assert.match(t, /History/);
  assert.match(t, /Used for millennia/);
  assert.doesNotMatch(t, /'''|\[\[|==|https:\/\//);
});

function fixtureDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wikiexp-'));
  fs.writeFileSync(path.join(d, 'Cannabis.wiki'), "'''Cannabis''' is a [[plant]].\n== Botany ==\nA flower.");
  fs.writeFileSync(path.join(d, 'Melqart.wiki'), "'''Melqart''' is a Phoenician god.");
  fs.writeFileSync(path.join(d, 'scripture_private.wiki'), 'SHOULD BE EXCLUDED');
  return d;
}

test('collectArticles reads .wiki, excludes private, dedupes by slug', () => {
  const d = fixtureDir();
  const arts = collectArticles([d, d]); // same dir twice -> dedupe
  assert.equal(arts.length, 2);
  assert.ok(arts.some((a) => a.slug === 'Cannabis'));
  assert.ok(!arts.some((a) => /scripture/i.test(a.slug)));
});

test('buildRecords shapes training records with plaintext + categories (injected)', async () => {
  const d = fixtureDir();
  const recs = await buildRecords({ dirs: [d], categoriesFor: (t) => (/Cannabis/.test(t) ? ['plants'] : ['religion']) });
  const can = recs.find((r) => r.slug === 'Cannabis');
  assert.match(can.text, /Cannabis is a plant/);
  assert.deepEqual(can.categories, ['plants']);
  assert.match(can.url, /wiki\.soapbox\.community\/Cannabis/);
  assert.ok(can.chars > 0);
});

test('writeExport emits jsonl + corpus + manifest', async () => {
  const d = fixtureDir();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'wikiout-'));
  const m = await writeExport(out, { dirs: [d], categoriesFor: () => [] });
  assert.equal(m.articles, 2);
  assert.ok(fs.existsSync(path.join(out, 'library.jsonl')));
  assert.ok(fs.existsSync(path.join(out, 'library-corpus.txt')));
  const firstLine = fs.readFileSync(path.join(out, 'library.jsonl'), 'utf8').split('\n')[0];
  assert.ok(JSON.parse(firstLine).title);
});
