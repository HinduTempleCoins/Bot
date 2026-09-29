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
//   "timeMode": "calendar" | "ago",                     (ago = deep time: years are -(years before present), -3,000,000..0,
//                                                        the counter reads "70,000 years ago")
//   "timeScale": "linear" | "log",                      (log needs ago: equal screen time per factor of years-ago)
//   "note": "…", "endNote": "…",                        (a line under the title on every frame; the end card's caveat line)
//   "size": [1920, 1080],  "fps": 24,  "duration": 60,  (optional; ≤ 3840x2160, fps 12..60, 5..600 s)
//   "territories": { "source": "cliopatria", "names": ["Macedonian Empire", …], "match": ["Egypt"], "context": true }
//                  (names = exact Cliopatria names; match = case-insensitive substrings; context = draw other polities faintly)
//                | { "source": "cliopatria-bbox", "minArea": 20000 }        (every polity in the frame)
//                | { "source": "geojson", "path": "territories.geojson" }  (user data)
//   "routes": [ { "label": "Alexander", "path": "route.csv", "colour": "#e8c170" } ],   (optional)
//   "cities": [ { "name": "Babylon", "lat": 32.54, "lon": 44.42, "from": -1900, "to": 200 } ],  (optional)
//   "credit": "…", "palette": "night" | "parchment", "subtitle": "…", "projection": "auto" | "equirect",
//   "stops": [ {                                       (optional; the march pauses at each, in time order)
//      "label": "Cannae", "lat": 41.3, "lon": 16.1, "year": -216.4,      (year within `years`; fractions allowed)
//      "date": "2 August 216 BC",                        (shown on the card; default = the formatted year)
//      "hold": 20,                                       (seconds on the stop's pictures, 2..180)
//      "media": [ "remake:<scene>/<file>" | "library:<set>/<file>" | "https://…jpg" | { "src": "…", "credit": "…", "caption": "…" } ],
//                 (≤ 12; images or mp4 clips; remake:/library:/anim:/parallax: name our own galleries)
//      "caption": "…", "kind": "record" | "tradition" | "debated" | "interpretation" | "none", "source": "Polybius 3.107–117",
//      "zoom": 3, "chapter": "Italy"
//   } ]
// }
// GeoJSON user data: FeatureCollection; each feature Polygon/MultiPolygon with properties
//   { name (required), fromYear (required), toYear (required), colour? }   — ≤ 5,000 features, ≤ 50 MB.
// Route CSV: header `label,lat,lon,year[,note]`, ≥ 2 rows, years non-decreasing, ≤ 5,000 rows. Route years may be
//   fractional so a march moves smoothly within a year: month m of year Y BC = -Y + (m - 1) / 12 (May 334 BC = -333.67).

export const LIMITS = Object.freeze({ maxW: 3840, maxH: 2160, minFps: 12, maxFps: 60, minDur: 5, maxDur: 600, minYear: -4000, maxYear: 2100, minAgo: -3000000, logOffset: 1000, maxFeatures: 5000, maxRoutePoints: 5000, maxBytes: 50 * 1024 * 1024, maxStops: 60, maxStopMedia: 12 });
export const STOP_KINDS = Object.freeze(['record', 'tradition', 'debated', 'interpretation', 'none']);

/** Validate route stops (mirrors render_map.validate_stops). Returns normalised stops; throws with a clear message. */
export function validateStops(stops, years, mode = 'calendar') {
  if (stops == null) return [];
  if (!Array.isArray(stops) || stops.length > LIMITS.maxStops) throw new Error(`stops must be a list of at most ${LIMITS.maxStops}`);
  let prev = null;
  return stops.map((st, i) => {
    const where = `stops[${i}]`;
    if (!st || typeof st !== 'object' || !st.label || String(st.label).length > 80) throw new Error(`${where}: label is required (≤ 80 characters)`);
    if (!(st.lat >= -90 && st.lat <= 90) || !(st.lon >= -180 && st.lon <= 180)) throw new Error(`${where}: lat/lon out of range`);
    if (!Number.isFinite(st.year) || st.year < years[0] || st.year > years[1]) throw new Error(`${where}: year must lie within the job's years`);
    if (prev != null && st.year < prev) throw new Error(`${where}: stops must be in time order`);
    prev = st.year;
    const hold = st.hold ?? 12;
    if (!(hold >= 2 && hold <= 180)) throw new Error(`${where}: hold must be 2..180 seconds`);
    const media = st.media ?? [];
    if (!Array.isArray(media) || media.length > LIMITS.maxStopMedia) throw new Error(`${where}: media must be a list of at most ${LIMITS.maxStopMedia}`);
    const norm = media.map((m, k) => {
      const o = typeof m === 'string' ? { src: m } : m;
      if (!o || typeof o.src !== 'string' || !o.src) throw new Error(`${where}.media[${k}]: needs src (a path or an http(s) URL)`);
      const rel = /^(remake|library|anim|parallax):/.test(o.src) ? o.src.replace(/^[a-z]+:/, '') : o.src;
      if (!/^https?:\/\//.test(o.src) && (rel.split('/').includes('..') || (rel !== o.src && rel.startsWith('/')))) throw new Error(`${where}.media[${k}]: '..' is not allowed in paths`);
      return { src: o.src, credit: String(o.credit || '').slice(0, 300), caption: String(o.caption || '').slice(0, 200) };
    });
    const kind = st.kind ?? 'none';
    if (!STOP_KINDS.includes(kind)) throw new Error(`${where}: kind must be one of ${STOP_KINDS.join(', ')}`);
    const zoom = st.zoom ?? 3;
    if (!(zoom >= 1.2 && zoom <= 12)) throw new Error(`${where}: zoom must be 1.2..12`);
    return { ...st, hold, media: norm, kind, zoom, date: String(st.date || formatTime(st.year, mode)).slice(0, 60) };
  });
}

export function formatYear(y) {
  // year Y BC runs from -Y up to -Y+1 (month m = -Y + (m-1)/12), so a fractional year belongs to its floor
  // (rounding made July 218 BC, -217.42, read "217 BC"); float noise near an integer is snapped first.
  const v = Number(y);
  if (!Number.isFinite(v)) return '';
  const n = Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : Math.floor(v);
  if (n < 0) return `${-n} BC`;
  const ad = n === 0 ? 1 : n;
  return ad < 1000 ? `AD ${ad}` : String(ad);
}

/** Deep time: y = -(years before present), rounded to the scale so the counter ticks cleanly. */
export function formatAgo(y) {
  const a = Math.max(0, -Number(y));
  if (!Number.isFinite(a)) return '';
  const step = a >= 100000 ? 1000 : a >= 10000 ? 100 : a >= 1000 ? 10 : 1;
  const n = Math.round(a / step) * step;
  if (n === 0) return 'Today';
  return `${n.toLocaleString('en-US')} year${n === 1 ? '' : 's'} ago`;
}

export const formatTime = (y, mode = 'calendar') => (mode === 'ago' ? formatAgo(y) : formatYear(y));

/** year at frame i of n: linear from→to, or log-ish in years-ago (300,000→100,000 as long as 30,000→10,000). */
export function yearAt(i, n, from, to, scale = 'linear') {
  if (n <= 1) return from;
  const t = i / (n - 1);
  if (scale !== 'log') return from + (to - from) * t;
  const c = LIMITS.logOffset; const a0 = -from + c; const a1 = -to + c;
  return -(a0 * (a1 / a0) ** t - c);
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

export function parseRouteCsv(text, mode = 'calendar') {
  const lo = mode === 'ago' ? LIMITS.minAgo : LIMITS.minYear; const hi = mode === 'ago' ? 0 : LIMITS.maxYear;
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
    if (!Number.isFinite(p.year) || p.year < lo || p.year > hi) throw new Error(`route CSV row ${i + 2}: year must be a number ${lo}..${hi}${mode === 'ago' ? ' (negative = years ago)' : ' (fractions allowed: May 334 BC = -333.67)'}`);
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
  j.timeMode ??= 'calendar'; j.timeScale ??= 'linear';
  if (!['calendar', 'ago'].includes(j.timeMode)) throw new Error('timeMode must be calendar or ago');
  if (!['linear', 'log'].includes(j.timeScale) || (j.timeScale === 'log' && j.timeMode !== 'ago')) throw new Error('timeScale must be linear, or log (with timeMode ago)');
  const [lo, hi] = j.timeMode === 'ago' ? [LIMITS.minAgo, 0] : [LIMITS.minYear, LIMITS.maxYear];
  const y = j.years;
  if (!Array.isArray(y) || y.length !== 2 || !y.every(Number.isInteger) || y[0] >= y[1] || y[0] < lo || y[1] > hi) throw new Error(`years must be [from, to] integers, from < to, within ${lo}..${hi}${j.timeMode === 'ago' ? ' (negative = years ago)' : ''}`);
  if (String(j.note ?? '').length > 200) throw new Error('note must be ≤ 200 characters');
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
  j.stops = validateStops(j.stops, j.years, j.timeMode);
  return j;
}
