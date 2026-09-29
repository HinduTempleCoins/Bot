// videos.mjs — trailers, theory videos and review videos for SoapBox Films review pages.
//   Trailer        — embedded (youtube-nocookie) when we know its video id; else a YouTube search link.
//   Theory videos  — first, marked "may contain spoilers".
//   Review videos  — second, marked "may contain spoilers".
// With YOUTUBE_API_KEY set, each is one YouTube Data API search per film (cached 30 days in DATA_DIR, and a daily
// budget so the free quota — ~100 searches/day — is never exceeded). Without a key, or over budget, every section is
// a YouTube search link, so a page is never empty. Soft-fail, injectable fetch, esc() everything.

import fs from 'node:fs';
import path from 'node:path';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
let _now = () => Date.now();
export function __setNow(fn) { _now = fn || (() => Date.now()); }

export const KINDS = {
  trailer: { q: (t, y) => `${t} ${y || ''} official trailer`, n: 1 },
  theory: { q: (t, y) => `${t} ${y || ''} movie theory explained`, n: 3 },
  review: { q: (t, y) => `${t} ${y || ''} movie review`, n: 3 },
};
const TTL = 30 * 864e5;
const DAILY = () => +(process.env.YOUTUBE_DAILY_SEARCHES || 90);
export const ytSearchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q.replace(/\s+/g, ' ').trim())}`;
const VID = /^[A-Za-z0-9_-]{11}$/;

function cacheFile(dir) { return path.join(dir, 'youtube-cache.json'); }
let _mem = null;
function load(dir) {
  if (_mem && _mem.dir === dir) return _mem;
  let j = { films: {}, budget: { day: '', used: 0 } };
  try { j = { films: {}, budget: { day: '', used: 0 }, ...JSON.parse(fs.readFileSync(cacheFile(dir), 'utf8')) }; } catch {}
  _mem = { dir, ...j };
  return _mem;
}
function save(m) { try { fs.writeFileSync(cacheFile(m.dir), JSON.stringify({ films: m.films, budget: m.budget })); } catch {} }
export function __resetVideos() { _mem = null; }

function spend(m) {
  const day = new Date(_now()).toISOString().slice(0, 10);
  if (m.budget.day !== day) m.budget = { day, used: 0 };
  if (m.budget.used >= DAILY()) return false;
  m.budget.used += 1;
  return true;
}

async function search(q, n) {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key) return null;
  const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${n}&safeSearch=none&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  try {
    const r = await Promise.race([_fetch(u), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    if (!r || !r.ok) return null;
    const j = await r.json();
    return (j.items || []).map((it) => ({ id: it.id && it.id.videoId, title: it.snippet && it.snippet.title, channel: it.snippet && it.snippet.channelTitle }))
      .filter((v) => VID.test(v.id || '')).slice(0, n);
  } catch { return null; }
}

/** { trailer:[…], theory:[…], review:[…] } — cached per film; null entries mean "link out". */
export async function videosFor(dir, film) {
  const m = load(dir);
  const c = m.films[film.id];
  if (c && _now() - c.at < TTL) return c.v;
  const v = {};
  let fetched = false;
  for (const [k, spec] of Object.entries(KINDS)) {
    if (!(process.env.YOUTUBE_API_KEY || '').trim() || !spend(m)) { v[k] = null; continue; }
    v[k] = await search(spec.q(film.t, film.y), spec.n);
    fetched = true;
  }
  if (fetched) { m.films[film.id] = { at: _now(), v }; save(m); }
  return v;
}

const thumb = (x) => `<a class=vcard href="https://www.youtube.com/watch?v=${esc(x.id)}" target=_blank rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/${esc(x.id)}/mqdefault.jpg" alt="" loading=lazy referrerpolicy=no-referrer><span>${esc(x.title || '')}</span><span class=meta>${esc(x.channel || '')}</span></a>`;

export function videosBox(film, v = {}) {
  const t = film.t; const y = film.y;
  const tr = (v.trailer || [])[0];
  const trailer = tr
    ? `<div class=vframe><iframe src="https://www.youtube-nocookie.com/embed/${esc(tr.id)}" title="${esc(`${t} trailer`)}" loading=lazy allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy=strict-origin-when-cross-origin></iframe></div>`
    : `<p><a class=chip href="${esc(ytSearchUrl(KINDS.trailer.q(t, y)))}" target=_blank rel="noopener noreferrer">▶ Watch the trailer on YouTube ↗</a></p>`;
  const list = (k, label) => {
    const xs = v[k] || [];
    return `<h3>${label} <span class=spoil>⚠ may contain spoilers</span></h3>${xs.length ? `<div class=vgrid>${xs.map(thumb).join('')}</div>` : ''}
<p><a href="${esc(ytSearchUrl(KINDS[k].q(t, y)))}" target=_blank rel="noopener noreferrer">More ${label.toLowerCase()} on YouTube ↗</a></p>`;
  };
  return `<style>.vframe{position:relative;aspect-ratio:16/9;max-width:720px}.vframe iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}
.vgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.vcard{display:flex;flex-direction:column;gap:3px;font-size:13px}.vcard img{width:100%;border-radius:8px}
.spoil{font-size:12px;font-weight:600;color:#e0a11b;border:1px solid #e0a11b;border-radius:10px;padding:1px 7px;margin-left:6px}</style>
<h2>Trailer</h2>${trailer}
${list('theory', 'Theory videos')}
${list('review', 'Review videos')}`;
}
