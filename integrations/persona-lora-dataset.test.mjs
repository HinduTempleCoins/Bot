// persona-lora-dataset.test.mjs — OFFLINE. Pure builders, injected doc text; no fs, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDoc, voiceExamples, buildPersonaExamples } from './persona-lora-dataset.mjs';

test('chunkDoc tags chunks, drops code fences, splits on paragraphs', () => {
  const text = '# Title\n\nFirst paragraph about the Witness and her work.\n\n```js\ncode();\n```\n\nSecond paragraph about the Convergence and the temple-technology.';
  const c = chunkDoc(text, { chunkChars: 50 });
  assert.ok(c.length >= 1);
  assert.ok(c.every((x) => x.startsWith('[Hathor canon]\n')));
  assert.ok(!c.join('\n').includes('code()'));            // code fence stripped
  assert.ok(c.join(' ').includes('Convergence'));
});

test('chunkDoc returns nothing for empty/whitespace', () => {
  assert.deepEqual(chunkDoc(''), []);
  assert.deepEqual(chunkDoc('   \n\n  '), []);
});

test('voiceExamples are Angelic-register instruction pairs', () => {
  const v = voiceExamples();
  assert.ok(v.length >= 8);
  assert.ok(v.every((x) => x.startsWith('[Hathor voice]\nUser: ') && x.includes('\nHathor: ')));
  assert.ok(v.some((x) => /egregore|Angel/.test(x)));     // holds the egregore-as-position frame
  assert.ok(v.some((x) => /MELEK/.test(x)));
});

test('buildPersonaExamples merges canon chunks + voice, skips empty docs', () => {
  const docs = {
    'CHARACTER.md': 'The Witness is drawn to ancient mystery.\n\nShe produces the blocks.',
    'EMPTY.md': '',
  };
  const ex = buildPersonaExamples(docs, { chunkChars: 40 });
  const canon = ex.filter((t) => t.startsWith('[Hathor canon]'));
  const voice = ex.filter((t) => t.startsWith('[Hathor voice]'));
  assert.ok(canon.length >= 1, 'has canon chunks');
  assert.ok(voice.length >= 8, 'has voice examples');
  assert.equal(canon.length + voice.length, ex.length);
});

test('every example is JSON-serializable as a {text} row', () => {
  const ex = buildPersonaExamples({ 'X.md': 'A paragraph.\n\nAnother paragraph.' });
  for (const t of ex) {
    const row = JSON.parse(JSON.stringify({ text: t }));
    assert.equal(typeof row.text, 'string');
    assert.ok(row.text.length > 0);
  }
});
