// weather.mjs — the SoapBox Weather vertical (queue task #104). Keyless sources only:
//   • NWS  (api.weather.gov)  — US point forecasts + active alerts. Needs a User-Agent header, no key.
//   • Open-Meteo (api.open-meteo.com) — global forecast, fully keyless.
//
// Pattern matches macro.mjs / chyron.mjs: ESM, __setFetch hook, graceful soft-fail (return
// null/[] on error, NEVER throw), a CLI block, and pure helpers unit-tested offline.
//
//   import { forecast, activeAlerts, weatherSummary } from './weather.mjs'
//   node integrations/soapbox/weather.mjs 40.71 -74.01     # NYC

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// NWS asks every client to identify itself; no key, just a UA string.
const UA = { 'User-Agent': 'SoapBoxWeather/1.0 (+https://data.soapbox.community)' };

// ---- pure helpers (unit-tested offline) ----

// NWS alert severity → 0..100 score, mirroring chyron's tiering inputs.
// Extreme=90, Severe=65, Moderate=40, Minor=20, Unknown/other=10.
export function alertSeverityScore(severity) {
  switch (String(severity || '').toLowerCase()) {
    case 'extreme': return 90;
    case 'severe': return 65;
    case 'moderate': return 40;
    case 'minor': return 20;
    default: return 10;
  }
}

// score → tier label (same buckets as chyron.severityTier for consistency).
export function alertTier(score) {
  return score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'med' : 'low';
}

// Open-Meteo WMO weather codes → short human label. Covers the common buckets.
// https://open-meteo.com/en/docs (WMO Weather interpretation codes)
const WMO = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};
export function weatherCodeLabel(code) {
  const c = Number(code);
  return WMO[c] || (Number.isFinite(c) ? `Code ${c}` : 'Unknown');
}

// Celsius → Fahrenheit, rounded. null-safe.
export function cToF(c) {
  if (c == null || !Number.isFinite(Number(c))) return null;
  return Math.round((Number(c) * 9) / 5 + 32);
}

// validate + normalize a {lat,lon} pair → {lat,lon} numbers, or null if out of range / non-numeric.
export function normalizeCoords({ lat, lon } = {}) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

// Normalize one NWS alert GeoJSON feature → a compact, sorted-by-score record. null if unusable.
export function normalizeAlert(feature) {
  const p = feature && feature.properties;
  if (!p) return null;
  const score = alertSeverityScore(p.severity);
  return {
    id: feature.id || p.id || null,
    event: p.event || 'Weather alert',
    severity: p.severity || 'Unknown',
    urgency: p.urgency || null,
    certainty: p.certainty || null,
    area: (p.areaDesc || '').split(';')[0].trim() || null,
    headline: p.headline || null,
    sent: p.sent || null,
    expires: p.expires || null,
    score,
    tier: alertTier(score),
  };
}

// Normalize an Open-Meteo current-weather payload → compact forecast record. null if unusable.
export function normalizeOpenMeteo(json, { lat, lon } = {}) {
  const cur = json && (json.current || json.current_weather);
  if (!cur) return null;
  // current_weather uses `temperature` + `weathercode`; the newer `current` uses `temperature_2m` + `weather_code`.
  const tempC = cur.temperature_2m != null ? cur.temperature_2m : cur.temperature;
  const code = cur.weather_code != null ? cur.weather_code : cur.weathercode;
  const wind = cur.wind_speed_10m != null ? cur.wind_speed_10m : cur.windspeed;
  if (tempC == null) return null;
  return {
    source: 'open-meteo',
    lat: lat != null ? lat : json.latitude,
    lon: lon != null ? lon : json.longitude,
    tempC: Number(tempC),
    tempF: cToF(tempC),
    code: code != null ? Number(code) : null,
    summary: weatherCodeLabel(code),
    windKph: wind != null ? Number(wind) : null,
    time: cur.time || null,
  };
}

// ---- live data (keyless; each fails soft to null/[]) ----

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Global point forecast via Open-Meteo (keyless). Returns a normalized record or null.
 * @param {{lat:number, lon:number}} coords
 */
export async function forecast({ lat, lon } = {}) {
  const c = normalizeCoords({ lat, lon });
  if (!c) return null;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}`
    + '&current=temperature_2m,weather_code,wind_speed_10m';
  const j = await getJson(url);
  return normalizeOpenMeteo(j, c);
}

/**
 * Active NWS alerts. With {lat,lon} → alerts for that point; with {area} (2-letter US state/zone)
 * → alerts for that area; with neither → all active actual alerts. Returns [] on any failure.
 * @param {{area?:string, lat?:number, lon?:number, limit?:number}} opts
 */
export async function activeAlerts({ area, lat, lon, limit = 50 } = {}) {
  let url;
  const c = normalizeCoords({ lat, lon });
  if (area) {
    url = `https://api.weather.gov/alerts/active?area=${encodeURIComponent(String(area).toUpperCase())}&status=actual&limit=${limit}`;
  } else if (c) {
    url = `https://api.weather.gov/alerts/active?point=${c.lat},${c.lon}&status=actual&limit=${limit}`;
  } else {
    url = `https://api.weather.gov/alerts/active?status=actual&limit=${limit}`;
  }
  const j = await getJson(url);
  const feats = (j && j.features) || [];
  return feats.map(normalizeAlert).filter(Boolean).sort((a, b) => b.score - a.score);
}

/**
 * Combined snapshot for a location: the global forecast plus the strongest active US alerts
 * for that point. Soft-fails each half independently; never throws.
 * @param {{lat:number, lon:number, maxAlerts?:number}} opts
 */
export async function weatherSummary({ lat, lon, maxAlerts = 5 } = {}) {
  const c = normalizeCoords({ lat, lon });
  if (!c) return null;
  const [fc, alerts] = await Promise.all([
    forecast(c).catch(() => null),
    activeAlerts(c).catch(() => []),
  ]);
  const top = (alerts || []).slice(0, maxAlerts);
  return {
    lat: c.lat,
    lon: c.lon,
    forecast: fc,
    alerts: top,
    alertCount: (alerts || []).length,
    worst: top[0] || null,
  };
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('weather.mjs')) {
  const lat = Number(process.argv[2] ?? 40.7128);
  const lon = Number(process.argv[3] ?? -74.006);
  const s = await weatherSummary({ lat, lon }).catch((e) => { console.error(e.message); return null; });
  if (!s) { console.log('No data.'); }
  else {
    console.log(`SoapBox Weather — ${s.lat}, ${s.lon}`);
    console.log('─'.repeat(50));
    if (s.forecast) console.log(`  Now: ${s.forecast.summary}  ${s.forecast.tempF}°F (${s.forecast.tempC}°C)  wind ${s.forecast.windKph ?? '?'} km/h`);
    else console.log('  Forecast: unavailable');
    console.log(`  Active alerts: ${s.alertCount}`);
    for (const a of s.alerts) console.log(`    [${a.tier.toUpperCase().padEnd(8)}] ${a.event} — ${a.area || 'US'}`);
  }
}
