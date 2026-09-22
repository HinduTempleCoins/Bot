// hathor-post-image.test.mjs — cover-image director + attacher. Fully offline (fake generator).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  derivePrompt, styleFor, attachImageToPost, hasImage,
  generatePostImage, ensurePostImage, HATHOR_SIGNATURE,
} from './hathor-post-image.mjs';

// a fake generator standing in for genai-providers.generateImage (no network, no model)
const fakeGen = (calls = []) => async ({ prompt, size, seed }) => {
  calls.push({ prompt, size, seed });
  return { ok: true, base64: 'AAAA', mime: 'image/png', bytes: 3, provider: 'pollinations', note: 'test' };
};

test('every derived prompt leads with Hathor’s canonical signature', () => {
  const d = derivePrompt({ title: 'Anything at all' });
  assert.ok(d.prompt.startsWith(HATHOR_SIGNATURE.split(':')[0]), 'signature first');
  assert.match(d.prompt, /VR\/oculus headset/);
  assert.match(d.prompt, /Hathor headdress/);
  assert.equal(d.size, '1024x576'); // wide blog cover
});

test('tags/title choose a fitting scene style', () => {
  assert.equal(styleFor({ tags: ['kula', 'defi'] }).id, 'defi');
  assert.equal(styleFor({ title: 'How block production works' }).id, 'witness');
  assert.equal(styleFor({ title: 'A staged tutorial for newcomers' }).id, 'tutorial');
  assert.equal(styleFor({ tags: ['library'], title: 'The Ashurbanipal corpus' }).id, 'library');
  assert.equal(styleFor({ title: 'hathor.live 40hz binaural sessions' }).id, 'video');
  // unknown → the announce fallback
  assert.equal(styleFor({ title: 'zzz' }).id, 'announce');
});

test('the post subject carries into the prompt', () => {
  const d = derivePrompt({ title: 'Tools for people: a price ticker', tags: ['tools'] });
  assert.match(d.prompt, /price ticker/);
  assert.equal(d.style, 'defi'); // "price"/"ticker" reads as defi — a fitting cover for a price tool
});

test('forced style overrides auto-detection', () => {
  const d = derivePrompt({ title: 'x' }, { style: 'library' });
  assert.equal(d.style, 'library');
  assert.match(d.prompt, /manuscript|library|codex/i);
});

test('attachImageToPost sets the cover first in json_metadata.image and preserves app/tags', () => {
  const post = { title: 't', json_metadata: JSON.stringify({ app: 'hathor/welcome', tags: ['melek'] }) };
  const out = attachImageToPost(post, 'https://media.example/cover.png');
  const meta = JSON.parse(out.json_metadata);
  assert.deepEqual(meta.image, ['https://media.example/cover.png']);
  assert.equal(meta.app, 'hathor/welcome');
  assert.deepEqual(meta.tags, ['melek']);
  // original is not mutated
  assert.ok(!/image/.test(post.json_metadata));
});

test('attach de-dupes and keeps the newest cover first', () => {
  const post = { json_metadata: JSON.stringify({ image: ['https://old/a.png', 'https://old/b.png'] }) };
  const out = attachImageToPost(post, 'https://new/cover.png');
  const meta = JSON.parse(out.json_metadata);
  assert.equal(meta.image[0], 'https://new/cover.png');
  assert.ok(!meta.image.slice(1).includes('https://new/cover.png'));
});

test('attach accepts an object json_metadata and empty url is a no-op', () => {
  const out = attachImageToPost({ json_metadata: { tags: ['x'] } }, 'https://m/c.png');
  assert.equal(JSON.parse(out.json_metadata).image[0], 'https://m/c.png');
  const noop = attachImageToPost({ title: 't' }, '');
  assert.equal(noop.json_metadata, undefined);
});

test('hasImage detects a present cover (string or object metadata)', () => {
  assert.equal(hasImage({ json_metadata: JSON.stringify({ image: ['x'] }) }), true);
  assert.equal(hasImage({ json_metadata: { image: [] } }), false);
  assert.equal(hasImage({ json_metadata: '{"tags":["a"]}' }), false);
  assert.equal(hasImage({}), false);
});

test('generatePostImage builds the prompt, calls the generator, returns media', async () => {
  const calls = [];
  const res = await generatePostImage({ title: 'KULA staking on KulaSwap', tags: ['defi'] }, { generate: fakeGen(calls) });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].size, '1024x576');
  assert.match(calls[0].prompt, /KULA staking/);
  assert.equal(res.media.base64, 'AAAA');
  assert.equal(res.hosted, false);          // no upload dep → not hosted
  assert.match(res.url, /^data:image\/png;base64,/); // data URL fallback
  assert.equal(res.post, undefined);        // we do NOT attach a data URL to on-chain metadata
});

test('with an upload dep the hosted URL is attached to the post', async () => {
  const res = await generatePostImage(
    { title: 'Witness school opens', tags: ['witness'], json_metadata: JSON.stringify({ tags: ['witness'] }) },
    { generate: fakeGen(), upload: async () => 'https://cdn.example/x.png' },
  );
  assert.equal(res.ok, true);
  assert.equal(res.hosted, true);
  assert.equal(res.url, 'https://cdn.example/x.png');
  assert.equal(JSON.parse(res.post.json_metadata).image[0], 'https://cdn.example/x.png');
});

test('generatePostImage soft-fails when the generator errors or returns nothing', async () => {
  const boom = await generatePostImage({ title: 'x' }, { generate: async () => { throw new Error('down'); } });
  assert.equal(boom.ok, false);
  assert.match(boom.error, /generate failed/);
  const empty = await generatePostImage({ title: 'x' }, { generate: async () => ({ ok: false, error: 'exhausted' }) });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /exhausted/);
});

test('ensurePostImage skips a post that already has a cover', async () => {
  let called = 0;
  const post = { json_metadata: JSON.stringify({ image: ['https://has/cover.png'] }) };
  const out = await ensurePostImage(post, { generate: async () => { called++; return { ok: true, base64: 'x' }; } });
  assert.equal(called, 0);
  assert.equal(out.image.skipped, true);
});

test('ensurePostImage generates + attaches when there is no cover', async () => {
  const out = await ensurePostImage(
    { title: 'New tools', tags: ['tools'] },
    { generate: fakeGen(), upload: async () => 'https://cdn/x.png' },
  );
  assert.equal(out.image.ok, true);
  assert.equal(JSON.parse(out.post.json_metadata).image[0], 'https://cdn/x.png');
});

test('ensurePostImage force re-generates even when a cover exists', async () => {
  let called = 0;
  const post = { json_metadata: JSON.stringify({ image: ['https://old.png'] }) };
  const out = await ensurePostImage(post, { force: true, generate: async () => { called++; return { ok: true, base64: 'z', mime: 'image/png' }; }, upload: async () => 'https://new.png' });
  assert.equal(called, 1);
  assert.equal(JSON.parse(out.post.json_metadata).image[0], 'https://new.png');
});
