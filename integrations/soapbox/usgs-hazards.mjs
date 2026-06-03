// usgs-hazards.mjs — the SoapBox "Is there a hazard near me?" reader over USGS natural-hazard data.
// Keyless, free sources only:
//   • Earthquakes — USGS FDSN event service (earthquake.usgs.gov/fdsnws/event/1/query) + the
//     significant-quake summary GeoJSON feed.
//   • Volcanoes   — USGS Volcano Hazards status (volcanoes.usgs.gov) elevated-alert levels.
//   • Floods      — real-time streamflow status is served by the EXISTING USGS Water reader in
//     gov-readers.mjs (#182). We do NOT duplicate it; floodReader() links/defers to it.
//
// Pattern matches weather.mjs / chyron.mjs / cdc-health.mjs: ESM, injectable __setFetch hook,
// graceful soft-fail (return null/[] on any error, NEVER throw), a guarded CLI block, HTML-escaped
// rendering, NO secrets (all sources are keyless), and as-of timestamps on rendered output.
//
//   import { earthquakes, recentSignificant, volcanoes, hazardSummary, renderPage } from './usgs-hazards.mjs'
//   node integrations/soapbox/usgs-hazards.mjs quakes 4.5
//   node integrations/soapbox/usgs-hazards.mjs near 34.05 -118.24 200

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// USGS is keyless but asks clients to identify themselves with a User-Agent.
const UA = { 'User-Agent': 'SoapBoxHazards/1.0 (+https://data.soapbox.community)' };
const SOURCE = 'USGS';

// ── pure helpers (unit-tested offline) ──────────────────────────────────────────────────────────────

// HTML-escape EVERY interpolated value. Mirrors cdc-health.esc.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// USGS volcano alert level → 0..100 severity (drives ordering/color). WARNING highest.
export function volcanoSeverity(alertLevel) {
  switch (String(alertLevel || '').toUpperCase()) {
    case 'WARNING': return 90;
    case 'WATCH': return 65;
    case 'ADVISORY': return 40;
    case 'NORMAL': return 10;
    default: return 0; // UNASSIGNED / unknown
  }
}

// An alert is "elevated" (worth surfacing on a hazard page) if above NORMAL.
export function isElevatedVolcano(alertLevel) {
  const a = String(alertLevel || '').toUpperCase();
  return a === 'WARNING' || a === 'WATCH' || a === 'ADVISORY';
}

// Great-circle distance (km) between two lat/lon points. null if either is non-numeric.
export function haversineKm(lat1, lon1, lat2, lon2) {
  const a1 = num(lat1), o1 = num(lon1), a2 = num(lat2), o2 = num(lon2);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1), dLon = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

// Normalize one USGS earthquake GeoJSON feature → compact record. null if unusable.
export function normalizeQuake(feature) {
  const p = feature && feature.properties;
  const g = feature && feature.geometry;
  if (!p) return null;
  const coords = (g && Array.isArray(g.coordinates)) ? g.coordinates : [];
  const mag = num(p.mag);
  return {
    mag,
    place: p.place || 'unknown location',
    time: num(p.time) != null ? new Date(num(p.time)).toISOString() : null,
    depthKm: coords.length >= 3 ? num(coords[2]) : null,
    url: p.url || null,
    lat: coords.length >= 2 ? num(coords[1]) : null,
    lon: coords.length >= 1 ? num(coords[0]) : null,
  };
}

// ── live data (keyless; each fails soft to null/[]) ─────────────────────────────────────────────────

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * USGS FDSN earthquake query (keyless GeoJSON). Returns normalized records sorted by magnitude desc.
 * @param {{minMagnitude?:number, area?:{minLat,maxLat,minLon,maxLon}, limit?:number, days?:number}} opts
 */
export async function earthquakes({ minMagnitude = 2.5, area, limit = 50, days = 7 } = {}) {
  const p = new URLSearchParams({ format: 'geojson', orderby: 'magnitude' });
  if (minMagnitude != null) p.set('minmagnitude', String(minMagnitude));
  if (limit != null) p.set('limit', String(Math.max(1, Math.min(2000, limit))));
  if (days != null) {
    const start = new Date(Date.now() - days * 86400000).toISOString();
    p.set('starttime', start);
  }
  if (area && area.minLat != null) {
    p.set('minlatitude', String(area.minLat));
    p.set('maxlatitude', String(area.maxLat));
    p.set('minlongitude', String(area.minLon));
    p.set('maxlongitude', String(area.maxLon));
  }
  const j = await getJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?${p.toString()}`);
  const feats = (j && j.features) || [];
  return feats.map(normalizeQuake).filter(Boolean)
    .sort((a, b) => (b.mag || 0) - (a.mag || 0));
}

/**
 * Significant quakes (past 30 days) from the USGS summary GeoJSON feed. Soft-fails to [].
 */
export async function recentSignificant() {
  const j = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_month.geojson');
  const feats = (j && j.features) || [];
  return feats.map(normalizeQuake).filter(Boolean)
    .sort((a, b) => (b.mag || 0) - (a.mag || 0));
}

/**
 * US volcano alert levels from USGS Volcano Hazards. Returns normalized records sorted by severity.
 * Soft-fails to []. The USGS feed shape carries volcano name + alert_level + color_code.
 */
export async function volcanoes({ elevatedOnly = false } = {}) {
  const j = await getJson('https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes');
  // The HANS API returns either a bare array or { items: [...] } across versions; tolerate both.
  const rows = Array.isArray(j) ? j : ((j && (j.items || j.data)) || []);
  const out = rows.map((v) => {
    const name = v.volcano_name || v.name || v.volcanoName || 'Unknown volcano';
    const alertLevel = v.alert_level || v.alertLevel || v.nws_id || v.aviation_color_code_alert || 'UNASSIGNED';
    const colorCode = v.color_code || v.colorCode || v.aviation_color_code || null;
    return {
      name,
      alertLevel: String(alertLevel).toUpperCase(),
      colorCode: colorCode ? String(colorCode).toUpperCase() : null,
      severity: volcanoSeverity(alertLevel),
    };
  });
  const filtered = elevatedOnly ? out.filter((v) => isElevatedVolcano(v.alertLevel)) : out;
  return filtered.sort((a, b) => b.severity - a.severity);
}

/**
 * Real-time streamflow / flood status is owned by the existing USGS Water reader (gov-readers.mjs,
 * task #182). We do NOT duplicate it — defensively import and defer. Returns the water rows for a
 * site (or null if the reader is unavailable / errors). Soft-fail by construction.
 * @param {{site?:string, period?:string}} opts
 */
export async function floodReader({ site = '01646500', period = 'P1D' } = {}) {
  try {
    const gr = await import('./gov-readers.mjs');
    if (typeof gr.usgsWater !== 'function') return null;
    return await gr.usgsWater({ site, period }).catch(() => null);
  } catch { return null; }
}

/**
 * "Is there a hazard near me?" — nearby quakes (within radiusKm of lat/lon) plus any elevated
 * US volcano alerts. Soft-fails each half independently; never throws.
 * @param {{lat:number, lon:number, radiusKm?:number, minMagnitude?:number}} opts
 */
export async function hazardSummary({ lat, lon, radiusKm = 300, minMagnitude = 2.5 } = {}) {
  const la = num(lat), lo = num(lon);
  // Query a generous bounding box around the point, then refine with haversine.
  const degPad = Math.max(1, radiusKm / 100); // ~1° ≈ 111km; pad loosely, refine below.
  const area = la != null && lo != null
    ? { minLat: la - degPad, maxLat: la + degPad, minLon: lo - degPad, maxLon: lo + degPad }
    : undefined;

  const [quakesRaw, volcsRaw] = await Promise.all([
    earthquakes({ minMagnitude, area, limit: 100 }).catch(() => []),
    volcanoes({ elevatedOnly: true }).catch(() => []),
  ]);

  const nearbyQuakes = (la != null && lo != null)
    ? (quakesRaw || []).map((q) => {
        const d = haversineKm(la, lo, q.lat, q.lon);
        return { ...q, distanceKm: d };
      }).filter((q) => q.distanceKm == null || q.distanceKm <= radiusKm)
        .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9))
    : (quakesRaw || []);

  return {
    lat: la,
    lon: lo,
    radiusKm,
    quakes: nearbyQuakes,
    volcanoes: volcsRaw || [],
    quakeCount: nearbyQuakes.length,
    elevatedVolcanoCount: (volcsRaw || []).length,
    worstQuake: nearbyQuakes[0] || null,
    asOf: new Date().toISOString(),
  };
}

// ── provenance + render ─────────────────────────────────────────────────────────────────────────────

// Provenance line. names USGS + an as-of date.
export function dataNote(asOf) {
  const when = (asOf && String(asOf).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE} (Earthquake Hazards, Volcano Hazards & Water Services), as of ${when}; informational, not emergency guidance`;
}

/**
 * Render an escaped HTML hazards section. EVERY interpolated value is HTML-escaped.
 * data = { quakes:[...], volcanoes:[...], lat, lon, radiusKm, asOf }
 */
export function renderPage(data = {}) {
  const quakes = Array.isArray(data.quakes) ? data.quakes : [];
  const volcs = Array.isArray(data.volcanoes) ? data.volcanoes : [];
  const where = (data.lat != null && data.lon != null)
    ? `near ${esc(data.lat)}, ${esc(data.lon)}${data.radiusKm ? ` (within ${esc(data.radiusKm)} km)` : ''}`
    : '';

  const quakeRows = quakes.slice(0, 20).map((q) => (
    '<tr>'
    + `<td class="num">${q.mag != null ? esc(q.mag.toFixed ? q.mag.toFixed(1) : q.mag) : '—'}</td>`
    + `<td>${esc(q.place)}</td>`
    + `<td class="num">${q.depthKm != null ? esc(q.depthKm) : '—'}</td>`
    + `<td>${q.distanceKm != null ? esc(q.distanceKm) + ' km' : (q.time ? esc(q.time) : '—')}</td>`
    + `<td>${q.url ? `<a href="${esc(q.url)}" rel="noopener nofollow">details</a>` : '—'}</td>`
    + '</tr>'
  )).join('');
  const quakeTable = quakeRows
    ? '  <h3>Recent earthquakes</h3>'
      + '<table class="quakes"><thead><tr><th>Mag</th><th>Place</th><th>Depth km</th>'
      + '<th>Distance / time</th><th>Link</th></tr></thead>'
      + `<tbody>${quakeRows}</tbody></table>`
    : '  <p class="none">No recent earthquakes found.</p>';

  const volcRows = volcs.slice(0, 20).map((v) => (
    `<tr><td>${esc(v.name)}</td><td>${esc(v.alertLevel)}</td><td>${esc(v.colorCode || '—')}</td></tr>`
  )).join('');
  const volcTable = volcRows
    ? '  <h3>Elevated volcano alerts</h3>'
      + '<table class="volcanoes"><thead><tr><th>Volcano</th><th>Alert level</th><th>Aviation color</th></tr></thead>'
      + `<tbody>${volcRows}</tbody></table>`
    : '  <p class="none">No elevated volcano alerts.</p>';

  return [
    '<section class="usgs-hazards">',
    `  <h2>Natural Hazards${where ? ` — ${where}` : ''}</h2>`,
    quakeTable,
    volcTable,
    '  <p class="disclaimer">Informational only — for emergencies follow official local guidance.</p>',
    `  <p class="note">${esc(dataNote(data.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/usgs-hazards.mjs <quakes|sig|volcanoes|near|page> [args] ──────────
if (process.argv[1] && process.argv[1].endsWith('usgs-hazards.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'quakes') out('earthquakes', await earthquakes({ minMagnitude: num(rest[0]) ?? 4.5 }).catch(() => []));
  else if (cmd === 'sig') out('significant', await recentSignificant().catch(() => []));
  else if (cmd === 'volcanoes') out('volcanoes', await volcanoes({ elevatedOnly: true }).catch(() => []));
  else if (cmd === 'near') {
    const s = await hazardSummary({ lat: num(rest[0]), lon: num(rest[1]), radiusKm: num(rest[2]) ?? 300 }).catch(() => null);
    out('hazardSummary', s);
  } else if (cmd === 'page') {
    const s = await hazardSummary({ lat: num(rest[0]) ?? 34.05, lon: num(rest[1]) ?? -118.24, radiusKm: num(rest[2]) ?? 300 }).catch(() => null);
    console.log(renderPage(s || {}));
  } else {
    console.log('usage: usgs-hazards.mjs <quakes [minMag]|sig|volcanoes|near <lat> <lon> [km]|page [lat] [lon] [km]>');
  }
}
