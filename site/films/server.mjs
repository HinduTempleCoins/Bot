// site/films/server.mjs — SoapBox Films: a film database with where-to-watch and audience reviews.
//
// Served at stream.soapbox.community/films (SoapBox Stream delegates /films/* here) and runnable alone.
//   · Catalog: every notable film, not just what we host — the Wikidata dataset built by
//     integrations/films-wikidata.mjs (DATA/films.ndjson), plus a live Wikidata lookup for anything missing
//     (cached to DATA/films-extra.ndjson so its page and reviews keep working).
//   · Where to watch: the streaming-service ids Wikidata records ("listed on" — availability varies by
//     region), our own free copies (Internet Archive titles play on SoapBox Stream), SoapBox originals
//     (Hathor's films, DATA/originals.json), per-region providers from TMDB when TMDB_API_KEY is set, and a
//     JustWatch search link for everything else.
//   · Reviews: 0.5–5 stars + text, one current review per reviewer per film, reviewer identity = a random
//     key made in the visitor's browser, stored server-side only as a salted hash. Append-only JSONL.
//   · Lotus Score: % of ratings at 3.5 stars or more (Lotus ≥ 60%, otherwise Wilted), average stars, count.
//
// House style: ESM, esc() all interpolation, soft-fail, handler(req,res) exported, CLI guarded.
//   PORT=8214 BASE_URL=https://stream.soapbox.community node site/films/server.mjs
//   Env: FILMS_DATA_DIR (default <repo>/data/films), TMDB_API_KEY (optional), FILMS_ADMIN_TOKEN (optional).

import * as horrorTax from '../../integrations/soapbox/horror-taxonomy.mjs';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as wd from '../../integrations/films-wikidata.mjs';
import * as store from './reviews-store.mjs';
import { normalizeKey, isValidKey, KEY_ALPHABET, KEY_LENGTH } from '../hathor-live/participant-key.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8214);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.FILMS_BASE_URL || process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PREFIX = '/films';
// US public domain: works published 95+ years ago. On 1 Jan 2026 works from 1930 entered it.
export const PD_YEAR = new Date().getUTCFullYear() - 96;
const SITE = 'SoapBox Films';

export function dataDir() {
  return process.env.FILMS_DATA_DIR || path.resolve(__dirname, '..', '..', 'data', 'films');
}
const F = {
  catalog: () => path.join(dataDir(), 'films.ndjson'),
  extra: () => path.join(dataDir(), 'films-extra.ndjson'),
  reviews: () => path.join(dataDir(), 'reviews.jsonl'),
  originals: () => path.join(dataDir(), 'originals.json'),
};

// ── injectables ─────────────────────────────────────────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); wd.__setFetch(fn); }
let _now = () => new Date();
export function __setNow(fn) { _now = typeof fn === 'function' ? fn : () => new Date(); }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; }
}

// ── reviewer identity (the Temple Exams key pattern, with this surface's own hash domain) ───────────
const REVIEWER_DOMAIN = 'soapbox/films/reviewer/v1';
export function reviewerId(key) {
  if (!isValidKey(key)) return '';
  try { return createHash('sha256').update(`${REVIEWER_DOMAIN}:${normalizeKey(key)}`).digest('hex').slice(0, 32); } catch { return ''; }
}

// ── catalog ─────────────────────────────────────────────────────────────────────────────────────────
let _cat = null; // { byId, list, genres, stamp, checked }
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function readLines(file) {
  let raw = '';
  try { raw = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && wd.isQid(r.id) && r.t) out.push(r); } catch { /* skip torn line */ }
  }
  return out;
}
function mtime(file) { try { return statSync(file).mtimeMs; } catch { return 0; } }

const bare = (s) => s.replace(/^(the|a|an) /, '');
function indexRecord(r) {
  r._n = norm(r.t);
  r._b = bare(r._n);
  r._p = norm([...(r.d || []), ...(r.c || [])].join(' '));
  return r;
}

export function catalog() {
  const now = Date.now();
  if (_cat && now - _cat.checked < 60000) return _cat;
  const stamp = `${mtime(F.catalog())}:${mtime(F.extra())}`;
  if (_cat && _cat.stamp === stamp) { _cat.checked = now; return _cat; }
  const byId = new Map();
  for (const r of readLines(F.catalog())) byId.set(r.id, indexRecord(r));
  for (const r of readLines(F.extra())) if (!byId.has(r.id)) byId.set(r.id, indexRecord(r));
  const list = [...byId.values()].sort((a, b) => (b.sl || 0) - (a.sl || 0));
  const gc = new Map();
  for (const r of list) for (const g of r.g || []) gc.set(g, (gc.get(g) || 0) + 1);
  const minG = list.length > 5000 ? 20 : 1;
  const genres = [...gc.entries()].filter(([, n]) => n >= minG).sort((a, b) => b[1] - a[1]).map(([g, n]) => ({ name: g, slug: wd.slug(g), n }));
  _cat = { byId, list, genres, stamp, checked: now };
  return _cat;
}
export function __resetCatalog() { _free = null; _archIdx = null; _cat = null; _searchCache.clear(); _tmdbCache.clear(); _rate.clear(); _origCache = null; }

function remember(recs) {
  const cat = catalog();
  const fresh = recs.filter((r) => r && r.film !== false && wd.isQid(r.id) && !cat.byId.has(r.id));
  if (!fresh.length) return;
  try {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(F.extra(), fresh.map((r) => { const x = { ...r }; delete x.film; return JSON.stringify(x); }).join('\n') + '\n');
  } catch { /* the page still works from memory */ }
  for (const r of fresh) { delete r.film; cat.byId.set(r.id, indexRecord(r)); cat.list.push(r); }
}

/** Local search: every query word in the title (best), else in title + people. Ranked, then by fame. */
// A trailing year ("Martyrs 2008") picks between same-titled films: it is not a word to match, it ranks the film
// from that year (±1, for festival vs release dates) above the others.
export function splitYear(q) {
  const m = /^(.*\S)\s+\(?((?:18|19|20)\d\d)\)?$/.exec(String(q || '').trim());
  if (!m || +m[2] > new Date().getUTCFullYear() + 1) return { q: String(q || ''), year: 0 }; // "Blade Runner 2049"
  return { q: m[1], year: +m[2] };
}

export function searchLocal(q0, { limit = 40 } = {}) {
  let { q, year } = splitYear(q0);
  if (year && catalog().list.some((r) => r._b === bare(norm(q0)))) { q = q0; year = 0; } // a title that ends in a year
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const phrase = bare(words.join(' '));
  const hits = [];
  for (const r of catalog().list) {
    let rank = 0;
    if (r._b === phrase) rank = 4;
    else if (r._b.startsWith(phrase)) rank = 3;
    else if (words.every((w) => r._n.includes(w))) rank = 2;
    else if (words.every((w) => r._n.includes(w) || r._p.includes(w))) rank = 1;
    if (rank) hits.push([rank, r]);
  }
  const yr = (r) => (year && r.y && Math.abs(r.y - year) <= 1 ? 1 : 0);
  hits.sort((a, b) => yr(b[1]) - yr(a[1]) || b[0] - a[0] || (b[1].sl || 0) - (a[1].sl || 0));
  return hits.slice(0, limit).map((h) => h[1]);
}

const _searchCache = new Map();
/** Local results, topped up from live Wikidata when the local set is thin. Never throws. */
export async function search(q, { limit = 40, ip = '' } = {}) {
  const local = searchLocal(q, { limit });
  if (local.length >= 8 || norm(q).length < 2) return local;
  const key = norm(q);
  let live = _searchCache.get(key);
  if (!live) {
    if (!allow(`live:${ip}`, 30, 60000)) return local;
    live = await wd.searchFilms(splitYear(q).q, { limit: 10 }).catch(() => []);
    if (_searchCache.size > 500) _searchCache.clear();
    _searchCache.set(key, live);
    remember(live);
  }
  const seen = new Set(local.map((r) => r.id));
  return [...local, ...live.filter((r) => !seen.has(r.id)).map((r) => catalog().byId.get(r.id) || r)].slice(0, limit);
}

/** A film by QID: local first, else live (and remembered). */
export async function getFilm(id) {
  if (!wd.isQid(id)) return null;
  const c = catalog().byId.get(id);
  if (c) return c;
  const recs = await wd.fetchFilms([id]).catch(() => []);
  const r = recs.find((x) => x.id === id && x.film);
  if (!r) return null;
  remember([r]);
  return catalog().byId.get(id) || r;
}

// ── SoapBox originals (Hathor's films) ──────────────────────────────────────────────────────────────
let _origCache = null;
export function originals() {
  const m = mtime(F.originals());
  if (_origCache && _origCache.m === m) return _origCache.list;
  let list = [];
  try {
    const j = JSON.parse(readFileSync(F.originals(), 'utf8'));
    list = (Array.isArray(j) ? j : []).filter((o) => o && /^[a-z0-9-]{1,60}$/.test(String(o.slug || '')) && o.title)
      .map((o) => ({ ...o, id: `o-${o.slug}` }));
  } catch { list = []; }
  _origCache = { m, list };
  return list;
}
const originalBySlug = (slug) => originals().find((o) => o.slug === slug) || null;
const isOriginalId = (id) => /^o-[a-z0-9-]{1,60}$/.test(String(id || ''));

function titleFor(id) {
  if (isOriginalId(id)) { const o = originalBySlug(id.slice(2)); return o ? { t: o.title, y: o.year || 0, href: `${PREFIX}/o/${o.slug}` } : null; }
  const r = catalog().byId.get(id);
  return r ? { t: r.t, y: r.y, href: `${PREFIX}/${r.id}` } : null;
}

// ── where to watch ──────────────────────────────────────────────────────────────────────────────────
// ── the Stream bridge ─────────────────────────────────────────────────────────────────────────────
// SoapBox Stream plays only curated, license-cleared public-domain copies (horror-taxonomy's PD list is the
// curated set). A film here gets "Watch free on SoapBox Stream" when the Stream holds a cleared copy of it —
// matched by its Internet Archive id, or by title + year — and a Stream player page shows this film's score
// and a review link (filmForStream). Watch ⇄ review, both ways.
let _free = null;
function freeCopies() {
  if (_free) return _free;
  const byIa = new Map(); const byTitle = new Map();
  for (const f of horrorTax.PD_HORROR_FILMS || []) {
    byIa.set(String(f.id), f);
    const k = bare(norm(f.title));
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(f);
  }
  _free = { byIa, byTitle };
  return _free;
}
/** The Stream's cleared free copy of a film record, or null. */
export function freeCopyFor(r) {
  if (!r) return null;
  const F = freeCopies();
  if (r.w && r.w.archive && F.byIa.has(r.w.archive)) return F.byIa.get(r.w.archive);
  const cands = F.byTitle.get(bare(norm(r.t))) || [];
  return cands.find((f) => r.y && f.year && Math.abs(+f.year - +r.y) <= 1) || null;
}
let _archIdx = null;
/** The film record for a Stream item ({ ia, title, year }), with its review stats. Never throws. */
export function filmForStream({ ia = '', title = '', year = '' } = {}) {
  try {
    const cat = catalog();
    if (!_archIdx || _archIdx.stamp !== cat.stamp) {
      const m = new Map();
      for (const r of cat.list) if (r.w && r.w.archive) m.set(r.w.archive, r.id);
      _archIdx = { stamp: cat.stamp, m };
    }
    let r = ia && _archIdx.m.has(ia) ? cat.byId.get(_archIdx.m.get(ia)) : null;
    if (!r && ia) { const f = freeCopies().byIa.get(ia); if (f) { title = f.title; year = f.year; } } // IA titles are long; ours are clean
    if (!r && title) {
      const want = bare(norm(title));
      r = searchLocal(`${title}${year ? ` ${year}` : ''}`, { limit: 5 }).find((x) => bare(norm(x.t)) === want && (!year || !x.y || Math.abs(+x.y - +year) <= 1)) || null;
    }
    if (!r) return null;
    const stats = statsMap().get(r.id) || null;
    return { id: r.id, t: r.t, y: r.y || '', href: `${PREFIX}/${r.id}`, reviewHref: `${PREFIX}/${r.id}#review`, stats, badge: scoreBadge(stats) };
  } catch { return null; }
}

export function watchLinks(r) {
  const listed = [];
  const seenNames = new Set();
  for (const s of wd.SERVICES) {
    const id = r && r.w && r.w[s.key];
    if (!id || seenNames.has(s.name)) continue;
    const href = safeHref(wd.linkFor(s.url, id));
    if (href) { listed.push({ key: s.key, name: s.name, href }); seenNames.add(s.name); }
  }
  const ours = [];
  // Only offer "play free here" when the film is old enough to be public domain in the US (published by
  // PD_YEAR). Newer Internet Archive uploads are often not licensed, so they are listed, never played.
  const cleared = freeCopyFor(r);
  if (cleared) ours.push({ name: 'Watch free on SoapBox Stream', href: `/watch?src=ia&id=${encodeURIComponent(cleared.id)}`, note: 'Public domain — a copy curated and cleared on SoapBox Stream' });
  else if (r && r.w && r.w.archive && r.y && r.y <= PD_YEAR) ours.push({ name: 'Watch free on SoapBox Stream', href: `/watch?src=ia&id=${encodeURIComponent(r.w.archive)}`, note: `Public domain in the US (published ${r.y}) — Internet Archive copy` });
  const refs = [];
  for (const s of wd.REFS) {
    const id = r && r.r && r.r[s.key];
    const href = id ? safeHref(wd.linkFor(s.url, id)) : '';
    if (href) refs.push({ key: s.key, name: s.name, href });
  }
  if (r && r.wiki) refs.push({ key: 'wikipedia', name: 'Wikipedia', href: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.wiki.replace(/ /g, '_'))}` });
  if (r && r.id) refs.push({ key: 'wikidata', name: 'Wikidata', href: `https://www.wikidata.org/wiki/${r.id}` });
  const justwatch = `https://www.justwatch.com/us/search?q=${encodeURIComponent(r ? r.t : '')}`;
  return { ours, listed, refs, justwatch };
}

// TMDB watch providers (JustWatch data). Only with a key; cached 12h; soft-fail to null.
const _tmdbCache = new Map();
export async function tmdbProviders(tmdbId, region = 'US') {
  const key = process.env.TMDB_API_KEY;
  if (!key || !/^\d{1,9}$/.test(String(tmdbId || ''))) return null;
  const reg = /^[A-Z]{2}$/.test(region) ? region : 'US';
  const ck = `${tmdbId}:${reg}`;
  const hit = _tmdbCache.get(ck);
  if (hit && Date.now() - hit.at < 12 * 3600e3) return hit.v;
  let v = null;
  try {
    const res = await _fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${encodeURIComponent(key)}`);
    if (res && res.ok) {
      const j = await res.json();
      const r = j && j.results && j.results[reg];
      if (r) {
        const names = (arr) => (Array.isArray(arr) ? arr : []).map((p) => p && p.provider_name).filter(Boolean).slice(0, 12);
        v = { region: reg, link: safeHref(r.link || ''), stream: names(r.flatrate), free: [...names(r.free), ...names(r.ads)], rent: names(r.rent), buy: names(r.buy) };
      } else v = { region: reg, link: '', stream: [], free: [], rent: [], buy: [] };
    }
  } catch { v = null; }
  if (_tmdbCache.size > 2000) _tmdbCache.clear();
  _tmdbCache.set(ck, { at: Date.now(), v });
  return v;
}

// ── reviews ─────────────────────────────────────────────────────────────────────────────────────────
export const LIMITS = { text: 4000, title: 120, name: 40, reason: 300 };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, n);

const _rate = new Map();
function allow(bucket, max, windowMs) {
  const now = Date.now();
  const arr = (_rate.get(bucket) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { _rate.set(bucket, arr); return false; }
  arr.push(now);
  _rate.set(bucket, arr);
  if (_rate.size > 20000) _rate.clear();
  return true;
}

function publishedReviews() { return store.readPublished(F.reviews()); }

/** Public view of a review: never the reviewer hash. */
function publicReview(r) {
  const ft = titleFor(r.film);
  return { id: r.id, film: r.film, filmTitle: ft ? ft.t : '', stars: r.stars, title: r.title || '', text: r.text || '', name: r.name || 'Anonymous viewer', at: r.at };
}

export async function submitReview(body, ip) {
  const key = normalizeKey(body && body.key);
  const rid = reviewerId(key);
  if (!rid) return { status: 400, error: 'Missing or invalid reviewer key.' };
  const film = String((body && body.film) || '');
  if (isOriginalId(film)) { if (!originalBySlug(film.slice(2))) return { status: 404, error: 'Unknown film.' }; }
  else if (!(await getFilm(film))) return { status: 404, error: 'Unknown film.' };
  const stars = Math.round(+(body && body.stars) * 2) / 2;
  if (!(stars >= 0.5 && stars <= 5)) return { status: 400, error: 'Rating must be between 0.5 and 5 stars.' };
  const text = clean(body.text, LIMITS.text);
  const title = clean(body.title, LIMITS.title);
  const name = clean(body.name, LIMITS.name).replace(/[<>]/g, '');
  if (!allow(`rev:${ip}`, 6, 10 * 60000) || !allow(`revk:${rid}`, 6, 10 * 60000)) return { status: 429, error: 'Too many reviews at once — try again in a few minutes.' };
  const rec = { kind: 'review', id: randomBytes(6).toString('hex'), film, rid, stars, title, text, name, at: _now().toISOString() };
  if (!store.append(F.reviews(), rec)) return { status: 503, error: 'Could not save the review right now.' };
  return { status: 200, review: publicReview(rec) };
}

export function deleteReview(body) {
  const rid = reviewerId(body && body.key);
  const id = String((body && body.id) || '');
  if (!rid || !/^[a-f0-9]{12}$/.test(id)) return { status: 400, error: 'Bad request.' };
  const r = store.readAll(F.reviews()).find((x) => x.id === id);
  if (!r || r.rid !== rid) return { status: 403, error: 'Only the reviewer who wrote it can delete it.' };
  store.append(F.reviews(), { kind: 'delete', id, rid, at: _now().toISOString() });
  return { status: 200, ok: true };
}

export function reportReview(body, ip) {
  const id = String((body && body.id) || '');
  if (!/^[a-f0-9]{12}$/.test(id)) return { status: 400, error: 'Bad request.' };
  if (!allow(`rep:${ip}`, 20, 3600e3)) return { status: 429, error: 'Too many reports.' };
  // Reporters without a key are counted per IP, so one person cannot hide a review alone.
  const rid = reviewerId(body && body.key) || `ip:${createHash('sha256').update(`${REVIEWER_DOMAIN}:ip:${ip}`).digest('hex').slice(0, 24)}`;
  store.append(F.reviews(), { kind: 'report', id, rid, reason: clean(body && body.reason, LIMITS.reason), at: _now().toISOString() });
  return { status: 200, ok: true };
}

export function myReviewIds(body) {
  const rid = reviewerId(body && body.key);
  if (!rid) return { status: 200, ids: [] };
  return { status: 200, ids: store.readAll(F.reviews()).filter((r) => r.rid === rid && r.status === 'published').map((r) => r.id) };
}

export function moderate(body, token) {
  const want = process.env.FILMS_ADMIN_TOKEN;
  if (!want || !token || token !== want) return { status: 403, error: 'Forbidden.' };
  const id = String((body && body.id) || '');
  const status = String((body && body.status) || '');
  if (!/^[a-f0-9]{12}$/.test(id) || !['published', 'hidden', 'removed'].includes(status)) return { status: 400, error: 'Bad request.' };
  store.append(F.reviews(), { kind: 'moderate', id, status, at: _now().toISOString() });
  return { status: 200, ok: true };
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
:root{--bg:#0a0d12;--card:#121822;--bd:#223044;--fg:#e8edf4;--mut:#9aa8bb;--acc:#e0b04a;--lotus:#e87fb4;--wilt:#8f8f6a;--link:#7fc4ff}
@media (prefers-color-scheme: light){:root:not([data-theme=dark]){--bg:#f6f7f9;--card:#fff;--bd:#d9dee6;--fg:#141a22;--mut:#5a6677;--acc:#a8740f;--link:#0b62b8}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
header{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--bd)}
.brand{font-size:19px;color:var(--fg)}.brand b{color:var(--acc)}
header form{flex:1;display:flex;gap:6px;min-width:220px}header input{flex:1;padding:9px 12px;border-radius:10px;border:1px solid var(--bd);background:var(--card);color:var(--fg)}
button,.btn{font:inherit;font-weight:600;border-radius:10px;border:1px solid var(--bd);background:var(--card);color:var(--fg);padding:8px 14px;cursor:pointer;display:inline-block}
button.pri{background:var(--acc);color:#111;border-color:var(--acc)}
nav.sub{display:flex;gap:14px;flex-wrap:wrap;padding:8px 16px;border-bottom:1px solid var(--bd);font-size:14px}
.wrap{max-width:1180px;margin:0 auto;padding:16px}
h1{font-size:26px;margin:4px 0 8px}h2{font-size:19px;margin:26px 0 10px}
.lead{color:var(--mut);max-width:760px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.card .pic{aspect-ratio:2/3;background:#1b2330;display:flex;align-items:center;justify-content:center;color:var(--mut);font-size:30px;overflow:hidden}
.card .pic img{width:100%;height:100%;object-fit:cover}
.card .b{padding:8px 10px;font-size:13px}.card .b b{display:block;font-size:14px;color:var(--fg)}
.meta{color:var(--mut);font-size:13px}
.score{display:inline-flex;gap:6px;align-items:center;font-weight:700;font-size:13px}
.score.lotus{color:var(--lotus)}.score.wilted{color:var(--wilt)}
.film{display:grid;grid-template-columns:240px 1fr;gap:22px}@media(max-width:700px){.film{grid-template-columns:1fr}.film .poster{max-width:220px}}
.poster{border-radius:12px;overflow:hidden;background:#1b2330;aspect-ratio:2/3;display:flex;align-items:center;justify-content:center;font-size:40px;color:var(--mut)}
.poster img{width:100%;height:100%;object-fit:cover}
.box{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:12px 14px;margin:12px 0}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{border:1px solid var(--bd);border-radius:999px;padding:5px 12px;font-size:13px;background:var(--bg)}
.chip.ours{border-color:var(--acc);color:var(--acc);font-weight:700}
.big{font-size:34px;font-weight:800}.scores{display:flex;gap:26px;flex-wrap:wrap;align-items:flex-end}
.rev{border-top:1px solid var(--bd);padding:12px 0}.rev .h{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}
.stars{color:var(--acc);letter-spacing:1px}.rev p{white-space:pre-wrap;margin:6px 0}
.rev .act{font-size:12px;color:var(--mut)}.rev .act button{padding:2px 8px;font-size:12px;font-weight:500}
form.review label{display:block;margin:8px 0 4px;font-size:13px;color:var(--mut)}
form.review input,form.review textarea,form.review select{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--bd);background:var(--bg);color:var(--fg);font:inherit}
form.review textarea{min-height:120px}
.note{font-size:12px;color:var(--mut)}.tags a{margin-right:8px}
.pager{display:flex;gap:10px;margin:18px 0}
footer{color:var(--mut);font-size:12px;padding:24px 16px;border-top:1px solid var(--bd);margin-top:30px}
.video{width:100%;max-width:960px;border-radius:12px;background:#000}
</style>`;

function shell(title, inner, { canonical = '', description = '' } = {}) {
  const desc = description || 'SoapBox Films — find where to watch any film, read and write audience reviews, and see the Lotus Score.';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name=description content="${esc(desc)}">
${canonical ? `<link rel=canonical href="${esc(BASE_URL + canonical)}">` : ''}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:site_name" content="${esc(SITE)}">
${STYLE}</head><body>
<header><a class=brand href="${PREFIX}"><b>SoapBox</b> Films</a>
<form action="${PREFIX}/search" method=get role=search><input name=q placeholder="Search any film, director or actor…" aria-label="Search films"><button>Search</button></form></header>
<nav class=sub><a href="${PREFIX}">Films</a><a href="${PREFIX}/top">Top rated</a><a href="${PREFIX}/reviews">Latest reviews</a><a href="${PREFIX}/genres">Genres</a><a href="${PREFIX}/decades">Decades</a><a href="${PREFIX}/originals">SoapBox originals</a><a href="/">▶ SoapBox Stream</a></nav>
<main class=wrap>${inner}</main>
<footer>Film data: Wikidata (CC0). "Listed on" means Wikidata records the title on that service; availability varies by region and changes over time — check the service. ${process.env.TMDB_API_KEY ? 'Per-region availability: JustWatch via TMDB. ' : ''}Reviews are written by SoapBox visitors. Reviewer keys are made in your browser; we store only a one-way hash of them.</footer>
</body></html>`;
}

const starStr = (s) => { const full = Math.floor(s); const half = s - full >= 0.5; return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0)); };

function scoreBadge(a) {
  if (!a) return '<span class=meta>No reviews yet</span>';
  const icon = a.verdict === 'lotus' ? '🪷' : '🥀';
  return `<span class="score ${a.verdict}" title="Lotus Score: share of ratings at 3.5★ or more">${icon} ${a.score}%</span> <span class=meta>★ ${a.avg} · ${a.count} review${a.count === 1 ? '' : 's'}</span>`;
}

function posterImg(r, width = 300) {
  const f = r && (r.poster || r.img);
  return f ? `<img src="${esc(wd.commonsThumb(f, width))}" alt="" loading=lazy referrerpolicy=no-referrer>` : '🎬';
}

function card(r, stats) {
  const a = stats && stats.get(r.id);
  const meta = [r.y || '', (r.d || [])[0] || ''].filter(Boolean).join(' · ');
  return `<a class=card href="${PREFIX}/${esc(r.id)}"><div class=pic>${posterImg(r)}</div><div class=b><b>${esc(r.t)}</b><span class=meta>${esc(meta)}</span><br>${a ? scoreBadge(a) : ''}</div></a>`;
}

function originalCard(o, stats) {
  const a = stats && stats.get(o.id);
  const img = safeHref(o.poster || '');
  return `<a class=card href="${PREFIX}/o/${esc(o.slug)}"><div class=pic>${img ? `<img src="${esc(img)}" alt="" loading=lazy>` : '🪷'}</div><div class=b><b>${esc(o.title)}</b><span class=meta>${esc(o.by || 'Hathor')}${o.year ? ` · ${esc(o.year)}` : ''}</span><br>${a ? scoreBadge(a) : ''}</div></a>`;
}

function reviewHtml(r, { showFilm = false } = {}) {
  const ft = showFilm ? titleFor(r.film) : null;
  return `<article class=rev data-id="${esc(r.id)}"><div class=h><span class=stars aria-label="${esc(r.stars)} of 5 stars">${starStr(r.stars)}</span>
${r.title ? `<b>${esc(r.title)}</b>` : ''}${ft ? ` <span class=meta>on <a href="${esc(ft.href)}">${esc(ft.t)}${ft.y ? ` (${esc(ft.y)})` : ''}</a></span>` : ''}</div>
${r.text ? `<p>${esc(r.text)}</p>` : ''}<div class=act>${esc(r.name || 'Anonymous viewer')} · ${esc(String(r.at).slice(0, 10))}
<button type=button class=report data-id="${esc(r.id)}">Report</button><button type=button class=del data-id="${esc(r.id)}" hidden>Delete my review</button></div></article>`;
}

// Browser side: the reviewer key (made here, never sent on its own), submit, report, delete.
const CLIENT_JS = `<script>
var A=${JSON.stringify(KEY_ALPHABET)},L=${KEY_LENGTH},S='soapbox.films.reviewer';
function nk(s){return String(s||'').toUpperCase().replace(/O/g,'0').replace(/[IL]/g,'1').replace(/U/g,'V').split('').filter(function(c){return A.indexOf(c)>=0}).join('')}
function gen(){var b=new Uint8Array(L),o='';crypto.getRandomValues(b);for(var i=0;i<L;i++)o+=A[b[i]%32];return o}
function key(){var k='';try{k=nk(localStorage.getItem(S))}catch(e){}if(k.length!==L){k=gen();try{localStorage.setItem(S,k)}catch(e){}}return k}
function fmt(k){return (k.match(/.{1,5}/g)||[]).join('-')}
function post(u,b){return fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){j._s=r.status;return j})})}
document.addEventListener('DOMContentLoaded',function(){
  var kEl=document.getElementById('mykey');if(kEl)kEl.textContent=fmt(key());
  var chg=document.getElementById('setkey');if(chg)chg.onclick=function(){var v=prompt('Paste your reviewer key (from another device):');if(!v)return;v=nk(v);if(v.length!==L){alert('That is not a valid key.');return}try{localStorage.setItem(S,v)}catch(e){}location.reload()};
  var f=document.querySelector('form.review');
  if(f)f.onsubmit=function(e){e.preventDefault();var m=document.getElementById('msg');m.textContent='Saving…';
    post('${PREFIX}/api/review',{film:f.film.value,stars:f.stars.value,title:f.title.value,text:f.text.value,name:f.name.value,key:key()}).then(function(j){
      if(j._s===200){m.textContent='Saved. Thank you!';setTimeout(function(){location.reload()},600)}else m.textContent=j.error||'Could not save.'}).catch(function(){m.textContent='Network error.'})};
  document.querySelectorAll('button.report').forEach(function(b){b.onclick=function(){var why=prompt('Why are you reporting this review? (optional)');if(why===null)return;
    post('${PREFIX}/api/report',{id:b.dataset.id,reason:why,key:key()}).then(function(){b.textContent='Reported';b.disabled=true})}});
  var ids=[].map.call(document.querySelectorAll('article.rev'),function(a){return a.dataset.id});
  if(ids.length)post('${PREFIX}/api/mine',{key:key()}).then(function(j){(j.ids||[]).forEach(function(id){var b=document.querySelector('button.del[data-id="'+id+'"]');if(b){b.hidden=false;b.onclick=function(){if(!confirm('Delete your review?'))return;
    post('${PREFIX}/api/delete',{id:id,key:key()}).then(function(){location.reload()})}}})});
});
</script>`;

function reviewForm(filmId, filmTitle) {
  const opts = [];
  for (let s = 5; s >= 0.5; s -= 0.5) opts.push(`<option value="${s}"${s === 4 ? ' selected' : ''}>${starStr(s)} ${s}</option>`);
  return `<div class=box id=review><h2 style="margin-top:0">Your review of ${esc(filmTitle)}</h2>
<form class=review><input type=hidden name=film value="${esc(filmId)}">
<label>Rating</label><select name=stars>${opts.join('')}</select>
<label>Headline (optional)</label><input name=title maxlength=${LIMITS.title}>
<label>Your review (optional)</label><textarea name=text maxlength=${LIMITS.text} placeholder="What worked, what didn't, who should watch it…"></textarea>
<label>Display name (optional)</label><input name=name maxlength=${LIMITS.name} placeholder="Anonymous viewer">
<p><button class=pri>Post review</button> <span id=msg class=note></span></p>
<p class=note>Your reviewer key: <code id=mykey></code> — made in this browser, never sent on its own. Write it down to edit or delete your reviews from another device. <button type=button id=setkey>Use a key from another device</button></p>
</form></div>`;
}

function statsMap() { return store.aggregate(publishedReviews()); }

function homePage() {
  const cat = catalog();
  const revs = publishedReviews();
  const stats = store.aggregate(revs);
  const byScore = [...stats.values()].filter((a) => titleFor(a.film)).sort((a, b) => b.score - a.score || b.avg - a.avg || b.count - a.count).slice(0, 12);
  const byCount = [...stats.values()].filter((a) => titleFor(a.film)).sort((a, b) => b.count - a.count || b.avg - a.avg).slice(0, 12);
  const cardFor = (id) => (isOriginalId(id) ? (originalBySlug(id.slice(2)) ? originalCard(originalBySlug(id.slice(2)), stats) : '') : (cat.byId.get(id) ? card(cat.byId.get(id), stats) : ''));
  const orig = originals();
  const popular = cat.list.slice(0, 24);
  const free = [];
  for (const f of horrorTax.PD_HORROR_FILMS || []) {
    const m = filmForStream({ ia: f.id, title: f.title, year: f.year });
    if (m && cat.byId.get(m.id) && !free.some((x) => x.id === m.id)) free.push(cat.byId.get(m.id));
    if (free.length >= 18) break;
  }
  const inner = `<h1>Every film. Where to watch it. What people really thought.</h1>
<p class=lead>${cat.list.length.toLocaleString('en-US')} films from Wikidata, with the streaming services each one is listed on, free copies we can play for you, and reviews from SoapBox viewers. Search any title — if it's not in our set yet, we look it up live.</p>
${free.length ? `<h2>Free on SoapBox Stream <span class=meta style="font-size:13px">· public domain, watch then review</span></h2><div class=grid>${free.map((r) => card(r, stats)).join('')}</div>` : ''}
${orig.length ? `<h2>SoapBox originals</h2><div class=grid>${orig.slice(0, 12).map((o) => originalCard(o, stats)).join('')}</div>` : ''}
${byScore.length ? `<h2>Top rated by viewers</h2><div class=grid>${byScore.map((a) => cardFor(a.film)).join('')}</div>` : ''}
${byCount.length ? `<h2>Most reviewed</h2><div class=grid>${byCount.map((a) => cardFor(a.film)).join('')}</div>` : ''}
<h2>Latest reviews</h2>${revs.length ? revs.slice(0, 6).map((r) => reviewHtml(r, { showFilm: true })).join('') + `<p><a href="${PREFIX}/reviews">All reviews →</a></p>` : '<p class=meta>No reviews yet — open any film and be the first.</p>'}
<h2>Most talked-about films</h2><div class=grid>${popular.map((r) => card(r, stats)).join('')}</div>
<h2>Browse by genre</h2><p class=tags>${cat.genres.slice(0, 30).map((g) => `<a href="${PREFIX}/genre/${esc(g.slug)}">${esc(g.name)}</a>`).join(' ')} <a href="${PREFIX}/genres">all genres →</a></p>
<h2>Browse by decade</h2><p class=tags>${decades().map((d) => `<a href="${PREFIX}/decade/${d}s">${d}s</a>`).join(' ')}</p>
${CLIENT_JS}`;
  return shell(`${SITE} — where to watch any film, and audience reviews`, inner, { canonical: PREFIX });
}

function decades() {
  const set = new Set();
  for (const r of catalog().list) if (r.y) set.add(Math.floor(r.y / 10) * 10);
  return [...set].sort((a, b) => b - a);
}

function listPage(title, films, { page = 1, base = '', lead = '' } = {}) {
  const per = 60;
  const stats = statsMap();
  const slice = films.slice((page - 1) * per, page * per);
  const pager = `<div class=pager>${page > 1 ? `<a class=btn href="${esc(base)}?page=${page - 1}">← Previous</a>` : ''}${films.length > page * per ? `<a class=btn href="${esc(base)}?page=${page + 1}">Next →</a>` : ''}</div>`;
  const inner = `<h1>${esc(title)}</h1>${lead ? `<p class=lead>${esc(lead)}</p>` : ''}<p class=meta>${films.length.toLocaleString('en-US')} films</p>
<div class=grid>${slice.map((r) => card(r, stats)).join('')}</div>${pager}`;
  return shell(`${title} · ${SITE}`, inner, { canonical: base });
}

async function filmPage(r, region) {
  const stats = statsMap();
  const a = stats.get(r.id);
  const links = watchLinks(r);
  const tmdb = r.r && r.r.tmdb ? await tmdbProviders(r.r.tmdb, region) : null;
  const revs = publishedReviews().filter((x) => x.film === r.id);
  const row = (label, arr) => (arr && arr.length ? `<p><b>${esc(label)}:</b> ${arr.map((n) => `<span class=chip>${esc(n)}</span>`).join(' ')}</p>` : '');
  const tmdbBox = tmdb ? `<div class=box><b>Available in ${esc(tmdb.region)} right now</b> <span class=note>(JustWatch via TMDB)</span>
${row('Stream', tmdb.stream)}${row('Free', tmdb.free)}${row('Rent', tmdb.rent)}${row('Buy', tmdb.buy)}
${!tmdb.stream.length && !tmdb.free.length && !tmdb.rent.length && !tmdb.buy.length ? '<p class=meta>No providers listed for this region.</p>' : ''}
${tmdb.link ? `<p><a href="${esc(tmdb.link)}" target=_blank rel="noopener noreferrer">All options for ${esc(tmdb.region)} ↗</a></p>` : ''}
<form method=get class=note>Region: <input name=region value="${esc(tmdb.region)}" size=3 maxlength=2 style="width:4em"> <button>Change</button></form></div>` : '';
  const facts = [
    r.d && r.d.length ? `<p><b>Directed by</b> ${r.d.map((n) => `<a href="${PREFIX}/search?q=${encodeURIComponent(n)}">${esc(n)}</a>`).join(', ')}</p>` : '',
    r.c && r.c.length ? `<p><b>Starring</b> ${r.c.map((n) => `<a href="${PREFIX}/search?q=${encodeURIComponent(n)}">${esc(n)}</a>`).join(', ')}</p>` : '',
    r.g && r.g.length ? `<p><b>Genre</b> ${r.g.map((g) => `<a href="${PREFIX}/genre/${esc(wd.slug(g))}">${esc(g)}</a>`).join(', ')}</p>` : '',
    r.co && r.co.length ? `<p><b>Country</b> ${esc(r.co.join(', '))}</p>` : '',
    r.rt ? `<p><b>Runtime</b> ${esc(r.rt)} min</p>` : '',
  ].join('');
  const inner = `<div class=film><div class=poster>${posterImg(r, 480)}</div><div>
<h1>${esc(r.t)}${r.y ? ` <span class=meta>(${esc(r.y)})</span>` : ''}</h1>${r.desc ? `<p class=lead>${esc(r.desc)}</p>` : ''}
<div class="box scores"><div><div class=big>${a ? `${a.verdict === 'lotus' ? '🪷' : '🥀'} ${a.score}%` : '—'}</div><div class=note>Lotus Score${a && a.few ? ' · few ratings yet' : ''}</div></div>
<div><div class=big>${a ? `★ ${a.avg}` : '—'}</div><div class=note>${a ? `${a.count} review${a.count === 1 ? '' : 's'}` : 'No reviews yet'}</div></div></div>
${facts}
<h2>Where to watch</h2>
${links.ours.length ? `<p class=chips>${links.ours.map((l) => `<a class="chip ours" href="${esc(l.href)}" title="${esc(l.note)}">▶ ${esc(l.name)}</a>`).join('')}</p>` : ''}
${tmdbBox}
${links.listed.length ? `<p><b>Listed on</b> <span class=note>(availability varies by region)</span></p><p class=chips>${links.listed.map((l) => `<a class=chip href="${esc(l.href)}" target=_blank rel="noopener noreferrer">${esc(l.name)} ↗</a>`).join('')}</p>` : '<p class=meta>No streaming listings recorded for this film yet.</p>'}
<p><a href="${esc(links.justwatch)}" target=_blank rel="noopener noreferrer">Search every service on JustWatch ↗</a></p>
${links.refs.length ? `<p class=note>Elsewhere: ${links.refs.map((l) => `<a href="${esc(l.href)}" target=_blank rel="noopener noreferrer">${esc(l.name)}</a>`).join(' · ')}</p>` : ''}
</div></div>
${reviewForm(r.id, r.t)}
<h2>Reviews</h2>${revs.length ? revs.map((x) => reviewHtml(x)).join('') : '<p class=meta>No reviews yet — be the first.</p>'}
${CLIENT_JS}`;
  return shell(`${r.t}${r.y ? ` (${r.y})` : ''} — where to watch & reviews · ${SITE}`, inner, {
    canonical: `${PREFIX}/${r.id}`,
    description: `Where to watch ${r.t}${r.y ? ` (${r.y})` : ''}${r.d && r.d.length ? `, directed by ${r.d[0]}` : ''} — streaming listings, free copies and audience reviews.`,
  });
}

function originalPage(o) {
  const stats = statsMap();
  const a = stats.get(o.id);
  const revs = publishedReviews().filter((x) => x.film === o.id);
  const video = safeHref(o.video || '');
  const inner = `<h1>${esc(o.title)}${o.year ? ` <span class=meta>(${esc(o.year)})</span>` : ''}</h1>
<p class=meta>A SoapBox original · by ${esc(o.by || 'Hathor')}</p>${o.desc ? `<p class=lead>${esc(o.desc)}</p>` : ''}
${video ? `<video class=video controls preload=metadata src="${esc(video)}"${safeHref(o.poster || '') ? ` poster="${esc(safeHref(o.poster))}"` : ''}></video>` : '<p class=meta>Video coming soon.</p>'}
<div class="box scores"><div><div class=big>${a ? `${a.verdict === 'lotus' ? '🪷' : '🥀'} ${a.score}%` : '—'}</div><div class=note>Lotus Score</div></div><div><div class=big>${a ? `★ ${a.avg}` : '—'}</div><div class=note>${a ? `${a.count} reviews` : 'No reviews yet'}</div></div></div>
${reviewForm(o.id, o.title)}<h2>Reviews</h2>${revs.length ? revs.map((x) => reviewHtml(x)).join('') : '<p class=meta>No reviews yet — be the first.</p>'}${CLIENT_JS}`;
  return shell(`${o.title} · SoapBox original · ${SITE}`, inner, { canonical: `${PREFIX}/o/${o.slug}` });
}

// ── http ────────────────────────────────────────────────────────────────────────────────────────────
function send(res, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'cache-control': 'no-store' });

function clientIp(req) {
  const xf = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function readBody(req, max = 16384) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    try {
      req.on('data', (c) => { size += c.length; if (size > max) { resolve(null); try { req.destroy(); } catch { /* noop */ } } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

function filmJson(r) {
  const x = { ...r }; delete x._n; delete x._b; delete x._p; delete x.film;
  return x;
}

/**
 * Handles /films/* (or /* when run standalone — the prefix is optional). Returns true when it answered.
 */
export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://films.local');
    let p = url.pathname.replace(/\/+$/, '') || '/';
    if (p === PREFIX) p = '/';
    else if (p.startsWith(PREFIX + '/')) p = p.slice(PREFIX.length);
    const ip = clientIp(req);
    const method = String(req.method || 'GET').toUpperCase();

    if (p === '/health') return json(res, 200, { ok: true, surface: 'films', films: catalog().list.length, originals: originals().length });

    // ── API ──
    if (p.startsWith('/api/')) {
      if (method === 'POST') {
        const body = await readBody(req);
        if (!body) return json(res, 400, { error: 'Bad JSON.' });
        let out;
        if (p === '/api/review') out = await submitReview(body, ip);
        else if (p === '/api/delete') out = deleteReview(body);
        else if (p === '/api/report') out = reportReview(body, ip);
        else if (p === '/api/mine') out = myReviewIds(body);
        else if (p === '/api/moderate') out = moderate(body, String((req.headers && req.headers['x-admin-token']) || ''));
        else out = { status: 404, error: 'Not found.' };
        const { status, ...rest } = out;
        return json(res, status, rest);
      }
      if (p === '/api/search') {
        const q = String(url.searchParams.get('q') || '').slice(0, 120);
        const stats = statsMap();
        const hits = await search(q, { ip, limit: Math.min(50, +url.searchParams.get('limit') || 20) });
        return json(res, 200, { q, results: hits.map((r) => ({ ...filmJson(r), stats: stats.get(r.id) || null })) });
      }
      const fm = p.match(/^\/api\/film\/(Q\d+)$/);
      if (fm) {
        const r = await getFilm(fm[1]);
        if (!r) return json(res, 404, { error: 'Unknown film.' });
        return json(res, 200, { film: filmJson(r), stats: statsMap().get(r.id) || null, watch: watchLinks(r) });
      }
      if (p === '/api/reviews') {
        const film = String(url.searchParams.get('film') || '');
        const lim = Math.min(200, Math.max(1, +url.searchParams.get('limit') || 50));
        const list = publishedReviews().filter((r) => !film || r.film === film).slice(0, lim).map(publicReview);
        return json(res, 200, { reviews: list });
      }
      if (p === '/api/stats') {
        const revs = publishedReviews();
        return json(res, 200, { films: catalog().list.length, reviews: revs.length, reviewedFilms: store.aggregate(revs).size, originals: originals().length });
      }
      if (p === '/api/originals') return json(res, 200, { originals: originals() });
      return json(res, 404, { error: 'Not found.' });
    }

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');

    if (p === '/') return send(res, 200, homePage());
    if (p === '/search') {
      const q = String(url.searchParams.get('q') || '').slice(0, 120);
      const hits = q ? await search(q, { ip, limit: 60 }) : [];
      const stats = statsMap();
      const inner = `<h1>Search: “${esc(q)}”</h1>${hits.length ? `<div class=grid>${hits.map((r) => card(r, stats)).join('')}</div>` : '<p class=meta>No films found. Try the original title or fewer words.</p>'}`;
      return send(res, 200, shell(`Search “${q}” · ${SITE}`, inner, { canonical: `${PREFIX}/search` }));
    }
    if (p === '/top') {
      const stats = statsMap();
      const ids = [...stats.values()].sort((a, b) => b.score - a.score || b.avg - a.avg || b.count - a.count).map((a) => a.film);
      const films = ids.map((id) => catalog().byId.get(id)).filter(Boolean);
      return send(res, 200, listPage('Top rated by viewers', films, { base: `${PREFIX}/top`, lead: 'Ranked by Lotus Score (share of ratings at 3.5★ or more), then average stars.' }));
    }
    if (p === '/reviews') {
      const revs = publishedReviews().slice(0, 100);
      const inner = `<h1>Latest reviews</h1>${revs.length ? revs.map((r) => reviewHtml(r, { showFilm: true })).join('') : '<p class=meta>No reviews yet.</p>'}${CLIENT_JS}`;
      return send(res, 200, shell(`Latest reviews · ${SITE}`, inner, { canonical: `${PREFIX}/reviews` }));
    }
    if (p === '/genres') {
      const inner = `<h1>Genres</h1><p class=tags>${catalog().genres.map((g) => `<a href="${PREFIX}/genre/${esc(g.slug)}">${esc(g.name)}</a> <span class=meta>${g.n}</span>`).join(' · ')}</p>`;
      return send(res, 200, shell(`Genres · ${SITE}`, inner, { canonical: `${PREFIX}/genres` }));
    }
    const gm = p.match(/^\/genre\/([a-z0-9-]{1,60})$/);
    if (gm) {
      const g = catalog().genres.find((x) => x.slug === gm[1]);
      if (!g) return send(res, 404, shell(`Not found · ${SITE}`, '<h1>Unknown genre</h1>'));
      const films = catalog().list.filter((r) => (r.g || []).includes(g.name));
      return send(res, 200, listPage(`${g.name[0].toUpperCase()}${g.name.slice(1)} films`, films, { page: Math.max(1, +url.searchParams.get('page') || 1), base: `${PREFIX}/genre/${g.slug}` }));
    }
    if (p === '/decades') {
      const inner = `<h1>Decades</h1><p class=tags>${decades().map((d) => `<a href="${PREFIX}/decade/${d}s">${d}s</a>`).join(' ')}</p>`;
      return send(res, 200, shell(`Decades · ${SITE}`, inner, { canonical: `${PREFIX}/decades` }));
    }
    const dm = p.match(/^\/decade\/(\d{4})s$/);
    if (dm) {
      const d = +dm[1];
      const films = catalog().list.filter((r) => r.y >= d && r.y < d + 10);
      return send(res, 200, listPage(`Films of the ${d}s`, films, { page: Math.max(1, +url.searchParams.get('page') || 1), base: `${PREFIX}/decade/${d}s` }));
    }
    if (p === '/originals') {
      const stats = statsMap();
      const list = originals();
      const inner = `<h1>SoapBox originals</h1><p class=lead>Films made here — including Hathor's own animations. Rate them: your reviews shape what she makes next.</p>
${list.length ? `<div class=grid>${list.map((o) => originalCard(o, stats)).join('')}</div>` : '<p class=meta>The first originals are being made now.</p>'}`;
      return send(res, 200, shell(`SoapBox originals · ${SITE}`, inner, { canonical: `${PREFIX}/originals` }));
    }
    const om = p.match(/^\/o\/([a-z0-9-]{1,60})$/);
    if (om) {
      const o = originalBySlug(om[1]);
      return o ? send(res, 200, originalPage(o)) : send(res, 404, shell(`Not found · ${SITE}`, '<h1>Unknown film</h1>'));
    }
    const qm = p.match(/^\/(Q\d{1,12})$/);
    if (qm) {
      const r = await getFilm(qm[1]);
      if (!r) return send(res, 404, shell(`Not found · ${SITE}`, `<h1>We couldn't find that film</h1><p><a href="${PREFIX}">Search the catalog</a></p>`));
      const region = String(url.searchParams.get('region') || 'US').toUpperCase().slice(0, 2);
      return send(res, 200, await filmPage(r, region));
    }
    return send(res, 404, shell(`Not found · ${SITE}`, `<h1>Not found</h1><p><a href="${PREFIX}">Back to films</a></p>`));
  } catch {
    try { send(res, 500, 'error', 'text/plain'); } catch { /* noop */ }
  }
  return true;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE} on http://${HOST}:${PORT}${PREFIX} (${BASE_URL})`));
}
