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
