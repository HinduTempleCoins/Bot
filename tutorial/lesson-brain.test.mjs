// lesson-brain.test.mjs — OFFLINE. Lesson context, FAQ matching, token-protected translation, and the
// brain client: OFF by default (no network at all), local-only transports when on (fetch injected).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './instructional.mjs';
import { lessonContext, faqMatch, protect, restore, looksLike, siteMapExcerpt, createLessonBrain } from './lesson-brain.mjs';

const reg = loadRegistry({ dir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'instructional') });

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    for (const [re, fn] of routes) if (re.test(url)) { const out = await fn(opts.body ? JSON.parse(opts.body) : null); return { ok: true, json: async () => out }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  f.calls = calls;
  return f;
}

test('lessonContext carries the body, the check explanation, the FAQ and a brief of the prerequisites', () => {
  const ctx = lessonContext(reg.byId('first-image'), reg);
  assert.match(ctx, /LESSON 3: Fixture Guide, Part 03/);
  assert.match(ctx, /Builds on: Lesson 2 "Fixture Guide, Part 02 — How to Post" \(task: write a short hello/);
  assert.match(ctx, /HOW I CHECK THIS LESSON: I look for a post showing a picture/);
  assert.match(ctx, /Q: Is my image private\?\nA: No\./);
  assert.equal(lessonContext(null), '');
});

test('faqMatch: FAQ first, by overlap; unrelated questions do not match', () => {
  const faq = reg.byId('how-to-post').faq;
  assert.match(faqMatch('how can I add a photo to the post?', faq).a, /Drag the photo/);
  assert.match(faqMatch('which tags do I use', faq).a, /introduceyourself first/);
  assert.equal(faqMatch('what is the price of MELEK today', faq), null);
  assert.equal(faqMatch('', faq), null);
});

test('protect/restore: URLs, @names and chain terms survive translation untouched; loss is detected', () => {
  const src = '@alice, Lesson 3 is done on MELEK.Salon. Next: [Lesson 4](https://melek.salon/@hathor/x) — MELEK POWER and PRANA.';
  const { text, tokens } = protect(src);
  assert.doesNotMatch(text, /https:|@alice|MELEK|PRANA/);
  assert.equal(restore(text, tokens), src);
  const dropped = text.replace('⟦0⟧', '');
  assert.equal(restore(dropped, tokens), null);
  assert.equal(restore(`${text} ⟦99⟧`, tokens), null);
});

test('looksLike: a Bengali reply must be in Bengali script', () => {
  assert.equal(looksLike('পাঠ ৩ সম্পূর্ণ হয়েছে ⟦0⟧', 'bn'), true);
  assert.equal(looksLike('Lesson 3 is complete', 'bn'), false);
  assert.equal(looksLike('La lección está completa y muy bien', 'es'), true);
});

test('siteMapExcerpt picks the relevant lines', () => {
  const map = '# x\n- Studio tool **Vectorize** — https://h/vectorize — Turn an image into SVG.\n- Studio tool **Generate** — https://h/ — Make an image.\n- Wiki: **Crypt-ology** — relationships.';
  assert.match(siteMapExcerpt('how do I vectorize my image', map), /Vectorize/);
  assert.equal(siteMapExcerpt('', map), '');
});

test('OFF by default: no model call, no network — classify falls to the keyword floor', async () => {
  const f = fakeFetch([]);
  const brain = createLessonBrain({ fetch: f, llm: '0' });
  assert.equal(brain.enabled, false);
  const c = await brain.classify('আমি পাঠটি শেষ করেছি');
  assert.equal(c.intent, 'claim');
  assert.equal(c.lang, 'bn');
  assert.equal(await brain.translate('Lesson 3 is complete.', 'bn'), null);
  assert.equal(await brain.answer({ question: 'x', lesson: reg.byId('how-to-post') }), null);
  assert.equal(await brain.voice('pass', { account: 'a', lesson: 'b' }), null);
  assert.equal(f.calls.length, 0);
});

test('ON with an old agency (no `lesson` feature): local Ollama only, JSON classify', async () => {
  const f = fakeFetch([
    [/:8175\/health$/, () => ({ ok: true, surfaces: ['melek'] })],
    [/\/api\/generate$/, (b) => ({ response: b.format === 'json' ? '{"intent":"question","lang":"es","english":"How do I add a photo?","lesson":null}' : 'Drag the photo into the editor.' })],
  ]);
  const brain = createLessonBrain({ fetch: f, llm: '1' });
  const c = await brain.classify('como pongo una foto');
  assert.equal(c.intent, 'question');
  assert.equal(c.english, 'How do I add a photo?');
  assert.equal(c.via, 'brain');
  assert.equal(await brain.transport(), 'ollama');
  const gen = f.calls.filter((x) => /api\/generate/.test(x.url));
  assert.ok(gen.length >= 1);
  assert.equal(gen[0].body.model, 'granite-melek3');
  // Nothing but the agency health probe and the local model was ever contacted.
  assert.ok(f.calls.every((x) => /127\.0\.0\.1/.test(x.url)));
});

test('ON with a current agency: POST /lesson on surface melek', async () => {
  const f = fakeFetch([
    [/\/health$/, () => ({ ok: true, features: ['perceive', 'lesson'] })],
    [/\/lesson$/, (b) => ({ ok: true, text: b.task === 'answer' ? 'Use the image button.' : '{}' })],
  ]);
  const brain = createLessonBrain({ fetch: f, llm: '1' });
  const a = await brain.answer({ question: 'photo?', lesson: reg.byId('how-to-post'), from: 'alice' });
  assert.equal(a, 'Use the image button.');
  const call = f.calls.find((x) => /\/lesson$/.test(x.url));
  assert.equal(call.body.surface, 'melek');
  assert.equal(call.body.task, 'answer');
  assert.equal(call.body.from, 'alice');
});

test('a strong keyword claim is not overruled by a model that says "other"; junk JSON falls back', async () => {
  const f = fakeFetch([[/health/, () => ({})], [/api\/generate/, () => ({ response: '{"intent":"other","lang":"en","english":"done"}' })]]);
  const c = await createLessonBrain({ fetch: f, llm: '1' }).classify('I finished, check me');
  assert.equal(c.intent, 'claim');
  const g = fakeFetch([[/health/, () => ({})], [/api\/generate/, () => ({ response: 'not json at all' })]]);
  const c2 = await createLessonBrain({ fetch: g, llm: '1' }).classify('¿Cómo subo una imagen?');
  assert.equal(c2.intent, 'question');
  assert.equal(c2.lang, 'es');
});

test('translate: protected tokens restored; a translation that drops a link or stays English is rejected', async () => {
  const good = fakeFetch([[/health/, () => ({})], [/api\/generate/, (b) => {
    const toks = b.prompt.match(/⟦\d+⟧/g) || [];
    return { response: `পাঠ সম্পূর্ণ হয়েছে। পরবর্তী: ${toks.join(' ')}` };
  }]]);
  const out = await createLessonBrain({ fetch: good, llm: '1' }).translate('@alice, done. Next: https://melek.salon/@hathor/x on MELEK.', 'bn');
  assert.match(out, /পাঠ সম্পূর্ণ/);
  assert.match(out, /@alice/);
  assert.match(out, /https:\/\/melek\.salon\/@hathor\/x/);
  assert.match(out, /MELEK/);

  const lossy = fakeFetch([[/health/, () => ({})], [/api\/generate/, () => ({ response: 'পাঠ সম্পূর্ণ হয়েছে' })]]);
  assert.equal(await createLessonBrain({ fetch: lossy, llm: '1' }).translate('Next: https://melek.salon/x', 'bn'), null);
  const english = fakeFetch([[/health/, () => ({})], [/api\/generate/, (b) => ({ response: `Lesson done ${(b.prompt.match(/⟦\d+⟧/g) || []).join(' ')}` })]]);
  assert.equal(await createLessonBrain({ fetch: english, llm: '1' }).translate('Lesson done https://x.y/z', 'bn'), null);
  assert.equal(await createLessonBrain({ fetch: english, llm: '1' }).translate('same', 'en'), 'same');
});

test('a dead model soft-fails to null, never throws', async () => {
  const f = async () => { throw new Error('ECONNREFUSED'); };
  const brain = createLessonBrain({ fetch: f, llm: '1' });
  assert.equal(await brain.answer({ question: 'q', lesson: reg.byId('sign-up') }), null);
  const c = await brain.classify('done!');
  assert.equal(c.intent, 'claim');
});
