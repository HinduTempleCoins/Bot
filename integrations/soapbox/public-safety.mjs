// public-safety.mjs — the SoapBox Police / Public-Safety vertical (queue #107). "What's happening near
// you, from the primary source." Two keyless feeds:
//
//   1. City open-data (Socrata) — most large US cities publish their CAD / incident / arrest data on a
//      Socrata portal (data.cityofnewyork.us, data.cityofchicago.org, …). The SODA API is keyless for
//      light use ($$where / $limit / $order via querystring), returns JSON. CITY_PORTALS pins the
//      curated dataset endpoints + a normalizer so every city's odd column names land on one shape.
//   2. PD press feeds (RSS) — police departments post blotters / press releases as RSS. A tiny PURE
//      parser turns the XML into items; pdFeeds() fetches + parses, soft-failing to [].
//
// Pattern follows macro.mjs: ESM, __setFetch hook, soft-fail (never throw), 60s cache, guarded CLI.
//
// ── SIGNAGE / INCIDENT-BOARD layer (added for the digital-signage "fire-alarm display") ───────────────
// The lower half of this file adds an at-a-glance situational-awareness layer for site/signage: active
// NWS weather alerts + USGS quakes (OFFICIAL, keyless) and a community SCANNER feed (reuses
// radio.scannerStations()). Design + posture: .local/PUBLIC_SAFETY_DISPLAY_DESIGN.md.
//   POSTURE (load-bearing): NOT an official emergency source. Official > consensual > community. POINT
//   posture throughout — we point at the agency's/broadcaster's OWN public URL, never re-encode or rehost,
//   and never present community data as authoritative. In an emergency, call 911.

import { cached, TTL } from './cache.mjs';
import * as radio from './radio.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
  // fan the same fake out to the radio reader so scannerStations() reuse stays offline-testable via one seam.
  if (radio && typeof radio.__setFetch === 'function') radio.__setFetch(fn);
}

// Curated Socrata dataset endpoints per city. `domain` = the portal host; `dataset` = the 4x4 resource
// id; `map` = how that dataset's columns map onto our normalized incident shape. `where`/`order` are
// optional SODA clauses applied at query time. PD RSS press feeds live alongside under `feeds`.
// Endpoints are best-effort public datasets; if a city retires/renames one, incidents() soft-fails to [].
export const CITY_PORTALS = {
  Dallas: {
    label: 'Dallas, TX',
    domain: 'www.dallasopendata.com',
    dataset: 'qv6i-rri7', // Police Incidents
    map: { id: 'incidentnum', type: 'nibrs_crime', desc: 'ucr_offense', address: 'incident_address', when: 'date1', lat: 'latitude', lon: 'longitude' },
    order: 'date1 DESC',
    feeds: ['https://dallaspolice.net/Pages/RSS.aspx'],
  },
  'New York': {
    label: 'New York, NY',
    domain: 'data.cityofnewyork.us',
    dataset: 'qgea-i56i', // NYPD Complaint Data Historic
    map: { id: 'cmplnt_num', type: 'law_cat_cd', desc: 'ofns_desc', address: 'boro_nm', when: 'cmplnt_fr_dt', lat: 'latitude', lon: 'longitude' },
    order: 'cmplnt_fr_dt DESC',
    feeds: ['https://www.nyc.gov/assets/nypd/rss/news.xml'],
  },
  'Los Angeles': {
    label: 'Los Angeles, CA',
    domain: 'data.lacity.org',
    dataset: '2nrs-mtv8', // Crime Data from 2020 to Present
    map: { id: 'dr_no', type: 'crm_cd', desc: 'crm_cd_desc', address: 'location', when: 'date_occ', lat: 'lat', lon: 'lon' },
    order: 'date_occ DESC',
    feeds: ['https://www.lapdonline.org/feed/'],
  },
  Chicago: {
    label: 'Chicago, IL',
    domain: 'data.cityofchicago.org',
    dataset: 'crimes', // Crimes - 2001 to Present (alias resource)
    map: { id: 'case_number', type: 'primary_type', desc: 'description', address: 'block', when: 'date', lat: 'latitude', lon: 'longitude' },
    order: 'date DESC',
    feeds: ['https://home.chicagopolice.org/feed/'],
  },
};

// ---- PURE helpers (no I/O — directly unit-tested) --------------------------------------------------

/** Decode the handful of XML entities that show up in RSS text. */
export function decodeEntities(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Pull the text content of the FIRST <tag>…</tag> inside `xml` (CDATA-aware). null if absent. */
export function tag(xml, name) {
  if (typeof xml !== 'string') return null;
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decodeEntities(m[1]) : null;
}

/**
 * PURE RSS / Atom parser. Splits on <item> (RSS) or <entry> (Atom) and pulls title/link/date/summary.
 * Never throws — bad input yields []. `limit` caps the result (default 20).
 */
export function parseRss(xml, limit = 20) {
  if (typeof xml !== 'string' || !xml) return [];
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const block = isAtom ? 'entry' : 'item';
  const chunks = xml.match(new RegExp(`<${block}[\\s>][\\s\\S]*?</${block}>`, 'gi')) || [];
  const out = [];
  for (const c of chunks) {
    let link = tag(c, 'link');
    if (isAtom && !link) {
      const m = c.match(/<link[^>]*href=["']([^"']+)["']/i); // Atom links are href attributes
      link = m ? decodeEntities(m[1]) : null;
    }
    const item = {
      title: tag(c, 'title') || '',
      link: link || '',
      date: tag(c, 'pubDate') || tag(c, 'published') || tag(c, 'updated') || tag(c, 'dc:date') || '',
      summary: tag(c, 'description') || tag(c, 'summary') || tag(c, 'content') || '',
    };
    if (item.title || item.link) out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/** Normalize ONE raw Socrata row onto our incident shape using a city's column `map`. PURE. */
export function normalizeIncident(row, map) {
  if (!row || typeof row !== 'object' || !map) return null;
  const lat = row[map.lat], lon = row[map.lon];
  const norm = {
    id: row[map.id] ?? null,
    type: row[map.type] ?? null,
    description: row[map.desc] ?? null,
    address: row[map.address] ?? null,
    when: row[map.when] ?? null,
    lat: lat != null && lat !== '' ? Number(lat) : null,
    lon: lon != null && lon !== '' ? Number(lon) : null,
  };
  if (Number.isNaN(norm.lat)) norm.lat = null;
  if (Number.isNaN(norm.lon)) norm.lon = null;
  // a row with nothing usable isn't worth surfacing
  if (norm.id == null && norm.type == null && norm.description == null) return null;
  return norm;
}

// ---- network feeders (soft-fail, cached) ----------------------------------------------------------

function sodaUrl(portal, limit) {
  const u = new URL(`https://${portal.domain}/resource/${portal.dataset}.json`);
  u.searchParams.set('$limit', String(limit));
  if (portal.where) u.searchParams.set('$where', portal.where);
  if (portal.order) u.searchParams.set('$order', portal.order);
  return u.toString();
}

/** Recent incidents for a city from its Socrata portal, normalized. Soft-fails to []. Cached 60s. */
export async function incidents({ city, limit = 25 } = {}) {
  const portal = CITY_PORTALS[city];
  if (!portal) return [];
  return cached(`pubsafety:incidents:${city}:${limit}`, TTL.list, async () => {
    try {
      const r = await _fetch(sodaUrl(portal, limit), { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!r.ok) return [];
      const rows = await r.json();
      if (!Array.isArray(rows)) return [];
      return rows.map((row) => normalizeIncident(row, portal.map)).filter(Boolean);
    } catch { return []; }
  });
}

/** PD press-feed (RSS) items for a city. Fetches every configured feed, parses, soft-fails to []. Cached 60s. */
export async function pdFeeds({ city, limit = 20 } = {}) {
  const portal = CITY_PORTALS[city];
  if (!portal || !Array.isArray(portal.feeds) || portal.feeds.length === 0) return [];
  return cached(`pubsafety:feeds:${city}:${limit}`, TTL.list, async () => {
    const out = [];
    for (const url of portal.feeds) {
      try {
        const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' } });
        if (!r.ok) continue;
        const xml = await r.text();
        for (const it of parseRss(xml, limit)) out.push({ ...it, source: url });
      } catch { /* skip this feed */ }
      if (out.length >= limit) break;
    }
    return out.slice(0, limit);
  });
}

/** Homepage roll-up: per-city incident counts + a few headline press items. Soft-fails per city. */
export async function publicSafetySummary({ cities = Object.keys(CITY_PORTALS), perCity = 5 } = {}) {
  const out = {};
  for (const city of cities) {
    if (!CITY_PORTALS[city]) continue;
    const [inc, feeds] = await Promise.all([
      incidents({ city, limit: perCity }).catch(() => []),
      pdFeeds({ city, limit: perCity }).catch(() => []),
    ]);
    out[city] = {
      label: CITY_PORTALS[city].label,
      incidentCount: inc.length,
      incidents: inc,
      press: feeds,
    };
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// SIGNAGE / INCIDENT-BOARD layer — NWS alerts + USGS quakes + scanner audio (see the header note).
// All keyless, courtesy UA, POINT posture, soft-fail-never-throw (any network/parse problem → []).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

// esc() escapes the single quote too (matches signage/server.mjs) so attribute interpolation is always safe.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Only ever emit http(s) hrefs; anything else (javascript:, data:, empty) → '' (POINT-only, safe). */
export function safeHref(u) {
  const s = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(s) ? s : '';
}

const str = (v) => (v == null ? '' : String(v)).trim();
const clampLimit = (v, def = 12) => Math.max(1, Math.min(200, Math.round(Number(v)) || def));

// Permanent disclaimer copy — rendered on EVERY safety view, returned in every board payload, never dismissible.
export const DISCLAIMER = 'Not an official emergency source — in an emergency, call 911.';

/** The fuller data note (posture §4) — for a footer / API note alongside the short DISCLAIMER. */
export function dataNote() {
  return 'Not an official emergency source. This board aggregates public and community feeds for situational '
    + 'awareness only. Information may be delayed, incomplete, or inaccurate. In an emergency, call 911.';
}

const NWS_BASE = (process.env.NWS_BASE || 'https://api.weather.gov').replace(/\/$/, '');
const USGS_BASE = (process.env.USGS_BASE || 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary').replace(/\/$/, '');

/** GET JSON with the courtesy UA. Soft-fails to null on any network/parse problem (never throws). */
async function getJson(url) {
  try {
    const res = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/geo+json, application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ── NWS / weather.gov active alerts (OFFICIAL) ───────────────────────────────────────────────────────
/** Normalize one NWS GeoJSON alert feature → our shaped incident. Null when it has no usable title. */
export function toAlert(f = {}) {
  const p = (f && f.properties) || {};
  const title = str(p.event) || str(p.headline);
  if (!title) return null;
  return {
    id: str(f.id) || str(p.id) || title,
    kind: 'alert',
    severity: str(p.severity) || 'Unknown',
    title,
    area: str(p.areaDesc),
    time: str(p.sent || p.effective || p.onset),
    source: 'NWS',
    posture: 'point',
    headline: str(p.headline),
    url: safeHref(p.url || f.id),
  };
}

/**
 * Active NWS alerts for a US state/area. Keyless GeoJSON; courtesy UA. Soft-fails to [].
 * @param {{state?:string, limit?:number}} opts  state = 2-letter code (default 'TX').
 */
export async function nwsAlerts({ state = 'TX', limit = 12 } = {}) {
  const st = String(state || 'TX').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'TX';
  const j = await getJson(`${NWS_BASE}/alerts/active/area/${st}`);
  const feats = j && Array.isArray(j.features) ? j.features : [];
  return feats.map(toAlert).filter(Boolean).slice(0, clampLimit(limit));
}

// ── USGS earthquakes (OFFICIAL) ──────────────────────────────────────────────────────────────────────
/** Severity label from magnitude (drives the tile color token in the board). */
export function quakeSeverity(mag) {
  const m = Number(mag);
  if (!Number.isFinite(m)) return 'Unknown';
  if (m >= 6) return 'Extreme';
  if (m >= 4.5) return 'Severe';
  if (m >= 3) return 'Moderate';
  return 'Minor';
}

/** Pick a USGS summary feed name from a magnitude floor + a time window. */
export function usgsFeed(minMagnitude, window) {
  const p = ['hour', 'day', 'week', 'month'].includes(String(window)) ? String(window) : 'day';
  const m = Number(minMagnitude);
  let tier = 'all';
  if (m >= 4.5) tier = '4.5';
  else if (m >= 2.5) tier = '2.5';
  else if (m >= 1) tier = '1.0';
  return `${tier}_${p}`;
}

/** Normalize one USGS GeoJSON quake feature → our shaped incident. */
export function toQuake(f = {}) {
  const p = (f && f.properties) || {};
  const mag = Number(p.mag);
  const place = str(p.place);
  const title = str(p.title) || (Number.isFinite(mag) ? `M${mag} — ${place}` : place);
  if (!title) return null;
  return {
    id: str(f.id) || title,
    kind: 'quake',
    severity: quakeSeverity(mag),
    title,
    area: place,
    time: Number.isFinite(Number(p.time)) ? new Date(Number(p.time)).toISOString() : '',
    source: 'USGS',
    posture: 'point',
    mag: Number.isFinite(mag) ? mag : null,
    url: safeHref(p.url),
  };
}

/**
 * Recent USGS earthquakes. Keyless GeoJSON, CDN-cached ~1 min. Soft-fails to [].
 * @param {{minMagnitude?:number, window?:string, limit?:number}} opts  window ∈ hour|day|week|month.
 */
export async function usgsQuakes({ minMagnitude = 2.5, window = 'day', limit = 12 } = {}) {
  const j = await getJson(`${USGS_BASE}/${usgsFeed(minMagnitude, window)}.geojson`);
  const feats = j && Array.isArray(j.features) ? j.features : [];
  const min = Number(minMagnitude);
  const out = feats.map(toQuake).filter(Boolean)
    .filter((q) => !Number.isFinite(min) || q.mag == null || q.mag >= min)
    .sort((a, b) => String(b.time).localeCompare(String(a.time)));
  return out.slice(0, clampLimit(limit));
}

// ── scanner audio (COMMUNITY/CONSENSUAL) — reuses radio.scannerStations() ─────────────────────────────
// Full state names by 2-letter code so we can hand scannerStations() its Dallas→state ranking correctly.
export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** Map a 2-letter state code (or pass-through name) to the full state name Radio Browser indexes. */
export function stateName(state) {
  const s = String(state || '').trim();
  if (!s) return 'Texas';
  return STATE_NAMES[s.toUpperCase()] || s;
}

/**
 * Public-safety SCANNER feeds, community/consensual, POINT posture — reuses radio.scannerStations(). Soft-fails [].
 * @param {{state?:string, limit?:number}} opts  state = 2-letter code or full name (default 'TX').
 */
export async function scannerStations({ state = 'TX', limit = 12 } = {}) {
  try {
    const out = await radio.scannerStations({ state: stateName(state), limit });
    return Array.isArray(out) ? out : [];
  } catch { return []; }
}

// ── the combined board ────────────────────────────────────────────────────────────────────────────────
/**
 * safetyBoard — the whole incident board in one shaped payload. Each section soft-fails independently to [];
 * the board never throws and always carries the permanent DISCLAIMER. Official (NWS/USGS) + community (scanner).
 * Official municipal-CAD incident tiles are available separately via incidents({city}) (city open-data above).
 * @param {{state?:string, limit?:number}} opts  state = 2-letter code (default 'TX').
 * @returns {Promise<{alerts:object[], quakes:object[], scanners:object[], disclaimer:string}>}
 */
export async function safetyBoard({ state = 'TX', limit = 12 } = {}) {
  const [alerts, quakes, scanners] = await Promise.all([
    nwsAlerts({ state, limit }).catch(() => []),
    usgsQuakes({ limit }).catch(() => []),
    scannerStations({ state, limit }).catch(() => []),
  ]);
  return { alerts, quakes, scanners, disclaimer: DISCLAIMER };
}

if (process.argv[1] && process.argv[1].endsWith('public-safety.mjs')) {
  const s = await publicSafetySummary();
  for (const [city, d] of Object.entries(s)) {
    console.log(`\n${d.label} — ${d.incidentCount} incidents, ${d.press.length} press items`);
    for (const i of d.incidents.slice(0, 3)) console.log(`  [${i.type || '?'}] ${i.description || ''} @ ${i.address || ''}`);
    for (const p of d.press.slice(0, 3)) console.log(`  press: ${p.title}`);
  }
}
