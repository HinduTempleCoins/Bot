import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, __setFetch, gateWatch, buildRows, tilesFor, esc, safeHref } from './server.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
const SEARCH_JSON = {
  response: {
    docs: [
      { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: '1968', creator: 'Romero', collection: ['feature_films'] },
      { identifier: 'evil<script>', title: '<script>alert(1)</script>', year: '1930', collection: ['prelinger'] },
    ],
  },
};
const META_JSON = {
  server: 'ia800100.us.archive.org', dir: '/12/items/notld',
  metadata: { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', collection: ['feature_films'] },
  files: [{ name: 'notld.mp4', format: 'h.264' }],
};
const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="NASA.us" group-title="Science" tvg-country="US",NASA TV
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 group-title="XXX",Adult
https://x/adult.m3u8`;
const RADIO_JSON = [{ stationuuid: 'r1', name: 'KERA Dallas', url_resolved: 'https://stream.kera.org/live', state: 'Texas', country: 'The United States Of America', tags: 'news', bitrate: 128 }];
const ITUNES_JSON = { results: [{ collectionId: 42, collectionName: 'History Pod', artistName: 'Someone', feedUrl: 'https://feed/x.rss', primaryGenreName: 'History', collectionViewUrl: 'https://pods/x' }] };
const SCOT_POSTS = [{ author: 'alice', permlink: 'my-reel', title: 'My Reel', json_metadata: JSON.stringify({ video: { url: 'https://cdn.example/vid.mp4' } }), created: '2026-08-01' }];

// One dispatching mock fans out to every reader the surface fetches from.
function dispatch(url, opts) {
  const s = String(url);
  if (s.includes('advancedsearch')) return { ok: true, json: async () => SEARCH_JSON };
  if (s.includes('/metadata/')) return { ok: true, json: async () => META_JSON };
  if (s.includes('.m3u')) return { ok: true, text: async () => PLAYLIST };
  if (s.includes('radio-browser')) return { ok: true, json: async () => RADIO_JSON };
  if (s.includes('itunes.apple.com')) return { ok: true, json: async () => ITUNES_JSON };
  if (opts && opts.method === 'POST') return { ok: true, json: async () => ({ result: SCOT_POSTS }) }; // ScotTube RPC
  return { ok: false, json: async () => ({}), text: async () => '' };  // engine payouts etc.
}
const useMock = () => __setFetch(async (url, opts) => dispatch(url, opts));

// tiny res double
function mkRes() {
  return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; } };
}
async function get(path) {
  const res = mkRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

// ── gateWatch (the license gate — the load-bearing safety function) ─────────────────────────────────
test('gateWatch: an official IA player URL → embed', () => {
  const g = gateWatch({ kind: 'film', source: 'Internet Archive', license: 'Public domain', licenseToken: 'public-domain', streamUrl: 'https://archive.org/embed/night_of_the_living_dead' });
  assert.equal(g.ok, true);
  assert.equal(g.mode, 'embed');
  assert.match(g.embed, /archive\.org\/embed\//);
});

test('gateWatch: a free-to-air HLS stream → stream (native play)', () => {
  const g = gateWatch({ kind: 'live', source: 'iptv-org', license: 'Free-to-air', licenseToken: 'free-to-air', streamUrl: 'https://ntv1.akamaized.net/x/master.m3u8' });
  assert.equal(g.ok, true);
  assert.equal(g.mode, 'stream');
  assert.equal(g.mime, 'application/x-mpegURL');
});

test('gateWatch: a public-domain direct mp4 → stream', () => {
  const g = gateWatch({ kind: 'film', source: 'Internet Archive', license: 'Public domain', licenseToken: 'public-domain', streamUrl: 'https://ia800100.us.archive.org/12/items/x/notld.mp4' });
  assert.equal(g.ok, true);
  assert.equal(g.mode, 'stream');
  assert.equal(g.mime, 'video/mp4');
});

test('gateWatch REFUSES a non-whitelisted / unlicensed stream', () => {
  const g = gateWatch({ kind: 'film', source: 'somewhere', license: 'copyrighted', licenseToken: 'copyrighted', streamUrl: 'https://evil.example.com/pirate/movie.mp4' });
  assert.equal(g.ok, false);
  assert.match(g.reason, /not license-cleared/);
});

test('gateWatch REFUSES a scraper iframe host (2embed) via license-router', () => {
  const g = gateWatch({ kind: 'film', source: '2embed', license: 'copyrighted', streamUrl: 'https://2embed.cc/embed/tt123' });
  assert.equal(g.ok, false);
});

test('gateWatch REFUSES non-http schemes and empty urls', () => {
  assert.equal(gateWatch({ streamUrl: 'javascript:alert(1)', license: 'public-domain', licenseToken: 'public-domain' }).ok, false);
  assert.equal(gateWatch({ streamUrl: 'rtmp://x/live', license: 'free-to-air', licenseToken: 'free-to-air' }).ok, false);
  assert.equal(gateWatch({}).ok, false);
});

test('safeHref allows http(s) only', () => {
  assert.equal(safeHref('https://x.com/a'), 'https://x.com/a');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref(''), '');
});

// ── rows / surface ──────────────────────────────────────────────────────────────────────────────
test('buildRows returns every category with tiles when sources return data', async () => {
  useMock();
  const rows = await buildRows();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.ok(byId.films.tiles.length >= 1, 'films row populated');
  assert.ok(byId.live.tiles.length >= 1, 'live TV row populated');
  assert.ok(byId.radio.tiles.length >= 1, 'radio row populated');
  assert.ok(byId.podcasts.tiles.length >= 1, 'podcasts row populated');
  assert.ok(byId.onmelek.tiles.length >= 1, 'ScotTube row populated');
  __setFetch(null);
});

test('a dead source degrades its row to empty, never throws', async () => {
  __setFetch(async () => { throw new Error('all sources down'); });
  const rows = await buildRows();
  assert.ok(rows.every((r) => Array.isArray(r.tiles) && r.tiles.length === 0));
  __setFetch(null);
});

test('home page renders category rows with license + source on every tile', async () => {
  useMock();
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /SoapBox<\/b> Stream|SoapBox Stream/);
  assert.match(res.body, /Films · public domain/);
  assert.match(res.body, /badge lic/);           // license badge present
  assert.match(res.body, /badge src/);           // source badge present
  assert.match(res.body, /Internet Archive/);
  __setFetch(null);
});

test('every rendered tile shows a license label (no tile lacks one)', async () => {
  useMock();
  const rows = await buildRows();
  for (const r of rows) for (const t of r.tiles) assert.ok(t.license, `tile ${t.id} has a license`);
  __setFetch(null);
});

test('hostile archive title is escaped in the rendered page (no live <script>)', async () => {
  useMock();
  const res = await get('/c/films');
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw XSS payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  __setFetch(null);
});

test('watch page embeds a whitelisted IA player (official), showing license', async () => {
  useMock();
  const res = await get('/watch?src=ia&id=night_of_the_living_dead');
  assert.equal(res.code, 200);
  assert.match(res.body, /<video|<iframe/);       // a real player
  assert.match(res.body, /License:/);             // license shown on the watch page
  assert.match(res.body, /Internet Archive/);
  __setFetch(null);
});

test('watch page REFUSES an unlicensed direct stream (tv src with a copyrighted-looking url still gated)', async () => {
  useMock();
  // craft a /watch/tv/<encoded rtmp url> — non-http scheme must be refused by the gate.
  const res = await get('/watch/tv/' + encodeURIComponent('rtmp://pirate/live'));
  // resolveItem returns null for a non-safeHref url → 404 (never renders a player for it).
  assert.equal(res.code, 404);
  __setFetch(null);
});

test('robots.txt, sitemap.xml, llms.txt, health all served', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /Sitemap:/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset/);
  assert.match(sm.body, /\/c\/films/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /SoapBox Stream/);
  const health = await get('/health');
  assert.equal(health.code, 200);
  assert.match(health.body, /"ok":true/);
});

test('unknown path → 404, unknown category → 404, never a 500', async () => {
  assert.equal((await get('/nope')).code, 404);
  useMock();
  assert.equal((await get('/c/bogus')).code, 404);
  __setFetch(null);
});

test('search with a query renders results; empty query renders the prompt', async () => {
  useMock();
  const res = await get('/search?q=zombie');
  assert.equal(res.code, 200);
  assert.match(res.body, /Search:/);
  const empty = await get('/search');
  assert.equal(empty.code, 200);
  __setFetch(null);
});
