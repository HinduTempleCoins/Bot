// media.test.mjs — offline tests for the Pentecaust Media Hub. All network is replaced via the hub's
// single __setFetch fan-out (which sets the fake on every reader); nothing here touches the wire.
// Covers: /media renders the tab nav; each tab route renders its reader's output when mocked; an
// empty/failed reader yields a graceful empty state (no throw); /health; esc-safety on a <script>
// query; and an unknown route → 404.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, tabPage, tabResults, videoPage, TABS, esc, __setFetch } from './media.mjs';
import { buildVideoMetadata } from './video-post.mjs';

// ── canned reader responses, routed by URL ───────────────────────────────────────────────────────
// Radio Browser (stations array), iTunes (search → {results}), Internet Archive advancedsearch
// ({response:{docs}}), Gutendex ({results}), Open Library ({docs}), Met/Artic, ccMixter (array).
const RADIO_ROWS = [{ stationuuid: 'r1', name: 'KERA 90.1 Dallas', url_resolved: 'https://stream.kera.org/live', state: 'Texas', tags: 'news', bitrate: 128 }];
const ITUNES = { results: [{ collectionId: 42, collectionName: 'The History Hour', artistName: 'BBC', feedUrl: 'https://feeds.bbc.co.uk/hh.xml', primaryGenreName: 'History', trackCount: 300 }] };
const ARTIC = { data: [{ id: 7, title: 'The Bedroom', artist_display: 'Vincent van Gogh', date_display: '1889', is_public_domain: true, image_id: 'abc' }] };
const GUTENDEX = { results: [{ id: 84, title: 'Frankenstein', authors: [{ name: 'Shelley, Mary' }], copyright: false, formats: { 'text/html': 'https://gutenberg.org/84.html', 'application/epub+zip': 'https://gutenberg.org/84.epub' } }] };
const OPENLIB = { docs: [] };
const IA_MOVIES = { response: { docs: [{ identifier: 'moonfilm', title: 'A Trip to the Moon', year: '1902', creator: 'Méliès', licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' }] } };
const MET = { objectIDs: [] };

// A real MELEK video post, built by the real builder so the fixture cannot drift from the shape.
const MELEK_META = buildVideoMetadata({
  author: 'hathor', permlink: 'reel-descent-of-tongues-0',
  title: 'Pentecaust: the descent of tongues',
  provider: 'melek', providerId: 'hathor/intro-1080p.mp4',
  durationSec: 600, height: 1080, contentType: 'video/mp4', lang: 'en',
  captions: [
    { lang: 'en', url: 'https://video.melek.salon/hathor/intro.en.vtt', original: true },
    { lang: 'hi', url: 'https://video.melek.salon/hathor/intro.hi.vtt' },
  ],
});
const MELEK_POST = {
  author: 'hathor', permlink: 'reel-descent-of-tongues-0',
  title: 'Pentecaust: the descent of tongues', created: '2026-09-08T12:00:00',
  json_metadata: JSON.stringify(MELEK_META),
};

// A single fake fetch routed by URL — one call, via the hub's fan-out, mocks the whole hub.
function fakeFetch(over = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    const u = String(url);
    calls.push(u);
    let body = {};
    if (u.includes('radio-browser')) body = over.radio ?? RADIO_ROWS;
    else if (u.includes('itunes.apple.com')) body = over.itunes ?? ITUNES;
    else if (u.includes('artic.edu/api')) body = over.artic ?? ARTIC;
    else if (u.includes('metmuseum.org')) body = over.met ?? MET;
    else if (u.includes('gutendex')) body = over.gutendex ?? GUTENDEX;
    else if (u.includes('openlibrary.org')) body = over.openlib ?? OPENLIB;
    else if (u.includes('archive.org/advancedsearch')) body = over.ia ?? IA_MOVIES;
    else if (u.includes('ccmixter')) body = over.ccmixter ?? [];
    else if (u.includes('/rpc')) {
      // the MELEK chain — the Watch tab's own tier. Routed by JSON-RPC method.
      const req = (() => { try { return JSON.parse((opts || {}).body || '{}'); } catch { return {}; } })();
      body = { jsonrpc: '2.0', id: 1, result: over.melek !== undefined ? over.melek : (req.method === 'condenser_api.get_content' ? MELEK_POST : [MELEK_POST]) };
    }
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  fn.calls = calls;
  return fn;
}

function install(over) { const f = fakeFetch(over); __setFetch(f); return f; }
function restore() { __setFetch(null); }

// Minimal mock response object capturing what the handler wrote.
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

// ── esc ────────────────────────────────────────────────────────────────────────────────────────
test('esc escapes html incl. quotes', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
});

// ── home / tab nav ───────────────────────────────────────────────────────────────────────────────
test('homePage renders the full tab nav', () => {
  const html = homePage();
  assert.match(html, /<nav class=tabs>/);
  for (const t of TABS) assert.match(html, new RegExp(`/media/${t.id}`));
  assert.match(html, /PENTECAUST/);
  assert.match(html, /Alpha/); // alpha badge
});

test('/media and / both render the hub home with the tab nav', async () => {
  for (const p of ['/media', '/', '/media/']) {
    const res = await get(p);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<nav class=tabs>/);
    assert.match(res.body, /Choose a surface/);
  }
});

// ── each tab renders its reader's output when mocked ─────────────────────────────────────────────
test('radio tab: no q → Dallas stations rendered', async () => {
  install();
  const res = await get('/media/radio');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /KERA 90\.1 Dallas/);
  assert.match(res.body, /class=active/); // active tab pill
  restore();
});

test('podcasts tab: q → shows rendered', async () => {
  install();
  const res = await get('/media/podcasts?q=history');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The History Hour/);
  restore();
});

test('music tab: q → CC/PD tracks rendered', async () => {
  install();
  const res = await get('/media/music?q=piano');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Free &amp; open music/); // music renderList heading
  restore();
});

test('art tab: q → PD gallery rendered', async () => {
  install();
  const res = await get('/media/art?q=bedroom');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The Bedroom/);
  assert.match(res.body, /art-gallery/);
  restore();
});

test('library tab: q → Gutenberg PD book rendered', async () => {
  install();
  const res = await get('/media/library?q=frankenstein');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Frankenstein/);
  assert.match(res.body, /Project Gutenberg/);
  restore();
});

test('watch tab: q → Internet Archive film rendered', async () => {
  install();
  const res = await get('/media/watch?q=moon');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /A Trip to the Moon/);
  restore();
});

// ── graceful empty / failed reader (no throw) ─────────────────────────────────────────────────────
test('empty reader → graceful empty state, no throw', async () => {
  // Every source returns nothing usable.
  install({ radio: [], itunes: { results: [] }, artic: { data: [] }, gutendex: { results: [] }, openlib: { docs: [] }, ia: { response: { docs: [] } } });
  for (const id of ['radio', 'podcasts', 'music', 'art', 'library', 'watch']) {
    const res = await get(`/media/${id}?q=zzzznothing`);
    assert.equal(res.statusCode, 200, `${id} still 200`);
    assert.match(res.body, /<nav class=tabs>/, `${id} still renders the shell`);
  }
  restore();
});

test('a throwing fetch is caught → still renders (soft-fail)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const html = await tabResults('radio', 'anything');
  assert.equal(typeof html, 'string');
  const res = await get('/media/podcasts?q=x');
  assert.equal(res.statusCode, 200);
  restore();
});

// ── /health ──────────────────────────────────────────────────────────────────────────────────────
test('/health → ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

// ── esc-safety on a <script> query ────────────────────────────────────────────────────────────────
test('a <script> query is escaped in the search box', async () => {
  install();
  const res = await get('/media/music?q=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;/);
  restore();
});

// ── unknown route → 404 ────────────────────────────────────────────────────────────────────────────
test('unknown route → 404', async () => {
  const res = await get('/media/nope');
  assert.equal(res.statusCode, 404);
  const res2 = await get('/totally-unknown');
  assert.equal(res2.statusCode, 404);
});

// ── tabPage returns null for an unknown tab id ─────────────────────────────────────────────────────
test('tabPage(unknown) → null', async () => {
  assert.equal(await tabPage('nope', ''), null);
});

// ── the Watch tab now carries MELEK's own video posts, above the discovery tier ───────────────────
test('watch tab: MELEK video posts render FIRST, then the public-domain discovery tier', async () => {
  install();
  const res = await get('/media/watch?q=moon');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /On MELEK/);
  assert.match(res.body, /Pentecaust: the descent of tongues/);
  assert.match(res.body, /A Trip to the Moon/);            // the IA tier still renders
  assert.ok(res.body.indexOf('On MELEK') < res.body.indexOf('A Trip to the Moon'), 'ours comes first');
  assert.match(res.body, /\/media\/watch\/@hathor\/reel-descent-of-tongues-0/);
  restore();
});

test('a dead chain node empties the MELEK row and leaves the rest of the tab standing', async () => {
  install({ melek: null });
  const res = await get('/media/watch?q=moon');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /No MELEK videos on chain yet/);
  assert.match(res.body, /A Trip to the Moon/);
  restore();
});

// ── one video, end to end ────────────────────────────────────────────────────────────────────────
test('/media/watch/@author/permlink renders the player, the captions and the cost', async () => {
  install();
  const res = await get('/media/watch/@hathor/reel-descent-of-tongues-0');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<video controls/);
  assert.match(res.body, /srclang="en"/);
  assert.match(res.body, /srclang="hi"/);
  assert.match(res.body, /English \(original\)/);
  assert.match(res.body, /Where this video lives/);
  assert.match(res.body, /What this costs to serve/);
  assert.ok(!/<iframe/i.test(res.body), 'our own origin — no third-party frame');
  restore();
});

test('?lang= picks the reader’s caption track, and an unknown language falls back to the original', async () => {
  install();
  const hi = await get('/media/watch/@hathor/reel-descent-of-tongues-0?lang=hi');
  assert.match(hi.body, /srclang="hi" label="[^"]*" default/);
  const ja = await get('/media/watch/@hathor/reel-descent-of-tongues-0?lang=ja');
  assert.match(ja.body, /srclang="en"[^>]*default/);
  restore();
});

test('a missing MELEK video is a 404 page, not a 500', async () => {
  install({ melek: null });
  const res = await get('/media/watch/@hathor/reel-nope-0');
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /No MELEK video post at/);
  assert.match(res.body, /<nav class=tabs>/);
  restore();
});

test('a malformed video ref never reaches the route handler as a video', async () => {
  install();
  for (const bad of ['/media/watch/@Bad Name/x', '/media/watch/@hathor/', '/media/watch/hathor/x']) {
    const res = await get(bad);
    assert.equal(res.statusCode, 404, bad);
  }
  restore();
});

test('videoPage is exported and soft-fails without a live node', async () => {
  __setFetch(async () => { throw new Error('down'); });
  const r = await videoPage('hathor', 'reel-x-0', '');
  assert.equal(r.found, false);
  assert.match(r.html, /No MELEK video post at/);
  restore();
});
