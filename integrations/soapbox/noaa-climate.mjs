// noaa-climate.mjs — the SoapBox ocean/climate reader. Distinct from weather.mjs (which does NWS point
// forecasts + Open-Meteo). This one reads NOAA's free ocean & climate data:
//   • CO-OPS Tides & Currents (api.tidesandcurrents.noaa.gov) — tide predictions + observed water levels.
//     Fully keyless. https://api.tidesandcurrents.noaa.gov/api/prod/
//   • CPC seasonal climate outlooks (Climate Prediction Center) — temperature / precipitation lean.
//
// Pattern matches weather.mjs / macro.mjs: ESM, __setFetch hook, graceful soft-fail (return null/[] on
// error, NEVER throw), a guarded CLI block, escaped rendered HTML, and pure helpers unit-tested offline.
//
//   import { tides, waterLevel, climateOutlook, STATIONS, renderPage, dataNote } from './noaa-climate.mjs'
//   node integrations/soapbox/noaa-climate.mjs 8518750   # The Battery, NY

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// NOAA asks clients to identify themselves; no key required for CO-OPS.
const UA = { 'User-Agent': 'SoapBoxClimate/1.0 (+https://data.soapbox.community)' };

// ---- curated CO-OPS stations (a few well-known US coastal tide gauges) ----
// id → human name. Station ids are CO-OPS' own 7-digit identifiers.
export const STATIONS = [
  { id: '8518750', name: 'The Battery, NY' },
  { id: '8443970', name: 'Boston, MA' },
  { id: '8723214', name: 'Virginia Key, FL' },
  { id: '9410230', name: 'La Jolla, CA' },
  { id: '9414290', name: 'San Francisco, CA' },
  { id: '9447130', name: 'Seattle, WA' },
  { id: '8761724', name: 'Grand Isle, LA' },
  { id: '1612340', name: 'Honolulu, HI' },
];

// ---- pure helpers (unit-tested offline) ----

// Minimal HTML-escape for rendered text (matches the sibling soapbox modules).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

// CO-OPS prediction "type": H = high tide, L = low tide. Normalize to that or null.
export function tideType(t) {
  const s = String(t || '').trim().toUpperCase();
  return s === 'H' || s === 'L' ? s : null;
}

// Normalize one CO-OPS hilo prediction row → { time, type, heightFt } or null if unusable.
// CO-OPS rows look like { t: '2026-06-03 03:24', v: '4.521', type: 'H' }; units=english → feet.
export function normalizePrediction(row) {
  if (!row) return null;
  const time = row.t || row.time || null;
  const type = tideType(row.type);
  const heightFt = num(row.v != null ? row.v : row.heightFt);
  if (!time || !type || heightFt == null) return null;
  return { time, type, heightFt };
}

// Normalize a CO-OPS water_level observation payload → { time, heightFt } or null.
// Shape: { data: [ { t, v, ... } ] } — we take the latest (last) usable reading.
export function normalizeWaterLevel(json) {
  const rows = (json && (json.data || json.predictions)) || [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const heightFt = num(r && (r.v != null ? r.v : r.heightFt));
    const time = r && (r.t || r.time);
    if (time && heightFt != null) return { time, heightFt };
  }
  return null;
}

// Normalize a CPC seasonal-outlook payload → { period, tempLean, precipLean, confidence }.
// CPC feeds vary; accept a small, tolerant shape and lean labels to a stable vocabulary.
export function normalizeLean(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return 'near-normal';
  if (s.startsWith('above') || s === 'a' || s.startsWith('warm') || s.startsWith('wet')) return 'above';
  if (s.startsWith('below') || s === 'b' || s.startsWith('cool') || s.startsWith('cold') || s.startsWith('dry')) return 'below';
  return 'near-normal';
}

export function normalizeOutlook(json) {
  if (!json) return null;
  const o = json.outlook || json;
  const period = o.period || o.season || o.lead || null;
  if (o.temp == null && o.tempLean == null && o.precip == null && o.precipLean == null) return null;
  return {
    period: period || 'seasonal',
    tempLean: normalizeLean(o.tempLean != null ? o.tempLean : o.temp),
    precipLean: normalizeLean(o.precipLean != null ? o.precipLean : o.precip),
    confidence: o.confidence || o.probability || null,
  };
}

// ---- live data (keyless; each fails soft to null/[]) ----

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// CO-OPS wants YYYYMMDD dates. begin = today (UTC), range expressed in days via `range` hours.
function ymd(d) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

/**
 * Tide predictions (high/low) for a CO-OPS station. Returns [] on any failure.
 * @param {{station:string, days?:number}} opts
 * @returns {Promise<Array<{time:string,type:'H'|'L',heightFt:number}>>}
 */
export async function tides({ station, days = 2 } = {}) {
  if (!station) return [];
  const begin = ymd(new Date());
  const range = Math.max(1, Math.min(30, Number(days) || 2)) * 24; // CO-OPS `range` is in hours
  const url = `${COOPS}?product=predictions&datum=MLLW&interval=hilo&format=json`
    + `&units=english&time_zone=lst_ldt&begin_date=${begin}&range=${range}`
    + `&station=${encodeURIComponent(String(station))}`;
  const j = await getJson(url);
  const rows = (j && j.predictions) || [];
  return rows.map(normalizePrediction).filter(Boolean);
}

/**
 * Latest observed water level for a CO-OPS station. Returns { station, name, time, heightFt } or null.
 * @param {{station:string}} opts
 */
export async function waterLevel({ station } = {}) {
  if (!station) return null;
  const url = `${COOPS}?product=water_level&datum=MLLW&date=latest&format=json`
    + `&units=english&time_zone=lst_ldt&station=${encodeURIComponent(String(station))}`;
  const j = await getJson(url);
  const w = normalizeWaterLevel(j);
  if (!w) return null;
  const name = (STATIONS.find((s) => s.id === String(station)) || {}).name || null;
  return { station: String(station), name, time: w.time, heightFt: w.heightFt };
}

/**
 * CPC seasonal climate outlook (temperature / precipitation lean). Keyless feed; normalized.
 * Returns a normalized outlook record or null on any failure.
 */
export async function climateOutlook() {
  // CPC publishes outlook products as JSON; URL kept here so the live source is overridable via __setFetch.
  const url = 'https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.json';
  const j = await getJson(url);
  return normalizeOutlook(j);
}

// ---- rendering ----

/**
 * Escaped HTML section: a tide table for one station + the seasonal outlook. PURE, soft-handles missing.
 * @param {{station?:string, name?:string, tides?:Array, water?:object, outlook?:object}} data
 */
export function renderPage(data = {}) {
  const name = esc(data.name || (data.station ? `Station ${data.station}` : 'Station'));
  const parts = [`<section class="noaa-climate"><h2>Tides &amp; Climate — ${name}</h2>`];

  const rows = Array.isArray(data.tides) ? data.tides : [];
  if (rows.length) {
    parts.push('<table class="tides"><thead><tr><th>Time</th><th>Tide</th><th>Height (ft)</th></tr></thead><tbody>');
    for (const r of rows) {
      const label = r.type === 'H' ? 'High' : r.type === 'L' ? 'Low' : esc(r.type);
      parts.push(`<tr><td>${esc(r.time)}</td><td>${esc(label)}</td><td>${esc(r.heightFt)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="tides-empty">Tide predictions unavailable.</p>');
  }

  if (data.water) {
    parts.push(`<p class="water-level">Latest water level: ${esc(data.water.heightFt)} ft (as of ${esc(data.water.time)})</p>`);
  }

  if (data.outlook) {
    const o = data.outlook;
    parts.push(`<p class="outlook">Seasonal outlook (${esc(o.period)}): temperature leans <strong>${esc(o.tempLean)}</strong>, precipitation leans <strong>${esc(o.precipLean)}</strong>.</p>`);
  }

  parts.push(`<p class="data-note">${esc(dataNote())}</p>`);
  parts.push('</section>');
  return parts.join('');
}

/** Provenance line with an as-of date. */
export function dataNote() {
  return `source: NOAA CO-OPS / CPC, as of ${new Date().toISOString().slice(0, 10)}`;
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('noaa-climate.mjs')) {
  const station = process.argv[2] || STATIONS[0].id;
  const [t, w, o] = await Promise.all([
    tides({ station }).catch(() => []),
    waterLevel({ station }).catch(() => null),
    climateOutlook().catch(() => null),
  ]);
  const name = (STATIONS.find((s) => s.id === String(station)) || {}).name || `Station ${station}`;
  console.log(`SoapBox Tides & Climate — ${name} (${station})`);
  console.log('─'.repeat(50));
  if (t.length) for (const r of t) console.log(`  ${r.time}  ${r.type === 'H' ? 'High' : 'Low '}  ${r.heightFt} ft`);
  else console.log('  Tide predictions: unavailable');
  if (w) console.log(`  Latest water level: ${w.heightFt} ft (${w.time})`);
  if (o) console.log(`  Outlook (${o.period}): temp ${o.tempLean}, precip ${o.precipLean}`);
  console.log(`  ${dataNote()}`);
}
