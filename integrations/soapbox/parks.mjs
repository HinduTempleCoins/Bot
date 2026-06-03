// parks.mjs — the SoapBox "Plan a park trip" reader over the US National Park Service developer API
// (developer.nps.gov) + Recreation.gov RIDB (ridb.recreation.gov). Complements the travel modules
// (hotels / routing / maps): once you know WHERE a trip goes, this tells you what's actually there —
// parks, current alerts (closures/hazards), campgrounds, and things to do.
//
// Two free keys, read by ENV NAME ONLY and never logged:
//   • NPS_API_KEY  — developer.nps.gov (free, instant). Powers parks / alerts / thingsToDo / NPS campgrounds.
//   • RIDB_API_KEY — ridb.recreation.gov (free) — federal reservable campgrounds across all agencies.
// When a key is absent, that source SOFT-FAILS to []/null — nothing here ever throws. NPS campgrounds
// are preferred; RIDB is the fallback when the NPS key is missing but the RIDB key is present.
//
// Pattern matches maps.mjs / usgs-hazards.mjs / hotels.mjs: ESM, injectable __setFetch hook, soft-fail,
// guarded CLI, HTML-escaped rendering, NO secrets in source, as-of provenance.
//
//   import { parks, alerts, campgrounds, thingsToDo, parkProfile, renderPage, dataNote } from './parks.mjs'
//   node integrations/soapbox/parks.mjs parks CA
//   node integrations/soapbox/parks.mjs profile yose

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxParks/1.0 (+https://data.soapbox.community)' };
const SOURCE = 'US National Park Service / Recreation.gov';

// Keys read lazily by ENV NAME so tests run keyless and a key added at runtime is picked up. Never logged.
const KEY = {
  nps: () => process.env.NPS_API_KEY || '',
  ridb: () => process.env.RIDB_API_KEY || '',
};

// ── pure helpers (unit-tested offline) ────────────────────────────────────────────────────────────────

// HTML-escape EVERY interpolated value. Mirrors usgs-hazards.esc.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const clampLimit = (n, def, max) => Math.max(1, Math.min(max, num(n) ?? def));

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── parks: list NPS parks (by state / free-text query) ──────────────────────────────────────────────────

/**
 * NPS parks, normalized to [{ parkCode, name, state, designation, description, url }].
 * @param {{state?:string, query?:string, limit?:number}} opts
 * Soft-fails to [] when NPS_API_KEY is absent or the call errors.
 */
export async function parks({ state, query, limit = 20 } = {}) {
  const key = KEY.nps();
  if (!key) return []; // no key ⇒ source not configured, soft-fail
  const p = new URLSearchParams({ limit: String(clampLimit(limit, 20, 50)), api_key: key });
  if (state) p.set('stateCode', String(state).toUpperCase());
  if (query) p.set('q', String(query));
  const j = await getJson(`https://developer.nps.gov/api/v1/parks?${p.toString()}`);
  const rows = (j && Array.isArray(j.data)) ? j.data : [];
  return rows.map((r) => ({
    parkCode: r.parkCode || null,
    name: r.fullName || r.name || null,
    state: r.states || null,
    designation: r.designation || null,
    description: r.description || '',
    url: r.url || (r.parkCode ? `https://www.nps.gov/${r.parkCode}/` : null),
  })).filter((r) => r.name);
}

// ── alerts: current park alerts (closures, hazards, info) ────────────────────────────────────────────────

/**
 * Current NPS alerts for a park → [{ title, category, description, url }] sorted with the most
 * urgent categories first (Danger > Closure > Caution > Information). Soft-fails to [].
 * @param {{parkCode:string, limit?:number}} opts
 */
export async function alerts({ parkCode, limit = 20 } = {}) {
  const key = KEY.nps();
  if (!key || !parkCode) return [];
  const p = new URLSearchParams({ parkCode: String(parkCode), limit: String(clampLimit(limit, 20, 50)), api_key: key });
  const j = await getJson(`https://developer.nps.gov/api/v1/alerts?${p.toString()}`);
  const rows = (j && Array.isArray(j.data)) ? j.data : [];
  const rank = { Danger: 0, Closure: 1, Caution: 2, Information: 3 };
  return rows.map((r) => ({
    title: r.title || null,
    category: r.category || 'Information',
    description: r.description || '',
    url: r.url || null,
  })).filter((r) => r.title)
    .sort((a, b) => (rank[a.category] ?? 9) - (rank[b.category] ?? 9));
}

// ── campgrounds: NPS preferred, RIDB fallback ────────────────────────────────────────────────────────────

function normNpsCampground(r) {
  const sites = num(r?.numberOfSitesReservable) ?? num(r?.numberOfSitesFirstComeFirstServe);
  return {
    name: r.name || null,
    parkCode: r.parkCode || null,
    sites,
    reservable: num(r?.numberOfSitesReservable) || null,
    url: r.url || null,
    source: 'NPS',
  };
}

function normRidbCampground(r) {
  return {
    name: r.FacilityName || null,
    parkCode: null,
    sites: null,
    reservable: r.Reservable === true ? 1 : null,
    url: r.FacilityID ? `https://www.recreation.gov/camping/campgrounds/${r.FacilityID}` : null,
    source: 'RIDB',
  };
}

async function npsCampgrounds(parkCode, limit) {
  const key = KEY.nps();
  if (!key || !parkCode) return null;
  const p = new URLSearchParams({ parkCode: String(parkCode), limit: String(limit), api_key: key });
  const j = await getJson(`https://developer.nps.gov/api/v1/campgrounds?${p.toString()}`);
  const rows = (j && Array.isArray(j.data)) ? j.data : null;
  if (!rows || !rows.length) return null;
  return rows.map(normNpsCampground).filter((r) => r.name);
}

async function ridbCampgrounds(parkCode, limit) {
  const key = KEY.ridb();
  if (!key) return null;
  // RIDB has no parkCode concept; use the park code as a free-text query against campground facilities.
  const p = new URLSearchParams({ query: String(parkCode || ''), activity: 'CAMPING', limit: String(limit) });
  const j = await getJson(`https://ridb.recreation.gov/api/v1/facilities?${p.toString()}`, {
    headers: { ...UA, apikey: key },
  });
  const rows = (j && Array.isArray(j.RECDATA)) ? j.RECDATA : null;
  if (!rows || !rows.length) return null;
  return rows.map(normRidbCampground).filter((r) => r.name);
}

/**
 * Campgrounds for a park, normalized to [{ name, parkCode, sites, reservable, url, source }].
 * Prefers NPS; falls back to RIDB when NPS yields nothing (e.g. NPS key missing). Soft-fails to [].
 * @param {{parkCode:string, limit?:number}} opts
 */
export async function campgrounds({ parkCode, limit = 10 } = {}) {
  if (!parkCode) return [];
  const lim = clampLimit(limit, 10, 50);
  const fromNps = await npsCampgrounds(parkCode, lim).catch(() => null);
  if (fromNps && fromNps.length) return fromNps;
  const fromRidb = await ridbCampgrounds(parkCode, lim).catch(() => null);
  if (fromRidb && fromRidb.length) return fromRidb;
  return [];
}

// ── thingsToDo: NPS activities / suggested experiences ──────────────────────────────────────────────────

/**
 * "Things to do" in a park → [{ title, activities, duration, url }]. Soft-fails to [].
 * @param {{parkCode:string, limit?:number}} opts
 */
export async function thingsToDo({ parkCode, limit = 10 } = {}) {
  const key = KEY.nps();
  if (!key || !parkCode) return [];
  const p = new URLSearchParams({ parkCode: String(parkCode), limit: String(clampLimit(limit, 10, 50)), api_key: key });
  const j = await getJson(`https://developer.nps.gov/api/v1/thingstodo?${p.toString()}`);
  const rows = (j && Array.isArray(j.data)) ? j.data : [];
  return rows.map((r) => ({
    title: r.title || null,
    activities: Array.isArray(r.activities) ? r.activities.map((a) => a.name).filter(Boolean) : [],
    duration: r.duration || null,
    url: r.url || null,
  })).filter((r) => r.title);
}

// ── parkProfile: one park + its alerts + a few campgrounds ───────────────────────────────────────────────

/**
 * Combine a single park's record with its current alerts and a handful of campgrounds + things to do.
 * Returns { park, alerts, campgrounds, thingsToDo, asOf }. park is null when not found. Soft-fails.
 */
export async function parkProfile(parkCode) {
  if (!parkCode) return null;
  const code = String(parkCode).toLowerCase();
  const [list, al, camps, todo] = await Promise.all([
    parks({ query: code, limit: 10 }).catch(() => []),
    alerts({ parkCode: code, limit: 10 }).catch(() => []),
    campgrounds({ parkCode: code, limit: 5 }).catch(() => []),
    thingsToDo({ parkCode: code, limit: 5 }).catch(() => []),
  ]);
  const park = (list || []).find((p) => (p.parkCode || '').toLowerCase() === code) || (list || [])[0] || null;
  return {
    park,
    alerts: al || [],
    campgrounds: camps || [],
    thingsToDo: todo || [],
    asOf: new Date().toISOString(),
  };
}

// ── provenance + render ─────────────────────────────────────────────────────────────────────────────────

// Provenance line. names the NPS + Recreation.gov + an as-of date.
export function dataNote(asOf) {
  const when = (asOf && String(asOf).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}; informational trip planning, not official guidance`;
}

/**
 * Render an escaped HTML park-profile page. EVERY interpolated value is HTML-escaped.
 * data = { park, alerts, campgrounds, thingsToDo, asOf }
 */
export function renderPage(data = {}) {
  const park = data.park || null;
  const al = Array.isArray(data.alerts) ? data.alerts : [];
  const camps = Array.isArray(data.campgrounds) ? data.campgrounds : [];
  const todo = Array.isArray(data.thingsToDo) ? data.thingsToDo : [];

  if (!park) {
    return [
      '<section class="park-profile">',
      '  <p class="none">Park not found.</p>',
      `  <p class="note">${esc(dataNote(data.asOf))}</p>`,
      '</section>',
    ].join('\n');
  }

  const header = [
    `  <h2>${esc(park.name)}</h2>`,
    park.designation ? `  <p class="designation">${esc(park.designation)}${park.state ? ` — ${esc(park.state)}` : ''}</p>` : (park.state ? `  <p class="designation">${esc(park.state)}</p>` : ''),
    park.description ? `  <p class="description">${esc(park.description)}</p>` : '',
    park.url ? `  <p><a href="${esc(park.url)}" rel="noopener nofollow">Official park page</a></p>` : '',
  ].filter(Boolean).join('\n');

  const alertRows = al.slice(0, 20).map((a) => (
    '<tr>'
    + `<td>${esc(a.category)}</td>`
    + `<td>${esc(a.title)}</td>`
    + `<td>${esc(a.description)}</td>`
    + '</tr>'
  )).join('');
  const alertTable = alertRows
    ? '  <h3>Current alerts</h3>'
      + '<table class="alerts"><thead><tr><th>Type</th><th>Title</th><th>Details</th></tr></thead>'
      + `<tbody>${alertRows}</tbody></table>`
    : '  <p class="none">No current alerts.</p>';

  const campRows = camps.slice(0, 20).map((c) => (
    '<tr>'
    + `<td>${esc(c.name)}</td>`
    + `<td class="num">${c.sites != null ? esc(c.sites) : '—'}</td>`
    + `<td>${c.url ? `<a href="${esc(c.url)}" rel="noopener nofollow">info</a>` : '—'}</td>`
    + `<td>${esc(c.source || '—')}</td>`
    + '</tr>'
  )).join('');
  const campTable = campRows
    ? '  <h3>Campgrounds</h3>'
      + '<table class="campgrounds"><thead><tr><th>Name</th><th>Sites</th><th>Link</th><th>Source</th></tr></thead>'
      + `<tbody>${campRows}</tbody></table>`
    : '  <p class="none">No campgrounds listed.</p>';

  const todoRows = todo.slice(0, 20).map((t) => (
    '<tr>'
    + `<td>${esc(t.title)}</td>`
    + `<td>${esc((t.activities || []).join(', '))}</td>`
    + `<td>${t.url ? `<a href="${esc(t.url)}" rel="noopener nofollow">details</a>` : '—'}</td>`
    + '</tr>'
  )).join('');
  const todoTable = todoRows
    ? '  <h3>Things to do</h3>'
      + '<table class="thingstodo"><thead><tr><th>Activity</th><th>Type</th><th>Link</th></tr></thead>'
      + `<tbody>${todoRows}</tbody></table>`
    : '  <p class="none">No activities listed.</p>';

  return [
    '<section class="park-profile">',
    header,
    alertTable,
    campTable,
    todoTable,
    `  <p class="note">${esc(dataNote(data.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/parks.mjs <parks|alerts|camps|todo|profile|page> [args] ────────────────
if (process.argv[1] && process.argv[1].endsWith('parks.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  const configured = [KEY.nps() && 'NPS_API_KEY', KEY.ridb() && 'RIDB_API_KEY'].filter(Boolean);
  console.error(`configured keys: ${configured.length ? configured.join(', ') : '(none — set NPS_API_KEY / RIDB_API_KEY)'}`);
  if (cmd === 'parks') out('parks', await parks({ state: rest[0], query: rest[1] }).catch(() => []));
  else if (cmd === 'alerts') out('alerts', await alerts({ parkCode: rest[0] }).catch(() => []));
  else if (cmd === 'camps') out('campgrounds', await campgrounds({ parkCode: rest[0] }).catch(() => []));
  else if (cmd === 'todo') out('thingsToDo', await thingsToDo({ parkCode: rest[0] }).catch(() => []));
  else if (cmd === 'profile') out('parkProfile', await parkProfile(rest[0] || 'yose').catch(() => null));
  else if (cmd === 'page') console.log(renderPage(await parkProfile(rest[0] || 'yose').catch(() => null) || {}));
  else console.log('usage: parks.mjs <parks [state] [query]|alerts <parkCode>|camps <parkCode>|todo <parkCode>|profile <parkCode>|page <parkCode>>');
}
