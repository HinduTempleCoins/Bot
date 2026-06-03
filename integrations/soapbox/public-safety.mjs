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

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

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

if (process.argv[1] && process.argv[1].endsWith('public-safety.mjs')) {
  const s = await publicSafetySummary();
  for (const [city, d] of Object.entries(s)) {
    console.log(`\n${d.label} — ${d.incidentCount} incidents, ${d.press.length} press items`);
    for (const i of d.incidents.slice(0, 3)) console.log(`  [${i.type || '?'}] ${i.description || ''} @ ${i.address || ''}`);
    for (const p of d.press.slice(0, 3)) console.log(`  press: ${p.title}`);
  }
}
