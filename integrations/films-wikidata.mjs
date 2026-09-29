// integrations/films-wikidata.mjs — the film catalog behind SoapBox Films (/films on SoapBox Stream).
//
// WHY WIKIDATA. It is the one open, keyless, CC0 source that carries every notable film AND the
// per-service catalog ids (Netflix, Prime Video, Disney+, Hulu, Max, Apple TV, Tubi, Peacock, …) that
// let us say "listed on" and deep-link, plus IMDb / TMDB / Letterboxd ids. Everything the build writes
// is CC0, so the dataset can be redistributed.
//
// TWO WAYS IN.
//   build  — offline dataset for the server: list notable films (sitelink count as the notability
//            proxy), then pull their fields in batches with one UNION query per batch (no cross-product
//            blow-up from multi-valued director × cast × genre), write NDJSON.
//   live   — searchFilms(q): Wikidata entity search → the same batch fetch, for anything not in the local
//            set. The server caches the result.
//
// Every property id below was checked live against wikidata.org (label + formatter URL, 2026-09-29).
// House style: ESM, injectable fetch, soft-fail (a failed batch is skipped, never thrown).
//
//   node integrations/films-wikidata.mjs build --out data/films/films.ndjson [--min-sitelinks 5] [--merge]
//   --merge keeps the records already in --out and fetches only films new to the list.

import { writeFileSync, readFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPARQL_URL = 'https://query.wikidata.org/sparql';
export const API_URL = 'https://www.wikidata.org/w/api.php';
export const USER_AGENT = 'SoapBoxFilms/1.0 (https://stream.soapbox.community/films; films catalog)';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Classes counted as films. Items are typed inconsistently (Spirited Away is only an "anime film"), so every
// film subclass with a real population of notable instances is accepted; junk subclasses of film on Wikidata
// (video album, film project, trailer, viral video, advertisement) are deliberately left out.
export const FILM_CLASSES = [
  'Q11424',    // film
  'Q24869',    // feature film
  'Q202866',   // animated film
  'Q29168811', // animated feature film
  'Q20650540', // anime film
  'Q117717390', // anime feature film
  'Q93204',    // documentary film
  'Q506240',   // television film
  'Q98807719', // animated television film
  'Q24862',    // short film
  'Q17517379', // animated short film
  'Q117209498', // anime short film
  'Q226730',   // silent film
  'Q20667187', // silent short film
  'Q220898',   // original video animation
  'Q7751682',  // serial film
  'Q98701476', // television film broadcast in two parts
  'Q25110269', // live-action/animated film
];

// Where-to-watch services: key, display name, Wikidata property, URL pattern ($1 = the id).
// "Listed on" is the honest claim — Wikidata records that the service carries/carried the title;
// availability varies by region and changes over time.
export const SERVICES = [
  { key: 'netflix', name: 'Netflix', prop: 'P1874', url: 'https://www.netflix.com/title/$1' },
  { key: 'prime', name: 'Prime Video', prop: 'P8055', url: 'https://www.amazon.com/gp/video/detail/$1' },
  { key: 'primevideo', name: 'Prime Video', prop: 'P14440', url: 'https://www.primevideo.com/detail/$1' },
  { key: 'disney', name: 'Disney+', prop: 'P7595', url: 'https://www.disneyplus.com/movies/wd/$1' },
  { key: 'hulu', name: 'Hulu', prop: 'P6466', url: 'https://www.hulu.com/movie/$1' },
  { key: 'max', name: 'Max', prop: 'P8298', url: 'https://play.hbomax.com/$1' },
  { key: 'apple', name: 'Apple TV', prop: 'P9586', url: 'https://tv.apple.com/movie/$1' },
  { key: 'peacock', name: 'Peacock', prop: 'P11815', url: 'https://www.peacocktv.com/stream-$1' },
  { key: 'paramount', name: 'Paramount+', prop: 'P13147', url: 'https://www.paramountplus.com/shows/video/$1/' },
  { key: 'tubi', name: 'Tubi (free)', prop: 'P7760', url: 'https://tubitv.com/movies/$1' },
  { key: 'kanopy', name: 'Kanopy (free with a library card)', prop: 'P7985', url: 'https://www.kanopy.com/product/$1' },
  { key: 'mubi', name: 'MUBI', prop: 'P7299', url: 'https://mubi.com/films/$1' },
  { key: 'criterion', name: 'The Criterion Collection', prop: 'P9584', url: 'https://www.criterion.com/films/$1' },
  { key: 'youtube', name: 'YouTube', prop: 'P1651', url: 'https://www.youtube.com/watch?v=$1' },
  { key: 'archive', name: 'Internet Archive', prop: 'P724', url: 'https://archive.org/details/$1' },
];

// Reference ids (not places to watch): shown as "elsewhere on the web".
export const REFS = [
  { key: 'imdb', name: 'IMDb', prop: 'P345', url: 'https://www.imdb.com/title/$1/' },
  { key: 'tmdb', name: 'TMDB', prop: 'P4947', url: 'https://www.themoviedb.org/movie/$1' },
  { key: 'letterboxd', name: 'Letterboxd', prop: 'P6127', url: 'https://letterboxd.com/film/$1/' },
  { key: 'rt', name: 'Rotten Tomatoes', prop: 'P1258', url: 'https://www.rottentomatoes.com/$1' },
  { key: 'metacritic', name: 'Metacritic', prop: 'P1712', url: 'https://www.metacritic.com/$1' },
];

// Item-valued fields (labels wanted) and their record keys.
const ITEM_FIELDS = { P57: 'd', P161: 'c', P136: 'g', P495: 'co' };
const MAX_CAST = 6;
const MAX_LIST = 4;

export const isQid = (s) => /^Q[1-9]\d{0,11}$/.test(String(s || ''));

/** Fill a service/ref URL pattern. Ids are URI-encoded except the path separators some services use. */
export function linkFor(pattern, id) {
  if (!pattern || id == null || id === '') return '';
  const enc = encodeURIComponent(String(id)).replace(/%2F/gi, '/');
  return pattern.replace('$1', enc);
}

/** Wikimedia Commons file → a sized thumbnail URL (Special:FilePath redirects to the thumb). */
export function commonsThumb(file, width = 300) {
  if (!file) return '';
  const name = String(file).replace(/^.*\/(?:wiki\/)?(?:File:)?/i, '').replace(/ /g, '_');
  if (!name) return '';
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${+width || 300}`;
}

/** Strip the "film" suffix Wikidata puts on genre labels ("drama film" → "drama"). */
export function genreName(label) {
  return String(label || '').replace(/\s+film$/i, '').replace(/\s+movie$/i, '').trim();
}

export function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

const qidOf = (uri) => String(uri || '').replace(/^.*\/entity\//, '');

/**
 * The per-batch UNION query. One row per (film, field, value) — no cross product — with the English
 * label of item values (falling back to the multilingual `mul` label Wikidata now uses for many names) and the sitelink count of cast members (used to put the best-known cast first).
 */
export function batchQuery(qids) {
  const values = qids.filter(isQid).map((q) => `wd:${q}`).join(' ');
  const ext = [...SERVICES, ...REFS].map((s) => `{ ?f wdt:${s.prop} ?v . BIND("${s.prop}" AS ?p) }`).join(' UNION\n');
  const items = Object.keys(ITEM_FIELDS).map((p) => `{ ?f wdt:${p} ?v . BIND("${p}" AS ?p) }`).join(' UNION\n');
  return `SELECT ?f ?p ?v ?vl ?vsl WHERE {
VALUES ?f { ${values} }
{ ?f rdfs:label ?v . FILTER(lang(?v) = "en") BIND("label" AS ?p) } UNION
{ ?f rdfs:label ?v . FILTER(lang(?v) = "mul") BIND("labelmul" AS ?p) } UNION
{ ?f schema:description ?v . FILTER(lang(?v) = "en") BIND("desc" AS ?p) } UNION
{ ?a schema:about ?f ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?v . BIND("enwiki" AS ?p) } UNION
{ ?f wikibase:sitelinks ?v . BIND("sl" AS ?p) } UNION
{ ?f wdt:P31 ?v . BIND("P31" AS ?p) } UNION
{ ?f wdt:P577 ?v . BIND("P577" AS ?p) } UNION
{ ?f wdt:P2047 ?v . BIND("P2047" AS ?p) } UNION
{ ?f wdt:P3383 ?v . BIND("P3383" AS ?p) } UNION
{ ?f wdt:P18 ?v . BIND("P18" AS ?p) } UNION
${items} UNION
${ext}
OPTIONAL { ?v rdfs:label ?vle . FILTER(lang(?vle) = "en") }
OPTIONAL { ?v rdfs:label ?vlm . FILTER(lang(?vlm) = "mul") }
BIND(COALESCE(?vle, ?vlm) AS ?vl)
OPTIONAL { ?v wikibase:sitelinks ?vsl }
}`;
}

/**
 * Fold SPARQL bindings into compact film records:
 * { id, t, desc, y, rt, d[], c[], g[], co[], img, poster, wiki, sl, film, w:{service:id}, r:{ref:id} }
 * `film` is false when none of the item's classes is a film class (the live-search filter uses it).
 */
export function foldBindings(bindings) {
  const acc = new Map();
  const get = (id) => {
    if (!acc.has(id)) acc.set(id, { id, t: '', desc: '', years: [], rt: 0, lists: { P57: new Map(), P161: new Map(), P136: new Map(), P495: new Map() }, img: '', poster: '', wiki: '', sl: 0, classes: new Set(), w: {}, r: {} });
    return acc.get(id);
  };
  const svc = new Map(SERVICES.map((s) => [s.prop, s.key]));
  const refs = new Map(REFS.map((s) => [s.prop, s.key]));
  for (const b of Array.isArray(bindings) ? bindings : []) {
    try {
      const id = qidOf(b.f && b.f.value);
      if (!isQid(id)) continue;
      const p = b.p && b.p.value;
      const v = b.v && b.v.value;
      if (!p || v == null) continue;
      const r = get(id);
      if (p === 'label') r.t = v;
      else if (p === 'labelmul') r.tm = v;
      else if (p === 'desc') r.desc = v;
      else if (p === 'enwiki') r.wiki = v;
      else if (p === 'sl') r.sl = +v || 0;
      else if (p === 'P31') r.classes.add(qidOf(v));
      else if (p === 'P577') { const y = +String(v).slice(0, 5).replace(/^\+/, '').slice(0, 4); if (y > 1870 && y < 2100) r.years.push(y); }
      else if (p === 'P2047') { const m = Math.round(+v); if (m > 0 && m < 1000) r.rt = r.rt || m; }
      else if (p === 'P3383') r.poster = r.poster || v;
      else if (p === 'P18') r.img = r.img || v;
      else if (r.lists[p]) {
        const q = qidOf(v);
        const label = b.vl && b.vl.value;
        if (label && !/^Q\d+$/.test(label)) r.lists[p].set(q, { n: label, s: +(b.vsl && b.vsl.value) || 0 });
      } else if (svc.has(p)) { if (!r.w[svc.get(p)]) r.w[svc.get(p)] = v; }
      else if (refs.has(p)) { if (!r.r[refs.get(p)]) r.r[refs.get(p)] = v; }
    } catch { /* one bad row never drops the batch */ }
  }
  const out = [];
  for (const r of acc.values()) {
    if (!r.t) r.t = r.tm || '';
    if (!r.t) continue;
    const names = (m, n, byFame) => {
      const arr = [...m.values()];
      if (byFame) arr.sort((a, b) => b.s - a.s);
      return arr.slice(0, n).map((x) => x.n);
    };
    const rec = {
      id: r.id, t: r.t,
      y: r.years.length ? Math.min(...r.years) : 0,
      d: names(r.lists.P57, MAX_LIST), c: names(r.lists.P161, MAX_CAST, true),
      g: [...new Set(names(r.lists.P136, 8).map(genreName).filter(Boolean))].slice(0, MAX_LIST),
      co: names(r.lists.P495, 3), sl: r.sl,
      film: [...r.classes].some((c) => FILM_CLASSES.includes(c)),
    };
    if (r.desc) rec.desc = r.desc.slice(0, 200);
    if (r.rt) rec.rt = r.rt;
    if (r.poster) rec.poster = r.poster.replace(/^.*\/Special:FilePath\//, '');
    if (r.img) rec.img = r.img.replace(/^.*\/Special:FilePath\//, '');
    if (r.wiki) rec.wiki = r.wiki;
    if (Object.keys(r.w).length) rec.w = r.w;
    if (Object.keys(r.r).length) rec.r = r.r;
    try { if (rec.poster) rec.poster = decodeURIComponent(rec.poster); if (rec.img) rec.img = decodeURIComponent(rec.img); } catch { /* keep raw */ }
    out.push(rec);
  }
  return out;
}

async function sparql(query, { timeoutMs = 70000 } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  if (timer && timer.unref) timer.unref();
  try {
    const res = await _fetch(SPARQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/sparql-results+json', 'user-agent': USER_AGENT },
      body: 'query=' + encodeURIComponent(query),
      signal: ctl ? ctl.signal : undefined,
    });
    if (!res || !res.ok) return null;
    const j = await res.json();
    return (j && j.results && Array.isArray(j.results.bindings)) ? j.results.bindings : null;
  } catch { return null; } finally { if (timer) clearTimeout(timer); }
}

/** Fetch full records for up to ~200 QIDs in one query. [] on any failure. */
export async function fetchFilms(qids) {
  const ids = [...new Set((qids || []).filter(isQid))];
  if (!ids.length) return [];
  const rows = await sparql(batchQuery(ids));
  return rows ? foldBindings(rows) : [];
}

/** Notable film ids, most-linked first. */
export async function listFilmIds({ minSitelinks = 5 } = {}) {
  const q = `SELECT DISTINCT ?f ?sl WHERE { VALUES ?cls { ${FILM_CLASSES.map((c) => `wd:${c}`).join(' ')} }
?f wdt:P31 ?cls ; wikibase:sitelinks ?sl . FILTER(?sl >= ${Math.max(1, +minSitelinks || 5)}) }`;
  const rows = await sparql(q, { timeoutMs: 120000 });
  if (!rows) return [];
  const seen = new Map();
  for (const b of rows) {
    const id = qidOf(b.f && b.f.value);
    if (isQid(id)) seen.set(id, Math.max(seen.get(id) || 0, +(b.sl && b.sl.value) || 0));
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

/** Live fallback: entity search → films only. */
export async function searchFilms(q, { limit = 10 } = {}) {
  const term = String(q || '').trim().slice(0, 120);
  if (!term) return [];
  try {
    const u = `${API_URL}?action=wbsearchentities&format=json&type=item&language=en&uselang=en&limit=${Math.min(20, Math.max(1, limit * 2))}&search=${encodeURIComponent(term)}`;
    const res = await _fetch(u, { headers: { 'user-agent': USER_AGENT } });
    if (!res || !res.ok) return [];
    const j = await res.json();
    const ids = (j && Array.isArray(j.search) ? j.search : []).map((x) => x && x.id).filter(isQid);
    if (!ids.length) return [];
    const recs = await fetchFilms(ids);
    const order = new Map(ids.map((id, i) => [id, i]));
    return recs.filter((r) => r.film).sort((a, b) => order.get(a.id) - order.get(b.id)).slice(0, limit);
  } catch { return []; }
}

/** Build the dataset. Returns the number of records written. */
export async function build({ out, minSitelinks = 5, batch = 150, merge = false, log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let ids = await listFilmIds({ minSitelinks });
  log(`listed ${ids.length} films (sitelinks >= ${minSitelinks})`);
  const lines = [];
  if (merge && out) {
    // Keep what is already built; fetch only ids not in it.
    const have = new Set();
    let raw = '';
    try { raw = readFileSync(out, 'utf8'); } catch { raw = ''; }
    for (const l of raw.split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); if (r && isQid(r.id)) { have.add(r.id); lines.push(l); } } catch { /* torn line */ }
    }
    ids = ids.filter((id) => !have.has(id));
    log(`merge: ${have.size} already built, ${ids.length} to fetch`);
  }
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    let recs = await fetchFilms(chunk);
    if (!recs.length) { await sleep(5000); recs = await fetchFilms(chunk); } // one retry after a pause
    for (const r of recs) { if (r.film) { delete r.film; lines.push(JSON.stringify(r)); } }
    if ((i / batch) % 20 === 0) log(`${Math.min(i + batch, ids.length)}/${ids.length} fetched, ${lines.length} kept`);
    await sleep(300);
  }
  if (out && lines.length) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out + '.tmp', lines.join('\n') + '\n');
    renameSync(out + '.tmp', out);
  }
  return lines.length;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'build') {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const out = arg('--out', 'data/films/films.ndjson');
  build({ out, minSitelinks: +arg('--min-sitelinks', 5), merge: process.argv.includes('--merge'), log: (m) => console.log(`[films] ${m}`) })
    .then((n) => { console.log(`[films] wrote ${n} films to ${out}`); if (!n) process.exitCode = 1; });
}
