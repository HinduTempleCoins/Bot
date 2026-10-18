// media-search.mjs — the grouped "our content first" search behind search.soapbox.community.
//
// One query fans out, in parallel, to every place our own content lives, and comes back as labelled groups:
//   Posts     — MELEK chain posts (melek-chain-search.mjs, via the chain RPC), with their lead image
//   People    — MELEK accounts (lookup_accounts + profile name/about/avatar)
//   Library   — the Library of Ashurbanipal (wiki.soapbox.community /api/search)
//   Films     — SoapBox Films, the ~78k-film catalogue (stream.soapbox.community/films/api/search), with posters
//   Pictures  — MELEK Pinboard pins, Hathor's studio gallery, and the Remakes image library
//   Videos & Music — Sandalphon's songs (SoapBox Music), Bifrost videos, Hathor's documentaries
//   Our sites — the public site list (knowledge/system-map.json), private/admin hosts never included
// Every source has its own timeout and soft-fails to [] (one dead source never empties the page), results
// are cached per query for a few minutes, and list-style sources (catalogues, manifests) are cached whole.
// Groups are ordered by how well their best hit matches the query, with a fixed order as the tiebreak.
//
//   import { searchGroups } from './media-search.mjs';
//   const groups = await searchGroups('nosferatu');   // -> [{ key, label, items:[{title,url,snippet,thumb,tag,score}] }]
//
// House style: ESM, injectable fetch (__setFetch), soft-fail never throw, no keys, offline-testable.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let _fetch = (...a) => globalThis.fetch(...a);
/** Inject fetch (tests pass a fake; default = global fetch). */
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); clearCache(); }
let _chain = null;
/** Inject the chain searcher (tests); default = melek-chain-search.mjs searchMelek. */
export function __setChain(fn) { _chain = typeof fn === 'function' ? fn : null; clearCache(); }

const env = (k, d) => (process.env[k] || d).replace(/\/$/, '');
const WIKI = () => env('WIKI_SITE', 'https://wiki.soapbox.community');
const STREAM = () => env('STREAM_SITE', 'https://stream.soapbox.community');
const HATHOR = () => env('HATHOR_SITE', 'https://hathor.soapbox.community');
const PIN = () => env('PIN_SITE', 'https://melek.salon/pin');
const CONDENSER = () => env('MELEK_CONDENSER_URL', 'https://melek.salon');
// The public RPC carries the tags API (get_discussions_by_*); a bare local witness node does not, so chain
// search uses SEARCH_RPC_URL (default: the public endpoint), not MELEK_RPC_URL.
const RPC = () => env('SEARCH_RPC_URL', 'https://melek.salon/rpc');
const TIMEOUT = () => +(process.env.SEARCH_SOURCE_TIMEOUT_MS || 4000);

// Never surface these: the admin/back-office hosts, and analytics/console style surfaces.
const PRIVATE_RE = /soapy\.blog|(^|\.)admin\.|console|analytics\.|grafana|phpmyadmin/i;
export const isPrivateUrl = (u) => PRIVATE_RE.test(String(u || ''));

export const GROUPS = [
  { key: 'posts', label: 'Posts' },
  { key: 'people', label: 'People' },
  { key: 'library', label: 'Library' },
  { key: 'films', label: 'Films' },
  { key: 'pictures', label: 'Pictures' },
  { key: 'media', label: 'Videos & Music' },
  { key: 'sites', label: 'Our sites' },
];

// ── small helpers ────────────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'in', 'on', 'at', 'to', 'a', 'an', 'is', 'by', 'or']);
export const terms = (q) => norm(q).split(/[^a-z0-9]+/).filter((t) => t && (t.length > 1 || /\d/.test(t)) && !STOP.has(t));
const clip = (s, n = 200) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t; };
const unwiki = (s) => String(s || '').replace(/'{2,}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/<[^>]+>/g, ' ').replace(/[=*#]{2,}/g, ' ');

/** 0..1: how well `title` (plus optional extra text) matches the query. Exact title = 1. */
export function matchScore(q, title, extra = '') {
  const ts = terms(q); if (!ts.length) return 0;
  const tn = norm(title).replace(/[^a-z0-9]+/g, ' ').trim();
  const qn = norm(q).replace(/[^a-z0-9]+/g, ' ').trim();
  if (tn && tn === qn) return 1;
  const tw = new Set(tn.split(' '));
  const inTitle = ts.filter((t) => tw.has(t) || tn.includes(t)).length;
  if (inTitle === ts.length) return 0.8 + (tn.startsWith(qn) ? 0.1 : 0);
  const ex = norm(extra);
  const inAny = ts.filter((t) => tn.includes(t) || ex.includes(t)).length;
  return (inTitle / ts.length) * 0.6 + (inAny / ts.length) * 0.25;
}
const matchesAll = (q, text) => { const n = norm(text); return terms(q).every((t) => n.includes(t)); };

async function getJson(url, ms = TIMEOUT()) {
  try {
    const r = await _fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json', 'user-agent': 'SoapBoxSearch/1.0' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function getText(url, ms = TIMEOUT()) {
  try {
    const r = await _fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'SoapBoxSearch/1.0' } });
    if (!r || !r.ok) return '';
    return await r.text();
  } catch { return ''; }
}
// Discussion lists (the chain searcher's candidate sweep) are the same for every query: cache them briefly
// so only the query's own tag is fetched cold.
const _rpcCache = new Map();
async function rpc(method, params) {
  if (method.startsWith('get_discussions_by_')) {
    const k = method + JSON.stringify(params); const hit = _rpcCache.get(k);
    if (hit && Date.now() - hit.at < 300_000) return hit.v;
    const v = await rpcRaw(method, params);
    if (v) { if (_rpcCache.size > 400) _rpcCache.clear(); _rpcCache.set(k, { at: Date.now(), v }); }
    return v;
  }
  return rpcRaw(method, params);
}
async function rpcRaw(method, params) {
  const r = await (async () => {
    try {
      const x = await _fetch(RPC(), { method: 'POST', signal: AbortSignal.timeout(TIMEOUT()), headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.' + method, params }) });
      return await x.json();
    } catch { return null; }
  })();
  return r && 'result' in r ? r.result : null;
}

// Bound any promise (a source may make many calls internally): resolve `fallback` after `ms`.
const deadline = (p, ms, fallback) => Promise.race([Promise.resolve(p).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms).unref?.())]);

// ── caches ──────────────────────────────────────────────────────────────────────────────────────────
const _q = new Map();      // `${src}|${q}` -> { at, v }
const _list = new Map();   // list-source key -> { at, v }
export function clearCache() { _q.clear(); _list.clear(); _rpcCache.clear(); }
const Q_TTL = 5 * 60_000, LIST_TTL = 10 * 60_000;
async function cachedQ(src, q, fn) {
  const k = `${src}|${norm(q)}`; const hit = _q.get(k);
  if (hit && Date.now() - hit.at < Q_TTL) return hit.v;
  const v = await fn();
  if (_q.size > 800) _q.clear();
  if (Array.isArray(v) && v.length) _q.set(k, { at: Date.now(), v }); // never cache a failure/empty
  return v;
}
async function cachedList(key, fn) {
  const hit = _list.get(key);
  if (hit && Date.now() - hit.at < LIST_TTL) return hit.v;
  const v = await fn();
  if (v && (!Array.isArray(v) || v.length)) _list.set(key, { at: Date.now(), v });
  return v;
}

// ── sources ─────────────────────────────────────────────────────────────────────────────────────────
async function chainSearch(q) {
  if (_chain) return _chain(q);
  const { searchMelek } = await import('../melek-chain-search.mjs');
  return searchMelek(q, { k: 10, rpc });
}

/** Posts + People from the MELEK chain. */
export async function srcChain(q) {
  return cachedQ('chain', q, async () => {
    const hits = (await deadline(chainSearch(q), TIMEOUT() + 1500, [])) || [];
    const posts = hits.filter((h) => h.kind === 'post').map((h) => ({
      group: 'posts', title: h.title, url: h.link, snippet: clip(h.snippet, 180), thumb: h.image || '',
      tag: h.author ? `@${h.author}` : 'MELEK', score: Math.max(matchScore(q, h.title, `${(h.tags || []).join(' ')} ${h.author || ''}`), (h.score || 0) * 0.7),
    }));
    // people: name-prefix lookup, plus authors of the matching posts whose name matches; enrich with profiles
    const ts = terms(q); const first = (ts.join('') || '').slice(0, 16);
    const names = new Set(hits.filter((h) => h.kind === 'account').map((h) => h.title.replace(/^@/, '')));
    if (first) {
      const looked = await rpc('lookup_accounts', [first, 6]);
      for (const n of Array.isArray(looked) ? looked : []) if (n.startsWith(first) || ts.some((t) => n.includes(t))) names.add(n);
    }
    let people = [];
    if (names.size) {
      const accts = (await rpc('get_accounts', [[...names].slice(0, 6)])) || [];
      people = accts.map((a) => {
        let prof = {};
        try { prof = (JSON.parse(a.posting_json_metadata || '{}').profile) || {}; } catch {}
        if (!prof.name && !prof.about) { try { prof = (JSON.parse(a.json_metadata || '{}').profile) || prof; } catch {} }
        const thumb = /^https:\/\//.test(prof.profile_image || '') ? prof.profile_image : '';
        return { group: 'people', title: prof.name ? `${prof.name} (@${a.name})` : `@${a.name}`, url: `${CONDENSER()}/@${a.name}`,
          snippet: clip(prof.about || `MELEK member${String(a.created || '') > '2000' ? ` since ${String(a.created).slice(0, 10)}` : ''} · ${a.post_count || 0} posts`, 160),
          thumb, tag: 'MELEK', score: a.name === norm(q).replace(/^@/, '').trim() ? 1 : matchScore(q, `${a.name} ${prof.name || ''}`) * 0.9 };
      });
    }
    return [...posts, ...people];
  });
}

/** Library of Ashurbanipal (the wiki's own search API). */
export async function srcLibrary(q) {
  return cachedQ('library', q, async () => {
    const d = await getJson(`${WIKI()}/api/search?q=${encodeURIComponent(q)}`);
    return ((d && d.results) || []).slice(0, 8).map((a) => ({
      group: 'library', title: a.title, url: a.url || `${WIKI()}/wiki/${encodeURIComponent(a.slug || a.title)}`,
      snippet: clip(unwiki(a.snippet), 180), tag: 'Library', score: matchScore(q, a.title, a.snippet),
    }));
  });
}

const commonsThumb = (f, w = 160) => {
  const name = String(f || '').replace(/^.*\/(?:wiki\/)?(?:File:)?/i, '').replace(/ /g, '_');
  return name ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${w}` : '';
};
/** SoapBox Films catalogue. */
export async function srcFilms(q) {
  return cachedQ('films', q, async () => {
    const d = await getJson(`${STREAM()}/films/api/search?q=${encodeURIComponent(q)}&limit=10`, TIMEOUT() + 1000);
    return ((d && d.results) || []).slice(0, 10).map((f) => ({
      group: 'films', title: f.y ? `${f.t} (${f.y})` : f.t, url: `${STREAM()}/films/${encodeURIComponent(f.id)}`,
      snippet: clip([f.desc, (f.d || []).length ? `dir. ${(f.d || []).join(', ')}` : '', (f.g || []).slice(0, 3).join(', ')].filter(Boolean).join(' · '), 160),
      thumb: commonsThumb(f.poster || f.img), tag: f.w && f.w.archive ? 'Free to watch' : 'Film', score: matchScore(q, f.t, `${(f.c || []).join(' ')} ${(f.d || []).join(' ')} ${(f.g || []).join(' ')}`),
    }));
  });
}

// Hathor gallery: the SFW gallery page (no NSFW cookie is ever sent), parsed into { file, prompt }.
async function hathorGallery() {
  return cachedList('gallery', async () => {
    const html = await getText(`${HATHOR()}/gallery`);
    const out = [];
    const re = /<div class=gcard>\s*<a href="\/p\/([^"]+)"><img src="\/img\/[^"]+" alt="([^"]*)"/g;
    let m; while ((m = re.exec(html))) out.push({ file: m[1], prompt: m[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') });
    return out;
  });
}
async function remakes() {
  return cachedList('remakes', async () => {
    const d = await getJson(`${HATHOR()}/remakes/manifest.json`);
    return ((d && d.scenes) || []).filter((s) => s && s.key);
  });
}
async function pins() {
  return cachedList('pins', async () => ((await getJson(`${PIN()}/pins.json`)) || {}).pins || []);
}
/** Pictures: Pinboard pins, Hathor's studio gallery, the Remakes image library. */
export async function srcPictures(q) {
  return cachedQ('pictures', q, async () => {
    const [p, g, r] = await Promise.all([pins(), hathorGallery(), remakes()]);
    const out = [];
    for (const x of p || []) {
      const hay = `${x.title} ${x.note} ${(x.tags || []).join(' ')} ${x.board} ${x.author}`;
      if (!matchesAll(q, hay) || !/^https:\/\//.test(x.cover || '')) continue;
      out.push({ group: 'pictures', title: x.title || 'Pin', url: `${PIN()}/p/${x.id}`, snippet: clip(x.note || `pinned by @${x.author}`, 120), thumb: x.cover, tag: 'Pinboard', score: matchScore(q, x.title, hay) });
    }
    for (const s of r || []) {
      const hay = `${s.title} ${s.group} ${s.credit}`;
      if (!matchesAll(q, hay)) continue;
      const look = s.looks && (s.looks['1_real'] || Object.values(s.looks)[0]);
      const img = (look && (look.face1 || look.sheet)) || s.source;
      out.push({ group: 'pictures', title: s.title, url: `${HATHOR()}/remakes#${encodeURIComponent(s.key)}`, snippet: clip(s.group || s.credit, 120),
        thumb: img ? `${HATHOR()}/remakes/img/${encodeURIComponent(s.key)}/${encodeURIComponent(img)}` : '', tag: 'Remakes', score: matchScore(q, s.title, hay) });
    }
    for (const x of g || []) {
      if (!matchesAll(q, x.prompt)) continue;
      out.push({ group: 'pictures', title: clip(x.prompt, 70) || 'Hathor image', url: `${HATHOR()}/p/${encodeURIComponent(x.file)}`, snippet: 'Made in Hathor’s studio',
        thumb: `${HATHOR()}/img/${encodeURIComponent(x.file)}`, tag: 'Hathor Studio', score: matchScore(q, x.prompt) * 0.9 });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 12);
  });
}

/** Videos & Music: Sandalphon's songs, Bifrost videos, Hathor's documentaries. */
export async function srcMedia(q) {
  return cachedQ('media', q, async () => {
    const [music, bif, docs] = await Promise.all([
      cachedList('music', async () => ((await getJson(`${STREAM()}/music/catalog.json`)) || {}).tracks || []),
      cachedList('bifrost', async () => {
        const html = await getText(`${HATHOR()}/pentecaust/bifrost`);
        const out = []; const re = /<a[^>]+href="(\/pentecaust\/bifrost\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g; let m;
        while ((m = re.exec(html))) {
          const img = (m[2].match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
          const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (title) out.push({ href: m[1], title, img });
        }
        return out;
      }),
      cachedList('docs', async () => ((await getJson(`${HATHOR()}/documentaries/manifest.json`)) || {}).films || []),
    ]);
    const out = [];
    for (const t of music || []) {
      const hay = `${t.title} ${t.artist} ${t.genre} ${t.album || ''} ${t.shelf || ''}`;
      if (!matchesAll(q, hay)) continue;
      out.push({ group: 'media', title: t.title, url: t.url || `${STREAM()}/music/t/${encodeURIComponent(t.id)}`, snippet: clip(`${t.artist || ''} · ${t.genre || ''}`, 120), thumb: '', icon: '♪', tag: 'Music', score: matchScore(q, t.title, hay) });
    }
    for (const v of bif || []) {
      if (!matchesAll(q, v.title)) continue;
      out.push({ group: 'media', title: clip(v.title, 90), url: `${HATHOR()}${v.href}`, snippet: 'Video on MELEK Bifrost', thumb: /^https:\/\//.test(v.img) ? v.img : (v.img.startsWith('/') ? HATHOR() + v.img : ''), icon: '▶', tag: 'Bifrost', score: matchScore(q, v.title) });
    }
    for (const f of docs || []) {
      const hay = `${f.title || ''} ${f.summary || f.description || ''}`;
      if (!f.title || !matchesAll(q, hay)) continue;
      out.push({ group: 'media', title: f.title, url: `${HATHOR()}/documentaries/${encodeURIComponent(f.slug || f.id || '')}`, snippet: clip(f.summary || f.description || 'A Hathor documentary', 140), thumb: '', icon: '▶', tag: 'Documentary', score: matchScore(q, f.title, hay) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 10);
  });
}

// The public site list. Read from knowledge/system-map.json (the Explore MELEK registry).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _sites = null;
export function siteList() {
  if (_sites) return _sites;
  try {
    const d = JSON.parse(readFileSync(path.resolve(__dirname, '..', '..', 'knowledge', 'system-map.json'), 'utf8'));
    _sites = (d.sites || []).filter((s) => s && s.host && !isPrivateUrl(s.host) && !/(^|\.)alpha\./.test(s.host));
  } catch { _sites = []; }
  return _sites;
}
export function __setSites(list) { _sites = Array.isArray(list) ? list : null; }
const purposeOf = (s) => clip(String(s.purpose || '').replace(/^[^.]*?\b(soapbox\.community|melek\.salon|\.com)\b[.,:]?\s*/i, ''), 160) || s.purpose || '';
/** Our sites — matched on host, app name and purpose. */
export async function srcSites(q) {
  const out = [];
  for (const s of siteList()) {
    const hay = `${s.host} ${s.app || ''} ${s.purpose || ''}`;
    if (!matchesAll(q, hay)) continue;
    const name = s.host.replace(/\.(soapbox\.community|melek\.salon)$/, '').replace(/^www$/, 'soapbox');
    out.push({ group: 'sites', title: `${name[0].toUpperCase()}${name.slice(1)} — ${s.host}`, url: `https://${s.host}/`, snippet: clip(purposeOf(s), 160), tag: 'Site',
      score: matchScore(q, `${s.app || ''} ${name}`, s.purpose) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

/**
 * Search every source and return the non-empty groups, best-matching group first.
 * `extraSites` (optional) = more "Our sites" rows from the caller (the all-internals index etc.).
 */
const tier = (x) => (x >= 0.999 ? 2 : x >= 0.8 ? 1 : 0);
export async function searchGroups(q, { extraSites = [] } = {}) {
  q = String(q || '').trim().slice(0, 120);
  if (!terms(q).length) return [];
  const runs = await Promise.all([srcChain(q), srcLibrary(q), srcFilms(q), srcPictures(q), srcMedia(q), srcSites(q)]
    .map((p) => deadline(p, TIMEOUT() + 2000, [])));
  // chain posts are matched on any body word by the chain searcher — keep only ones that really match
  extraSites = await deadline(extraSites, TIMEOUT() + 2000, []); if (!Array.isArray(extraSites)) extraSites = [];
  const all = runs.flat().filter((r) => r && r.url && !isPrivateUrl(r.url) && !(r.group === 'posts' && r.score < 0.2));
  const seen = new Set(all.map((r) => r.url.replace(/\/$/, '')));
  for (const r of extraSites || []) {
    if (!r || !r.url || isPrivateUrl(r.url)) continue;
    const k = r.url.replace(/\/$/, ''); if (seen.has(k)) continue; seen.add(k);
    // a MELEK post page that came in through the site index belongs with the Posts, not "Our sites"
    const pm = r.url.match(/^https:\/\/(?:www\.)?melek\.salon\/@([a-z0-9.-]+)\/[^/?#]+$/);
    if (pm) { all.push({ group: 'posts', title: r.title, url: r.url, snippet: clip(r.snippet, 180), tag: `@${pm[1]}`, score: matchScore(q, r.title, `${r.url} ${r.snippet || ''}`) * 0.9 }); continue; }
    all.push({ group: 'sites', title: r.title, url: r.url, snippet: clip(r.snippet, 180), tag: r.tag || 'SoapBox', score: matchScore(q, r.title, r.snippet) * 0.95 });
  }
  return GROUPS.map((g, i) => {
    const items = all.filter((r) => r.group === g.key).sort((a, b) => b.score - a.score);
    const lim = g.key === 'sites' ? 10 : 8;
    return { ...g, order: i, best: items.length ? items[0].score : 0, items: items.slice(0, lim), total: items.length };
  }).filter((g) => g.items.length)
    // an exact title/name hit first, then groups whose best title holds every query word, then the fixed order.
    .sort((a, b) => tier(b.best) - tier(a.best) || a.order - b.order);
}
