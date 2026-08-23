// server.mjs — Maps.MELEK. An OpenStreetMap-based, keyless map surface for the MELEK ecosystem, in the
// SoapBox/MELEK house style (mirrors site/hemp/server.mjs). It REUSES the existing keyless OSM readers —
// it invents no new geocoder or POI layer:
//   • geocoding                 — integrations/soapbox/nominatim.mjs  (geocode → lat/lon/displayName/bbox)
//   • "places near a point"     — integrations/soapbox/osm-poi.mjs    (nearby amenities via Overpass + AMENITIES)
//   • robots/sitemap helpers    — integrations/soapbox/crawlers.mjs
// and cross-links to the wider ecosystem (Move geo-explore, coupons, local-business intel).
//
//   PORT=8144 BASE_URL=https://maps.melek.salon node site/maps/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                 the map page — a search box, a Leaflet map div, and (on ?q=) the resolved place
//                     + an SSR list of nearby POIs. Coords + POIs are also handed to the client map as
//                     inline (script-safe) JSON so Leaflet can drop markers.
//   /api/search?q=    JSON: geocode + nearby POIs for the client. Soft-fails to a shaped empty object.
//   /health           liveness probe
//   /robots.txt /sitemap.xml
//
// ── DISCIPLINE (inherited from the readers) ───────────────────────────────────────────────────────
//   Keyless OSM only (Nominatim + Overpass) — no Google, no API key. Every route SOFT-FAILS: the page
//   renders even when a reader returns nothing (bad query, network down, empty result) — it never throws.
//   esc() on every interpolated HTML value; the client-map JSON is unicode-escaped for <script> context.
//   OSM data is ODbL — "© OpenStreetMap contributors" attribution travels on every page. The client map
//   loads Leaflet + OSM raster tiles from a CDN: this is a NORMAL site page (not an artifact), so external
//   tiles/scripts are fine; the SSR list works with no client JS at all.

import { createServer } from 'node:http';

import * as nominatim from '../../integrations/soapbox/nominatim.mjs';
import * as osmPoi from '../../integrations/soapbox/osm-poi.mjs';
import { robotsTxt, sitemapXml } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8144);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Ecosystem tie-ins (links, not deps). Overridable by env; sensible live defaults.
const MOVE = (process.env.MOVE_SITE || 'https://move.melek.salon').replace(/\/$/, '');
const COUPONS = (process.env.COUPONS_SITE || 'https://coupons.soapbox.community').replace(/\/$/, '');
const DATA = (process.env.SOAPBOX_SITE || 'https://data.soapbox.community').replace(/\/$/, '');

// Leaflet CDN (a normal site page — external assets are allowed here; the SSR list needs none of it).
const LEAFLET_CSS = process.env.LEAFLET_CSS || 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = process.env.LEAFLET_JS || 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© OpenStreetMap contributors';
const DEFAULT_TYPE = 'restaurant';
const DEFAULT_RADIUS_M = 2000;

// ── house-style helpers ───────────────────────────────────────────────────────────────────────────
// esc() escapes the single quote too (matches the readers) so attribute interpolation is always safe.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
// JSON destined for a <script> body: unicode-escape the characters that could break out of the tag.
const safeJson = (obj) => JSON.stringify(obj == null ? null : obj)
  .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const str = (v) => (v == null ? '' : String(v)).trim();
const labelForType = (t) => (osmPoi.AMENITIES.find((a) => a.type === t)?.label || t);

// Haversine distance (meters) so the SSR list can show how far each POI is from the resolved place.
function distanceM(aLat, aLon, bLat, bLon) {
  const vals = [aLat, aLon, bLat, bLon].map(Number);
  if (vals.some((v) => !Number.isFinite(v))) return null;
  const [la1, lo1, la2, lo2] = vals;
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1), dLon = toRad(lo2 - lo1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
const fmtDist = (m) => (m == null ? '' : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

// Normalize a requested amenity type to a known AMENITIES entry; unknown → the default.
function normType(t) {
  const v = str(t).toLowerCase();
  return osmPoi.AMENITIES.some((a) => a.type === v) ? v : DEFAULT_TYPE;
}

// ── the data core — REUSES nominatim.geocode + osm-poi.nearby, soft-fails to a shaped empty object ──
/**
 * searchData(q, { type, radiusM }) → { ok, query, type, typeLabel, place, count, results, attribution }
 *   place:   { lat, lon, displayName } | null      results: [{ name, type, lat, lon, distanceM }]
 * Never throws: any reader failure collapses to place:null / results:[] with ok reflecting whether a
 * place was resolved.
 */
export async function searchData(q, { type, radiusM = DEFAULT_RADIUS_M } = {}) {
  const query = str(q);
  const ty = normType(type);
  const empty = { ok: false, query, type: ty, typeLabel: labelForType(ty), place: null, count: 0, results: [], attribution: ATTRIBUTION };
  if (!query) return empty;
  try {
    const g = await nominatim.geocode(query).catch(() => null);
    if (!g || g.lat == null || g.lon == null) return empty;
    const place = { lat: g.lat, lon: g.lon, displayName: g.displayName || query };
    const raw = await osmPoi.nearby({ lat: place.lat, lon: place.lon, amenity: ty, radiusM }).catch(() => []);
    const results = (Array.isArray(raw) ? raw : []).map((p) => ({
      name: str(p.name) || labelForType(ty),
      type: str(p.type) || ty,
      lat: p.lat,
      lon: p.lon,
      distanceM: distanceM(place.lat, place.lon, p.lat, p.lon),
    })).sort((a, b) => (a.distanceM ?? 1e12) - (b.distanceM ?? 1e12));
    return { ok: true, query, type: ty, typeLabel: labelForType(ty), place, count: results.length, results, attribution: ATTRIBUTION };
  } catch {
    return empty; // soft-fail — never throw to the route
  }
}

// ── styling (MELEK/SoapBox dark theme) ─────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:600;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{position:absolute;top:6px;left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:0 5px;text-transform:uppercase}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  form.msearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  input.q{flex:1 1 260px;min-width:180px;max-width:460px} input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  #map{height:420px;width:100%;border:1px solid var(--line2);border-radius:10px;background:#0b0f14}
  .poi-list{list-style:none;margin:12px 0 0;padding:0}
  .poi{padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
  .poi:last-child{border-bottom:0}
  .poi .nm{font-weight:600} .poi .ty{color:var(--mut);font-size:13px} .poi .ds{margin-left:auto;color:var(--gold);font-size:13px}
  .empty{color:var(--mut);padding:14px 0}
  .tie{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:10px}
  .tie a{display:block;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;background:var(--panel)}
  .tie a:hover{border-color:var(--blue);text-decoration:none} .tie .t{font-weight:700;color:var(--fg)} .tie .d{color:var(--mut);font-size:13px;margin-top:3px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Maps.MELEK</b> — keyless OpenStreetMap, no Google. Geocoding via Nominatim, places via the Overpass API;
  map tiles © OpenStreetMap contributors, ODbL. This surface only shows public OSM data — it stores nothing about you.
  <div style="margin-top:8px"><a href="/">Maps</a> · <a href="${esc(MOVE)}">Move (geo-explore)</a> · <a href="${esc(COUPONS)}">Coupons</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Maps.MELEK — a keyless OpenStreetMap search + nearby-places surface for the MELEK ecosystem. Geocode a place, see what is near it, and jump into Move geo-explore, coupons, and local-business intel.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = opts.head || '';
  const bodyTail = opts.bodyTail || '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}${head}</head><body>
<header class=topbar><a class=brand href="/"><span class=alpha>Alpha</span>🗺️ MELEK <span>maps</span></a>
  <div class=topbar-r><a href="${esc(MOVE)}">Move</a><a href="${esc(COUPONS)}">Coupons</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}${bodyTail}</body></html>`;
}

// The type <select> for the search form, marking the current selection.
function typeSelect(selected) {
  const opts = osmPoi.AMENITIES.map((a) =>
    `<option value="${esc(a.type)}"${a.type === selected ? ' selected' : ''}>${esc(a.label)}</option>`).join('');
  return `<select class=q name=type aria-label="Kind of place">${opts}</select>`;
}

function searchForm(q, type) {
  return `<form class=msearch method=get action="/"><div class=row>
    <input class=q name=q value="${esc(q)}" placeholder="Search a place or address — e.g. Dallas, TX" autocomplete=off aria-label="Place or address">
    ${typeSelect(type)}<button type=submit>Search</button>
  </div></form>`;
}

// The nearby-POI list (SSR — works with zero client JS).
function poiList(data) {
  const results = Array.isArray(data.results) ? data.results : [];
  if (!results.length) return '<p class="empty">No nearby places found for that search yet — try a broader place or a different kind.</p>';
  const rows = results.slice(0, 100).map((p) => `<li class=poi>
    <span class=nm>${esc(p.name)}</span><span class=ty>${esc(p.type)}</span>
    ${p.distanceM != null ? `<span class=ds>${esc(fmtDist(p.distanceM))}</span>` : ''}
  </li>`).join('');
  return `<ul class=poi-list>${rows}</ul>`;
}

const TIE_INS = `<div class=tie>
  <a href="${esc(MOVE)}"><div class=t>Move — geo-explore →</div><div class=d>Walk the map, claim territory, earn on the MELEK chain.</div></a>
  <a href="${esc(COUPONS)}"><div class=t>Coupons &amp; deals →</div><div class=d>Local savings across the SoapBox ecosystem.</div></a>
  <a href="${esc(DATA)}"><div class=t>Local business intel →</div><div class=d>Neighborhood-granular facts on the businesses near you.</div></a>
</div>`;

// ── the map page ────────────────────────────────────────────────────────────────────────────────────
export async function mapPage(q, type) {
  const query = str(q);
  const ty = normType(type);
  const data = query ? await searchData(query, { type: ty }) : null;

  // What the client map needs — coords + markers — as script-safe inline JSON.
  const mapData = {
    center: data && data.place ? [data.place.lat, data.place.lon] : null,
    zoom: data && data.place ? 14 : 4,
    label: data && data.place ? data.place.displayName : '',
    tileUrl: TILE_URL,
    attribution: ATTRIBUTION,
    markers: (data && Array.isArray(data.results) ? data.results : [])
      .filter((p) => p.lat != null && p.lon != null)
      .slice(0, 100)
      .map((p) => ({ lat: p.lat, lon: p.lon, name: p.name, type: p.type })),
  };

  let resultCard = '';
  if (query && data) {
    if (!data.place) {
      resultCard = `<div class=card><p class="empty">Couldn't find “${esc(query)}”. Try a city, an address, or a landmark.</p></div>`;
    } else {
      resultCard = `<div class=card>
        <h2>${esc(data.typeLabel)} near ${esc(data.place.displayName)}</h2>
        <p class=muted style="font-size:13px">${esc(String(data.count))} place${data.count === 1 ? '' : 's'} within ${esc(String(DEFAULT_RADIUS_M / 1000))} km · ${esc(ATTRIBUTION)}</p>
        ${poiList(data)}
      </div>`;
    }
  }

  const body = `<h1>MELEK Maps <span class=muted style="font-size:14px">· keyless OpenStreetMap</span></h1>
    <p class=muted>Search a place or address, see what's nearby, and step into the ecosystem. No Google, no API key —
      just OpenStreetMap. The list below renders even with JavaScript off.</p>
    ${searchForm(query, ty)}
    <div id=map role=application aria-label="Map"></div>
    ${resultCard}
    <div class=card><h2>Explore the ecosystem</h2>${TIE_INS}</div>`;

  // Client map: load Leaflet from CDN, then drop the SSR markers. Guarded so a missing CDN/JS never
  // breaks the page (the SSR list already stands on its own).
  const head = `<link rel=stylesheet href="${esc(LEAFLET_CSS)}">`;
  const script = `<script src="${esc(LEAFLET_JS)}"></script>
<script>
(function(){
  var D = ${safeJson(mapData)};
  try {
    if (typeof L === 'undefined' || !document.getElementById('map')) return;
    var center = D.center || [39.5, -98.35];
    var map = L.map('map').setView(center, D.zoom || 4);
    L.tileLayer(D.tileUrl, { maxZoom: 19, attribution: D.attribution }).addTo(map);
    if (D.center) { L.marker(D.center).addTo(map).bindPopup(D.label || 'Here'); }
    (D.markers || []).forEach(function(m){
      if (m.lat == null || m.lon == null) return;
      L.marker([m.lat, m.lon]).addTo(map).bindPopup((m.name || '') + (m.type ? ' — ' + m.type : ''));
    });
  } catch (e) { /* soft-fail: the SSR list is the source of truth */ }
})();
</script>`;

  return page('MELEK Maps — keyless OpenStreetMap search', body, {
    canonical: `${BASE_URL}/`,
    robots: query ? 'noindex,follow' : 'index,follow',
    head,
    bodyTail: script, // Leaflet + marker init runs after the DOM, so it goes at the tail of <body>.
  });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' });
  res.end(JSON.stringify(obj));
}

const SITEMAP_PATHS = ['/'];

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    const sp = url.searchParams;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: '1.0' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }

    if (path === '/api/search') {
      const data = await searchData(sp.get('q') || '', { type: sp.get('type') || '' });
      return sendJson(res, data);
    }

    if (path === '/') {
      return sendHtml(res, await mapPage(sp.get('q') || '', sp.get('type') || ''));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    // last-ditch soft-fail: never leak a stack, never crash the process.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/maps\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`MELEK Maps on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
