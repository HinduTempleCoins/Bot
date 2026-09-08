// video-feed.test.mjs — offline tests for reading MELEK video posts off the chain and rendering one.
// Every chain read goes through the module's injectable fetch; nothing here touches the wire.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __setFetch, recentVideos, getVideo, toVideoItem,
  renderVideoList, renderVideoPage, dataNote, esc, ACCOUNT_RE, PERMLINK_RE,
} from './video-feed.mjs';
import { buildVideoMetadata } from './video-post.mjs';

// ── a real MELEK video post, built by the real builder (no hand-written fixture to drift) ────────
const META = buildVideoMetadata({
  author: 'hathor',
  permlink: 'reel-descent-of-tongues-0',
  title: 'Pentecaust: the descent of tongues',
  description: 'The first MELEK video.',
  provider: 'melek',
  providerId: 'hathor/intro-1080p.mp4',
  durationSec: 600,
  filesizeBytes: 347_100_000,
  width: 1920, height: 1080,
  contentType: 'video/mp4',
  thumbnail: 'https://video.melek.salon/hathor/intro.jpg',
  lang: 'en',
  renditions: [
    { height: 1080, providerId: 'hathor/intro-1080p.mp4', bitrateKbps: 4500 },
    { height: 480, providerId: 'hathor/intro-480p.mp4', bitrateKbps: 1200 },
  ],
  captions: [
    { lang: 'en', url: 'https://video.melek.salon/hathor/intro.en.vtt', source: 'human', original: true },
    { lang: 'hi', url: 'https://video.melek.salon/hathor/intro.hi.vtt', source: 'machine' },
    { lang: 'es', url: 'https://video.melek.salon/hathor/intro.es.vtt', source: 'machine' },
  ],
});

const POST = {
  author: 'hathor',
  permlink: 'reel-descent-of-tongues-0',
  title: 'Pentecaust: the descent of tongues',
  body: 'The first MELEK video.',
  created: '2026-09-08T12:00:00',
  pending_payout_value: '4.200 MBD',
  json_metadata: JSON.stringify(META),
};
const NOT_A_VIDEO = { author: 'hathor', permlink: 'a-blog-post', title: 'Words', json_metadata: '{"app":"melek/blog","tags":["blog"]}' };

// A single fake fetch, routed by RPC method. Records every call so we can assert we stayed offline-shaped.
function install(result, { ok = true } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    calls.push({ url: String(url), method: body.method, params: body.params });
    const r = typeof result === 'function' ? result(body) : result;
    return { ok, status: ok ? 200 : 502, json: async () => ({ jsonrpc: '2.0', id: 1, result: r }), text: async () => '' };
  };
  fn.calls = calls;
  __setFetch(fn);
  return fn;
}
const restore = () => __setFetch(null);

// ── the feed ─────────────────────────────────────────────────────────────────────────────────────
test('recentVideos reads reel-tagged posts and keeps only the ones that parse as video', async () => {
  const f = install([POST, NOT_A_VIDEO, null, { author: 'x' }]);
  try {
    const list = await recentVideos({ limit: 5 });
    assert.equal(list.length, 1);
    assert.equal(list[0].author, 'hathor');
    assert.equal(list[0].duration, 600);
    assert.equal(list[0].watch, '/media/watch/@hathor/reel-descent-of-tongues-0');
    assert.equal(f.calls[0].method, 'condenser_api.get_discussions_by_created');
    assert.equal(f.calls[0].params[0].tag, 'reel');
  } finally { restore(); }
});

test('a dead node empties the feed instead of breaking the page', async () => {
  for (const setup of [() => install(null, { ok: false }), () => install(undefined), () => { __setFetch(() => { throw new Error('down'); }); }]) {
    setup();
    try { assert.deepEqual(await recentVideos({}), []); } finally { restore(); }
  }
});

test('getVideo fetches one post and refuses a malformed reference without calling the chain', async () => {
  const f = install(POST);
  try {
    const v = await getVideo({ author: '@hathor', permlink: 'reel-descent-of-tongues-0' });
    assert.equal(v.title, 'Pentecaust: the descent of tongues');
    assert.equal(f.calls[0].method, 'condenser_api.get_content');
    const before = f.calls.length;
    assert.equal(await getVideo({ author: 'Bad Name!', permlink: 'x' }), null);
    assert.equal(await getVideo({}), null);
    assert.equal(f.calls.length, before, 'a bad ref never reaches the network');
  } finally { restore(); }
});

test('getVideo returns null for a post that is not a video', async () => {
  install(NOT_A_VIDEO);
  try { assert.equal(await getVideo({ author: 'hathor', permlink: 'a-blog-post' }), null); } finally { restore(); }
});

test('toVideoItem rejects rows with an unusable author or permlink', () => {
  assert.equal(toVideoItem(null), null);
  assert.equal(toVideoItem({ ...POST, author: 'no' }), null);            // too short for an account
  assert.equal(toVideoItem({ ...POST, author: 'bad name!' }), null);
  assert.equal(toVideoItem({ ...POST, permlink: 'bad permlink' }), null);
  assert.ok(ACCOUNT_RE.test('hathor') && PERMLINK_RE.test('reel-x-1'));
});

// ── the list ─────────────────────────────────────────────────────────────────────────────────────
test('renderVideoList shows the caption languages and the original', () => {
  const html = renderVideoList([toVideoItem(POST)]);
  assert.match(html, /On MELEK/);
  assert.match(html, /\/media\/watch\/@hathor\/reel-descent-of-tongues-0/);
  assert.match(html, /CC 3 languages/);
  assert.match(html, /original English/);
  assert.match(html, /10:00/);           // duration
  assert.match(html, /MELEK storage/);   // which backend
});

test('the empty state explains the architecture instead of just saying "none"', () => {
  const html = renderVideoList([]);
  assert.match(html, /No MELEK videos on chain yet/);
  assert.match(html, /no custom chain op/);
  assert.match(html, /json_metadata/);
});

test('renderVideoList is total and escapes hostile titles', () => {
  const nasty = { ...toVideoItem(POST), title: '<script>alert(1)</script>' };
  const html = renderVideoList([nasty, null, undefined]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(typeof renderVideoList(), 'string');
  assert.equal(typeof renderVideoList('nonsense'), 'string');
});

// ── the player ───────────────────────────────────────────────────────────────────────────────────
test('renderVideoPage builds a plain <video> with a <source> per rendition — no iframe', () => {
  const html = renderVideoPage(toVideoItem(POST));
  assert.match(html, /<video controls/);
  assert.ok(!/<iframe/i.test(html), 'MELEK video is our own origin — no third-party frame, no arbitrary JS');
  assert.match(html, /src="https:\/\/video\.melek\.salon\/hathor\/intro-1080p\.mp4" type="video\/mp4"/);
  assert.match(html, /intro-480p\.mp4/);
  assert.match(html, /crossorigin="anonymous"/, 'without it the browser silently drops every caption track');
  assert.match(html, /poster="https:\/\/video\.melek\.salon\/hathor\/intro\.jpg"/);
});

test('every caption language becomes a <track>, and the original is labelled as the original', () => {
  const html = renderVideoPage(toVideoItem(POST));
  for (const l of ['en', 'hi', 'es']) assert.match(html, new RegExp(`srclang="${l}"`));
  assert.match(html, /kind="captions"[^>]*srclang="en"/, 'the original is captions, not subtitles');
  assert.match(html, /kind="subtitles"[^>]*srclang="es"/);
  assert.match(html, /label="English \(original\)"/);
});

test('the reader’s language is the default track; an unknown language falls back to the ORIGINAL', () => {
  const hi = renderVideoPage(toVideoItem(POST), { lang: 'hi' });
  assert.match(hi, /srclang="hi" label="[^"]*" default/);
  assert.ok(!/srclang="en"[^>]*default/.test(hi));

  const ja = renderVideoPage(toVideoItem(POST), { lang: 'ja' });   // no Japanese track exists
  assert.match(ja, /srclang="en"[^>]*default/, 'falls back to the original, never to nothing');
});

test('the language row marks the original and never hides it', () => {
  const html = renderVideoPage(toVideoItem(POST), { lang: 'es' });
  assert.match(html, /\?lang=hi/);
  assert.match(html, /\?lang=en/);
  assert.match(html, /· original/);
  assert.match(html, /the original \(English\) is always kept and always shown as the original/);
});

test('a post with no captions still renders, and says so', () => {
  const bare = toVideoItem({ ...POST, json_metadata: JSON.stringify(buildVideoMetadata({ title: 'Bare', provider: 'melek', providerId: 'a/b.mp4', durationSec: 30, lang: 'en' })) });
  const html = renderVideoPage(bare);
  assert.match(html, /No caption tracks on this post/);
  assert.match(html, /<video controls/);
});

test('an unaddressable video renders the refusal instead of a broken player', () => {
  const broken = { ...toVideoItem(POST), url: '', sourceMap: [] };
  const html = renderVideoPage(broken);
  assert.match(html, /cannot be addressed/);
  assert.ok(!html.includes('<video'));
});

test('the page names the backend and who keeps the bytes alive', () => {
  const html = renderVideoPage(toVideoItem(POST));
  assert.match(html, /Where this video lives/);
  assert.match(html, /MELEK storage/);
  assert.match(html, /the operator runs the boxes/);
  assert.match(html, /The chain holds the <b>reference<\/b>, not the bytes/);
  assert.match(html, /75\/25 author\/curator/);
});

test('the page carries the cost of serving it', () => {
  const html = renderVideoPage(toVideoItem(POST));
  assert.match(html, /What this costs to serve/);
  assert.match(html, /per viewer-hour/);
  assert.match(html, /of a full day of total MELEK chain capacity/);
});

test('renderVideoPage is total and escapes everything', () => {
  assert.equal(renderVideoPage(null), '');
  assert.equal(renderVideoPage({ ok: false }), '');
  const nasty = { ...toVideoItem(POST), title: '"><script>x</script>', description: '<img onerror=1>', providerId: '</code><script>y</script>' };
  const html = renderVideoPage(nasty);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img onerror'));
  assert.match(html, /&lt;script&gt;/);
});

test('esc and dataNote hold the line', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
  assert.match(dataNote(), /standard `comment` op/);
  assert.match(dataNote(), /never signs, uploads or pins/);
});
