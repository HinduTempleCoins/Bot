// image-response.test.mjs — OFFLINE tests for Cheetah's image-post responder.
// node --test cheetah/image-response.test.mjs   (no network, no native deps, injected fetch + index).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractImages,
  fingerprint,
  respondToPost,
  esc,
  __setFetch,
  __setIndex,
  __resetSeams,
} from './image-response.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────
// Fake, varied image bytes → a stable, non-trivial average hash. A minimal Response stub exposing
// exactly what fingerprint() reads (ok + arrayBuffer). No network, no decoder.
const FAKE_BYTES = new Uint8Array(256).map((_, i) => (i * 37) % 256);
const okResp = (bytes) => ({ ok: true, arrayBuffer: async () => bytes.buffer });
const okFetch = () => okResp(FAKE_BYTES);
const throwFetch = () => { throw new Error('network down'); };

const POST_WITH_IMAGES = {
  author: 'someone',
  permlink: 'a-post',
  body:
    'Here is a meme ![alt](https://cdn.example.com/meme.png)\n' +
    'and a raw tag <img src="https://cdn.example.com/photo.jpg?w=600">\n' +
    'and a bare link https://cdn.example.com/bare.gif in prose.',
};
const POST_NO_IMAGE = { author: 'someone', permlink: 'text-only', body: 'Just words, no pictures here.' };

// ── extractImages ─────────────────────────────────────────────────────────────
test('extractImages finds markdown, <img>, and bare image URLs', () => {
  const urls = extractImages(POST_WITH_IMAGES);
  assert.ok(urls.includes('https://cdn.example.com/meme.png'), 'markdown image');
  assert.ok(urls.includes('https://cdn.example.com/photo.jpg?w=600'), 'raw <img> src');
  assert.ok(urls.includes('https://cdn.example.com/bare.gif'), 'bare image URL');
  // prefix de-dupe: the query-string <img> URL must NOT also appear truncated at ".jpg".
  assert.ok(!urls.includes('https://cdn.example.com/photo.jpg'), 'truncated dupe dropped');
  assert.equal(urls.length, 3);
});

test('extractImages on a post with no image returns []', () => {
  assert.deepEqual(extractImages(POST_NO_IMAGE), []);
  assert.deepEqual(extractImages(''), []);
});

// ── fingerprint ───────────────────────────────────────────────────────────────
test('fingerprint returns a stable 16-hex hash for given bytes', async () => {
  __setFetch(okFetch);
  const h1 = await fingerprint('https://cdn.example.com/meme.png');
  const h2 = await fingerprint('https://cdn.example.com/meme.png');
  assert.match(h1, /^[0-9a-f]{16}$/, 'a 64-bit hex hash');
  assert.equal(h1, h2, 'same bytes → same hash (deterministic)');
  __resetSeams();
});

test('fingerprint soft-fails to null on fetch error (never throws)', async () => {
  __setFetch(throwFetch);
  let h;
  await assert.doesNotReject(async () => { h = await fingerprint('https://cdn.example.com/x.png'); });
  assert.equal(h, null);
  __resetSeams();
});

test('fingerprint soft-fails to null on a non-ok response', async () => {
  __setFetch(() => ({ ok: false, arrayBuffer: async () => new Uint8Array().buffer }));
  const h = await fingerprint('https://cdn.example.com/missing.png');
  assert.equal(h, null);
  __resetSeams();
});

// ── respondToPost ─────────────────────────────────────────────────────────────
test('respondToPost with an image + a seeded match names the source', async () => {
  __setFetch(okFetch);
  // Seed the index with the exact fingerprint of the fake bytes so a match is guaranteed.
  const phash = await fingerprint('https://cdn.example.com/meme.png');
  const index = [{ hash: phash, author: 'artist', permlink: 'the-original', url: 'https://melek.salon/@artist/the-original' }];

  const post = { author: 'reposter', permlink: 'repost', body: '![m](https://cdn.example.com/meme.png)' };
  const r = await respondToPost(post, { index });

  assert.equal(r.ok, true);
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].phash, phash);
  assert.ok(r.images[0].match, 'a match record is attached');
  assert.match(r.reply, /@artist\/the-original/, 'reply links the crediting source');
  assert.match(r.reply, /Cheetah/, 'reply carries the self-ID footer');
  __resetSeams();
});

test('respondToPost with an image + no match returns a neutral reply', async () => {
  __setFetch(okFetch);
  const post = { author: 'someone', permlink: 'fresh', body: '![m](https://cdn.example.com/new.png)' };
  const r = await respondToPost(post, { index: [] }); // empty index → nothing to credit

  assert.equal(r.ok, true);
  assert.equal(r.images.length, 1);
  assert.equal(r.images[0].match, null);
  assert.match(r.reply, /No earlier appearance/i, 'neutral acknowledgement, not an accusation');
  assert.doesNotMatch(r.reply, /appears to have first appeared/i, 'no credit line without a match');
  __resetSeams();
});

test('respondToPost honors an injected default index via __setIndex', async () => {
  __setFetch(okFetch);
  const phash = await fingerprint('https://cdn.example.com/meme.png');
  __setIndex([{ hash: phash, url: 'https://example.org/source' }]);
  const r = await respondToPost({ body: '![m](https://cdn.example.com/meme.png)' });
  assert.equal(r.ok, true);
  assert.ok(r.images[0].match, 'default index used when opts.index omitted');
  assert.match(r.reply, /example\.org\/source/);
  __resetSeams();
});

test('respondToPost with no image returns { ok:false, reason:"no-image" }', async () => {
  const r = await respondToPost(POST_NO_IMAGE);
  assert.deepEqual(r, { ok: false, reason: 'no-image' });
});

test('respondToPost never throws on a garbage post', async () => {
  let r;
  await assert.doesNotReject(async () => { r = await respondToPost(null); });
  assert.equal(r.ok, false);
});

// ── esc ───────────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
});
