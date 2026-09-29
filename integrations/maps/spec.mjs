// spec.mjs — the job format for Hathor's animated history maps (integrations/maps/render_map.py renders it).
// Used by the Video Studio (users bring their own data) and by our own clip set (integrations/maps/clips/*.json).
// Pure: validate a job, format years, interpolate a route. No I/O. Mirrors the Python renderer's rules.
//
// Years are integers: negative = BC ("-334" → "334 BC"), positive = AD. There is no year 0 (0 is treated as AD 1).
//
// Job:
// {
//   "title": "Alexander's march",                       (required, ≤ 120 chars)
//   "bbox": [lonMin, latMin, lonMax, latMax],           (required, degrees)
//   "years": [from, to],                                (required, from < to, within -4000..2100)
//   "size": [1920, 1080],  "fps": 24,  "duration": 60,  (optional; ≤ 3840x2160, fps 12..60, 5..600 s)
//   "territories": { "source": "cliopatria", "names": ["Macedonian Empire", …], "match": ["Egypt"], "context": true }
//                  (names = exact Cliopatria names; match = case-insensitive substrings; context = draw other polities faintly)
//                | { "source": "cliopatria-bbox", "minArea": 20000 }        (every polity in the frame)
//                | { "source": "geojson", "path": "territories.geojson" }  (user data)
//   "routes": [ { "label": "Alexander", "path": "route.csv", "colour": "#e8c170" } ],   (optional)
//   "cities": [ { "name": "Babylon", "lat": 32.54, "lon": 44.42, "from": -1900, "to": 200 } ],  (optional)
//   "credit": "…", "palette": "night" | "parchment", "subtitle": "…", "projection": "auto" | "equirect"
// }
// GeoJSON user data: FeatureCollection; each feature Polygon/MultiPolygon with properties
//   { name (required), fromYear (required), toYear (required), colour? }   — ≤ 5,000 features, ≤ 50 MB.
// Route CSV: header `label,lat,lon,year[,note]`, ≥ 2 rows, years non-decreasing, ≤ 5,000 rows. Route years may be
//   fractional so a march moves smoothly within a year: month m of year Y BC = -Y + (m - 1) / 12 (May 334 BC = -333.67).

export const LIMITS = Object.freeze({ maxW: 3840, maxH: 2160, minFps: 12, maxFps: 60, minDur: 5, maxDur: 600, minYear: -4000, maxYear: 2100, maxFeatures: 5000, maxRoutePoints: 5000, maxBytes: 50 * 1024 * 1024 });

export function formatYear(y) {
  const n = Math.round(Number(y));
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `${-n} BC`;
  const ad = n === 0 ? 1 : n;
  return ad < 1000 ? `AD ${ad}` : String(ad);
}

/** year at frame i of n (linear from→to). */
export function yearAt(i, n, from, to) {
  if (n <= 1) return from;
  return from + (to - from) * (i / (n - 1));
}

/** Position on a route at a year: { lat, lon, reached: index of last waypoint passed, done } */
export function routeAt(points, year) {
  if (!points.length) return null;
  if (year <= points[0].year) return { lat: points[0].lat, lon: points[0].lon, reached: 0, done: false, started: year >= points[0].year };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]; const b = points[i];
    if (year <= b.year) {
      const t = b.year === a.year ? 1 : (year - a.year) / (b.year - a.year);
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, reached: i - 1, done: false, started: true };
    }
  }
  const last = points[points.length - 1];
  return { lat: last.lat, lon: last.lon, reached: points.length - 1, done: true, started: true };
}

export function parseRouteCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 3) throw new Error('route CSV needs a header and at least 2 waypoints');
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  for (const k of ['label', 'lat', 'lon', 'year']) if (!head.includes(k)) throw new Error(`route CSV header must include ${k}`);
  if (lines.length - 1 > LIMITS.maxRoutePoints) throw new Error(`route CSV has more than ${LIMITS.maxRoutePoints} waypoints`);
  const col = (k) => head.indexOf(k);
  const pts = lines.slice(1).map((l, i) => {
    const c = splitCsv(l);
    const p = { label: (c[col('label')] || '').trim(), lat: Number(c[col('lat')]), lon: Number(c[col('lon')]), year: Number(c[col('year')]), note: col('note') >= 0 ? (c[col('note')] || '').trim() : '' };
    if (!(p.lat >= -90 && p.lat <= 90) || !(p.lon >= -180 && p.lon <= 180)) throw new Error(`route CSV row ${i + 2}: lat/lon out of range`);
    if (!Number.isFinite(p.year) || p.year < LIMITS.minYear || p.year > LIMITS.maxYear) throw new Error(`route CSV row ${i + 2}: year must be a number ${LIMITS.minYear}..${LIMITS.maxYear} (fractions allowed: May 334 BC = -333.67)`);
    return p;
  });
  for (let i = 1; i < pts.length; i++) if (pts[i].year < pts[i - 1].year) throw new Error(`route CSV row ${i + 2}: years must not go backwards`);
  return pts;
}
function splitCsv(line) {
  const out = []; let cur = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

const isRing = (r) => Array.isArray(r) && r.length >= 4 && r.every((p) => Array.isArray(p) && p.length >= 2 && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);

/** Validate user GeoJSON territories. Throws with a clear message; returns the feature count. */
export function validateTerritories(fc) {
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new Error('territories must be a GeoJSON FeatureCollection');
  if (!fc.features.length) throw new Error('territories has no features');
  if (fc.features.length > LIMITS.maxFeatures) throw new Error(`territories has more than ${LIMITS.maxFeatures} features`);
  fc.features.forEach((f, i) => {
    const p = (f && f.properties) || {};
    const g = f && f.geometry;
    const where = `feature ${i}${p.name ? ` (${p.name})` : ''}`;
    if (!p.name || typeof p.name !== 'string') throw new Error(`${where}: properties.name is required`);
    if (!Number.isInteger(p.fromYear) || !Number.isInteger(p.toYear) || p.fromYear > p.toYear) throw new Error(`${where}: fromYear/toYear must be integers with fromYear ≤ toYear`);
    if (p.colour != null && !/^#[0-9a-f]{6}$/i.test(String(p.colour))) throw new Error(`${where}: colour must be #rrggbb`);
    if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) throw new Error(`${where}: geometry must be Polygon or MultiPolygon`);
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    if (!Array.isArray(polys) || !polys.length || !polys.every((poly) => Array.isArray(poly) && poly.length && poly.every(isRing))) throw new Error(`${where}: invalid coordinates (rings need ≥ 4 [lon,lat] points within range)`);
  });
  return fc.features.length;
}

/** Validate a job. Returns a normalised copy (defaults filled). Throws Error with a clear message. */
export function validateJob(job) {
  if (!job || typeof job !== 'object') throw new Error('job must be a JSON object');
  const j = { size: [1920, 1080], fps: 24, duration: 60, palette: 'night', ...job };
  if (!j.title || String(j.title).length > 120) throw new Error('title is required (≤ 120 characters)');
  const b = j.bbox;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || b[0] >= b[2] || b[1] >= b[3] || b[1] < -90 || b[3] > 90 || b[0] < -180 || b[2] > 180) throw new Error('bbox must be [lonMin, latMin, lonMax, latMax] with min < max');
  const y = j.years;
  if (!Array.isArray(y) || y.length !== 2 || !y.every(Number.isInteger) || y[0] >= y[1] || y[0] < LIMITS.minYear || y[1] > LIMITS.maxYear) throw new Error(`years must be [from, to] integers, from < to, within ${LIMITS.minYear}..${LIMITS.maxYear}`);
  const [w, h] = j.size;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 320 || h < 240 || w > LIMITS.maxW || h > LIMITS.maxH || w % 2 || h % 2) throw new Error(`size must be even integers between 320x240 and ${LIMITS.maxW}x${LIMITS.maxH}`);
  if (!Number.isInteger(j.fps) || j.fps < LIMITS.minFps || j.fps > LIMITS.maxFps) throw new Error(`fps must be ${LIMITS.minFps}..${LIMITS.maxFps}`);
  if (!(j.duration >= LIMITS.minDur && j.duration <= LIMITS.maxDur)) throw new Error(`duration must be ${LIMITS.minDur}..${LIMITS.maxDur} seconds`);
  if (!['night', 'parchment'].includes(j.palette)) throw new Error('palette must be night or parchment');
  if (j.projection != null && !['auto', 'equirect'].includes(j.projection)) throw new Error('projection must be auto or equirect');
  const t = j.territories;
  if (t) {
    if (t.source === 'cliopatria') {
      const names = t.names || []; const match = t.match || [];
      if (!Array.isArray(names) || !Array.isArray(match) || !(names.length + match.length) || ![...names, ...match].every((n) => typeof n === 'string' && n.length >= 2)) throw new Error('territories needs names (exact Cliopatria polity names) and/or match (substrings)');
    }
    else if (t.source === 'geojson') { if (!t.path && !t.data) throw new Error('territories.geojson needs a path or data'); if (t.data) validateTerritories(t.data); }
    else if (t.source !== 'cliopatria-bbox') throw new Error('territories.source must be cliopatria, cliopatria-bbox or geojson');
  }
  for (const [i, r] of (j.routes || []).entries()) {
    if (!r.path && !r.points) throw new Error(`routes[${i}] needs a CSV path or points`);
    if (r.colour != null && !/^#[0-9a-f]{6}$/i.test(String(r.colour))) throw new Error(`routes[${i}].colour must be #rrggbb`);
  }
  for (const [i, c] of (j.cities || []).entries()) {
    if (!c.name || !(c.lat >= -90 && c.lat <= 90) || !(c.lon >= -180 && c.lon <= 180)) throw new Error(`cities[${i}] needs name, lat, lon`);
  }
  if (!t && !(j.routes || []).length) throw new Error('a job needs territories and/or routes');
  return j;
}
