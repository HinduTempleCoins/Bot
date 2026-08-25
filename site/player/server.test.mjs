// site/player/server.test.mjs — offline tests for the SoapBox Media Player.
// Fully offline: injectable fetch (__setFetch) returns canned reader payloads; no network.
// Covers the pure helpers (isPlayable / normalizeTrack / buildPlaylist / renderPlayer) and the
// handler routes (/, /api/resolve, /health, robots/sitemap/llms) — and that nothing ever throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, __setFetch,
  isPlayable, normalizeTrack, buildPlaylist, renderPlayer, videoUrlOf,
} from './server.mjs';

// ── a tiny mock res that captures what the handler writes ────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; if (headers) Object.assign(this.headers, headers); return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function call(pathAndQuery) {
  const res = mockRes();
  await handler({ url: pathAndQuery, method: 'GET' }, res);
  return res;
}

// A mock fetch that soft-fails every reader network call — the page must still render (offline).
function offlineFetch() {
  __setFetch(async () => ({ ok: false, status: 503, async json() { return {}; }, async text() { return ''; } }));
}

// ── isPlayable ────────────────────────────────────────────────────────────────────────────────────
test('isPlayable: accepts an https direct media file (mp3/mp4)', () => {
  assert.equal(isPlayable('https://cdn.example.com/song.mp3'), true);
  assert.equal(isPlayable('https://cdn.example.com/clip.mp4?token=abc'), true);
  assert.equal(isPlayable('https://cdn.example.com/v.webm#t=10'), true);
});

test('isPlayable: accepts a whitelisted official embed (YouTube)', () => {
  assert.equal(isPlayable('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
  assert.equal(isPlayable('https://vimeo.com/12345'), true);
});

test('isPlayable: rejects javascript:, data:, and http:', () => {
  assert.equal(isPlayable('javascript:alert(1)'), false);
  assert.equal(isPlayable('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isPlayable('http://cdn.example.com/song.mp3'), false); // must be https
});

test('isPlayable: rejects an unlisted host with no media extension', () => {
  assert.equal(isPlayable('https://evil.example.com/watch/page'), false);
  assert.equal(isPlayable('https://2embed.cc/embed/tt123'), false); // not on the embed allowlist
});

test('isPlayable: rejects junk input without throwing', () => {
  assert.equal(isPlayable(''), false);
  assert.equal(isPlayable(null), false);
  assert.equal(isPlayable('not a url'), false);
  assert.equal(isPlayable(42), false);
});

// ── normalizeTrack ──────────────────────────────────────────────────────────────────────────────
test('normalizeTrack: shapes an https media file, trims the title', () => {
  const t = normalizeTrack({ url: 'https://cdn.example.com/a/song.mp3', title: '  Hello  ' });
  assert.equal(t.kind, 'audio');
  assert.equal(t.title, 'Hello');
  assert.equal(t.host, 'cdn.example.com');
  assert.equal(t.url, 'https://cdn.example.com/a/song.mp3');
});

test('normalizeTrack: derives a title when none is given', () => {
  const t = normalizeTrack('https://cdn.example.com/media/clip.mp4');
  assert.equal(t.kind, 'video');
  assert.match(t.title, /clip\.mp4/);
});

test('normalizeTrack: a whitelisted embed becomes kind:embed with an official embed URL', () => {
  const t = normalizeTrack({ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'Vid' });
  assert.equal(t.kind, 'embed');
  assert.equal(t.provider, 'YouTube');
  assert.match(t.embed, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
});

test('normalizeTrack: honors a trusted audio/video kind hint for an extensionless stream (radio)', () => {
  const t = normalizeTrack({ url: 'https://stream.example.com/live', title: 'Radio One', kind: 'audio' });
  assert.equal(t.kind, 'audio');
  assert.equal(t.title, 'Radio One');
});

test('normalizeTrack: rejects a dangerous scheme even with a kind hint', () => {
  assert.equal(normalizeTrack({ url: 'javascript:alert(1)', kind: 'audio' }), null);
  assert.equal(normalizeTrack({ url: 'http://stream.example.com/live', kind: 'audio' }), null);
  assert.equal(normalizeTrack(''), null);
  assert.equal(normalizeTrack(null), null);
});

test('normalizeTrack: rejects an https non-media host with no hint', () => {
  assert.equal(normalizeTrack('https://evil.example.com/page'), null);
});

// ── buildPlaylist ───────────────────────────────────────────────────────────────────────────────
test('buildPlaylist: validates and dedupes', () => {
  const pl = buildPlaylist([
    'https://cdn.example.com/a.mp3',
    'https://cdn.example.com/a.mp3',          // dup url
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ', // same embed, different url shape → dedup
    'javascript:alert(1)',                    // invalid → dropped
    'https://evil.example.com/x',             // unplayable → dropped
    { url: 'https://cdn.example.com/b.webm', title: 'B' },
  ]);
  const urls = pl.map((t) => t.url);
  assert.equal(pl.length, 3, `expected 3, got ${pl.length}: ${JSON.stringify(urls)}`);
  assert.ok(pl.some((t) => t.url.endsWith('a.mp3')));
  assert.ok(pl.some((t) => t.kind === 'embed'));
  assert.ok(pl.some((t) => t.title === 'B'));
});

test('buildPlaylist: non-array / empty input → []', () => {
  assert.deepEqual(buildPlaylist(), []);
  assert.deepEqual(buildPlaylist(null), []);
  assert.deepEqual(buildPlaylist('nope'), []);
});

// ── renderPlayer ────────────────────────────────────────────────────────────────────────────────
test('renderPlayer: escapes a hostile track title (no raw script tag)', () => {
  const html = renderPlayer({
    tracks: [{ url: 'https://cdn.example.com/x.mp3', title: '<script>alert(1)</script>', kind: 'audio', host: 'cdn.example.com' }],
    index: 0,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'title must be escaped');
});

test('renderPlayer: empty state renders an empty-playlist prompt, no throw', () => {
  const html = renderPlayer({ tracks: [], index: 0 });
  assert.match(html, /Playlist is empty|No tracks yet/);
  assert.match(html, /id=playlist/);
});

test('renderPlayer: video track uses a <video> element (native cast controls)', () => {
  const html = renderPlayer({ tracks: [{ url: 'https://cdn.example.com/v.mp4', title: 'V', kind: 'video', host: 'cdn.example.com' }], index: 0 });
  assert.match(html, /<video[^>]+src="https:\/\/cdn\.example\.com\/v\.mp4"/);
});

test('renderPlayer: embed track uses a sandboxed iframe of the official embed', () => {
  const html = renderPlayer({ tracks: [{ url: 'https://youtu.be/dQw4w9WgXcQ', title: 'E', kind: 'embed', provider: 'YouTube', embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' }], index: 0 });
  assert.match(html, /<iframe[^>]+youtube-nocookie\.com\/embed/);
  assert.match(html, /sandbox=/);
});

// ── /api/resolve ────────────────────────────────────────────────────────────────────────────────
test('/api/resolve: returns a track for a good media URL (200)', async () => {
  offlineFetch();
  const res = await call('/api/resolve?url=' + encodeURIComponent('https://cdn.example.com/song.mp3') + '&title=Song');
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.track.kind, 'audio');
  assert.equal(j.track.title, 'Song');
});

test('/api/resolve: soft-fails a hostile URL with a reason (still 200)', async () => {
  offlineFetch();
  const res = await call('/api/resolve?url=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
  assert.ok(typeof j.reason === 'string' && j.reason.length > 0);
});

test('/api/resolve: soft-fails an unlisted https host (200, ok:false)', async () => {
  offlineFetch();
  const res = await call('/api/resolve?url=' + encodeURIComponent('https://evil.example.com/watch'));
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, false);
});

test('/api/resolve: missing url → ok:false, no throw', async () => {
  offlineFetch();
  const res = await call('/api/resolve');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, false);
});

// ── handler routes ──────────────────────────────────────────────────────────────────────────────
test('handler: / returns 200 HTML (renders offline)', async () => {
  offlineFetch();
  const res = await call('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /MELEK<\/b> Player|MELEK Player/);
  assert.match(res.body, /id=playlist/);
  assert.match(res.body, /Casting/);
});

test('handler: /health returns 200 JSON', async () => {
  const res = await call('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
});

test('handler: robots.txt / sitemap.xml / llms.txt all serve', async () => {
  const robots = await call('/robots.txt');
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /User-agent/i);
  const sitemap = await call('/sitemap.xml');
  assert.equal(sitemap.statusCode, 200);
  assert.match(sitemap.body, /<urlset/);
  const llms = await call('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /Player/);
});

test('handler: unknown path → 404, never throws', async () => {
  const res = await call('/no/such/route');
  assert.equal(res.statusCode, 404);
});

test('handler: never throws on garbage input', async () => {
  await assert.doesNotReject(async () => {
    const res = mockRes();
    await handler({ url: '/api/resolve?url=%%%bad%%', method: 'GET' }, res);
    assert.ok(res.ended);
  });
});

// ── quick-add reader wiring (offline: readers return real shapes) ─────────────────────────────────
test('handler: / still renders when a reader returns usable data', async () => {
  // radio search returns one https stream; podcasts + scottube fail → soft-fail. Page must render.
  __setFetch(async (u) => {
    const s = String(u);
    if (s.includes('radio-browser')) {
      return { ok: true, status: 200, async json() {
        return [{ stationuuid: 'x1', name: 'KDAL FM', url_resolved: 'https://stream.example.com/kdal', country: 'The United States Of America', state: 'Texas', tags: 'news' }];
      }, async text() { return ''; } };
    }
    return { ok: false, status: 503, async json() { return {}; }, async text() { return ''; } };
  });
  const res = await call('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /KDAL FM/);
  assert.match(res.body, /Radio · Dallas first/);
});

test('videoUrlOf: pulls a playable url out of json_metadata shapes', () => {
  assert.equal(videoUrlOf({ video: 'https://x/a.mp4' }), 'https://x/a.mp4');
  assert.equal(videoUrlOf({ video: { url: 'https://x/b.webm' } }), 'https://x/b.webm');
  assert.equal(videoUrlOf({ links: ['https://x/c.mp4'] }), 'https://x/c.mp4');
  assert.equal(videoUrlOf({}), null);
  assert.equal(videoUrlOf(null), null);
});
