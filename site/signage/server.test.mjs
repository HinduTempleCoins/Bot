// server.test.mjs — offline tests for the data.SoapBox TV / signage board. All network is replaced via
// the server's single __setFetch fan-out (which sets the fake on every reader). Covers: / renders the
// carousel container + an SSR first slide; /api/slides returns a shaped deck (art/radio/events) and
// soft-fails to a default deck when readers are empty or throw; /config renders the picker and the
// query-building script; /health; esc-safety on a <script> topic; and an unknown route → 404.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, buildDeck, displayPage, configPage, renderSlideHtml, parseTypes, clampRotate,
  SLIDE_TYPES, DEFAULT_TYPES, esc, __setFetch,
} from './server.mjs';

// ── canned reader responses, routed by URL (Met + Artic PD art; Radio Browser stations; IA/ccMixter music)
const ARTIC = { data: [{ id: 7, title: 'The Bedroom', artist_display: 'Vincent van Gogh', date_display: '1889', is_public_domain: true, image_id: 'abc' }] };
const MET = { objectIDs: [] };
const RADIO_ROWS = [{ stationuuid: 'r1', name: 'KERA 90.1 Dallas', url_resolved: 'https://stream.kera.org/live', state: 'Texas', tags: 'news', bitrate: 128 }];
const IA_AUDIO = { response: { docs: [{ identifier: 'song1', title: 'Clair de Lune', creator: 'Debussy', licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/', collection: ['opensource_audio'], year: '1905' }] } };

function fakeFetch(over = {}) {
  const calls = [];
  const fn = async (url) => {
    const u = String(url);
    calls.push(u);
    let body = {};
    if (u.includes('artic.edu/api')) body = over.artic ?? ARTIC;
    else if (u.includes('metmuseum.org')) body = over.met ?? MET;
    else if (u.includes('radio-browser')) body = over.radio ?? RADIO_ROWS;
    else if (u.includes('archive.org/advancedsearch')) body = over.ia ?? IA_AUDIO;
    else if (u.includes('ccmixter')) body = over.ccmixter ?? [];
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  fn.calls = calls;
  return fn;
}
function install(over) { const f = fakeFetch(over); __setFetch(f); return f; }
function restore() { __setFetch(null); }

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

// ── esc / helpers ──────────────────────────────────────────────────────────────────────────────────
test('esc escapes html incl. quotes', () => {
  assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;');
});

test('parseTypes: comma + repeated params, dedup, known-only, defaults', () => {
  assert.deepEqual(parseTypes('art,radio'), ['art', 'radio']);
  assert.deepEqual(parseTypes(['art', 'art,brand']), ['art', 'brand']);
  assert.deepEqual(parseTypes('nope,zzz'), DEFAULT_TYPES);
  assert.deepEqual(parseTypes(''), DEFAULT_TYPES);
});

test('clampRotate: default, floor, ceiling', () => {
  assert.equal(clampRotate(undefined), 12);
  assert.equal(clampRotate(1), 3);
  assert.equal(clampRotate(9999), 600);
  assert.equal(clampRotate('20'), 20);
});

// ── / renders the carousel container + at least one SSR slide ────────────────────────────────────────
test('/ renders the kiosk carousel container + an SSR first slide', async () => {
  install();
  const res = await get('/?types=art,brand');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="stage"/);          // carousel container
  assert.match(res.body, /data-slide-count=/);
  assert.match(res.body, /class="slide/);        // an SSR slide is present
  assert.match(res.body, /The Bedroom/);         // art slide SSR'd from the mocked reader
  assert.match(res.body, /Alpha/);               // alpha badge
  restore();
});

test('/ falls back to a default deck (brand + welcome) when readers are empty', async () => {
  install({ artic: { data: [] }, radio: [], ia: { response: { docs: [] } } });
  const res = await get('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /id="stage"/);
  assert.match(res.body, /MELEK/);               // brand slide in the default deck
  restore();
});

// ── /api/slides returns a shaped deck + soft-fails ──────────────────────────────────────────────────
test('/api/slides returns a shaped deck with art/radio/events slides', async () => {
  install();
  const res = await get('/api/slides?types=art,radio,events,brand');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const deck = JSON.parse(res.body);
  assert.ok(Array.isArray(deck) && deck.length > 0);
  const types = deck.map((s) => s.type);
  assert.ok(types.includes('art'), 'has an art slide');
  assert.ok(types.includes('radio'), 'has a radio slide');
  assert.ok(types.includes('events'), 'has an events/welcome slide');
  assert.ok(types.includes('brand'), 'has a brand slide');
  // shapes
  const artSlide = deck.find((s) => s.type === 'art');
  assert.ok(artSlide.imageUrl && artSlide.title);
  const radioSlide = deck.find((s) => s.type === 'radio');
  assert.ok(Array.isArray(radioSlide.items) && radioSlide.items[0].name);
  restore();
});

test('/api/slides soft-fails to a safe default deck when every reader is empty', async () => {
  install({ artic: { data: [] }, met: { objectIDs: [] }, radio: [], ia: { response: { docs: [] } } });
  const res = await get('/api/slides?types=art,radio');
  assert.equal(res.statusCode, 200);
  const deck = JSON.parse(res.body);
  assert.ok(Array.isArray(deck) && deck.length >= 1, 'never an empty deck');
  assert.ok(deck.some((s) => s.type === 'brand'), 'default deck carries the brand slide');
  restore();
});

test('/api/slides soft-fails when a reader throws (never throws to the route)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const res = await get('/api/slides?types=art,radio');
  assert.equal(res.statusCode, 200);
  const deck = JSON.parse(res.body);
  assert.ok(Array.isArray(deck) && deck.length >= 1);
  restore();
});

test('buildDeck() is callable directly and never returns empty', async () => {
  __setFetch(async () => { throw new Error('down'); });
  const deck = await buildDeck({ topic: '', types: ['art'] });
  assert.ok(Array.isArray(deck) && deck.length >= 1);
  restore();
});

// ── /config renders the picker + builds a query URL ─────────────────────────────────────────────────
test('/config renders the picker with all slide-type options + a URL builder', async () => {
  const res = await get('/config');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Signage setup/);
  for (const t of SLIDE_TYPES) assert.match(res.body, new RegExp(`value="${t.id}"`));
  assert.match(res.body, /name="rotate"/);
  assert.match(res.body, /name="topic"/);
  assert.match(res.body, /id="url"/);            // the shareable-URL output
  assert.match(res.body, /URLSearchParams/);     // the query-building client script
  assert.match(res.body, /action="\/"/);         // the form points back to the display
});

test('configPage reflects current selection', () => {
  const html = configPage({ topic: 'jazz', types: 'radio', rotate: 20 });
  assert.match(html, /value="jazz"/);
  assert.match(html, /value="20"/);
  // the radio option is checked, an unchosen one is not
  assert.match(html, /value="radio" checked/);
  assert.doesNotMatch(html, /value="art" checked/);
});

// ── renderSlideHtml unit ────────────────────────────────────────────────────────────────────────────
test('renderSlideHtml renders each slide type', () => {
  assert.match(renderSlideHtml({ type: 'art', title: 'X', imageUrl: 'https://e/x.jpg' }), /slide-art/);
  assert.match(renderSlideHtml({ type: 'brand', title: 'MELEK', subtitle: 'hi' }), /slide-brand/);
  assert.match(renderSlideHtml({ type: 'radio', title: 'Now Tuned', items: [{ name: 'KERA', meta: 'TX' }] }), /KERA/);
  assert.equal(renderSlideHtml(null), '');
});

// ── /health ─────────────────────────────────────────────────────────────────────────────────────────
test('/health → ok', async () => {
  const res = await get('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

// ── esc-safety on a <script> topic ──────────────────────────────────────────────────────────────────
test('a <script> topic is escaped in the display page (no raw breakout)', async () => {
  install();
  const res = await get('/?topic=' + encodeURIComponent('<script>alert(1)</script>&types=brand'));
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
});

test('a <script> topic is escaped in the embedded deck JSON', async () => {
  install();
  const res = await get('/?topic=' + encodeURIComponent('</script><script>alert(1)</script>') + '&types=brand');
  assert.equal(res.statusCode, 200);
  // the raw closing-script breakout must not appear; it is <-escaped inside the deck JSON
  assert.doesNotMatch(res.body, /<\/script><script>alert/);
  assert.match(res.body, /\\u003c/);
});

test('a <script> topic is escaped on /config', async () => {
  const res = await get('/config?topic=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /value="<script>alert\(1\)<\/script>"/);
  assert.match(res.body, /&lt;script&gt;/);
});

// ── unknown route → 404 ─────────────────────────────────────────────────────────────────────────────
test('unknown route → 404', async () => {
  const res = await get('/totally-unknown');
  assert.equal(res.statusCode, 404);
});
