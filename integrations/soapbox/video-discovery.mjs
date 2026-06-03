// video-discovery.mjs — the SoapBox VIDEO discovery reader (v3 §7 media layer). Two tiers, JustWatch
// model throughout: we surface metadata + a link/official-embed and NEVER host or restream video.
//
//   1. Internet Archive films (archive.org/advancedsearch.php — KEYLESS). We query the openly-licensed
//      film collections (prelinger, feature_films) and return records whose `embed` is IA's OWN player
//      URL (archive.org/embed/<identifier>) — vetted through embed-whitelist so we only ever frame the
//      official first-party player.
//   2. TMDB metadata (api.themoviedb.org/3 — needs TMDB_API_KEY; SOFT-SKIPS to [] when unset). This is
//      pure metadata enrichment (title/year/overview/poster) + a link OUT to the TMDB page. The JustWatch
//      model: we describe and link, we do not host. TMDB results carry NO embed — they are link-outs only.
//
// Pattern matches worldbank.mjs: ESM, zero deps, __setFetch hook, keyless-first, graceful soft-fail
// (return []/null, NEVER throw), guarded CLI, escaped rendered HTML, no secrets logged. Every record
// carries { source, license, provenance }.
//
//   import { archiveFilms, tmdbSearch, discover, renderList, dataNote, __setFetch } from './video-discovery.mjs'
//   node integrations/soapbox/video-discovery.mjs "moon"     # keyless IA film search

import { allowedEmbed } from './embed-whitelist.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxVideo/1.0 (+https://data.soapbox.community)' };

// Optional TMDB key (free to register). Soft-skipped when absent — never required, never logged.
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

// Openly-licensed IA film collections we draw from (Prelinger ephemeral films + the public feature_films).
export const IA_COLLECTIONS = ['prelinger', 'feature_films'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Internet Archive films (keyless) ─────────────────────────────────────────────────────────────
// advancedsearch.php?q=<query>&fl[]=…&rows=N&output=json → { response: { docs: [ {identifier,title,…} ] } }.
// We build an embed via archive.org/embed/<identifier> and ONLY keep it if embed-whitelist approves it
// (it always should — IA is on the allowlist — but we route through the gate so the rule is enforced
// in exactly one place).
/** @param {{q?:string, rows?:number, collections?:string[]}} opts */
export async function archiveFilms({ q = '', rows = 12, collections = IA_COLLECTIONS } = {}) {
  const n = Math.max(1, Math.min(50, Number(rows) || 12));
  const colls = (Array.isArray(collections) && collections.length ? collections : IA_COLLECTIONS);
  // mediatype:movies AND (collection:prelinger OR collection:feature_films) AND <user query>
  const collClause = '(' + colls.map((c) => `collection:${c}`).join(' OR ') + ')';
  const query = `mediatype:movies AND ${collClause}` + (q ? ` AND (${q})` : '');
  const fl = ['identifier', 'title', 'year', 'creator', 'licenseurl', 'description']
    .map((f) => `fl[]=${encodeURIComponent(f)}`).join('&');
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}`
    + `&${fl}&rows=${n}&page=1&output=json`;
  const j = await getJson(url);
  const docs = j && j.response && Array.isArray(j.response.docs) ? j.response.docs : [];
  const out = [];
  for (const d of docs) {
    if (!d || !d.identifier) continue;
    const page = `https://archive.org/details/${d.identifier}`;
    const gate = allowedEmbed(page);                 // route IA url through the embed gate
    out.push({
      id: String(d.identifier),
      title: Array.isArray(d.title) ? d.title[0] : (d.title || d.identifier),
      year: d.year != null ? String(Array.isArray(d.year) ? d.year[0] : d.year) : '',
      creator: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
      overview: Array.isArray(d.description) ? d.description[0] : (d.description || ''),
      url: page,
      embed: gate.ok ? gate.embed : '',              // IA's OWN player, vetted; '' if (impossibly) refused
      poster: `https://archive.org/services/img/${d.identifier}`,
      license: d.licenseurl || 'Internet Archive — see item page',
      source: 'Internet Archive',
      provenance: `Internet Archive item ${d.identifier}`,
    });
  }
  return out;
}

// ── TMDB metadata (keyed; soft-skip when TMDB_API_KEY unset) ───────────────────────────────────────
// JustWatch model: metadata + link OUT only. No embed is ever produced from TMDB — we don't host and we
// don't claim a playable source. Returns [] (soft-skip) when no key, [] on any error.
/** @param {{q?:string, limit?:number}} opts */
export async function tmdbSearch({ q = '', limit = 12 } = {}) {
  if (!TMDB_API_KEY || !q) return [];              // soft-skip: no key, or nothing to search
  const n = Math.max(1, Math.min(50, Number(limit) || 12));
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(TMDB_API_KEY)}`
    + `&query=${encodeURIComponent(String(q))}&include_adult=false&page=1`;
  const j = await getJson(url);
  const results = j && Array.isArray(j.results) ? j.results.slice(0, n) : [];
  return results.map((m) => ({
    id: m.id != null ? `tmdb-${m.id}` : null,
    title: m.title || m.original_title || '',
    year: (m.release_date || '').slice(0, 4),
    creator: '',
    overview: m.overview || '',
    url: m.id != null ? `https://www.themoviedb.org/movie/${m.id}` : '',
    embed: '',                                       // JustWatch model: metadata + link out, never host
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : '',
    license: 'TMDB metadata (link-out only) — see provider for rights',
    source: 'TMDB',
    provenance: m.id != null ? `TMDB movie ${m.id}` : 'TMDB',
  }));
}

/**
 * Discover across both tiers. The keyless IA film search always runs; TMDB metadata enrichment runs only
 * when keyed. Each tier soft-fails to [] independently.
 * @param {{q?:string, rows?:number}} opts
 */
export async function discover({ q = '', rows = 12 } = {}) {
  const [ia, tmdb] = await Promise.all([
    archiveFilms({ q, rows }).catch(() => []),
    tmdbSearch({ q, limit: rows }).catch(() => []),
  ]);
  return [...ia, ...tmdb];
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
/** Escaped HTML list of video results; playable (IA-embed) rows flagged. PURE; soft-handles empties. */
export function renderList(items = []) {
  const list = Array.isArray(items) ? items : [];
  const parts = ['<section class="video-discovery"><h2>Films &amp; video</h2>'];
  if (list.length) {
    parts.push('<ul class="video-list">');
    for (const v of list) {
      const link = v.url ? `<a href="${esc(v.url)}" rel="noopener noreferrer">${esc(v.title || 'Untitled')}</a>` : esc(v.title || 'Untitled');
      const yr = v.year ? ` (${esc(v.year)})` : '';
      const play = v.embed ? ' <span class="playable">▶ playable</span>' : ' <span class="linkout">↗ link out</span>';
      parts.push(`<li>${link}${yr}${play} <span class="src">${esc(v.source)}</span> <span class="lic">[${esc(v.license)}]</span></li>`);
    }
    parts.push('</ul>');
  } else {
    parts.push('<p class="video-empty">No films found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the sources + the JustWatch (link-out, never host) discipline. */
export function dataNote() {
  return 'source: Internet Archive (own player) + TMDB metadata — we link out / embed official players only, never host video';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('video-discovery.mjs')) {
  const q = process.argv.slice(2).join(' ').trim();
  const items = await discover({ q, rows: 15 });
  console.log(`SoapBox Video — "${q || '(browse)'}" — ${items.length} result(s)`);
  console.log('─'.repeat(60));
  for (const v of items) console.log(`  ${(v.title || 'Untitled').slice(0, 40).padEnd(42)} ${v.year || '----'}  ${v.embed ? '[playable]' : '[link]'}  (${v.source})`);
  console.log(`  ${dataNote()}`);
}
