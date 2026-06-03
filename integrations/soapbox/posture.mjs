// posture.mjs — the HOST-vs-WINDOW rule for SoapBox geo/business-data sources (v3 §5 mapping spine).
//
// The rule, stated plainly:
//
//   HOST sources are the database we KEEP. Open, redistributable, license-clean data we are allowed to
//   store, mirror, index, and serve as our own corpus. OpenStreetMap (ODbL), Overture Maps (ODbL/CDLA),
//   public-domain government datasets. These populate the canonical store. We own a copy.
//
//   WINDOW sources are last-mile DISPLAY only. Proprietary, license-restricted feeds whose terms forbid
//   storage/redistribution — Google Places, Yelp, Numbeo, and similar. We may show their result to the
//   user at the moment of a request (a "window" onto their data), but we MUST NOT persist it into our
//   database, mirror it, or treat it as corpus. Google = last-mile display only; OSM/Overture = the
//   database we keep.
//
// Why it matters: confusing the two is how a project quietly relicenses someone else's proprietary data
// into its own store and gets a cease-and-desist (or worse, taints the whole corpus). This helper makes
// the posture an explicit, testable property of every source so callers can branch: a HOST result may be
// cached/stored/indexed; a WINDOW result may only be rendered for the immediate response and then dropped.
//
// Pattern: ESM, zero deps, pure (no network, no secrets), guarded CLI. Companion to overpass.mjs /
// nominatim.mjs / geo-basics.mjs in this directory.
//
//   import { postureFor, isHost, isWindow, mayStore, SOURCES, HOST, WINDOW } from './posture.mjs'
//   node integrations/soapbox/posture.mjs google-places

export const HOST = 'host';
export const WINDOW = 'window';

// Normalize a free-text source key: lowercase, collapse separators/spaces to a single '-'.
function normKey(source) {
  return String(source == null ? '' : source).trim().toLowerCase().replace(/[\s_./]+/g, '-');
}

// Canonical source registry. `posture` is HOST (keep) or WINDOW (display-only).
// `aliases` lets common spellings (google, yelp, overture-maps) resolve to the same entry.
// `license`/`why` document the call so the rule is self-explaining at the point of use.
export const SOURCES = {
  // ── HOST: open / redistributable — the database we KEEP ──────────────────────────────────────────────
  'openstreetmap': {
    posture: HOST, license: 'ODbL', aliases: ['osm', 'overpass', 'nominatim'],
    why: 'Open data (ODbL). Storable/mirrorable with attribution — our canonical place store.',
  },
  'overture': {
    posture: HOST, license: 'ODbL / CDLA-Permissive-2.0', aliases: ['overture-maps', 'overturemaps'],
    why: 'Open map data (ODbL/CDLA). Storable/mirrorable — feeds the canonical store alongside OSM.',
  },
  'geonames': {
    posture: HOST, license: 'CC-BY-4.0', aliases: ['geo-names'],
    why: 'CC-BY geographic database. Storable with attribution.',
  },
  'pd-gov': {
    posture: HOST, license: 'Public Domain (US-Gov / equivalent)', aliases: ['us-gov', 'public-domain', 'census', 'tiger'],
    why: 'Public-domain government data. Free to store, mirror, and serve.',
  },
  'rest-countries': {
    posture: HOST, license: 'Open (Mozilla PD)', aliases: ['restcountries'],
    why: 'Open country reference data. Storable as static reference.',
  },
  'open-elevation': {
    posture: HOST, license: 'Open (built on open DEMs)', aliases: ['openelevation'],
    why: 'Open elevation derived from open DEMs. Storable.',
  },

  // ── WINDOW: proprietary / restricted — DISPLAY only, never stored ───────────────────────────────────
  'google-places': {
    posture: WINDOW, license: 'Proprietary (Google Maps Platform ToS)', aliases: ['google', 'google-maps', 'gmp', 'places'],
    why: 'Last-mile display only. Google ToS forbids storing/mirroring most results — render, do not keep.',
  },
  'yelp': {
    posture: WINDOW, license: 'Proprietary (Yelp Fusion ToS)', aliases: ['yelp-fusion'],
    why: 'Last-mile display only. Yelp ToS forbids caching/redistribution beyond limited display.',
  },
  'numbeo': {
    posture: WINDOW, license: 'Proprietary (Numbeo ToS)', aliases: [],
    why: 'Last-mile display only. Cost-of-living figures are licensed for display, not storage.',
  },
  'foursquare': {
    posture: WINDOW, license: 'Proprietary (Foursquare ToS)', aliases: ['fsq', 'four-square'],
    why: 'Last-mile display only. Restricted caching terms — render, do not keep.',
  },
  'here': {
    posture: WINDOW, license: 'Proprietary (HERE ToS)', aliases: ['here-maps'],
    why: 'Last-mile display only. Storage of results is restricted under HERE terms.',
  },
  'mapbox': {
    posture: WINDOW, license: 'Proprietary (Mapbox ToS)', aliases: [],
    why: 'Last-mile display only. Mapbox ToS restricts persistent storage of geocoding results.',
  },
};

// alias → canonical key, built once.
const ALIAS = (() => {
  const m = new Map();
  for (const [key, def] of Object.entries(SOURCES)) {
    m.set(key, key);
    for (const a of def.aliases || []) m.set(normKey(a), key);
  }
  return m;
})();

/** Resolve a source name (or alias) to its canonical registry key, or null if unknown. */
export function resolveSource(source) {
  const k = normKey(source);
  if (!k) return null;
  return ALIAS.get(k) || null;
}

/**
 * The posture of a source: HOST ('host') or WINDOW ('window').
 * Unknown sources default to WINDOW — the SAFE default: never store data we can't prove is open.
 * @param {string} source  a source name or alias (e.g. 'osm', 'google', 'Overture Maps')
 * @returns {'host'|'window'}
 */
export function postureFor(source) {
  const key = resolveSource(source);
  if (!key) return WINDOW; // unknown ⇒ treat as restricted; do not store.
  return SOURCES[key].posture;
}

/** True iff the source is a HOST (storable/mirrorable) source. */
export function isHost(source) { return postureFor(source) === HOST; }

/** True iff the source is WINDOW (display-only). Unknown sources are WINDOW. */
export function isWindow(source) { return postureFor(source) === WINDOW; }

/** May we persist results from this source into the canonical store? Only HOST sources. */
export function mayStore(source) { return isHost(source); }

/** Full registry detail for a source (posture + license + rationale), or null if unknown. */
export function describe(source) {
  const key = resolveSource(source);
  if (!key) return null;
  return { source: key, ...SOURCES[key] };
}

// ── guarded CLI ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('posture.mjs')) {
  const arg = process.argv.slice(2).join(' ').trim();
  if (arg) {
    const d = describe(arg);
    if (d) {
      console.log(`${arg}  →  ${d.posture.toUpperCase()}  (${d.license})`);
      console.log(`  ${d.why}`);
      console.log(`  mayStore: ${mayStore(arg)}`);
    } else {
      console.log(`${arg}  →  ${postureFor(arg).toUpperCase()}  (unknown source — defaulting to WINDOW, do not store)`);
    }
  } else {
    console.log('HOST sources (the database we keep):');
    for (const [k, v] of Object.entries(SOURCES)) if (v.posture === HOST) console.log(`  ${k.padEnd(16)} ${v.license}`);
    console.log('WINDOW sources (last-mile display only, never stored):');
    for (const [k, v] of Object.entries(SOURCES)) if (v.posture === WINDOW) console.log(`  ${k.padEnd(16)} ${v.license}`);
  }
}
