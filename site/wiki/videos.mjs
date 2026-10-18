// site/wiki/videos.mjs — YouTube videos on Library of Ashurbanipal articles.
//
// Each article gets a "Videos" section: up to 4 videos found by the article's title, embedded privacy-enhanced
// (youtube-nocookie). Article pages render synchronously, so this works from a cache:
//   • cached  → the page shows the videos straight away;
//   • not yet → the page shows a "Watch on YouTube" search link, and refresh() is kicked off in the background
//               so the next visitor sees the videos; scripts/warm can fill the whole library ahead of time.
// With YOUTUBE_API_KEY unset (or the daily budget spent) every article still gets the search link — a page is
// never empty, and nothing breaks. One YouTube Data API search per article, cached 30 days, with a daily
// budget (YOUTUBE_DAILY_SEARCHES, default 90) so the free quota (~100 searches/day) is never exceeded.
//
// House style: ESM, injectable fetch/clock, soft-fail, esc() everything.
//   node site/wiki/videos.mjs warm [--limit N]   # fill the cache for articles that have none (within budget)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
let _now = () => Date.now();
export function __setNow(fn) { _now = fn || (() => Date.now()); }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TTL = 30 * 864e5;
const PER_ARTICLE = 4;
const DAILY = () => +(process.env.YOUTUBE_DAILY_SEARCHES || 90);
const VID = /^[A-Za-z0-9_-]{11}$/;
export const ytSearchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(String(q).replace(/\s+/g, ' ').trim())}`;
const cacheFile = () => process.env.WIKI_VIDEOS_CACHE || path.join(__dir, 'youtube-cache.json');

let _mem = null;
function load() {
  const f = cacheFile();
  if (_mem && _mem.f === f) return _mem;
  let j = { articles: {}, budget: { day: '', used: 0 } };
  try { j = { articles: {}, budget: { day: '', used: 0 }, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { /* first run */ }
  _mem = { f, ...j, inflight: new Set() };
  return _mem;
}
function save(m) { try { fs.writeFileSync(m.f + '.new', JSON.stringify({ articles: m.articles, budget: m.budget })); fs.renameSync(m.f + '.new', m.f); } catch { /* soft */ } }
export function __reset() { _mem = null; }

function spend(m) {
  const day = new Date(_now()).toISOString().slice(0, 10);
  if (m.budget.day !== day) m.budget = { day, used: 0 };
  if (m.budget.used >= DAILY()) return false;
  m.budget.used += 1;
  return true;
}

/** Search words for an article: its title, without wiki disambiguation and underscores. */
export function queryFor(title) { return String(title || '').replace(/_/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim(); }

async function search(q) {
  const key = (process.env.YOUTUBE_API_KEY || '').trim();
  if (!key || !q) return null;
  const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=moderate&maxResults=${PER_ARTICLE}&q=${encodeURIComponent(q)}&key=${encodeURIComponent(key)}`;
  try {
    const r = await Promise.race([_fetch(u), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))]);
    if (!r || !r.ok) return null;
    const j = await r.json();
    return (j.items || []).map((it) => ({ id: it.id && it.id.videoId, title: it.snippet && it.snippet.title, channel: it.snippet && it.snippet.channelTitle }))
      .filter((v) => VID.test(v.id || '')).slice(0, PER_ARTICLE);
  } catch { return null; }
}

/** Cached videos for an article, or null if we haven't looked yet (or the look is older than 30 days). */
export function cached(slug) {
  const c = load().articles[slug];
  return c && _now() - c.at < TTL ? c.v : null;
}

/** Look the article up (one search, within budget) and cache it. Safe to call without awaiting. */
export async function refresh(slug, title) {
  const m = load();
  if (cached(slug) || m.inflight.has(slug)) return cached(slug);
  if (!(process.env.YOUTUBE_API_KEY || '').trim() || !spend(m)) return null;
  m.inflight.add(slug);
  try {
    const v = await search(queryFor(title));
    if (v) { m.articles[slug] = { at: _now(), v }; }
    save(m);
    return v;
  } finally { m.inflight.delete(slug); }
}

const card = (x) => `<a class=wv-card href="https://www.youtube.com/watch?v=${esc(x.id)}" target=_blank rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/${esc(x.id)}/mqdefault.jpg" alt="" loading=lazy referrerpolicy=no-referrer><span>${esc(x.title || '')}</span><span class=muted>${esc(x.channel || '')}</span></a>`;

/** The Videos section for an article page. Kicks off a background lookup when nothing is cached yet. */
export function videosSection(slug, title) {
  const v = cached(slug);
  if (!v) refresh(slug, title).catch(() => {});
  const q = queryFor(title);
  const first = v && v[0];
  const embed = first ? `<div class=wv-frame><iframe src="https://www.youtube-nocookie.com/embed/${esc(first.id)}" title="${esc(first.title || q)}" loading=lazy allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy=strict-origin-when-cross-origin></iframe></div>` : '';
  const more = v && v.length > 1 ? `<div class=wv-grid>${v.slice(1).map(card).join('')}</div>` : '';
  return `<section class=wv aria-label="Videos"><style>.wv-frame{position:relative;aspect-ratio:16/9;max-width:720px;margin:6px 0 10px}.wv-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}
.wv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}.wv-card{display:flex;flex-direction:column;gap:3px;font-size:13px;text-decoration:none}.wv-card img{width:100%;border-radius:8px}</style>
<h2 id=videos>Videos</h2>${embed}${more}
<p><a href="${esc(ytSearchUrl(q))}" target=_blank rel="noopener noreferrer">${v && v.length ? 'More' : 'Watch'} videos about ${esc(q)} on YouTube ↗</a></p>
<p class=muted>Videos are found by the article's title on YouTube and are not reviewed or endorsed by the Library.</p></section>`;
}

if (process.argv[1] && process.argv[1].endsWith(path.join('wiki', 'videos.mjs')) && process.argv[2] === 'warm') {
  // fill the cache within today's budget: articles with no cached videos, in the order the wiki lists them
  const { listArticles } = await import('./server.mjs');
  const i = process.argv.indexOf('--limit'); const limit = i > 0 ? +process.argv[i + 1] : Infinity;
  let n = 0;
  for (const a of listArticles()) {
    if (n >= limit) break;
    if (cached(a.slug)) continue;
    const v = await refresh(a.slug, a.title);
    if (v === null && load().budget.used >= DAILY()) break;
    n++;
  }
  console.log(`[wiki-videos] looked up ${n} articles; budget used today ${load().budget.used}/${DAILY()}`);
}
