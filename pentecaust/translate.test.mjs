// translate.test.mjs — OFFLINE. Mocked provider fetch, temp prefs file. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  translate, translateBatch, setLang, getLang, normLang, translateLabel, originalLabel,
  __setFetch, __setSpecializedRouter,
} from './translate.mjs';

let n = 0;
function freshFile() {
  const f = join(tmpdir(), `pentecaust-tr-test-${process.pid}-${n++}.json`);
  try { unlinkSync(f); } catch {}
  return f;
}
const O = (file) => ({ file });
// a MyMemory-shaped provider that upper-cases (deterministic, offline)
const mockMyMemory = (transform = (s) => s.toUpperCase()) => async (u) => ({
  json: async () => ({ responseData: { translatedText: transform(decodeURIComponent(String(u).match(/[?&]q=([^&]*)/)[1])) } }),
});

test('translate: returns a translation and preserves the original', async () => {
  __setFetch(mockMyMemory());
  const r = await translate({ text: 'hello', to: 'es' });
  assert.equal(r.text, 'hello');
  assert.equal(r.tr, 'HELLO');
  assert.equal(r.to, 'es'); assert.equal(r.from, 'en');
  __setFetch(null);
});

test('translate: same source/target → no-op (tr null)', async () => {
  __setFetch(mockMyMemory());
  const r = await translate({ text: 'hello', to: 'en', from: 'en' });
  assert.equal(r.tr, null);
  __setFetch(null);
});

test('translate: empty / missing target → no-op', async () => {
  assert.equal((await translate({ text: '   ', to: 'es' })).tr, null);
  assert.equal((await translate({ text: 'hi', to: '' })).tr, null);
});

test('translate: an identical echo from the provider is treated as no translation', async () => {
  __setFetch(mockMyMemory((s) => s));            // provider echoes input
  const r = await translate({ text: 'unchanged', to: 'fr' });
  assert.equal(r.tr, null);
  __setFetch(null);
});

test('translate: provider failure soft-fails to the original (tr null, no throw)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await translate({ text: 'resilient', to: 'de' });
  assert.equal(r.text, 'resilient'); assert.equal(r.tr, null);
  __setFetch(null);
});

test('translate: caches — a repeat does not hit the provider again', async () => {
  let calls = 0;
  __setFetch(async (u) => { calls++; return { json: async () => ({ responseData: { translatedText: 'CACHED' } }) }; });
  await translate({ text: 'cache-me-xyz', to: 'es' });
  await translate({ text: 'cache-me-xyz', to: 'es' });
  assert.equal(calls, 1, 'second call served from cache');
  __setFetch(null);
});

test('translateBatch: aligns to input, nulls where nothing to do', async () => {
  __setFetch(mockMyMemory());
  const out = await translateBatch(['one', '', 'two'], 'es');
  assert.equal(out.length, 3);
  assert.equal(out[0], 'ONE');
  assert.equal(out[1], null);       // empty → null
  assert.equal(out[2], 'TWO');
  __setFetch(null);
});

test('setLang / getLang: round-trip; invalid clears', () => {
  const o = O(freshFile());
  assert.equal(setLang('Alice', 'ES', o).lang, 'es');   // normalized + lowercased
  assert.equal(getLang('alice', o), 'es');
  assert.equal(setLang('alice', 'not-a-lang!!', o).lang, null);
  assert.equal(getLang('alice', o), '');
});

test('normLang accepts iso-ish codes incl. region, rejects junk', () => {
  assert.equal(normLang('EN'), 'en');
  assert.equal(normLang('pt-BR'), 'pt-br');
  assert.equal(normLang('zh-CN'), 'zh-cn');
  assert.equal(normLang('english'), '');
  assert.equal(normLang(''), '');
});

test('uncommon target routes to Hathor\'s Language Center; common skips it', async () => {
  let routed = null;
  __setSpecializedRouter(async (text, from, to) => { routed = { text, from, to }; return `[ckb]${text}`; });
  __setFetch(async () => ({ json: async () => ({ responseData: { translatedText: 'COMMON-MT' } }) }));
  // Sorani (ckb) is NOT common → the specialized router (Language Center) handles it.
  const r1 = await translate({ text: 'peace', to: 'ckb', from: 'en' });
  assert.equal(r1.tr, '[ckb]peace');
  assert.deepEqual(routed, { text: 'peace', from: 'en', to: 'ckb' });
  // Spanish IS common → the router is never consulted; the cheap MT answers.
  routed = null;
  const r2 = await translate({ text: 'peace', to: 'es', from: 'en' });
  assert.equal(r2.tr, 'COMMON-MT');
  assert.equal(routed, null, 'common languages never hit the Language Center');
  __setSpecializedRouter(null); __setFetch(null);
});

test('a specialized router that declines (null) falls back to the common MT best-effort', async () => {
  __setSpecializedRouter(async () => null);          // Hathor has no backend wired → declines
  __setFetch(async () => ({ json: async () => ({ responseData: { translatedText: 'FALLBACK' } }) }));
  const r = await translate({ text: 'hope', to: 'kmr', from: 'en' });   // Kurmanji
  assert.equal(r.tr, 'FALLBACK');
  __setSpecializedRouter(null); __setFetch(null);
});

test('labels are localized to the reader, English fallback', () => {
  assert.equal(translateLabel('es'), '¿Traducir?');
  assert.equal(translateLabel('ku'), 'Wergerîne?');
  assert.equal(translateLabel('pt-br'), 'Traduzir?');   // region falls back to base
  assert.equal(translateLabel('xx'), 'Translate?');     // unknown → English
  assert.equal(originalLabel('de'), 'Original anzeigen');
});
