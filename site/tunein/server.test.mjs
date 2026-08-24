// site/tunein/server.test.mjs — offline tests for the "Tune In" browse+watch surface.
// Fully offline: one injected fetch fans out to every reader (radio / podcasts / video-discovery) and to
// the ScotTube RPC + engine payouts. No network, no ports bound. Asserts the page renders rows, a /watch
// route renders, and the page soft-fails when a source is dead.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, __setFetch, buildRows, scottubeFeed, videoUrlOf, esc } from './server.mjs';
import { listCams } from '../../integrations/camera-directory.mjs';

// ── injected data ───────────────────────────────────────────────────────────────────────────────
const IA_FILMS = {
  response: {
    docs: [
      { identifier: 'moon_voyage_1902', title: 'A Trip to the Moon', year: '1902', creator: 'Méliès', description: 'PD film' },
      { identifier: 'night_of_living', title: 'Night of the Living Dead', year: '1968', creator: 'Romero' },
    ],
  },
};
const RADIO_STATIONS = [
  { stationuuid: 'r1', name: 'KERA Dallas', url_resolved: 'https://stream.kera.org/live', state: 'Texas', country: 'The United States Of America', tags: 'news,talk', bitrate: 128, homepage: 'https://kera.org', clickcount: 5000, votes: 40 },
  { stationuuid: 'r2', name: 'Dallas Jazz', url_resolved: 'https://stream.example.com/jazz', state: 'Texas', tags: 'jazz', bitrate: 256, homepage: 'https://example.com' },
];
const ITUNES_PODS = {
  results: [
    { collectionId: 111, collectionName: 'Hardcore History', artistName: 'Dan Carlin', feedUrl: 'https://feeds.example/hh', primaryGenreName: 'History', trackCount: 70, collectionViewUrl: 'https://podcasts.apple.com/hh' },
  ],
};
const SCOT_POSTS = {
  result: [
    { author: 'hathor', permlink: 'reel-abc', title: 'Welcome to MELEK', created: '2026-08-20T00:00:00', json_metadata: JSON.stringify({ app: 'melek/scottube', tags: ['reel', 'video'], video: 'https://ipfs.io/ipfs/QmVid/clip.mp4' }) },
    { author: 'nobody', permlink: 'reel-novid', title: 'No video here', json_metadata: JSON.stringify({ tags: ['reel'] }) },
  ],
};
const SCOT_PAYOUTS = [{ postKey: 'hathor/reel-abc', emitted: '12.34', paid: true }];

// Route a single fake fetch to the right fixture by URL + method. Returns a Response-ish object.
function okJson(obj) { return { ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) }; }

function fakeFetch(url, opts = {}) {
  const u = String(url);
  if (u.includes('radio-browser')) return Promise.resolve(okJson(RADIO_STATIONS));
  if (u.includes('itunes.apple.com')) return Promise.resolve(okJson(ITUNES_PODS));
  if (u.includes('archive.org/advancedsearch')) return Promise.resolve(okJson(IA_FILMS));
  if (u.includes('/api/payouts')) return Promise.resolve(okJson(SCOT_PAYOUTS));
  if ((opts.method || '').toUpperCase() === 'POST') return Promise.resolve(okJson(SCOT_POSTS)); // chain RPC
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
}

// Minimal mock req/res that captures head + body.
function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

// ── unit: pure helpers ─────────────────────────────────────────────────────────────────────────
test('videoUrlOf resolves the playable url shapes', () => {
  assert.equal(videoUrlOf({ video: 'https://x/a.mp4' }), 'https://x/a.mp4');
  assert.equal(videoUrlOf({ video: { url: 'https://x/b.webm' } }), 'https://x/b.webm');
  assert.equal(videoUrlOf({ links: ['https://x/c.ogg'] }), 'https://x/c.ogg');
  assert.equal(videoUrlOf({}), null);
  assert.equal(videoUrlOf(null), null);
});

test('scottubeFeed shapes reel videos + joins SCOT earnings, drops no-video posts', async () => {
  __setFetch(fakeFetch);
  const feed = await scottubeFeed({ limit: 12 });
  assert.equal(feed.length, 1, 'the no-video post is dropped');
  assert.equal(feed[0].author, 'hathor');
  assert.equal(feed[0].videoUrl, 'https://ipfs.io/ipfs/QmVid/clip.mp4');
  assert.match(feed[0].earn, /12\.34 REEL/);
});

// ── home page renders rows from injected sources ─────────────────────────────────────────────────
test('home renders the Netflix-style rows aggregating every source', async () => {
  __setFetch(fakeFetch);
  const res = await get('/');
  assert.equal(res.code, 200);
  const html = res.body;
  assert.match(html, /Tune In/);
  assert.match(html, /Alpha/);                       // standing Alpha-badge rule
  // rows present
  assert.match(html, /Live now/);
  assert.match(html, /On MELEK \(ScotTube\)/);
  assert.match(html, /Films/);
  assert.match(html, /Radio/);
  assert.match(html, /Podcasts/);
  // injected content surfaced across sources
  assert.match(html, /A Trip to the Moon/);          // IA film
  assert.match(html, /KERA Dallas/);                 // radio
  assert.match(html, /Hardcore History/);            // podcast
  assert.match(html, /Welcome to MELEK/);            // ScotTube on-chain
  assert.match(html, /Hathor\.Live/);                // live channel
  assert.match(html, /12\.34 REEL/);                 // SCOT earnings badge
  // at least one curated live cam appears
  const cams = listCams();
  if (cams.length) assert.ok(html.includes(esc(cams[0].name)), 'a curated cam renders in Live now');
});

test('buildRows returns a hero rail + the five rows', async () => {
  __setFetch(fakeFetch);
  const { hero, rows } = await buildRows();
  assert.ok(Array.isArray(hero));
  assert.ok(hero.length > 0, 'hero rail is populated from merged sources');
  assert.deepEqual(rows.map((r) => r.id), ['live', 'onmelek', 'films', 'radio', 'podcasts']);
});

// ── watch route renders (deterministic, offline) ─────────────────────────────────────────────────
test('/watch/ia/:id embeds the Internet Archive player (license-router gated)', async () => {
  __setFetch(fakeFetch);
  const res = await get('/watch/ia/moon_voyage_1902');
  assert.equal(res.code, 200);
  assert.match(res.body, /archive\.org\/embed\/moon_voyage_1902/);
  assert.match(res.body, /← Tune In/);
});

test('/watch/cam/:id renders a stage for a curated cam (or 404 if none seeded)', async () => {
  __setFetch(fakeFetch);
  const cams = listCams();
  if (!cams.length) return; // no seed → nothing to assert
  const res = await get(`/watch/cam/${cams[0].id}`);
  assert.equal(res.code, 200);
  assert.ok(res.body.includes(esc(cams[0].name)));
});

test('/watch/live/hathor renders the live channel stage', async () => {
  __setFetch(fakeFetch);
  const res = await get('/watch/live/hathor');
  assert.equal(res.code, 200);
  assert.match(res.body, /Hathor\.Live/);
});

test('unknown /watch target 404s cleanly', async () => {
  __setFetch(fakeFetch);
  const res = await get('/watch/bogus/xyz');
  assert.equal(res.code, 404);
});

// ── soft-fail: a dead source degrades its row, never breaks the page ──────────────────────────────
test('page still renders when every source is dead (fetch throws)', async () => {
  __setFetch(() => { throw new Error('network down'); });
  const res = await get('/');
  assert.equal(res.code, 200, 'page renders even with all remote sources dead');
  assert.match(res.body, /Tune In/);
  assert.match(res.body, /check back soon/);         // an empty-row soft-fail message
});

test('one dead source (radio) does not break the other rows', async () => {
  __setFetch((url, opts) => {
    if (String(url).includes('radio-browser')) return Promise.reject(new Error('radio down'));
    return fakeFetch(url, opts);
  });
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /A Trip to the Moon/);      // films still render
  assert.match(res.body, /Welcome to MELEK/);        // ScotTube still renders
});

test('/health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.match(res.body, /"ok":true/);
  assert.match(res.body, /tunein/);
});
