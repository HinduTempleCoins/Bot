import { test } from 'node:test';
import assert from 'node:assert';
import { chunkText, translate, detect, languages, __setFetch } from './translate.mjs';

// Build a fake fetch from a route map: path-substring -> { ok, json }.
function fakeFetch(routes) {
  return async (url, opts) => {
    for (const [frag, resp] of Object.entries(routes)) {
      if (String(url).includes(frag)) {
        return { ok: resp.ok !== false, json: async () => resp.body, _opts: opts };
      }
    }
    return { ok: false, json: async () => null };
  };
}

// ---- PURE chunkText ----

test('chunkText: empty / blank input -> []', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n  '), []);
  assert.deepEqual(chunkText(undefined), []);
});

test('chunkText: short text returns a single chunk unchanged', () => {
  assert.deepEqual(chunkText('Hello world.', 100), ['Hello world.']);
});

test('chunkText: splits on sentence boundaries and never exceeds max', () => {
  const text = 'First sentence here. Second sentence here. Third sentence here.';
  const chunks = chunkText(text, 25);
  assert.ok(chunks.length > 1, 'splits into multiple chunks');
  for (const c of chunks) assert.ok(c.length <= 25, `chunk within limit: "${c}"`);
  assert.equal(chunks.join(''), text, 'reassembles to the original exactly');
});

test('chunkText: a single sentence longer than max is hard-broken', () => {
  const text = 'word '.repeat(50).trim(); // 249 chars, no sentence punctuation
  const chunks = chunkText(text, 40);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.length <= 40);
  assert.equal(chunks.join(''), text, 'lossless even with no boundaries');
});

test('chunkText: invalid max falls back to default and still chunks', () => {
  const out = chunkText('A short one.', 0);
  assert.deepEqual(out, ['A short one.']);
});

// ---- response normalization (injected fetch, no network) ----

test('translate: normalizes translatedText string', async () => {
  __setFetch(fakeFetch({ '/translate': { body: { translatedText: 'Hola mundo.' } } }));
  const out = await translate({ text: 'Hello world.', target: 'es' });
  assert.equal(out, 'Hola mundo.');
  __setFetch(null);
});

test('translate: joins per-chunk results across a long input', async () => {
  __setFetch(fakeFetch({ '/translate': { body: { translatedText: 'X' } } }));
  const long = 'Sentence one. Sentence two. Sentence three. Sentence four.';
  const out = await translate({ text: long, target: 'es' });
  // chunked into multiple pieces, each returning 'X', then concatenated
  assert.match(out, /^X+$/);
  __setFetch(null);
});

test('translate: soft-fails to original on non-ok response', async () => {
  __setFetch(fakeFetch({ '/translate': { ok: false, body: null } }));
  const out = await translate({ text: 'Keep me.', target: 'fr' });
  assert.equal(out, 'Keep me.');
  __setFetch(null);
});

test('translate: soft-fails to original on malformed body', async () => {
  __setFetch(fakeFetch({ '/translate': { body: { nope: 1 } } }));
  const out = await translate({ text: 'Original text.', target: 'fr' });
  assert.equal(out, 'Original text.');
  __setFetch(null);
});

test('translate: no-op when target missing, blank, or equals source', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  assert.equal(await translate({ text: 'hi', target: '' }), 'hi');
  assert.equal(await translate({ text: 'hi' }), 'hi');
  assert.equal(await translate({ text: 'hi', source: 'en', target: 'en' }), 'hi');
  assert.equal(await translate({ text: '   ', target: 'es' }), '   ');
  __setFetch(null);
});

test('detect: normalizes top detection', async () => {
  __setFetch(fakeFetch({ '/detect': { body: [{ language: 'es', confidence: 92 }, { language: 'pt', confidence: 5 }] } }));
  const out = await detect('Hola que tal');
  assert.deepEqual(out, { language: 'es', confidence: 92 });
  __setFetch(null);
});

test('detect: blank input -> null without calling fetch', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  assert.equal(await detect('  '), null);
  __setFetch(null);
});

test('detect: soft-fails to null on bad shape', async () => {
  __setFetch(fakeFetch({ '/detect': { body: {} } }));
  assert.equal(await detect('text'), null);
  __setFetch(null);
});

test('languages: normalizes and drops bad rows', async () => {
  __setFetch(fakeFetch({ '/languages': { body: [{ code: 'en', name: 'English' }, { name: 'no code' }, { code: 'es' }] } }));
  const out = await languages();
  assert.deepEqual(out, [{ code: 'en', name: 'English' }, { code: 'es', name: 'es' }]);
  __setFetch(null);
});

test('languages: soft-fails to [] on error', async () => {
  __setFetch(fakeFetch({ '/languages': { ok: false, body: null } }));
  assert.deepEqual(await languages(), []);
  __setFetch(null);
});
