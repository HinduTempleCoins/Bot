// video-post.test.mjs — offline tests for the MELEK video post metadata (pentecaust/video-post.mjs).
// Pure module: no network, no fetch, no keys, nothing broadcast — so there is nothing to mock. What is
// tested is the contract: the shape, backend swappability, the captions original-preserved invariant,
// the addressability rejection, the chain byte budget, and legacy/DTube/3Speak parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APP, TYPE, PLATFORM, VIDEO_TAG, LIMITS, PROVIDERS, PROVIDER_IDS, CONTENT_TYPES,
  MAX_JSON_METADATA_BYTES,
  buildVideoMetadata, validateVideoMetadata, parseVideoMetadata, buildCommentIntent,
  resolveVideoUrl, inferProvider, normalizeCaptions, originalCaption, captionFor, captionLanguages,
  videoPermlink, metadataBytes, isProvider, langLabel,
} from './video-post.mjs';

// A complete, valid input used across the tests.
const GOOD = {
  author: 'hathor',
  title: 'Pentecaust: the descent of tongues',
  description: 'The first MELEK video.',
  provider: 'melek',
  providerId: 'hathor/intro-1080p.mp4',
  durationSec: 600,
  filesizeBytes: 347_100_000,
  width: 1920,
  height: 1080,
  contentType: 'video/mp4',
  thumbnail: 'https://video.melek.salon/hathor/intro.jpg',
  lang: 'en',
  tags: ['melek'],
  at: 0,
  captions: [
    { lang: 'en', url: 'https://video.melek.salon/hathor/intro.en.vtt', source: 'human', original: true },
    { lang: 'hi', url: 'https://video.melek.salon/hathor/intro.hi.vtt', source: 'machine' },
  ],
};

// ── the shape ────────────────────────────────────────────────────────────────────────────────────
test('buildVideoMetadata produces the settled shape', () => {
  const m = buildVideoMetadata(GOOD);
  assert.equal(m.app, APP);
  assert.equal(m.type, TYPE);
  assert.equal(m.video.info.platform, PLATFORM);
  assert.ok(m.tags.includes(VIDEO_TAG));
  assert.ok(m.tags.includes('video'));
  assert.equal(m.video.info.duration, 600);          // seconds, like DTube and 3Speak
  assert.equal(m.video.info.filesize, 347_100_000);  // bytes
  assert.equal(m.video.info.lang, 'en');
  assert.equal(m.video.content.description, 'The first MELEK video.');
  assert.deepEqual(m.image, ['https://video.melek.salon/hathor/intro.jpg']);
});

test('video.url stays flat so the already-shipped ScotTube / tunein readers resolve it unchanged', () => {
  const m = buildVideoMetadata(GOOD);
  // site/tunein videoUrlOf(): meta.video.url
  assert.equal(m.video.url, 'https://video.melek.salon/hathor/intro-1080p.mp4');
  assert.equal(typeof m.video.url, 'string');
});

test('sourceMap is 3Speak-shaped: typed rows with a video and a thumbnail', () => {
  const m = buildVideoMetadata(GOOD);
  const sm = m.video.info.sourceMap;
  assert.ok(Array.isArray(sm));
  const vid = sm.find((r) => r.type === 'video');
  const thumb = sm.find((r) => r.type === 'thumbnail');
  assert.equal(vid.format, 'mp4');
  assert.equal(vid.quality, '1080p');
  assert.equal(thumb.url, 'https://video.melek.salon/hathor/intro.jpg');
});

test('renditions become sourceMap rows, capped', () => {
  const m = buildVideoMetadata({
    ...GOOD,
    renditions: [
      { height: 1080, providerId: 'a/1080.mp4', bitrateKbps: 4500 },
      { height: 480, providerId: 'a/480.mp4', bitrateKbps: 1200 },
      { height: 0, providerId: '' }, // unaddressable → dropped
    ],
  });
  const vids = m.video.info.sourceMap.filter((r) => r.type === 'video');
  assert.equal(vids.length, 2);
  assert.deepEqual(vids.map((r) => r.quality), ['1080p', '480p']);
  assert.equal(vids[0].bitrateKbps, 4500);
});

test('m3u8 and CID inputs get the right content type', () => {
  assert.equal(buildVideoMetadata({ ...GOOD, providerId: 'a/master.m3u8', contentType: '' }).video.info.contentType, 'application/x-mpegurl');
  assert.ok(CONTENT_TYPES.includes(buildVideoMetadata(GOOD).video.info.contentType));
});

// ── backend swappability: the whole point of provider + providerId ───────────────────────────────
test('every provider resolves a durable id to a playable https url', () => {
  assert.deepEqual([...PROVIDER_IDS].sort(), ['archive', 'https', 'ipfs', 'melek']);
  assert.ok(isProvider('ipfs'));
  assert.ok(!isProvider('bittorrent'));
  assert.match(resolveVideoUrl({ provider: 'melek', providerId: 'a/b.mp4' }), /^https:\/\/.+\/a\/b\.mp4$/);
  assert.match(resolveVideoUrl({ provider: 'ipfs', providerId: 'QmVideoCidExample1234567890' }), /\/ipfs\/QmVideoCidExample1234567890$/);
  assert.match(resolveVideoUrl({ provider: 'archive', providerId: 'trip-to-moon/moon.mp4' }), /^https:\/\/archive\.org\/download\/trip-to-moon\/moon\.mp4$/);
  assert.equal(resolveVideoUrl({ provider: 'https', providerId: '', url: 'https://x.example/v.mp4' }), 'https://x.example/v.mp4');
  // every provider states who keeps it alive when nobody is looking — the DTube pinning question
  for (const p of PROVIDER_IDS) assert.ok(PROVIDERS[p].custody.length > 20, `${p} has no custody answer`);
});

test('moving the storage backend re-resolves an OLD post without editing it', () => {
  const m = buildVideoMetadata(GOOD);
  const before = resolveVideoUrl({ provider: m.video.info.provider, providerId: m.video.info.providerId, url: m.video.url });
  const prev = process.env.MELEK_VIDEO_BASE;
  process.env.MELEK_VIDEO_BASE = 'https://cdn2.example.org';
  try {
    const after = resolveVideoUrl({ provider: m.video.info.provider, providerId: m.video.info.providerId, url: m.video.url });
    assert.notEqual(after, before);
    assert.equal(after, 'https://cdn2.example.org/hathor/intro-1080p.mp4');
  } finally {
    if (prev == null) delete process.env.MELEK_VIDEO_BASE; else process.env.MELEK_VIDEO_BASE = prev;
  }
});

test('a URL-only post still gets a durable address inferred', () => {
  assert.deepEqual(inferProvider('ipfs://QmAbc1234567890abcdef123'), { provider: 'ipfs', providerId: 'QmAbc1234567890abcdef123' });
  assert.deepEqual(inferProvider('https://ipfs.io/ipfs/QmAbc1234567890abcdef123'), { provider: 'ipfs', providerId: 'QmAbc1234567890abcdef123' });
  assert.deepEqual(inferProvider('https://archive.org/download/moon/moon.mp4'), { provider: 'archive', providerId: 'moon/moon.mp4' });
  assert.equal(inferProvider('https://some.host/v.mp4').provider, 'https');
  assert.equal(inferProvider('not a url').provider, '');
  const m = buildVideoMetadata({ ...GOOD, provider: '', providerId: '', url: 'ipfs://QmAbc1234567890abcdef123' });
  assert.equal(m.video.info.provider, 'ipfs');
  assert.equal(m.video.info.providerId, 'QmAbc1234567890abcdef123');
});

test('resolveVideoUrl refuses non-https, traversal and junk — soft, never throws', () => {
  assert.equal(resolveVideoUrl({ url: 'http://insecure.example/v.mp4' }), '');
  assert.equal(resolveVideoUrl({ url: 'javascript:alert(1)' }), '');
  assert.equal(resolveVideoUrl({ provider: 'melek', providerId: '../../etc/passwd' }), '');
  assert.equal(resolveVideoUrl({ provider: 'ipfs', providerId: 'not a cid!' }), '');
  assert.equal(resolveVideoUrl({}), '');
  assert.equal(resolveVideoUrl(), '');
});

// ── CAPTIONS: the differentiator + the original-preserved invariant ──────────────────────────────
test('exactly one original track, and it is the video language', () => {
  const c = normalizeCaptions(GOOD.captions, 'en');
  assert.equal(c.filter((t) => t.original).length, 1);
  assert.equal(originalCaption(c).lang, 'en');
  assert.equal(originalCaption(c).kind, 'captions');            // same language as the audio
  assert.equal(c.find((t) => t.lang === 'hi').kind, 'subtitles'); // a translation
  assert.equal(c.find((t) => t.lang === 'hi').translatedFrom, 'en');
});

test('two tracks claiming original are demoted to one — soft-fail, never throw', () => {
  const c = normalizeCaptions([
    { lang: 'en', url: 'https://v.example/a.vtt', original: true },
    { lang: 'es', url: 'https://v.example/b.vtt', original: true },
  ], 'en');
  assert.equal(c.filter((t) => t.original).length, 1);
  assert.equal(originalCaption(c).lang, 'en');
});

test('no track marked original: the one matching the spoken language is promoted', () => {
  const c = normalizeCaptions([
    { lang: 'es', url: 'https://v.example/b.vtt' },
    { lang: 'ta', url: 'https://v.example/c.vtt' },
  ], 'ta');
  assert.equal(originalCaption(c).lang, 'ta');
  assert.equal(c[0].lang, 'ta', 'the original sorts first so truncation never drops it');
});

test('the original always sorts first, so overflow truncation cannot drop it', () => {
  const many = Array.from({ length: 70 }, (_, n) => ({ lang: `x${String.fromCharCode(97 + (n % 26))}`, url: `https://v.example/${n}.vtt` }));
  many.push({ lang: 'en', url: 'https://v.example/en.vtt', original: true });
  const c = normalizeCaptions(many, 'en');
  assert.ok(c.length <= LIMITS.captionsMax);
  assert.equal(c[0].lang, 'en');
  assert.equal(originalCaption(c).lang, 'en');
});

test('unaddressable and duplicate caption rows are dropped, not thrown', () => {
  const c = normalizeCaptions([
    { lang: 'en', url: 'https://v.example/a.vtt', original: true },
    { lang: 'en', url: 'https://v.example/dupe.vtt' },
    { lang: 'es', url: 'http://insecure/b.vtt' },
    { lang: '', url: 'https://v.example/c.vtt' },
    null, 'nonsense', 42,
  ], 'en');
  assert.deepEqual(captionLanguages(c), ['en']);
});

test('caption tracks carry their own provider, so captions move with the backend too', () => {
  const c = normalizeCaptions([{ lang: 'en', provider: 'ipfs', providerId: 'QmCaptionCid1234567890', original: true }], 'en');
  assert.equal(c.length, 1);
  assert.equal(c[0].provider, 'ipfs');
  assert.match(c[0].url, /\/ipfs\/QmCaptionCid1234567890$/);
});

test('captionFor: exact → base language → the original, never null', () => {
  const c = normalizeCaptions([
    { lang: 'en', url: 'https://v.example/en.vtt', original: true },
    { lang: 'pt-br', url: 'https://v.example/ptbr.vtt' },
  ], 'en');
  assert.equal(captionFor(c, 'pt-br').lang, 'pt-br');
  assert.equal(captionFor(c, 'pt').lang, 'pt-br', 'base-language fallback');
  assert.equal(captionFor(c, 'ja').lang, 'en', 'unknown language falls back to the original');
  assert.equal(captionFor(c, '').lang, 'en');
  assert.equal(captionFor([], 'en'), null);
});

test('language labels are endonyms where we have them', () => {
  assert.equal(langLabel('hi'), 'हिन्दी');
  assert.equal(langLabel('ta'), 'தமிழ்');
  assert.equal(langLabel('zz'), 'zz');
});

test('the captionIndex overflow valve is carried and validated', () => {
  const m = buildVideoMetadata({ ...GOOD, captionIndex: 'https://video.melek.salon/hathor/intro.captions.json', captionCount: 42 });
  assert.equal(m.video.captionIndex.url, 'https://video.melek.salon/hathor/intro.captions.json');
  assert.equal(m.video.captionIndex.count, 42);
  assert.ok(validateVideoMetadata(m).ok);
  const bad = buildVideoMetadata(GOOD);
  bad.video.captionIndex = { url: 'http://insecure/x.json' };
  assert.ok(validateVideoMetadata(bad).errors.some((e) => /captionIndex is unaddressable/.test(e)));
});

// ── VALIDATION ───────────────────────────────────────────────────────────────────────────────────
test('a complete post validates clean', () => {
  const r = validateVideoMetadata(buildVideoMetadata(GOOD));
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.addressable, true);
  assert.deepEqual(r.captionLangs, ['en', 'hi']);
  assert.ok(r.bytes > 0 && r.bytes < MAX_JSON_METADATA_BYTES);
});

test('a post claiming a video it cannot address is REJECTED', () => {
  const m = buildVideoMetadata({ ...GOOD, provider: '', providerId: '', url: 'not-a-url' });
  const r = validateVideoMetadata(m);
  assert.equal(r.ok, false);
  assert.equal(r.addressable, false);
  assert.ok(r.errors.some((e) => /unaddressable/.test(e)));
});

test('insane durations and sizes are rejected', () => {
  const long = validateVideoMetadata(buildVideoMetadata({ ...GOOD, durationSec: LIMITS.durationMax + 1 }));
  assert.ok(long.errors.some((e) => /duration/.test(e)));
  const none = validateVideoMetadata(buildVideoMetadata({ ...GOOD, durationSec: 0 }));
  assert.ok(none.errors.some((e) => /missing duration/.test(e)));
  const big = validateVideoMetadata(buildVideoMetadata({ ...GOOD, filesizeBytes: LIMITS.filesizeMax + 1 }));
  assert.ok(big.errors.some((e) => /filesize/.test(e)));
  const wide = buildVideoMetadata(GOOD); wide.video.info.width = 99999;
  assert.ok(validateVideoMetadata(wide).errors.some((e) => /width/.test(e)));
});

test('the caption invariant is enforced at validation, not just at build', () => {
  const m = buildVideoMetadata(GOOD);
  m.video.captions[1].original = true;                     // hand-tampered: two originals
  assert.ok(validateVideoMetadata(m).errors.some((e) => /exactly ONE original/.test(e)));

  const m2 = buildVideoMetadata(GOOD);
  m2.video.info.lang = 'fr';                                // original track no longer matches the audio
  assert.ok(validateVideoMetadata(m2).errors.some((e) => /spoken language/.test(e)));

  const m3 = buildVideoMetadata(GOOD);
  m3.video.captions[1].url = 'http://insecure/x.vtt';
  assert.ok(validateVideoMetadata(m3).errors.some((e) => /unaddressable/.test(e)));
});

test('json_metadata over the chain budget is an error, not a surprise on broadcast', () => {
  const m = buildVideoMetadata(GOOD);
  m.video.content.description = 'x'.repeat(MAX_JSON_METADATA_BYTES + 500);
  const r = validateVideoMetadata(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /json_metadata is \d+ bytes/.test(e)));
  assert.ok(r.bytes > MAX_JSON_METADATA_BYTES);
});

test('IPFS carries the pinning warning — the failure that killed DTube is named on every post', () => {
  const m = buildVideoMetadata({ ...GOOD, provider: 'ipfs', providerId: 'QmVideoCidExample1234567890' });
  const r = validateVideoMetadata(m);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /pin it/.test(w)));
});

test('validation is total — junk in, safe shape out, never a throw', () => {
  for (const junk of [null, undefined, 0, '', 'string', [], {}, { video: 'x' }]) {
    const r = validateVideoMetadata(junk);
    assert.equal(typeof r.ok, 'boolean');
    assert.ok(Array.isArray(r.errors));
  }
  assert.equal(validateVideoMetadata({}).ok, false);
});

// ── PARSE (ours, ours-legacy, DTube, 3Speak) ─────────────────────────────────────────────────────
test('round-trips our own metadata', () => {
  const m = buildVideoMetadata(GOOD);
  const p = parseVideoMetadata(JSON.stringify(m));
  assert.equal(p.ok, true);
  assert.equal(p.platform, PLATFORM);
  assert.equal(p.url, m.video.url);
  assert.equal(p.duration, 600);
  assert.equal(p.lang, 'en');
  assert.equal(p.provider, 'melek');
  assert.deepEqual(captionLanguages(p.captions), ['en', 'hi']);
  assert.equal(originalCaption(p.captions).lang, 'en');
});

test('parses the legacy ScotTube flat-string shape already live in engine/api', () => {
  // engine/api/server.mjs DTUBE_HTML buildPost() writes exactly this today.
  const p = parseVideoMetadata({ app: 'melek/scottube', tags: ['reel', 'video'], video: 'https://video.melek.salon/x.mp4' });
  assert.equal(p.ok, true);
  assert.equal(p.legacy, 'flat-string');
  assert.equal(p.url, 'https://video.melek.salon/x.mp4');
  assert.equal(p.provider, 'melek');
});

test('parses a DTube v1 post (files.ipfs hashes + snaphash)', () => {
  const dtube = {
    app: 'dtube/0.9',
    video: {
      info: { title: 'An old DTube upload', author: 'someone', permlink: 'old-post', duration: 123, snaphash: 'QmSnapHashExample12345678' },
      content: { description: 'from 2018' },
      files: { ipfs: { video480hash: 'QmVideo480HashExample1234', video1080hash: 'QmVideo1080HashExample123' } },
      providerName: 'IPFS',
    },
  };
  const p = parseVideoMetadata(dtube);
  assert.equal(p.ok, true);
  assert.equal(p.platform, 'dtube');
  assert.equal(p.provider, 'ipfs');
  assert.match(p.url, /\/ipfs\/QmVideo1080HashExample123$/, 'prefers the highest rendition');
  assert.equal(p.duration, 123);
  assert.match(p.thumbnail, /\/ipfs\/QmSnapHashExample12345678$/);
});

test('parses a 3Speak post (sourceMap + video_v2 ipfs:// uri)', () => {
  const three = {
    app: '3speak/0.3.0', type: '3speak/video',
    video: {
      info: {
        platform: '3speak', title: 'A Hive video', author: 'someone', permlink: 'hive-video',
        duration: 305, filesize: 40_000_000, lang: 'en',
        video_v2: 'ipfs://QmThreeSpeakCid1234567890',
        sourceMap: [
          { type: 'video', url: 'https://threespeakvideo.b-cdn.net/x/default.m3u8', format: 'm3u8' },
          { type: 'thumbnail', url: 'https://media.3speak.tv/x/thumbnail.png', format: '' },
        ],
      },
      content: { description: 'hello hive', tags: ['hive'] },
    },
  };
  const p = parseVideoMetadata(three);
  assert.equal(p.ok, true);
  assert.equal(p.platform, '3speak');
  assert.equal(p.duration, 305);
  assert.match(p.url, /\/ipfs\/QmThreeSpeakCid1234567890$/);
  assert.equal(p.thumbnail, 'https://media.3speak.tv/x/thumbnail.png');
});

test('parse soft-fails on non-video and malformed input — never throws', () => {
  assert.equal(parseVideoMetadata('{not json').ok, false);
  assert.equal(parseVideoMetadata({ app: 'melek/blog', tags: ['blog'] }).ok, false);
  assert.equal(parseVideoMetadata({ video: 'ftp://nope/x.mp4' }).ok, false);
  assert.equal(parseVideoMetadata(null).ok, false);
  assert.equal(parseVideoMetadata({ video: { info: {} } }).ok, false);
});

// ── THE INTENT — unsigned, standard Graphene, nothing broadcast ──────────────────────────────────
test('buildCommentIntent emits a STANDARD comment op and nothing else', () => {
  const r = buildCommentIntent(GOOD);
  assert.equal(r.ok, true, r.validation.errors.join('; '));
  assert.equal(r.op[0], 'comment', 'standard Graphene op — no custom chain op, ever');
  const c = r.op[1];
  assert.deepEqual(Object.keys(c).sort(), ['author', 'body', 'json_metadata', 'parent_author', 'parent_permlink', 'permlink', 'title'].sort());
  assert.equal(c.parent_author, '');
  assert.equal(c.parent_permlink, VIDEO_TAG);
  assert.equal(c.author, 'hathor');
  assert.equal(JSON.parse(c.json_metadata).video.url, 'https://video.melek.salon/hathor/intro-1080p.mp4');
  assert.match(r.note, /UNSIGNED INTENT/);
  assert.match(r.note, /broadcasts nothing/);
});

test('the intent carries no key material and no signature field', () => {
  const blob = JSON.stringify(buildCommentIntent(GOOD));
  for (const forbidden of ['wif', 'privateKey', 'posting_key', 'signature', 'signatures', '5J', '5K']) {
    assert.ok(!blob.includes(forbidden), `intent leaked "${forbidden}"`);
  }
});

test('a bad author fails the intent instead of producing a broadcastable op', () => {
  const r = buildCommentIntent({ ...GOOD, author: 'Not An Account!' });
  assert.equal(r.ok, false);
  assert.ok(r.validation.errors.some((e) => /author/.test(e)));
});

test('videoPermlink is chain-legal and deterministic', () => {
  const p = videoPermlink('Pentecaust: the Descent of Tongues!!', 0);
  assert.match(p, /^[a-z0-9][a-z0-9-]{0,254}$/);
  assert.equal(p, videoPermlink('Pentecaust: the Descent of Tongues!!', 0));
  assert.match(videoPermlink('', 0), /^reel-video-0$/);
  assert.ok(videoPermlink('x'.repeat(500), 0).length <= 255);
});

test('metadataBytes is total', () => {
  assert.ok(metadataBytes({ a: 1 }) > 0);
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(metadataBytes(cyclic), 0);
});
