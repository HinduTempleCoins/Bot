// aviation.mjs — the SoapBox "track flights + airport delays" public reader. Keyless / free sources:
//   • Live aircraft positions — OpenSky Network states API (opensky-network.org/api/states/all),
//     anonymous tier is KEYLESS but rate-limited (anon ~10s resolution, ~400 req/day; a credentialed
//     account gets higher limits). We use the anonymous tier; OpenSky creds are read by ENV NAME ONLY
//     and are entirely optional (presence just sends Basic auth for higher limits — never logged).
//   • Airport status / delays — FAA NAS Status (ASWS) airport-status JSON
//     (nasstatus.faa.gov / soa.smext.faa.gov/asws/api/airport/status/<IATA>), keyless.
//
// Distinct from scanners.mjs (that module is a directory of public live-AUDIO ATC/SDR feeds; this one
// is structured position + delay DATA). Pattern matches usgs-hazards.mjs / weather.mjs: ESM .mjs,
// injectable __setFetch hook, graceful soft-fail (return []/null on any error, NEVER throw), a guarded
// CLI block, HTML-escaped rendering, NO secrets, and as-of timestamps on rendered output.
//
//   import { flightsInArea, airportStatus, majorAirports, summary, renderPage, dataNote } from './aviation.mjs'
//   node integrations/soapbox/aviation.mjs area 36 -84 40 -80
//   node integrations/soapbox/aviation.mjs airport ATL

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Both sources are keyless but ask clients to identify themselves with a User-Agent.
const UA = { 'User-Agent': 'SoapBoxAviation/1.0 (+https://data.soapbox.community)' };

// Optional OpenSky credentials — read by ENV NAME ONLY (never a literal here). When both are present we
// send HTTP Basic auth for the higher (credentialed) rate limit. Absent → anonymous keyless tier.
const OPENSKY_USER_ENV = 'OPENSKY_USERNAME';
const OPENSKY_PASS_ENV = 'OPENSKY_PASSWORD';

// ── pure helpers (unit-tested offline) ──────────────────────────────────────────────────────────────

// HTML-escape EVERY interpolated value. Mirrors usgs-hazards.esc.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// OpenSky /states/all returns a POSITIONAL array per aircraft (no field names). Index map per the API:
//   0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact, 5 longitude, 6 latitude,
//   7 baro_altitude, 8 on_ground, 9 velocity, 10 true_track, 11 vertical_rate, ...
// Normalize one such row → compact record. null if it carries no usable position.
export function normalizeState(s) {
  if (!Array.isArray(s)) return null;
  const lon = num(s[5]);
  const lat = num(s[6]);
  if (lat == null || lon == null) return null;
  return {
    callsign: (typeof s[1] === 'string' ? s[1].trim() : '') || null,
    country: s[2] || null,
    lat,
    lon,
    altitudeM: num(s[7]),
    velocityMs: num(s[9]),
    onGround: s[8] === true,
  };
}

// FAA ASWS reports a delay flag + a Status block. Treat anything explicitly flagged, or carrying a
// non-trivial Status type, as "delayed". Pure so it can be unit-tested.
export function isDelayed(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.Delay === true || json.delay === true) return true;
  const type = json?.Status?.Type || json?.status?.type || '';
  const t = String(type).toLowerCase();
  return t !== '' && t !== 'normal' && t !== 'no delay';
}

// ── curated major-airport reference (static) ────────────────────────────────────────────────────────

// A curated list of the busiest US airports (IATA + name). Drives the default airport-status sweep and
// gives the UI a stable menu independent of any live call.
const MAJOR_AIRPORTS = [
  { iata: 'ATL', name: 'Hartsfield–Jackson Atlanta International' },
  { iata: 'LAX', name: 'Los Angeles International' },
  { iata: 'ORD', name: "Chicago O'Hare International" },
  { iata: 'DFW', name: 'Dallas/Fort Worth International' },
  { iata: 'DEN', name: 'Denver International' },
  { iata: 'JFK', name: 'John F. Kennedy International (New York)' },
  { iata: 'SFO', name: 'San Francisco International' },
  { iata: 'SEA', name: 'Seattle–Tacoma International' },
  { iata: 'LAS', name: 'Harry Reid International (Las Vegas)' },
  { iata: 'MCO', name: 'Orlando International' },
  { iata: 'EWR', name: 'Newark Liberty International' },
  { iata: 'MIA', name: 'Miami International' },
  { iata: 'PHX', name: 'Phoenix Sky Harbor International' },
  { iata: 'IAH', name: 'George Bush Intercontinental (Houston)' },
  { iata: 'BOS', name: 'Boston Logan International' },
  { iata: 'MSP', name: 'Minneapolis–Saint Paul International' },
  { iata: 'DTW', name: 'Detroit Metropolitan Wayne County' },
  { iata: 'LGA', name: 'LaGuardia (New York)' },
  { iata: 'PHL', name: 'Philadelphia International' },
  { iata: 'CLT', name: 'Charlotte Douglas International' },
];

/** A curated list of major US airports (IATA + name). Static; always returned. */
export function majorAirports() {
  return MAJOR_AIRPORTS.map((a) => ({ ...a }));
}

// ── live data (keyless; each fails soft to []/null) ─────────────────────────────────────────────────

/**
 * Live aircraft positions in a bounding box via the OpenSky anonymous (keyless) states API. The anon
 * tier is rate-limited; OpenSky credentials (by env name only, optional) raise the limit when present.
 * Returns normalized records; soft-fails to [].
 * @param {{lamin:number, lomin:number, lamax:number, lomax:number}} box
 */
export async function flightsInArea({ lamin, lomin, lamax, lomax } = {}) {
  const a1 = num(lamin), o1 = num(lomin), a2 = num(lamax), o2 = num(lomax);
  if (a1 == null || o1 == null || a2 == null || o2 == null) return [];
  try {
    const p = new URLSearchParams({
      lamin: String(Math.min(a1, a2)), lamax: String(Math.max(a1, a2)),
      lomin: String(Math.min(o1, o2)), lomax: String(Math.max(o1, o2)),
    });
    const headers = { ...UA };
    // Optional credentialed (higher-limit) tier — read by env NAME only, never a literal.
    const user = process.env[OPENSKY_USER_ENV];
    const pass = process.env[OPENSKY_PASS_ENV];
    if (user && pass) {
      headers.Authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    }
    const r = await _fetch(`https://opensky-network.org/api/states/all?${p.toString()}`, { headers });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const states = (j && Array.isArray(j.states)) ? j.states : [];
    return states.map(normalizeState).filter(Boolean);
  } catch { return []; }
}

/**
 * FAA airport status / delays for a single IATA code via the keyless ASWS service. Returns a normalized
 * record { airport, status, delay, reason, weather }; soft-fails to null.
 * @param {string} iata
 */
export async function airportStatus(iata) {
  const code = String(iata || '').trim().toUpperCase();
  if (!code) return null;
  try {
    const r = await _fetch(`https://soa.smext.faa.gov/asws/api/airport/status/${encodeURIComponent(code)}`, {
      headers: { ...UA, accept: 'application/json' },
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    if (!j || typeof j !== 'object') return null;
    const st = j.Status || j.status || {};
    const weather = j.Weather || j.weather || {};
    const wx = weather?.Weather?.[0]?.Temp?.[0]
      || weather?.Temp?.[0]
      || (typeof weather === 'string' ? weather : null);
    return {
      airport: j.IATA || j.iata || code,
      status: st.Type || st.type || 'Operating normally',
      delay: isDelayed(j),
      reason: st.Reason || st.reason || null,
      weather: wx || null,
    };
  } catch { return null; }
}

/**
 * Sweep airport status across the curated major-airport list (or a supplied list of IATA codes).
 * Each lookup soft-fails independently; returns the array of non-null normalized records.
 */
export async function airportStatuses(codes) {
  const list = Array.isArray(codes) && codes.length
    ? codes
    : majorAirports().map((a) => a.iata);
  const rows = await Promise.all(list.map((c) => airportStatus(c).catch(() => null)));
  return rows.filter(Boolean);
}

// ── summary + provenance + render ─────────────────────────────────────────────────────────────────────

/**
 * Compact rollup for a chip/header: flight count + which airports are delayed.
 * data = { flights:[...], airports:[...] } (either may be missing).
 */
export function summary(data = {}) {
  const flights = Array.isArray(data.flights) ? data.flights : [];
  const airports = Array.isArray(data.airports) ? data.airports : [];
  const delayed = airports.filter((a) => a && a.delay);
  return {
    flightCount: flights.length,
    airportCount: airports.length,
    delayedCount: delayed.length,
    delayed: delayed.map((a) => a.airport),
    asOf: new Date().toISOString(),
  };
}

// Provenance line. names OpenSky + FAA + an as-of date.
export function dataNote(asOf) {
  const when = (asOf && String(asOf).slice(0, 10)) || new Date().toISOString().slice(0, 10);
  return `source: OpenSky Network (live aircraft positions, anonymous tier — rate-limited) / FAA `
    + `(NAS Status / ASWS airport delays), as of ${when}; informational, not for flight operations`;
}

/**
 * Render an escaped HTML aviation section (flights table + airport-status table). EVERY interpolated
 * value is HTML-escaped. data = { flights:[...], airports:[...], asOf }.
 */
export function renderPage(data = {}) {
  const flights = Array.isArray(data.flights) ? data.flights : [];
  const airports = Array.isArray(data.airports) ? data.airports : [];

  const flightRows = flights.slice(0, 50).map((f) => (
    '<tr>'
    + `<td>${esc(f.callsign || '—')}</td>`
    + `<td>${esc(f.country || '—')}</td>`
    + `<td class="num">${f.lat != null ? esc(f.lat) : '—'}</td>`
    + `<td class="num">${f.lon != null ? esc(f.lon) : '—'}</td>`
    + `<td class="num">${f.altitudeM != null ? esc(f.altitudeM) + ' m' : '—'}</td>`
    + `<td class="num">${f.velocityMs != null ? esc(f.velocityMs) + ' m/s' : '—'}</td>`
    + `<td>${f.onGround ? 'on ground' : 'airborne'}</td>`
    + '</tr>'
  )).join('');
  const flightTable = flightRows
    ? '  <h3>Aircraft in view</h3>'
      + '<table class="flights"><thead><tr><th>Callsign</th><th>Country</th><th>Lat</th><th>Lon</th>'
      + '<th>Altitude</th><th>Speed</th><th>State</th></tr></thead>'
      + `<tbody>${flightRows}</tbody></table>`
    : '  <p class="none">No aircraft in the selected area.</p>';

  const airportRows = airports.slice(0, 60).map((a) => (
    '<tr>'
    + `<td>${esc(a.airport || '—')}</td>`
    + `<td>${a.delay ? '<span class="delayed">delayed</span>' : esc(a.status || '—')}</td>`
    + `<td>${esc(a.reason || '—')}</td>`
    + `<td>${esc(a.weather || '—')}</td>`
    + '</tr>'
  )).join('');
  const airportTable = airportRows
    ? '  <h3>Airport status</h3>'
      + '<table class="airports"><thead><tr><th>Airport</th><th>Status</th><th>Reason</th><th>Weather</th></tr></thead>'
      + `<tbody>${airportRows}</tbody></table>`
    : '  <p class="none">No airport status available.</p>';

  return [
    '<section class="aviation">',
    '  <h2>Track Flights &amp; Airport Delays</h2>',
    flightTable,
    airportTable,
    `  <p class="note">${esc(dataNote(data.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/aviation.mjs <area|airport|airports|major|page> [args] ─────────────
if (process.argv[1] && process.argv[1].endsWith('aviation.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'area') {
    const f = await flightsInArea({ lamin: num(rest[0]), lomin: num(rest[1]), lamax: num(rest[2]), lomax: num(rest[3]) }).catch(() => []);
    out(`flightsInArea (${f.length})`, f.slice(0, 20));
  } else if (cmd === 'airport') {
    out('airportStatus', await airportStatus(rest[0]).catch(() => null));
  } else if (cmd === 'airports') {
    out('airportStatuses', await airportStatuses(rest.length ? rest : undefined).catch(() => []));
  } else if (cmd === 'major') {
    out('majorAirports', majorAirports());
  } else if (cmd === 'page') {
    const [flights, airports] = await Promise.all([
      flightsInArea({ lamin: num(rest[0]) ?? 36, lomin: num(rest[1]) ?? -84, lamax: num(rest[2]) ?? 40, lomax: num(rest[3]) ?? -80 }).catch(() => []),
      airportStatuses().catch(() => []),
    ]);
    console.log(renderPage({ flights, airports }));
    console.log('\n', JSON.stringify(summary({ flights, airports }), null, 2));
  } else {
    console.log('usage: aviation.mjs <area <lamin> <lomin> <lamax> <lomax>|airport <IATA>|airports [IATA...]|major|page [lamin lomin lamax lomax]>');
  }
}
