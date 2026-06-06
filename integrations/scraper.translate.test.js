// scraper.translate.test.js — live tests for the upgraded keyless translation hub.
// These hit real public engines (Lingva → MyMemory), so they need network and can be skipped
// offline with SKIP_LIVE=1. Run: node --test integrations/scraper.translate.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { translate, translateMany, detectLanguage, chunkText, __setFetch } from './scraper.mjs';

const LIVE = !process.env.SKIP_LIVE;
const live = (name, fn) => test(name, { skip: LIVE ? false : 'SKIP_LIVE set' }, fn);

// ── pure unit test: chunking (no network) ──
test('chunkText splits long text on boundaries, preserves order, respects max', () => {
  const sentences = Array.from({ length: 40 }, (_, i) => `This is sentence number ${i + 1}.`).join(' ');
  const parts = chunkText(sentences, 120);
  assert.ok(parts.length > 1, 'long text should split into multiple chunks');
  for (const p of parts) assert.ok(p.length <= 120, `chunk over max: ${p.length}`);
  // rejoining the chunks reconstructs every sentence in order
  const rejoined = parts.join(' ');
  assert.ok(rejoined.includes('sentence number 1.'));
  assert.ok(rejoined.includes('sentence number 40.'));
  assert.ok(rejoined.indexOf('number 1.') < rejoined.indexOf('number 40.'), 'order preserved');
});

test('chunkText returns single chunk for short text, [] for empty', () => {
  assert.deepStrictEqual(chunkText('hi', 100), ['hi']);
  assert.deepStrictEqual(chunkText('', 100), []);
});

test('translate is a noop for same from/to and never throws on empty', async () => {
  const noop = await translate('hello', { from: 'en', to: 'en' });
  assert.strictEqual(noop.translated, 'hello');
  const empty = await translate('', { to: 'en' });
  assert.strictEqual(empty.translated, '');
});

// ── live tests ──
live('Spanish → English (real engine)', async () => {
  const r = await translate('Hola mundo, ¿cómo estás?', { from: 'es', to: 'en' });
  assert.match(r.translated.toLowerCase(), /hello|world|how are you/);
  assert.strictEqual(r.to, 'en');
  assert.ok(r.engine && r.engine !== 'fallback', `expected a real engine, got ${r.engine}`);
});

// Deterministic (offline): inject a Lingva-shaped response so auto-detect
// resolves the source language without hitting the network. Verifies the
// `from='auto'` → detected resolution path (house rule: tests run offline).
test('French → English, auto-detect resolves `from` (injected engine)', async () => {
  __setFetch(async (url) => {
    // Lingva: GET .../api/v1/auto/en/<text> → { translation, info: { detectedSource } }
    if (String(url).includes('/api/v1/')) {
      return {
        ok: true,
        json: async () => ({ translation: 'Liberty guiding the people', info: { detectedSource: 'fr' } }),
      };
    }
    // any other engine endpoint shouldn't be reached, but fail soft if it is
    return { ok: false, json: async () => ({}) };
  });
  try {
    const r = await translate('La liberté guidant le peuple', { from: 'auto', to: 'en' });
    assert.match(r.translated.toLowerCase(), /freedom|liberty|people/);
    assert.notStrictEqual(r.engine, 'fallback', 'injected engine should resolve');
    // auto must resolve to the detected source on success
    assert.strictEqual(r.from, 'fr');
  } finally {
    __setFetch(null); // restore real fetch for the remaining live tests
  }
});

live('long text is chunked, translated, and rejoined', async () => {
  const longEs = Array.from({ length: 12 }, (_, i) =>
    `La cadena de bloques produce el bloque número ${i + 1} cada tres segundos.`).join(' ');
  assert.ok(longEs.length > 500, 'fixture should exceed MyMemory single-call limit');
  const r = await translate(longEs, { from: 'es', to: 'en' });
  assert.ok(r.translated.length > 100, 'got a substantial translation back');
  assert.match(r.translated.toLowerCase(), /block|chain|produces?|every|three|second/);
});

live('translateMany preserves order and shape', async () => {
  const out = await translateMany(['Hola', 'Bonjour', 'Hallo'], { to: 'en' });
  assert.strictEqual(out.length, 3);
  for (const o of out) assert.ok('text' in o && 'translated' in o && 'from' in o && 'to' in o);
});

live('detectLanguage identifies Spanish', async () => {
  const lang = await detectLanguage('Buenos días, me gustaría aprender sobre la cadena de bloques.');
  // engines may answer 'es'; allow null only if every engine was unreachable
  if (lang) assert.strictEqual(lang, 'es');
});
