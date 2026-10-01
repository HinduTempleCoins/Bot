// site/music/server.mjs — SoapBox Music: our own music library, the SoundCloud-type shelf beside SoapBox Films.
//
// Two shelves:
//   • Originals — songs WE host: Hathor Sandalphon originals first (Christian-type songs, then ancient, then other kinds),
//     later creators' uploads. Each has a track page with a player, lyrics, credits and licence. Audio lives in
//     MUSIC_DIR/media and is served here with Range support (so the player can seek).
//   • Free & open — the public-domain / CC (never NC) catalog from integrations/soapbox/music-catalog.mjs, linked out.
//
// The catalog is MUSIC_DIR/catalog.json: { tracks: [{ id, title, artist, album?, genre?, shelf?, seconds?, lyrics?,
// style?, engine?, license, made?, file }] } — `file` is a basename inside MUSIC_DIR/media. A broken or missing catalog
// shows an empty shelf, never an error page.
//
// Mounted by site/stream/server.mjs at /music (like /films); also runs alone:
//   PORT=8203 MUSIC_DIR=/var/lib/soapbox-music node site/music/server.mjs
//   import { handler, loadCatalog, trackPage, __setDir } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as openMusic from '../../integrations/soapbox/music-catalog.mjs';
import { panelHtml, trackAttr, PLAYER_CSS, PLAYER_JS } from './player.mjs';
import { pinItAll } from '../../integrations/pin-it.mjs';

const PORT = +(process.env.PORT || 8203);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://stream.soapbox.community').replace(/\/$/, '');
let DIR = process.env.MUSIC_DIR || '/var/lib/soapbox-music';
export function __setDir(d) { DIR = d; }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
const AUDIO = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.flac': 'audio/flac' };
// shelf order is the operator's: Christian-type songs first, then ancient music, then other kinds
export const SHELVES = [
  { id: 'christian', title: 'Hymns, gospel and worship', blurb: 'Songs of the Spirit in the Christian styles — hymn, worship ballad, gospel choir, southern gospel, folk.' },
  { id: 'ancient', title: 'Ancient music', blurb: 'Lyres, harps, sistra, frame drums and temple songs.' },
  { id: 'other', title: 'Other songs', blurb: 'Everything else.' },
];

/** Read and sanitise the catalog; soft-fails to []. Only tracks whose audio file exists are listed. */
export function loadCatalog() {
  let raw;
  try { raw = JSON.parse(readFileSync(join(DIR, 'catalog.json'), 'utf8')); } catch { return []; }
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.tracks) ? raw.tracks : []);
  const out = [];
  for (const t of list) {
    if (!t || !ID_RE.test(String(t.id || '')) || !t.title || !t.file || !t.license) continue;
    const file = basename(String(t.file));
    if (!AUDIO[extname(file).toLowerCase()]) continue;
    try { if (!statSync(join(DIR, 'media', file)).isFile()) continue; } catch { continue; }
    let stems = [];
    try {
      const sj = JSON.parse(readFileSync(join(DIR, 'stems', String(t.id), 'stems.json'), 'utf8'));
      if (Array.isArray(sj.parts)) stems = sj.parts.filter((x) => /^[a-z]+$/.test(String(x))).slice(0, 12);
    } catch { /* no stems for this song yet */ }
    let notes = '';
    if (t.notes) { const n = basename(String(t.notes)); try { if (n.endsWith('.json') && statSync(join(DIR, 'notes', n)).isFile()) notes = n; } catch { /* no notes yet */ } }
    out.push({ ...t, file, notes, stems, shelf: SHELVES.some((s) => s.id === t.shelf) ? t.shelf : 'other' });
  }
  return out.sort((a, b) => (b.made || 0) - (a.made || 0));
}

/** what the player needs (same-origin URLs) */
const forPlayer = (t) => ({ ...t, audio: `/music/media/${t.file}`, notesUrl: t.notes ? `/music/notes/${t.notes}` : '' });

const dur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

const STYLE = `<style>
:root{--bg:#0f1117;--panel:#171a23;--bd:#2a2f3d;--fg:#e8e6e1;--mut:#9aa0ad;--acc:#8fb4ff}
@media (prefers-color-scheme:light){:root{--bg:#f6f4ef;--panel:#fff;--bd:#ddd6c8;--fg:#1d1b17;--mut:#6b665c;--acc:#2f5bd3}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif}
header{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--bd)}
header a{color:var(--mut);text-decoration:none}.brand{color:var(--fg)!important;font-size:18px}
.wrap{max-width:1000px;margin:0 auto;padding:16px}a{color:var(--acc)}h1{font-size:24px;margin:6px 0}h2{font-size:18px;margin:22px 0 6px}h3{font-size:15px;margin:16px 0 2px}
.lead{color:var(--mut)}.alpha{border:1px solid #c9a64a;border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--panel)}.tracks{list-style:none;padding:0;margin:0}.tracks li{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--bd);border-radius:10px;background:var(--panel);margin-top:8px}
.tracks .t{flex:1;min-width:0}.tracks .t a{font-weight:700;text-decoration:none}.mut{color:var(--mut);font-size:13px}
.tracks .play{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid var(--bd);background:var(--acc);color:#111;cursor:pointer}
.lyrics{white-space:pre-wrap;background:var(--panel);border:1px solid var(--bd);border-radius:10px;padding:14px}
form.search{display:flex;gap:8px}form.search input{flex:1;padding:8px;border-radius:8px;border:1px solid var(--bd);background:transparent;color:inherit}
form.search button{padding:8px 14px;border-radius:8px;border:0;background:var(--acc);color:#111}
.music-list{padding-left:18px}.lic,.src{color:var(--mut);font-size:12px}
@media(max-width:640px){.tracks li{flex-wrap:wrap}}
</style>`;

function shell(title, inner, { canonical = `${BASE_URL}/music`, description } = {}) {
  const desc = description || 'SoapBox Music — original songs made on our own servers with Hathor Sandalphon, and free public-domain and Creative-Commons music.';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name=description content="${esc(desc)}"><link rel=canonical href="${esc(canonical)}">${STYLE}${PLAYER_CSS}</head><body>
<header><a class=brand href="/music"><b>SoapBox</b> Music</a><a href="/">SoapBox Stream</a><a href="/films">Films</a><a href="https://pentecaust.com/sandalphon">🎼 Make a song with Hathor Sandalphon</a></header>
<div class=wrap>${inner}</div>${PLAYER_JS}${pinItAll()}</body></html>`;
}

function row(t) {
  const meta = [t.artist, t.genre, dur(t.seconds)].filter(Boolean).map(esc).join(' · ');
  return `<li><div class=t><a href="/music/t/${esc(t.id)}">${esc(t.title)}</a><div class=mut>${meta}</div></div>
<button class=play data-sbp-track="${trackAttr(forPlayer(t))}" aria-label="Play ${esc(t.title)}">▶ Play</button></li>`;
}

export function homePage(tracks = loadCatalog()) {
  const shelves = SHELVES.map((s) => {
    const list = tracks.filter((t) => t.shelf === s.id);
    if (!list.length) return '';
    // singles first, then each album as its own group (album order = newest track first)
    const singles = list.filter((t) => !t.album);
    const albums = [...new Set(list.filter((t) => t.album).map((t) => t.album))];
    const groups = albums.map((al) => `<h3>${esc(al)}</h3><ul class=tracks>${list.filter((t) => t.album === al).map(row).join('')}</ul>`).join('');
    return `<section><h2>${esc(s.title)}</h2><p class=lead>${esc(s.blurb)}</p>${singles.length ? `<ul class=tracks>${singles.map(row).join('')}</ul>` : ''}${groups}</section>`;
  }).join('');
  const inner = `<h1>SoapBox Music</h1>
${tracks.length ? panelHtml(forPlayer(tracks[0])) : ''}
<div class=alpha><b>Alpha.</b> These are Hathor Sandalphon's first test songs, made on our own servers. She is still being trained, and the songs she makes next are expected to be much better. The notes under the player are read from the recording by machine, so they are a test too.</div>
<p class=lead>Original songs made on our own servers with <a href="https://pentecaust.com/sandalphon">Hathor Sandalphon</a>, and a search across free public-domain and Creative-Commons music.</p>
${shelves || '<p class=lead>The first original songs are being made now — they will appear here.</p>'}
<h2>Free &amp; open music</h2>
<form class=search action="/music/search" method=get><input name=q placeholder="Search public-domain and CC music — e.g. organ, hymn, harp" aria-label="Search open music"><button>Search</button></form>`;
  return shell('SoapBox Music', inner);
}

export const embedCode = (t) => `<iframe src="${BASE_URL}/music/embed/${t.id}" width="700" height="300" style="border:0;max-width:100%" title="${t.title} — SoapBox Music" loading="lazy"></iframe>`;

/** the small panel alone — for profiles and other sites (MySpace-style) */
export function embedPage(t) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(t.title)} · SoapBox Music</title>${PLAYER_CSS}
<style>body{margin:0;background:transparent;font:13px system-ui,sans-serif}.sbp{margin:0}a{color:#8fb4ff}p{margin:4px 2px}</style></head><body>
${panelHtml(forPlayer(t), { compact: true })}<p><a href="${esc(BASE_URL)}/music/t/${esc(t.id)}" target=_blank rel=noopener>${esc(t.title)} on SoapBox Music ↗</a></p>${PLAYER_JS}</body></html>`;
}

export function trackPage(t) {
  const credit = [t.artist && `By ${t.artist}`, t.engine && `made with ${t.engine}`].filter(Boolean).map(esc).join(' · ');
  const inner = `<p><a href="/music">← All music</a></p><h1>${esc(t.title)}</h1>
<div class=alpha><b>Alpha — a test song.</b> Made on our own servers while Hathor Sandalphon is still being trained; the next ones are expected to be better. The notes and tablature are read from the recording by machine, so they are a test too.</div>
${t.album ? `<p class=mut>From the album <b>${esc(t.album)}</b></p>` : ''}<p class=mut>${credit}${t.genre ? ` · ${esc(t.genre)}` : ''}${t.seconds ? ` · ${dur(t.seconds)}` : ''}</p>
${panelHtml(forPlayer(t))}
${t.style ? `<p class=mut><b>Sound:</b> ${esc(t.style)}</p>` : ''}
${t.stems && t.stems.length ? `<h2>The parts</h2>
<p class=mut>Every part of this song on its own — to remix it, sing over it, or learn it. Made with Demucs (MIT) on our own servers.</p>
<ul class=tracks>${t.stems.map((p) => `<li><div class=t><b>${esc(p)}</b></div><audio controls preload=none src="/music/stems/${esc(t.id)}/${esc(p)}.mp3"></audio><a class=mut href="/music/stems/${esc(t.id)}/${esc(p)}.mp3" download>download</a></li>`).join('')}</ul>` : ''}
${t.lyrics ? `<h2>Lyrics</h2><div class=lyrics>${esc(t.lyrics)}</div>` : ''}
<p class=mut><b>Licence:</b> ${esc(t.license)}</p>
<p class=mut><b>Put this player on your page:</b> <code>${esc(embedCode(t))}</code></p>`;
  return shell(`${t.title} · SoapBox Music`, inner, { canonical: `${BASE_URL}/music/t/${t.id}`, description: `${t.title} — ${t.genre || 'an original song'} on SoapBox Music.` });
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

/** stream an audio file with HTTP Range support */
function sendAudio(req, res, file) {
  const p = join(DIR, 'media', file);
  if (!p.startsWith(join(DIR, 'media')) && !p.startsWith(join(DIR, 'stems'))) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  let size;
  try { size = statSync(p).size; } catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
  const type = AUDIO[extname(file).toLowerCase()];
  const m = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? +m[2] : size - 1;
    if (start < 0) start = 0;
    if (start >= size || end < start) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
    end = Math.min(end, size - 1);
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'cache-control': 'public, max-age=86400' });
    return createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size, 'cache-control': 'public, max-age=86400' });
  return createReadStream(p).pipe(res);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://music.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path === '/music' || path === '/') return sendHtml(res, homePage());
    if (path === '/music/catalog.json') {
      const tracks = loadCatalog().map(({ id, title, artist, genre, shelf, seconds, license, file }) => ({ id, title, artist, genre, shelf, seconds, license, url: `${BASE_URL}/music/t/${id}`, audio: `${BASE_URL}/music/media/${file}` }));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ tracks }));
    }
    const tm = path.match(/^\/music\/t\/([a-z0-9-]+)$/);
    if (tm) {
      const t = loadCatalog().find((x) => x.id === tm[1]);
      return t ? sendHtml(res, trackPage(t)) : sendHtml(res, shell('Not found · SoapBox Music', '<p>No such song. <a href="/music">All music</a></p>'), 404);
    }
    const mm = path.match(/^\/music\/media\/([A-Za-z0-9._-]+)$/);
    if (mm && AUDIO[extname(mm[1]).toLowerCase()] && !mm[1].startsWith('.')) return sendAudio(req, res, mm[1]);
    const nm = path.match(/^\/music\/notes\/([A-Za-z0-9._-]+\.json)$/);
    if (nm && !nm[1].startsWith('.')) {
      try {
        const body = readFileSync(join(DIR, 'notes', nm[1]));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' });
        return res.end(body);
      } catch { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    }
    const em = path.match(/^\/music\/embed\/([a-z0-9-]+)$/);
    if (em) {
      const t = loadCatalog().find((x) => x.id === em[1]);
      if (!t) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
      return sendHtml(res, embedPage(t));
    }
    const sm = path.match(/^\/music\/stems\/([a-z0-9-]+)\/([a-z]+)\.mp3$/);
    if (sm) {
      const t = loadCatalog().find((x) => x.id === sm[1]);
      if (!t || !t.stems.includes(sm[2])) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
      return sendAudio(req, res, join('..', 'stems', sm[1], `${sm[2]}.mp3`));
    }
    if (path === '/music/search') {
      const q = String(url.searchParams.get('q') || '').slice(0, 120).trim();
      const tracks = q ? await openMusic.search({ query: q, limit: 15 }).catch(() => []) : [];
      return sendHtml(res, shell(`${q || 'Search'} · SoapBox Music`, `<p><a href="/music">← All music</a></p>
<form class=search action="/music/search" method=get><input name=q value="${esc(q)}" aria-label="Search open music"><button>Search</button></form>${openMusic.renderList(tracks)}`));
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`SoapBox Music on http://${HOST}:${PORT}`));
}
