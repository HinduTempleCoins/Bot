// game-mods.mjs — the SoapBox game-mods reader. "Aggregating everything for the gamer": find game
// mods/plugins across the major modding hosts. Keyless-first: Modrinth (api.modrinth.com/v2) is fully
// open and needs no key, so it powers live search today. CurseForge and Nexus Mods both gate their APIs
// behind a key — those are wired by ENV-VAR NAME only and SOFT-SKIP when the key is absent (we never
// embed a key, never throw).
//
//   Modrinth   — https://api.modrinth.com/v2 — keyless, open. Minecraft (and adjacent) mods/plugins,
//                modpacks, resource packs, shaders. Documented at https://docs.modrinth.com . We send a
//                descriptive User-Agent as their docs request.
//   CurseForge — https://api.curseforge.com — requires an API key (header `x-api-key`). Read from
//                env CURSEFORGE_API_KEY *by name*; if unset we skip it (return no results, no error).
//   Nexus Mods — https://api.nexusmods.com — requires a PERSONAL API key (header `apikey`). Per Nexus
//                API terms, the key is tied to an individual user's account and is for PERSONAL,
//                non-commercial use; it must not be shared or used to build a competing service. We
//                therefore only read it from env NEXUS_API_KEY *by name* and soft-skip when unset, and
//                never bundle or log a key. See https://www.nexusmods.com/users/myaccount?tab=api
//
// Pattern matches worldbank.mjs / library-catalog.mjs: ESM, zero deps, __setFetch hook, graceful
// soft-fail (return []/null on error, NEVER throw), guarded CLI, escaped rendered HTML, no secrets,
// provenance note.
//
//   import { searchMods, modrinthSearch, renderResults, dataNote, __setFetch } from './game-mods.mjs'
//   node integrations/soapbox/game-mods.mjs "create"            # search Modrinth
//   node integrations/soapbox/game-mods.mjs "shaders" -- modrinth

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxGameMods/1.0 (+https://data.soapbox.community)' };

const MODRINTH_BASE = 'https://api.modrinth.com/v2';
const CURSEFORGE_BASE = 'https://api.curseforge.com/v1';

// Env-var NAMES only (never the values inline). Reading happens at call time so tests/CI stay clean.
export const KEY_ENV = Object.freeze({
  curseforge: 'CURSEFORGE_API_KEY',
  nexus: 'NEXUS_API_KEY',
});

// ---- pure helpers (unit-tested offline) ----

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// Compact count formatting (1.2M, 340.5K, 73).
export function fmtCount(v) {
  const n = num(v);
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

// Normalize a Modrinth /search payload → a clean [{ source, slug, title, author, downloads, url,
// description, categories }]. Returns [] for anything that isn't the expected shape.
export function normalizeModrinth(json) {
  const hits = json && Array.isArray(json.hits) ? json.hits : null;
  if (!hits) return [];
  const out = [];
  for (const h of hits) {
    if (!h) continue;
    const slug = h.slug || h.project_id || null;
    if (!slug) continue;
    out.push({
      source: 'Modrinth',
      slug: String(slug),
      title: h.title || String(slug),
      author: h.author || null,
      downloads: num(h.downloads),
      follows: num(h.follows),
      type: h.project_type || 'mod',
      url: `https://modrinth.com/${esc(h.project_type || 'mod')}/${encodeURIComponent(String(slug))}`,
      description: h.description || '',
      categories: Array.isArray(h.categories) ? h.categories.slice(0, 8) : [],
    });
  }
  return out;
}

// ---- live data (each fails soft) ----

async function getJson(url, headers) {
  try {
    const r = await _fetch(url, { headers: { ...UA, ...(headers || {}) } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Search Modrinth (keyless). Returns a normalized [{...}] list (possibly []) — never throws.
 * @param {string} query
 * @param {{limit?:number, type?:string}} [opts]  type = 'mod' | 'plugin' | 'modpack' | 'shader' | …
 */
export async function modrinthSearch(query, { limit = 20, type } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (!q) return [];
  const per = Math.max(1, Math.min(50, Number(limit) || 20));
  let url = `${MODRINTH_BASE}/search?query=${encodeURIComponent(q)}&limit=${per}`;
  if (type) {
    // Modrinth facets are a JSON array-of-arrays; filter by project_type.
    url += `&facets=${encodeURIComponent(JSON.stringify([[`project_type:${type}`]]))}`;
  }
  const j = await getJson(url);
  return normalizeModrinth(j);
}

/**
 * Fetch one Modrinth project's detail by slug/id. Returns a normalized object or null.
 */
export async function modrinthProject(slug) {
  const s = typeof slug === 'string' ? slug.trim() : '';
  if (!s) return null;
  const j = await getJson(`${MODRINTH_BASE}/project/${encodeURIComponent(s)}`);
  if (!j || !(j.slug || j.id)) return null;
  return {
    source: 'Modrinth',
    slug: String(j.slug || j.id),
    title: j.title || String(j.slug || j.id),
    downloads: num(j.downloads),
    followers: num(j.followers),
    type: j.project_type || 'mod',
    url: `https://modrinth.com/${esc(j.project_type || 'mod')}/${encodeURIComponent(String(j.slug || j.id))}`,
    description: j.description || '',
    categories: Array.isArray(j.categories) ? j.categories.slice(0, 12) : [],
    license: (j.license && (j.license.id || j.license.name)) || null,
    sourceUrl: j.source_url || null,
  };
}

// CurseForge — key-gated. Reads env CURSEFORGE_API_KEY by NAME; soft-skips (returns []) when unset.
export async function curseforgeSearch(query, { limit = 20, gameId } = {}) {
  const key = process.env[KEY_ENV.curseforge];
  const q = typeof query === 'string' ? query.trim() : '';
  if (!key || !q) return []; // no key configured (or no query) → soft-skip, never throw
  const per = Math.max(1, Math.min(50, Number(limit) || 20));
  // CurseForge requires a gameId; default to Minecraft (432) when none supplied.
  const gid = num(gameId) || 432;
  const url = `${CURSEFORGE_BASE}/mods/search?gameId=${gid}&searchFilter=${encodeURIComponent(q)}&pageSize=${per}`;
  const j = await getJson(url, { 'x-api-key': key, Accept: 'application/json' });
  const data = j && Array.isArray(j.data) ? j.data : null;
  if (!data) return [];
  return data.map((m) => ({
    source: 'CurseForge',
    slug: String(m.slug || m.id || ''),
    title: m.name || '',
    downloads: num(m.downloadCount),
    type: 'mod',
    url: (m.links && m.links.websiteUrl) || '',
    description: m.summary || '',
    categories: Array.isArray(m.categories) ? m.categories.map((c) => c && c.name).filter(Boolean).slice(0, 8) : [],
  })).filter((m) => m.slug);
}

// Nexus Mods — key-gated, PERSONAL-use key only (see header). Reads env NEXUS_API_KEY by NAME.
// Nexus has no broad keyless search endpoint; without a key (the common case) we soft-skip entirely.
// When a personal key IS present we expose the per-game "latest_added" feed as a discovery surface.
export async function nexusLatest({ game } = {}) {
  const key = process.env[KEY_ENV.nexus];
  if (!key) return []; // no personal key → soft-skip (respects personal-use terms; nothing bundled)
  const domain = typeof game === 'string' && game.trim() ? game.trim() : 'skyrimspecialedition';
  const url = `https://api.nexusmods.com/v1/games/${encodeURIComponent(domain)}/mods/latest_added.json`;
  const j = await getJson(url, { apikey: key, Accept: 'application/json' });
  if (!Array.isArray(j)) return [];
  return j.map((m) => ({
    source: 'Nexus Mods',
    slug: String(m.mod_id || ''),
    title: m.name || '',
    downloads: null,
    type: 'mod',
    url: m.mod_id ? `https://www.nexusmods.com/${encodeURIComponent(domain)}/mods/${encodeURIComponent(String(m.mod_id))}` : '',
    description: m.summary || '',
    categories: [],
  })).filter((m) => m.slug);
}

/**
 * Cross-host mod search. Modrinth always runs (keyless); CurseForge/Nexus join in only when their key
 * env is set. Returns { query, game, results: [...], sources: [...], note }. Never throws.
 * @param {string} query
 * @param {{game?:string, limit?:number, type?:string}} [opts]
 *   game — a Modrinth project_type hint OR a Nexus game domain when that key is present.
 */
export async function searchMods(query, { game, limit = 20, type } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  const empty = { query: q, game: game || null, results: [], sources: [], note: dataNote() };
  if (!q) return empty;

  const tasks = [modrinthSearch(q, { limit, type })];
  // key-gated hosts only run when configured (each soft-skips to [] otherwise)
  tasks.push(curseforgeSearch(q, { limit }));
  if (process.env[KEY_ENV.nexus] && game) tasks.push(nexusLatest({ game }));

  const settled = await Promise.all(tasks.map((p) => p.catch(() => [])));
  const results = settled.flat().filter(Boolean);
  const sources = [...new Set(results.map((r) => r.source))];
  return { query: q, game: game || null, results, sources, note: dataNote() };
}

// ---- rendering (escaped HTML) ----

/** Render a searchMods() result (or a bare array) into escaped cards. PURE. */
export function renderResults(data = {}) {
  const results = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
  const parts = ['<section class="game-mods">'];
  if (!results.length) {
    parts.push('<p class="gm-empty">No mods found.</p>');
  } else {
    parts.push('<ul class="gm-list" style="list-style:none;padding:0">');
    for (const r of results) {
      const dl = r.downloads != null ? ` · ${esc(fmtCount(r.downloads))} downloads` : '';
      const cats = (r.categories || []).length ? ` · ${esc((r.categories || []).slice(0, 4).join(', '))}` : '';
      parts.push(
        '<li style="padding:8px 0;border-bottom:1px solid var(--line)">'
        + `<a href="${esc(r.url)}" target="_blank" rel="noopener nofollow"><b>${esc(r.title)}</b></a>`
        + ` <span class="badge">${esc(r.source)}</span>`
        + `<div class="muted" style="font-size:12px">${esc(r.author ? `by ${r.author}` : '')}${dl}${cats}</div>`
        + (r.description ? `<div style="font-size:13px">${esc(r.description)}</div>` : '')
        + '</li>',
      );
    }
    parts.push('</ul>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the hosts + which are keyless vs key-gated. */
export function dataNote() {
  const have = [];
  if (process.env[KEY_ENV.curseforge]) have.push('CurseForge');
  if (process.env[KEY_ENV.nexus]) have.push('Nexus Mods');
  const gated = have.length ? `; also querying ${have.join(' + ')}` : '; CurseForge/Nexus add their own results when an API key is configured';
  return `source: Modrinth (keyless)${gated}`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('game-mods.mjs')) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const query = (sep >= 0 ? argv.slice(0, sep) : argv).join(' ');
  const which = sep >= 0 ? (argv[sep + 1] || '') : '';
  if (which === 'modrinth') {
    const rows = await modrinthSearch(query);
    console.log(`SoapBox Game Mods — Modrinth "${query}"`);
    console.log('─'.repeat(50));
    rows.forEach((r) => console.log(`  ${r.title}  (${fmtCount(r.downloads)} dl)  ${r.url}`));
  } else {
    const res = await searchMods(query);
    console.log(`SoapBox Game Mods — "${res.query}"  [${res.sources.join(', ') || 'no results'}]`);
    console.log('─'.repeat(50));
    res.results.forEach((r) => console.log(`  [${r.source}] ${r.title}  (${fmtCount(r.downloads)} dl)`));
    console.log(`  ${res.note}`);
  }
}
