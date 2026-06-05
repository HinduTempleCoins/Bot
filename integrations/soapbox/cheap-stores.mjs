// cheap-stores.mjs — the TRUE-DOLLAR-STORE AGGREGATOR for the SoapBox data family.
//
// A finder + facts page for stores that GENUINELY sell at the Dollar Tree model — most of the shelf at
// roughly $0.99–$2.00 — versus the "dollar" crowd that is dollar in NAME ONLY (Dollar General / Family
// Dollar are variety discount stores; most items run over $2). Two layers:
//
//   1. CHAIN FACTS (curated, honest, sourced) — which chains actually hold under-$2 pricing TODAY. Each
//      entry states the REAL current base price and a ceiling, flags trulyUnder2, and cites a source.
//      These are facts with provenance, NOT a verdict engine; we label the not-actually-cheap chains
//      plainly rather than hiding them.
//
//   2. STORE LOCATOR (keyless-first house style) — find locations near a user-supplied place:
//        • geocode the place (zip / city / "lat,lng") via Nominatim (keyless, reused from nominatim.mjs),
//        • query OpenStreetMap via Overpass (keyless, reused from overpass.mjs) for shop=variety_store /
//          shop=convenience features near the point, then match brand/name against the curated chains.
//      Google Places is wired as a BETTER-DATA path behind GOOGLE_MAPS_API_KEY — built + tested with a
//      fake fetch, but DORMANT until a key exists. Places has a monthly free credit; see the report.
//
// House pattern (matches oversight-directory.mjs / overpass.mjs / nominatim.mjs):
//   • ESM, keyless by default, injectable fetch via __setFetch (tests pass a fake fetch),
//   • every live fetcher SOFT-FAILS to [] / null — the curated facts table always renders,
//   • every interpolated value HTML-escaped before it reaches markup,
//   • secrets by env NAME only (never the value), CLI guarded, offline fixture tests.
//
//   import { CHAINS, chainFacts, trulyCheapChains, locateStores, render*, __setFetch } from './cheap-stores.mjs'
//   node integrations/soapbox/cheap-stores.mjs 75201            # locate near Dallas zip
//   node integrations/soapbox/cheap-stores.mjs "Portland, OR"

import { geocode } from './nominatim.mjs';
import { queryAround } from './overpass.mjs';

const UA = 'SoapBoxData/1.0 (+https://data.soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Secret read by NAME only; never the value, never logged. Google Places dormant until this is set.
export const GOOGLE_KEY_ENV = 'GOOGLE_MAPS_API_KEY';
const googleKey = () => process.env[GOOGLE_KEY_ENV] || '';

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// LAYER 1 — THE CHAIN FACTS. Curated + sourced. Verified with web search June 2026 (sources below).
//
//   Schema per chain:
//     name         — chain name
//     basePrice    — the chain's entry/base price in USD (the "everything's X" number), or null if N/A
//     priceCeiling — highest common shelf price in USD (multi-price ceiling), or null
//     trulyUnder2  — bool: does MOST of the shelf genuinely sit at/below ~$2 the Dollar Tree way?
//     osmBrands    — lowercase brand/name tokens used to match OSM features to this chain
//     notes        — the honest, plain-English read
//     source       — authoritative source URL for the price fact
//     status       — 'open' | 'closed' (closed chains are shown for honesty, e.g. 99 Cents Only)
//
//   SOURCES (verified June 2026):
//   • Dollar Tree multi-price ($1.25 base, $1.50/$1.75 weave, "Plus" up to $5–$7, some items to $10):
//       https://foodtradenews.com/2026/03/17/dollar-trees-multi-price-model-is-rewriting-the-dollar-store-playbook/
//       https://www.yahoo.com/news/articles/dollar-tree-price-changes-2026-192510192.html
//   • Daiso US base ($1.75 base; some regions raised to $2.25, e.g. Hawai‘i June 2025):
//       https://www.khon2.com/local-news/more-price-hikes-could-be-coming-as-another-retailer-increases-prices/
//   • 99 Cents Only Stores — ALL 371 locations closed + liquidated 2024; Dollar Tree bought ~170 leases:
//       https://en.wikipedia.org/wiki/99_Cents_Only_Stores
//       https://fortune.com/2024/05/30/dollar-tree-99-cents-only-stores/
//   • Dollar General / Family Dollar — variety discount, MOST items over $2 (not a true dollar store):
//       https://www.thepennyhoarder.com/save-money/whats-the-best-dollar-store/
//       https://www.thekitchn.com/dollar-tree-dollar-general-price-comparison-23721288
// ──────────────────────────────────────────────────────────────────────────────────────────────────
export const CHAINS = [
  {
    id: 'dollar-tree',
    name: 'Dollar Tree',
    basePrice: 1.25,
    priceCeiling: 7.00,
    trulyUnder2: true,
    status: 'open',
    osmBrands: ['dollar tree', 'dollartree'],
    notes: 'The closest thing to the classic single-price dollar store. Base price is $1.25 (raised from $1 '
      + 'in 2021), with a growing multi-price weave at $1.50 and $1.75, and a "Plus" assortment up to $5–$7 '
      + '(a few items now reach $10). The core of the store is still genuinely at/under ~$1.75.',
    source: 'https://foodtradenews.com/2026/03/17/dollar-trees-multi-price-model-is-rewriting-the-dollar-store-playbook/',
  },
  {
    id: 'daiso',
    name: 'Daiso',
    basePrice: 1.75,
    priceCeiling: 10.00,
    trulyUnder2: true,
    status: 'open',
    osmBrands: ['daiso'],
    notes: 'Japanese 100-yen-style variety chain. US base price is $1.75 (some regions, e.g. Hawai‘i as of '
      + 'June 2025, raised to $2.25), with higher price points up the shelf. The bulk of the assortment is '
      + 'still entry-priced — genuinely a low-fixed-price store.',
    source: 'https://www.khon2.com/local-news/more-price-hikes-could-be-coming-as-another-retailer-increases-prices/',
  },
  {
    id: 'target-bullseye-playground',
    name: "Target — Bullseye's Playground",
    basePrice: 1.00,
    priceCeiling: 5.00,
    trulyUnder2: true,
    status: 'open',
    // A SECTION, not a standalone store — matched to Target locations in the locator with a clear note.
    osmBrands: ['target'],
    notes: 'Not a store but a SECTION inside Target — the "Bullseye\'s Playground" dollar-spot bins near the '
      + 'entrance. Items commonly run $1–$5, with a real $1–$3 core of seasonal and impulse goods. We list '
      + 'Target locations so you can find the section; the rest of the store is full retail price.',
    source: 'https://www.thepennyhoarder.com/save-money/whats-the-best-dollar-store/',
  },
  {
    id: 'dollar-general',
    name: 'Dollar General',
    basePrice: null,
    priceCeiling: null,
    trulyUnder2: false,
    status: 'open',
    osmBrands: ['dollar general', 'dollargeneral'],
    notes: 'Dollar in NAME ONLY. A small-format variety DISCOUNT store, not a fixed-price dollar store — '
      + 'most of the shelf runs well over $2 (e.g. laundry detergent ~$5.50, coffee ~$11). It does carry a '
      + 'small "$1 / Dollar Deals" section, but the store as a whole is not under-$2 pricing.',
    source: 'https://www.thekitchn.com/dollar-tree-dollar-general-price-comparison-23721288',
  },
  {
    id: 'family-dollar',
    name: 'Family Dollar',
    basePrice: null,
    priceCeiling: null,
    trulyUnder2: false,
    status: 'open',
    osmBrands: ['family dollar', 'familydollar'],
    notes: 'Dollar in NAME ONLY. A variety discount chain (owned by Dollar Tree, Inc.), most items priced '
      + 'over $2. Useful for convenience and the occasional deal, but it is not a true under-$2 store.',
    source: 'https://www.thepennyhoarder.com/save-money/whats-the-best-dollar-store/',
  },
  {
    id: '99-cents-only',
    name: '99 Cents Only Stores',
    basePrice: 0.99,
    priceCeiling: 0.99,
    trulyUnder2: true,
    status: 'closed',
    osmBrands: ['99 cents only', '99 cents', '99cents only'],
    notes: 'CLOSED. The original sub-$1 chain shut all 371 stores and liquidated in 2024; Dollar Tree bought '
      + '~170 of the leases (many reopened as Dollar Tree). Listed here for honesty — if you remember it, it '
      + 'is gone. We do NOT show it in locator results.',
    source: 'https://fortune.com/2024/05/30/dollar-tree-99-cents-only-stores/',
  },
];

const BY_ID = new Map(CHAINS.map((c) => [c.id, c]));

// The standing honesty line — present on every rendered block, by construction.
export const HOW_WE_DECIDE =
  'A store is "truly under $2" when MOST of its shelf genuinely sits at or below about $2 the way Dollar '
  + 'Tree does — a low fixed/anchored price, not a "discount" store that merely has the word "dollar" in '
  + 'its name. Prices are stated as the chain\'s real current base; verify at the store before relying on '
  + 'it. Facts with sources, not a verdict.';

/** chainFacts({ trulyUnder2, open } = {}) — filter the curated chains. Always returns an array. */
export function chainFacts({ trulyUnder2, open } = {}) {
  return CHAINS.filter((c) => {
    if (trulyUnder2 === true && !c.trulyUnder2) return false;
    if (trulyUnder2 === false && c.trulyUnder2) return false;
    if (open === true && c.status !== 'open') return false;
    return true;
  });
}

/** The chains that genuinely hold under-$2 pricing today (open + trulyUnder2). */
export function trulyCheapChains() {
  return chainFacts({ trulyUnder2: true, open: true });
}

/** chain(id) — one chain's full facts, or null. */
export function chain(id) { return BY_ID.get(str(id)) || null; }

// The set of OSM brand tokens we consider "a true dollar store" for locator matching: open chains we
// flag trulyUnder2. (Closed chains like 99 Cents Only are excluded so we never send anyone to a dead store.)
const LOCATABLE = CHAINS.filter((c) => c.status === 'open' && c.trulyUnder2);

// Match an OSM feature's tags to one of our locatable chains by brand/name token. Returns the chain or null.
function matchChain(tags = {}) {
  const hay = `${str(tags.brand)} ${str(tags.name)} ${str(tags.operator)}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const c of LOCATABLE) {
    if ((c.osmBrands || []).some((b) => hay.includes(b))) return c;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// LAYER 2 — THE LOCATOR.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

// Parse a user-supplied location into a geocode target. Accepts "lat,lng" directly (no network needed),
// otherwise returns the geocode text for Nominatim. A bare 5-digit US ZIP is ambiguous to Nominatim
// (it can match a foreign place code), so we anchor it to the US — `geocodeText` is what we actually
// geocode, while `text` keeps the user's original input for display.
function parseWhere(where) {
  const w = str(where);
  if (!w) return { latlng: null, text: '', geocodeText: '' };
  const m = w.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = num(m[1]); const lon = num(m[2]);
    if (lat != null && lon != null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { latlng: { lat, lon }, text: w, geocodeText: w };
    }
  }
  // bare 5-digit ZIP → anchor to the US so "75201" resolves to Dallas, not a foreign postal code.
  const geocodeText = /^\d{5}$/.test(w) ? `${w}, USA` : w;
  return { latlng: null, text: w, geocodeText };
}

const haversineMi = (a, b) => {
  const R = 3958.7613; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat); const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

// Build a clean store record from an OSM feature + the matched chain + the search origin.
function osmStoreRecord(feature, matched, origin) {
  const t = feature.tags || {};
  const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const cityState = [t['addr:city'], t['addr:state']].filter(Boolean).join(', ');
  const address = [addr, cityState].filter(Boolean).join(', ');
  const distanceMi = (origin && feature.lat != null) ? haversineMi(origin, { lat: feature.lat, lon: feature.lon }) : null;
  return {
    chainId: matched.id,
    name: matched.name,
    basePrice: matched.basePrice,
    trulyUnder2: matched.trulyUnder2,
    lat: feature.lat,
    lon: feature.lon,
    address: address || str(t.name) || '',
    distanceMi: distanceMi == null ? null : Math.round(distanceMi * 10) / 10,
    source: 'OpenStreetMap',
    provider: 'osm',
  };
}

/**
 * locateStoresOSM({ lat, lon, radiusM }) — keyless floor. Pulls variety/convenience shops from Overpass
 * near the point and keeps only those that match a locatable true-dollar chain. Soft-fails to [].
 */
export async function locateStoresOSM({ lat, lon, radiusM = 16000 } = {}) {
  const la = num(lat); const lo = num(lon);
  if (la == null || lo == null) return [];
  const origin = { lat: la, lon: lo };
  // shop=variety_store is the OSM tag for dollar/variety stores; also sweep shop=convenience for brands
  // tagged loosely. queryAround already soft-fails to [].
  const [variety, conv] = await Promise.all([
    queryAround({ lat: la, lon: lo, key: 'shop', value: 'variety_store', radiusM }).catch(() => []),
    queryAround({ lat: la, lon: lo, key: 'shop', value: 'convenience', radiusM }).catch(() => []),
  ]);
  const seen = new Set();
  const out = [];
  for (const f of [...variety, ...conv]) {
    const matched = matchChain(f.tags);
    if (!matched) continue;
    const id = f.id || `${f.lat},${f.lon}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(osmStoreRecord(f, matched, origin));
  }
  out.sort((a, b) => (a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9));
  return out;
}

/**
 * locateStoresGoogle({ lat, lon, radiusM }) — the BETTER-DATA path, DORMANT until GOOGLE_MAPS_API_KEY is
 * set. Uses Google Places Nearby Search. Soft-fails to [] (and returns [] immediately with no key, so it
 * never spends or leaks). Kept symmetrical with the OSM path so the page can prefer it when a key exists.
 */
export async function locateStoresGoogle({ lat, lon, radiusM = 16000 } = {}) {
  const key = googleKey();
  if (!key) return []; // dormant: no key → no call, no spend, no leak
  const la = num(lat); const lo = num(lon);
  if (la == null || lo == null) return [];
  const origin = { lat: la, lon: lo };
  const radius = Math.max(1, Math.min(50000, num(radiusM) || 16000));
  const out = [];
  try {
    // One Nearby Search per locatable chain keyword (variety stores are poorly typed in Places).
    for (const c of LOCATABLE) {
      const kw = encodeURIComponent(c.name);
      const u = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${la},${lo}`
        + `&radius=${radius}&keyword=${kw}&key=${encodeURIComponent(key)}`;
      const r = await _fetch(u, { headers: { 'User-Agent': UA } });
      if (!r || !r.ok) continue;
      const j = await r.json();
      for (const p of (Array.isArray(j?.results) ? j.results : [])) {
        const plat = num(p.geometry?.location?.lat); const plon = num(p.geometry?.location?.lng);
        if (plat == null || plon == null) continue;
        const name = `${str(p.name)}`.toLowerCase();
        // confirm the result really is this chain (keyword search is fuzzy)
        if (!(c.osmBrands || []).some((b) => name.includes(b))) continue;
        const distanceMi = Math.round(haversineMi(origin, { lat: plat, lon: plon }) * 10) / 10;
        out.push({
          chainId: c.id, name: c.name, basePrice: c.basePrice, trulyUnder2: c.trulyUnder2,
          lat: plat, lon: plon, address: str(p.vicinity || p.formatted_address || ''),
          distanceMi, source: 'Google Places', provider: 'google',
        });
      }
    }
  } catch { /* soft-fail */ }
  out.sort((a, b) => (a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9));
  return out;
}

/**
 * locateStores(where, { radiusM, limit }) — the public locator. Geocodes `where` (zip / city / "lat,lng"),
 * prefers Google Places when a key is set, otherwise the keyless OSM floor. Always returns an object:
 *   { where, origin, results, provider }  — results soft-fails to [], origin null if geocode fails.
 */
export async function locateStores(where, { radiusM = 16000, limit = 50 } = {}) {
  const { latlng, text, geocodeText } = parseWhere(where);
  let origin = latlng;
  if (!origin && geocodeText) {
    const g = await geocode(geocodeText).catch(() => null);
    if (g && g.lat != null && g.lon != null) origin = { lat: g.lat, lon: g.lon, displayName: g.displayName };
  }
  if (!origin) return { where: text, origin: null, results: [], provider: 'none' };

  let results = [];
  let provider = 'osm';
  if (googleKey()) {
    results = await locateStoresGoogle({ lat: origin.lat, lon: origin.lon, radiusM }).catch(() => []);
    provider = 'google';
  }
  if (!results.length) {
    results = await locateStoresOSM({ lat: origin.lat, lon: origin.lon, radiusM }).catch(() => []);
    provider = results.length ? 'osm' : provider;
  }
  return { where: text, origin, results: results.slice(0, Math.max(1, limit)), provider };
}

/** Status of the Google Places adapter — for the page footer + the report. Never returns the key. */
export function googlePlacesStatus() {
  return {
    enabled: !!googleKey(),
    envName: GOOGLE_KEY_ENV,
    note: googleKey()
      ? 'Google Places is active (key present). Used as the better-data path; OSM remains the fallback.'
      : `Google Places is DORMANT. Set the ${GOOGLE_KEY_ENV} env var on the host to enable richer results `
        + '(Places has a recurring monthly free credit). Until then the keyless OpenStreetMap floor is used.',
  };
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// RENDERING — escaped HTML, the how-we-decide line always present.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`);

/** renderChainTable() — the honest "who's truly under $2" table. */
export function renderChainTable() {
  const rows = CHAINS.map((c) => {
    const verdict = c.status === 'closed'
      ? '<span class="cs-closed">closed (2024)</span>'
      : c.trulyUnder2
        ? '<span class="cs-yes">✓ truly under $2</span>'
        : '<span class="cs-no">✗ dollar in name only</span>';
    const range = c.basePrice == null
      ? '<span class="cs-muted">varies — over $2</span>'
      : `${money(c.basePrice)}${c.priceCeiling && c.priceCeiling !== c.basePrice ? ` – ${money(c.priceCeiling)}` : ''}`;
    return `<tr class="cs-chain cs-${c.trulyUnder2 ? 'true' : 'false'}${c.status === 'closed' ? ' cs-shut' : ''}" data-chain="${esc(c.id)}">
      <td class="cs-name">${esc(c.name)}</td>
      <td class="cs-price">${range}</td>
      <td class="cs-verdict">${verdict}</td>
      <td class="cs-notes">${esc(c.notes)} <a class="cs-src" href="${esc(c.source)}" rel="nofollow noopener">[source]</a></td>
    </tr>`;
  }).join('\n');
  return `<table class="cheap-stores-table">
    <thead><tr><th>Chain</th><th>Real price range</th><th>Verdict</th><th>The honest read</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="cs-how-we-decide"><em>${esc(HOW_WE_DECIDE)}</em></p>`;
}

/** A keyless OpenStreetMap embed (iframe) centered on the origin — no Google key needed for display. */
export function renderMap(origin, { zoomDelta = 0.08 } = {}) {
  if (!origin || num(origin.lat) == null || num(origin.lon) == null) return '';
  const { lat, lon } = origin;
  const bbox = [lon - zoomDelta, lat - zoomDelta, lon + zoomDelta, lat + zoomDelta].map((n) => n.toFixed(5));
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${esc(bbox.join('%2C'))}`
    + `&layer=mapnik&marker=${esc(Number(lat).toFixed(5))}%2C${esc(Number(lon).toFixed(5))}`;
  const big = `https://www.openstreetmap.org/?mlat=${esc(Number(lat).toFixed(5))}&mlon=${esc(Number(lon).toFixed(5))}#map=13/${esc(Number(lat).toFixed(4))}/${esc(Number(lon).toFixed(4))}`;
  return `<div class="cs-map">
    <iframe title="Map of the search area" width="100%" height="340" frameborder="0" loading="lazy"
      referrerpolicy="no-referrer" style="border:1px solid var(--line,#333);border-radius:8px"
      src="${src}"></iframe>
    <p class="cs-map-link"><a href="${big}" rel="noopener" target="_blank">View larger map ↗</a>
      <span class="cs-attr">© OpenStreetMap contributors</span></p>
  </div>`;
}

/** renderResults({ where, origin, results, provider }) — the located-store list. */
export function renderResults(loc = {}) {
  const results = Array.isArray(loc.results) ? loc.results : [];
  const where = esc(loc.where || '');
  if (!loc.origin) {
    return `<div class="cs-results"><p class="cs-empty">Couldn't find “${where}”. Try a ZIP code, a city, or "lat,lng".</p></div>`;
  }
  const map = renderMap(loc.origin);
  if (!results.length) {
    return `<div class="cs-results">${map}
      <p class="cs-empty">No true dollar stores found near “${where}”. We list ${esc(String(LOCATABLE.length))} chains; `
      + `try a wider area, or a nearby city.</p></div>`;
  }
  const items = results.map((r) => `<li class="cs-store" data-chain="${esc(r.chainId)}">
    <span class="cs-store-name">${esc(r.name)}</span>
    ${r.basePrice != null ? `<span class="cs-store-base">base ${money(r.basePrice)}</span>` : ''}
    ${r.distanceMi != null ? `<span class="cs-store-dist">${esc(String(r.distanceMi))} mi</span>` : ''}
    ${r.address ? `<span class="cs-store-addr">${esc(r.address)}</span>` : ''}
  </li>`).join('\n');
  return `<div class="cs-results">${map}
    <p class="cs-count">${esc(String(results.length))} true dollar store${results.length === 1 ? '' : 's'} near “${where}” `
    + `<span class="cs-via">(via ${esc(loc.provider === 'google' ? 'Google Places' : 'OpenStreetMap')})</span></p>
    <ul class="cs-store-list">
${items}
    </ul></div>`;
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────
// CLI (guarded). The chain facts need no network; a place argument runs a live locator lookup.
//   node integrations/soapbox/cheap-stores.mjs 75201
// ──────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('cheap-stores.mjs')) {
  const where = process.argv.slice(2).join(' ');
  console.log('\n# True dollar stores — the honest chain facts\n');
  for (const c of CHAINS) {
    const tag = c.status === 'closed' ? 'CLOSED' : c.trulyUnder2 ? 'TRULY UNDER $2' : 'DOLLAR IN NAME ONLY';
    console.log(`  - ${c.name}  [${tag}]  base ${money(c.basePrice)}${c.priceCeiling && c.priceCeiling !== c.basePrice ? `–${money(c.priceCeiling)}` : ''}`);
    console.log(`      ${c.notes}`);
    console.log(`      source: ${c.source}`);
  }
  console.log(`\n  ${googlePlacesStatus().note}`);
  if (where) {
    console.log(`\n# Locator: "${where}"\n`);
    const loc = await locateStores(where);
    if (!loc.origin) console.log(`  could not geocode: ${where}`);
    else {
      console.log(`  ${loc.results.length} found near ${loc.origin.displayName || `${loc.origin.lat},${loc.origin.lon}`} (via ${loc.provider}):`);
      for (const r of loc.results.slice(0, 25)) {
        console.log(`    ${r.name}${r.distanceMi != null ? `  ${r.distanceMi} mi` : ''}  ${r.address || ''}`);
      }
    }
  }
  console.log(`\n${HOW_WE_DECIDE}`);
}
