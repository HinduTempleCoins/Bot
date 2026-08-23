// camera-directory.mjs — the CAMERA DIRECTORY reader (Phase 1 of the live-view / camera app).
// See .local/CAMERA_LIVEVIEW_APP_DESIGN.md. Sibling of radio.mjs / minecraft.mjs: keyless-first,
// __setFetch injectable, soft-fail-never-throw, provenance/attribution on every row.
//
// THE HARD ETHICS BOUNDARY (load-bearing — stated in the UI, the README, and here):
//   Public cameras = CONSENSUAL / OFFICIAL / EMBEDDABLE directories ONLY. We point at cameras whose
//   owners PUBLISH them for public viewing through a real API or official embed: official DOT / 511
//   traffic cams, tourism / wildlife / institution live streams (their own YouTube/Vimeo lives), and
//   the Windy Webcams API (only when WINDY_API_KEY is configured). We NEVER scrape, index, or probe
//   strangers' unsecured/misconfigured cameras — no Insecam-style behavior, no credential probing,
//   no port-scanning for open RTSP/MJPEG, no "found on the internet" feeds. This is a HARD LINE.
//
// POSTURE (license-router HOST/WINDOW/POINT vocabulary, defensively imported):
//   window — an official embed surface (YouTube/Vimeo live, Windy's player). We DISPLAY, never store.
//   point  — a link-out to the owner's official stream/page (e.g. a DOT MJPEG). We POINT, never rehost.
//   NEVER host — we never download, re-encode, or store a third party's frames.
//
//   import { CAMS, listCams, searchCams, windyCams, refuseHost, esc, safeHref, dataNote, __setFetch }
//     from './camera-directory.mjs'
//   node integrations/camera-directory.mjs            # list the seed directory (offline)

// ── posture vocabulary (defensive reuse of the license-router's HOST/WINDOW/POINT) ─────────────────
let _POSTURES;
try { ({ POSTURES: _POSTURES } = await import('./license-router.mjs')); } catch { _POSTURES = null; }
export const POSTURE = Object.freeze(
  _POSTURES && _POSTURES.WINDOW ? _POSTURES : { HOST: 'host', WINDOW: 'window', POINT: 'point' },
);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── html safety ─────────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only http(s) URLs may be used as hrefs/embeds — esc() does NOT neutralize javascript:/data: URIs.
export function safeHref(u) {
  const raw = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

// ── the hard-line refuse test ─────────────────────────────────────────────────────────────────────
// Any source string that smells of a scraper / open-camera aggregator / credential-probe is REFUSED
// outright, mirroring the license-router's REFUSED_EMBED_MARKERS. This runs BEFORE anything is shown.
const REFUSED_MARKERS = [
  'insecam', 'opentopia', 'shodan', 'earthcam-scrape', 'ipvm-scrape',
  'unsecured', 'default-password', 'defaultpassword', 'admin:admin', 'port-scan', 'portscan',
  'scraper', 'scrape', 'pirate', 'leak', 'hacked', 'unauthorized',
];
/** True if a source/host string matches a known scraper / open-camera-aggregator marker → never shown. */
export function refuseHost(s) {
  const h = String(s == null ? '' : s).toLowerCase();
  if (!h) return false;
  return REFUSED_MARKERS.some((m) => h.includes(m));
}

// ── the curated seed directory (DATA — real, well-known official/embeddable public cams) ────────────
// Every record: { id, name, region, category, source, posture, embed?, attribution }.
//   embed present → WINDOW posture (an official iframe surface). embed absent → POINT (link-out only).
// These are institutions' OWN official live streams (keyless YouTube embeds) and official DOT open-data
// pages — the exact consensual sources the boundary permits. No stranger's camera is ever listed here.
const SEED = [
  // — Wildlife / nature (institutions' own official YouTube lives; keyless WINDOW embed) —
  { id: 'monterey-bay-aquarium', name: 'Monterey Bay Aquarium — Kelp Forest', region: 'Monterey, CA, USA',
    category: 'nature', source: 'https://www.youtube.com/@montereybayaquarium/streams',
    embed: 'https://www.youtube.com/embed/live_stream?channel=UCM5Dj-w6R4Ky-lU4B6DHkbg',
    attribution: 'Monterey Bay Aquarium (official live stream)' },
  { id: 'explore-africa-waterhole', name: 'Africam — Tembe Elephant Park Waterhole', region: 'Tembe, South Africa',
    category: 'nature', source: 'https://www.africam.com/wildlife/tembe-elephant-park',
    embed: 'https://www.youtube.com/embed/live_stream?channel=UCthDp8pDbLD7GXm0EiTB0Zg',
    attribution: 'Africam (official wildlife live stream)' },
  { id: 'explore-brown-bears', name: 'Explore.org — Brooks Falls Brown Bears', region: 'Katmai NP, AK, USA',
    category: 'nature', source: 'https://explore.org/livecams/brown-bears/brown-bear-salmon-cam-brooks-falls',
    embed: 'https://www.youtube.com/embed/live_stream?channel=UCiWuvBw80mIN8Bl_gGN7Wpg',
    attribution: 'Explore.org (official live cam)' },

  // — City / skyline (institutions' or broadcasters' own official lives; keyless WINDOW embed) —
  { id: 'times-square-live', name: 'Times Square — EarthCam Official Live', region: 'New York, NY, USA',
    category: 'city', source: 'https://www.earthcam.com/usa/newyork/timessquare/',
    embed: 'https://www.youtube.com/embed/live_stream?channel=UCiWuvBw80mIN8Bl_gGN7Wpg',
    attribution: 'EarthCam (official embed — point-only)' },
  { id: 'venice-rialto', name: 'Venice — Rialto Bridge Live', region: 'Venice, Italy',
    category: 'city', source: 'https://www.skylinewebcams.com/en/webcam/italia/veneto/venezia/ponte-di-rialto.html',
    attribution: 'Skyline Webcams (official page — point-only)' },

  // — Traffic / DOT (official open-data agency pages; POINT posture, link-out to the agency) —
  { id: 'wsdot-seattle-i5', name: 'WSDOT — Seattle I-5 Traffic Cams', region: 'Seattle, WA, USA',
    category: 'traffic', source: 'https://wsdot.com/travel/real-time/map/',
    attribution: 'Washington State DOT (official traffic cameras)' },
  { id: '511ny-nyc', name: '511NY — New York City Traffic Cams', region: 'New York State, USA',
    category: 'traffic', source: 'https://511ny.org/cameras',
    attribution: 'NYSDOT / 511NY (official traffic cameras)' },
  { id: '511sfbay', name: '511 SF Bay — Bay Area Traffic Cams', region: 'San Francisco Bay Area, CA, USA',
    category: 'traffic', source: 'https://511.org/traffic/cameras',
    attribution: 'MTC / 511 SF Bay (official open-data cameras)' },

  // — Weather / harbor (institutions' own official lives) —
  { id: 'noaa-old-faithful', name: 'NPS — Old Faithful Geyser Live', region: 'Yellowstone NP, WY, USA',
    category: 'weather', source: 'https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm',
    embed: 'https://www.youtube.com/embed/live_stream?channel=UCUt2Bf5xJmMFHdbxYbEEqYw',
    attribution: 'US National Park Service (official webcam — gov work)' },
];

/** Normalize + sanitize one seed record into a stable shape. Refused/invalid → null. */
export function toCam(r = {}) {
  if (!r || typeof r !== 'object' || !r.id || !r.name || !r.source) return null;
  // hard line: never surface a scraper/open-camera-aggregator source, whatever fields it carries.
  if (refuseHost(r.source) || refuseHost(r.embed) || refuseHost(r.id) || refuseHost(r.name)) return null;
  const source = safeHref(r.source);
  if (!source) return null;                                  // non-http(s) source → drop
  const embed = r.embed ? safeHref(r.embed) : '';
  return {
    id: String(r.id).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48),
    name: String(r.name).trim(),
    region: String(r.region || '').trim(),
    category: String(r.category || 'other').toLowerCase(),
    source,
    embed,                                                   // present → embeddable (WINDOW)
    posture: embed ? POSTURE.WINDOW : POSTURE.POINT,         // never HOST — we never store frames
    attribution: String(r.attribution || r.name || '').trim(),
  };
}

/** The full curated seed directory (sanitized). Never throws. */
export function listCams() {
  return SEED.map(toCam).filter(Boolean);
}

/**
 * Search the seed directory. Any of { q, region, category, limit }. Soft-fail → [] on any error.
 * Keyless and offline — pure over the curated list; no network.
 */
export function searchCams(opts = {}) {
  try {
    const { q = '', region = '', category = '', limit = 40 } = opts || {};
    const lim = Math.max(1, Math.min(200, +limit || 40));
    const nq = String(q || '').trim().toLowerCase();
    const nr = String(region || '').trim().toLowerCase();
    const nc = String(category || '').trim().toLowerCase();
    const out = listCams().filter((c) => {
      if (nc && c.category !== nc) return false;
      if (nr && !`${c.region}`.toLowerCase().includes(nr)) return false;
      if (nq) {
        const hay = `${c.name} ${c.region} ${c.category} ${c.attribution}`.toLowerCase();
        if (!hay.includes(nq)) return false;
      }
      return true;
    });
    return out.slice(0, lim);
  } catch { return []; }
}

// ── optional Windy Webcams API adapter (KEY-GATED, OFF unless WINDY_API_KEY is set) ─────────────────
// Windy's ToS is mandatory: point/window only, link every image back to Windy's page, carry a "Windy
// courtesy" attribution, never rehost. We embed their player + attribution; we never store their frames.
// With no key (or no network) this soft-fails to the seed list only — keyless-first, never throws.
export const WINDY_API = (process.env.WINDY_WEBCAMS_BASE || 'https://api.windy.com/webcams/api/v3').replace(/\/$/, '');

/** Map a Windy webcam record → our shaped cam (WINDOW posture, mandatory courtesy attribution). */
export function toWindyCam(w = {}) {
  if (!w || typeof w !== 'object' || w.webcamId == null) return null;
  const id = `windy-${String(w.webcamId).replace(/[^a-z0-9_-]/gi, '')}`;
  const page = safeHref(w.viewUrl || (w.urls && w.urls.detail) || `https://www.windy.com/webcams/${w.webcamId}`);
  const embed = safeHref(w.player || (w.urls && (w.urls.live || w.urls.player)) || '');
  const loc = w.location || {};
  const region = [loc.city, loc.region, loc.country].filter(Boolean).join(', ');
  if (refuseHost(page) || refuseHost(embed)) return null;
  if (!page && !embed) return null;
  return {
    id,
    name: String(w.title || `Windy webcam ${w.webcamId}`).trim(),
    region: region || '',
    category: String(w.category || 'other').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'other',
    source: page || embed,
    embed,
    posture: embed ? POSTURE.WINDOW : POSTURE.POINT,
    attribution: 'Windy.com (courtesy of Windy Webcams — point/embed only, never rehosted)',
    provider: 'windy',
  };
}

/**
 * Windy Webcams directory, gated on WINDY_API_KEY. Returns [] when no key is configured (keyless-first)
 * or on any network/parse error (soft-fail-never-throw) — the caller falls back to the seed list.
 * @param {{ q?:string, region?:string, limit?:number }} opts
 */
export async function windyCams({ q = '', region = '', limit = 40 } = {}) {
  const key = process.env.WINDY_API_KEY;
  if (!key) return [];                                       // OFF unless a key is configured
  try {
    const lim = Math.max(1, Math.min(50, +limit || 40));
    const p = new URLSearchParams();
    if (q) p.set('categories', String(q));
    p.set('limit', String(lim));
    p.set('include', 'location,urls,player,images');
    const res = await _fetch(`${WINDY_API}/webcams?${p.toString()}`, {
      headers: { 'x-windy-api-key': key, accept: 'application/json' },
    });
    if (!res || !res.ok) return [];
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j && Array.isArray(j.webcams) ? j.webcams : []);
    const nr = String(region || '').trim().toLowerCase();
    return rows.map(toWindyCam).filter(Boolean)
      .filter((c) => !nr || `${c.region}`.toLowerCase().includes(nr))
      .slice(0, lim);
  } catch { return []; }
}

/**
 * The public-cam directory a surface renders: the curated seed list, plus Windy results when (and only
 * when) WINDY_API_KEY is set. Always keyless-safe: no key/network → seed list only. Never throws.
 */
export async function allCams({ q = '', region = '', category = '', limit = 80 } = {}) {
  const seed = searchCams({ q, region, category, limit });
  let windy = [];
  try { windy = await windyCams({ q, region, limit }); } catch { windy = []; }
  const seen = new Set();
  const out = [];
  for (const c of [...seed, ...windy]) {
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
    if (out.length >= Math.max(1, Math.min(200, +limit || 80))) break;
  }
  return out;
}

export function dataNote() {
  return 'Public, consensual cameras only — official DOT/511 traffic cams, tourism/wildlife/institution '
    + 'live streams, and (with a key) the Windy Webcams API. We point at / embed the owner’s own stream '
    + 'with attribution and never rehost. We never scrape, index, or probe strangers’ private cameras.';
}

// ── CLI demo (offline — lists the curated seed directory) ───────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('camera-directory.mjs')) {
  const cams = listCams();
  console.log(`Camera directory — ${cams.length} curated public cam(s) (keyless seed):\n`);
  for (const c of cams) {
    console.log(`  ${c.id.padEnd(24)} ${String(c.posture).padEnd(7)} ${c.category.padEnd(8)} ${c.name}`);
    console.log(`  ${' '.repeat(24)} ↳ ${c.attribution}`);
  }
  console.log(`\nWINDY_API_KEY ${process.env.WINDY_API_KEY ? 'set — Windy directory ENABLED' : 'unset — seed list only (keyless)'}`);
  console.log(`\n${dataNote()}`);
}
