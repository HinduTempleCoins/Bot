// hashtag-external.test.mjs — offline tests for the external hashtag adapter.
// Fully offline: __setFetch injects canned platform JSON; no network; soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, normTag, youtube, reddit, xtwitter, instagram, tiktok,
  trackHashtag, renderExternal, ALL_SOURCES,
} from './hashtag-external.mjs';

// ── fetch stub helpers ────────────────────────────────────────────────────────────────────────────
function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}
// route by URL substring → canned body (or a function for dynamic)
function routeFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(routes)) {
      if (u.includes(needle)) {
        const b = typeof body === 'function' ? body(u) : body;
        if (b === '__NETWORK_ERROR__') throw new Error('boom');
        if (b && b.__notOk) return jsonResponse(b.body, false);
        return jsonResponse(b, true);
      }
    }
    return jsonResponse({}, false);
  };
}

const YT_JSON = {
  pageInfo: { totalResults: 4200 },
  items: [
    { id: { videoId: 'abc123' }, snippet: { title: 'MELEK explained <script>' } },
    { id: { videoId: 'def456' }, snippet: { title: 'Second video' } },
    { id: { kind: 'channel' } }, // no videoId → filtered out
  ],
};
const REDDIT_JSON = {
  data: {
    children: [
      { data: { title: 'Top MELEK post', permalink: '/r/crypto/comments/x/top/', score: 512 } },
      { data: { title: 'Another <b>post</b>', permalink: '/r/crypto/comments/y/two/', score: 88 } },
    ],
  },
};
const X_JSON = {
  meta: { result_count: 17 },
  data: [
    { id: '900', text: 'loving #melek today', public_metrics: { like_count: 33 } },
    { id: '901', text: 'more melek', public_metrics: { like_count: 5 } },
  ],
};

function clearEnv() {
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.X_BEARER_TOKEN;
  delete process.env.REDDIT_SEARCH_URL;
}

// ── normTag ───────────────────────────────────────────────────────────────────────────────────────
test('normTag strips # and lowercases and drops junk', () => {
  assert.equal(normTag('#MELEK'), 'melek');
  assert.equal(normTag('  Hathor! '), 'hathor');
  assert.equal(normTag('a b-c'), 'abc');
});

// ── youtube ───────────────────────────────────────────────────────────────────────────────────────
test('youtube: no key → available:false with reason, never throws', async () => {
  clearEnv();
  __setFetch(routeFetch({}));
  const r = await youtube('melek');
  assert.equal(r.source, 'youtube');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'no YOUTUBE_API_KEY');
  assert.deepEqual(r.top, []);
});

test('youtube: parses count + top videos, filters non-videos', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  __setFetch(routeFetch({ 'googleapis.com/youtube': YT_JSON }));
  const r = await youtube('melek');
  clearEnv();
  assert.equal(r.available, true);
  assert.equal(r.count, 4200);
  assert.equal(r.top.length, 2);
  assert.equal(r.top[0].url, 'https://www.youtube.com/watch?v=abc123');
  assert.match(r.top[0].title, /MELEK explained/);
});

test('youtube: api error body → soft-fail with reason', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  __setFetch(routeFetch({ 'googleapis.com/youtube': { error: { code: 403, message: 'quota' } } }));
  const r = await youtube('melek');
  clearEnv();
  assert.equal(r.available, false);
  assert.equal(r.reason, 'youtube api error');
});

// ── reddit ────────────────────────────────────────────────────────────────────────────────────────
test('reddit: parses count + top posts from search.json', async () => {
  clearEnv();
  __setFetch(routeFetch({ 'reddit.com/search.json': REDDIT_JSON }));
  const r = await reddit('melek');
  assert.equal(r.source, 'reddit');
  assert.equal(r.available, true);
  assert.equal(r.count, 2);
  assert.equal(r.top[0].score, 512);
  assert.equal(r.top[0].url, 'https://www.reddit.com/r/crypto/comments/x/top/');
});

test('reddit: unreachable → soft-fail available:false', async () => {
  clearEnv();
  __setFetch(routeFetch({ 'reddit.com/search.json': '__NETWORK_ERROR__' }));
  const r = await reddit('melek');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'reddit unreachable');
});

// ── xtwitter ──────────────────────────────────────────────────────────────────────────────────────
test('xtwitter: disabled without token → available:false, paid reason', async () => {
  clearEnv();
  __setFetch(routeFetch({}));
  const r = await xtwitter('melek');
  assert.equal(r.source, 'xtwitter');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'paid API not configured');
});

test('xtwitter: with token parses counts + top', async () => {
  process.env.X_BEARER_TOKEN = 'bearer-xyz';
  __setFetch(routeFetch({ 'api.twitter.com/2/tweets/search/recent': X_JSON }));
  const r = await xtwitter('melek');
  clearEnv();
  assert.equal(r.available, true);
  assert.equal(r.count, 17);
  assert.equal(r.top.length, 2);
  assert.equal(r.top[0].score, 33);
  assert.match(r.top[0].url, /status\/900/);
});

// ── instagram / tiktok ────────────────────────────────────────────────────────────────────────────
test('instagram is always unavailable with ToS reason (never scraped)', async () => {
  const r = await instagram('#MELEK');
  assert.equal(r.source, 'instagram');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'no public hashtag API (ToS)');
  assert.equal(r.hashtag, 'melek');
});

test('tiktok is always unavailable with ToS reason (never scraped)', async () => {
  const r = await tiktok('melek');
  assert.equal(r.available, false);
  assert.equal(r.reason, 'no public hashtag API (ToS)');
});

// ── trackHashtag aggregate ──────────────────────────────────────────────────────────────────────────
test('trackHashtag aggregates enabled sources + soft-fails a dead one', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  __setFetch(routeFetch({
    'googleapis.com/youtube': YT_JSON,
    'reddit.com/search.json': '__NETWORK_ERROR__', // dead source
  }));
  const r = await trackHashtag('melek', { sources: ['youtube', 'reddit', 'instagram'] });
  clearEnv();
  assert.equal(r.hashtag, 'melek');
  assert.ok(r.asOf);
  assert.equal(r.sources.length, 3);
  const yt = r.sources.find((s) => s.source === 'youtube');
  const rd = r.sources.find((s) => s.source === 'reddit');
  const ig = r.sources.find((s) => s.source === 'instagram');
  assert.equal(yt.available, true);
  assert.equal(rd.available, false); // dead source did not throw
  assert.equal(ig.available, false);
  assert.equal(r.totalCount, 4200); // only available youtube counts
});

test('trackHashtag with no sources runs all + never throws', async () => {
  clearEnv();
  __setFetch(routeFetch({})); // everything soft-fails
  const r = await trackHashtag('melek');
  assert.equal(r.sources.length, ALL_SOURCES.length);
  assert.equal(r.totalCount, 0);
  assert.ok(r.sources.every((s) => typeof s.available === 'boolean'));
});

// ── renderExternal ──────────────────────────────────────────────────────────────────────────────────
test('renderExternal escapes hostile titles', async () => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  __setFetch(routeFetch({ 'googleapis.com/youtube': YT_JSON }));
  const r = await trackHashtag('melek', { sources: ['youtube'] });
  clearEnv();
  const html = renderExternal(r);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('#melek'));
});

test('renderExternal shows n/a sources with their reason', () => {
  const html = renderExternal({
    hashtag: 'melek', asOf: 'x', totalCount: 0,
    sources: [
      { source: 'instagram', hashtag: 'melek', available: false, top: [], reason: 'no public hashtag API (ToS)' },
    ],
  });
  assert.ok(html.includes('instagram'));
  assert.ok(html.includes('no public hashtag API (ToS)'));
});

test('renderExternal handles garbage input without throwing', () => {
  assert.match(renderExternal(null), /unavailable/);
  assert.match(renderExternal({}), /unavailable/);
});
