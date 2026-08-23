// radio.mjs — the SoapBox/Pentecaust RADIO reader (media layer, sibling of video-discovery.mjs).
// "Tune In" tier 1: live radio stations. JustWatch/POINT model throughout — we surface a station's
// metadata + its OWN public stream URL and NEVER rehost or re-encode the audio (the station streams
// it; we point the player at their stream). Starts with DALLAS / Texas stations.
//
// Data source: Radio Browser (https://*.api.radio-browser.info) — the community, KEYLESS, open
// directory of internet radio streams that RadioFM / Radioline / Radio.net-style apps build on.
// ~50k stations searchable by name / state / tag / country. No key, no secret.
//
// Pattern matches video-discovery.mjs: ESM, zero deps, __setFetch hook, keyless, graceful soft-fail
// (any network/parse problem → [] , never throws). Posture is POINT (license-router): the stream is
// the broadcaster's own; we link/point, we do not host.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Radio Browser mirrors (any one works; we try in order). Override with RADIO_BROWSER_BASE.
export const RADIO_BASES = (process.env.RADIO_BROWSER_BASE
  ? [process.env.RADIO_BROWSER_BASE]
  : ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info']
).map((b) => b.replace(/\/$/, ''));

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Normalize a Radio Browser record → our shaped station. POINT posture (we never host the audio). */
export function toStation(r = {}) {
  const stream = r.url_resolved || r.url || '';
  if (!r.name || !stream) return null;
  return {
    id: r.stationuuid || stream,
    name: String(r.name).trim(),
    stream,                                   // the broadcaster's own public stream (we POINT here)
    homepage: r.homepage || '',
    favicon: r.favicon || '',
    tags: String(r.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    country: r.country || '', state: r.state || '',
    codec: r.codec || '', bitrate: r.bitrate || 0,
    posture: 'point',                          // license-router: point-to-source, never rehost
  };
}

async function query(path) {
  for (const base of RADIO_BASES) {
    try {
      const res = await _fetch(`${base}${path}`, { headers: { 'user-agent': 'SoapBox-Radio/1.0', accept: 'application/json' } });
      if (!res || !res.ok) continue;
      const j = await res.json();
      if (Array.isArray(j)) return j;
    } catch { /* try the next mirror */ }
  }
  return [];
}

/** Search stations. Any of {name, state, tag, country, limit}. Soft-fail → []. */
export async function searchStations({ name = '', state = '', tag = '', country = '', limit = 40 } = {}) {
  const p = new URLSearchParams();
  if (name) p.set('name', name);
  if (state) p.set('state', state);
  if (tag) p.set('tag', tag);
  if (country) p.set('country', country);
  p.set('limit', String(Math.max(1, Math.min(200, +limit || 40))));
  p.set('hidebroken', 'true'); p.set('order', 'clickcount'); p.set('reverse', 'true');
  const raw = await query(`/json/stations/search?${p.toString()}`);
  return raw.map(toStation).filter(Boolean);
}

/** Dallas-first: stations tagged/located Dallas, then fill with Texas by popularity. */
export async function dallasStations(limit = 40) {
  const byName = await searchStations({ name: 'Dallas', country: 'The United States Of America', limit });
  const byState = await searchStations({ state: 'Texas', country: 'The United States Of America', limit });
  const seen = new Set(); const out = [];
  for (const s of [...byName, ...byState]) { if (!seen.has(s.id)) { seen.add(s.id); out.push(s); } if (out.length >= limit) break; }
  return out;
}

/** Stations by genre/tag (news, jazz, hiphop, talk, …). */
export async function stationsByTag(tag, limit = 40) { return searchStations({ tag, limit }); }

// ── PUBLIC-SAFETY / POLICE-SCANNER feeds ─────────────────────────────────────────────────────────────
// Radio Browser also indexes public-safety SCANNER streams — many big metros run their live dispatch feed
// as an ordinary internet-radio station tagged "scanner" / "police" / "emergency" / "fire". Same directory,
// same keyless API, same POINT posture: we surface the metadata + the broadcaster's OWN public stream and
// never rehost. These are the operator/hobbyist relays a listener could already tune with any radio app.
export const SCANNER_TAGS = ['scanner', 'police', 'emergency', 'fire', 'public safety', 'first responder'];
// Match any of the scanner tags as a whole word/phrase inside a station's tag list (fuzzy tag search on
// Radio Browser can return adjacent hits — this second-pass filter keeps only genuine public-safety feeds).
const SCANNER_RE = new RegExp(`\\b(${SCANNER_TAGS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

/** True if a shaped station carries a public-safety/scanner tag (or says so in its name). */
export function isScannerStation(s) {
  if (!s) return false;
  const hay = [...(s.tags || []), s.name || ''].join(' ');
  return SCANNER_RE.test(hay);
}

// BROADCASTIFY NOTE (researched 2026-08-23): Broadcastify (RadioReference) is the largest public-safety
// scanner directory. Its live feeds ARE plain MP3/AAC stream URLs (e.g. https://audio.broadcastify.com/<id>.mp3),
// and it publishes a "Live Audio Feed Catalog API". BUT that catalog API is licensed and Broadcastify has
// stated it is NOT issuing new keys to "police-scanner-style" apps that wrap its catalog into a competing
// listening experience; premium feeds are also user/password-gated. So we DO NOT add a Broadcastify
// integration here: it would be key-required (against keyless-first) and, for the catalog, effectively
// off-limits. If Broadcastify feeds are ever surfaced, it must be POINT-only and consensual — a feed owner
// listing THEIR OWN public stream URL in a MELEK directory, never us scraping/rehosting the catalog. For
// now the keyless path is Radio Browser's community-listed scanner stations (this function). See also
// .local/PUBLIC_SAFETY_DISPLAY_DESIGN.md for the full posture write-up.

/**
 * Public-safety scanner feeds, Dallas/Texas-first (like dallasStations). Queries each scanner tag on the
 * keyless Radio Browser directory, keeps only genuine public-safety stations (isScannerStation), then
 * orders Dallas → Texas → rest, deduped. POINT posture throughout. Soft-fails to [].
 * @param {{state?:string, limit?:number}} opts  state defaults to Texas; pass '' to go nationwide/global.
 */
export async function scannerStations({ state = 'Texas', limit = 40 } = {}) {
  const per = Math.max(1, Math.min(200, +limit || 40));
  const batches = await Promise.all(SCANNER_TAGS.map((tag) => searchStations({ tag, limit: per })));
  const seen = new Set();
  const all = [];
  for (const s of batches.flat()) {
    if (!s || seen.has(s.id) || !isScannerStation(s)) continue;
    seen.add(s.id); all.push(s);
  }
  const want = String(state || '').toLowerCase();
  const rank = (s) => {
    const st = String(s.state || '').toLowerCase();
    const nm = String(s.name || '').toLowerCase();
    if (/\bdallas\b/.test(nm) || /\bdallas\b/.test(st)) return 0;   // Dallas first
    if (want && st === want) return 1;                              // then the requested state
    if (want && (nm.includes(want) || st.includes(want))) return 2; // loose state match
    return 3;                                                        // everyone else
  };
  all.sort((a, b) => rank(a) - rank(b));
  return all.slice(0, per);
}

/** A tiny HTML station list (esc'd) — an <audio> points at the station's own stream (POINT posture). */
export function renderList(stations = []) {
  if (!stations.length) return '<p class=empty>No stations right now — try another search.</p>';
  return stations.map((s) => `<div class=station data-stream="${esc(s.stream)}">
    <span class=sname>${esc(s.name)}</span>
    <span class=smeta>${esc(s.state || s.country)}${s.tags[0] ? ' · ' + esc(s.tags[0]) : ''}${s.bitrate ? ' · ' + esc(s.bitrate) + 'k' : ''}</span>
    <button class=play data-stream="${esc(s.stream)}" data-name="${esc(s.name)}">▶ Play</button>
  </div>`).join('');
}

export function dataNote() {
  return 'Live radio via Radio Browser (community, keyless). We point to each station’s own public stream — we never rehost or re-encode the audio.';
}
