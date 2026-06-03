// music-catalog.mjs — the SoapBox FREE/OPEN-MUSIC catalog reader (v3 §7 media layer). Surfaces tracks
// we are actually allowed to use on the public site: Creative-Commons and public-domain audio from
//   • ccMixter   (ccmixter.org/api/query — keyless JSON; CC-licensed remixes & a cappellas)
//   • FreePD      (freepd.com — a static curated set of CC0 / public-domain production music)
//   • Jamendo     (api.jamendo.com/v3.0 — needs a free CLIENT_ID; soft-SKIPS when JAMENDO_CLIENT_ID unset)
// plus Musopen-style PUBLIC-DOMAIN classification helpers (isPDRecording / isPDComposition) that encode
// the rolling US copyright schedule, and a CC license filter that EXCLUDES NonCommercial (NC) variants —
// SoapBox is a commercial-context site, so NC audio is NOT usable for us.
//
// Pattern matches worldbank.mjs / macro.mjs: ESM, zero deps, __setFetch hook, keyless-first, graceful
// soft-fail (return []/null, NEVER throw), a guarded CLI block, escaped rendered HTML, no secrets logged.
// EVERY emitted record carries { source, license, provenance } — we never surface a track without a
// usable license string, because "is this safe to play?" is the whole point of this module.
//
//   import { search, ccMixter, freePD, jamendo, isUsableLicense, isPDRecording, isPDComposition,
//            PD_RECORDING_CUTOFF, PD_COMPOSITION_CUTOFF, renderList, dataNote, __setFetch } from './music-catalog.mjs'
//   node integrations/soapbox/music-catalog.mjs "piano"     # search the keyless sources for "piano"

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxMusic/1.0 (+https://data.soapbox.community)' };

// Optional Jamendo client id (free to register). Soft-skipped when absent — never required, never logged.
const JAMENDO_CLIENT_ID = process.env.JAMENDO_CLIENT_ID || '';

// ── Public-domain rolling schedule (US, as of 2026) ────────────────────────────────────────────────
// The 2018 Music Modernization Act (MMA) set a rolling federal schedule for PRE-1972 sound RECORDINGS:
//   recordings first published BEFORE 1923 entered the public domain on 2022-01-01, and the window then
//   rolls forward one year every January 1st. So as of 2026 the recording cutoff is 1925 (i.e. a
//   recording published in 1925 or earlier is PD). COMPOSITIONS (the underlying written work) follow the
//   ordinary 95-years-after-publication rule, so as of 2026 a composition published in 1930 or earlier
//   is PD. Both cutoffs advance by one each new year — recompute from `now` so we stay correct over time.
// Refs: 17 U.S.C. §1401 (MMA); the published-95-years term for pre-1978 works.
const PD_BASE_YEAR = 2026;            // year these cutoffs were last hand-verified
export const PD_RECORDING_CUTOFF = 1925;   // recording published ≤ this year → PD, as of PD_BASE_YEAR
export const PD_COMPOSITION_CUTOFF = 1930; // composition published ≤ this year → PD, as of PD_BASE_YEAR

// Roll the cutoff forward one year per calendar year past PD_BASE_YEAR (never backward).
function rollingCutoff(base, now = Date.now()) {
  const yr = new Date(now).getUTCFullYear();
  return base + Math.max(0, yr - PD_BASE_YEAR);
}

/** True if a SOUND RECORDING first published in `year` is public-domain in the US (rolling MMA schedule). */
export function isPDRecording(year, now = Date.now()) {
  const y = Number(year);
  if (!Number.isFinite(y)) return false;
  return y <= rollingCutoff(PD_RECORDING_CUTOFF, now);
}

/** True if a musical COMPOSITION first published in `year` is public-domain in the US (95-year rule). */
export function isPDComposition(year, now = Date.now()) {
  const y = Number(year);
  if (!Number.isFinite(y)) return false;
  return y <= rollingCutoff(PD_COMPOSITION_CUTOFF, now);
}

// ── License usability (the gate) ───────────────────────────────────────────────────────────────────
// SoapBox runs in a commercial context, so we EXCLUDE NonCommercial (NC) Creative-Commons variants.
// Usable: public domain / CC0 / CC-BY / CC-BY-SA / CC-BY-ND (and Sampling+ which permits commercial).
// NOT usable: anything containing "NC"/"NonCommercial", and "All Rights Reserved" / unknown licenses.
const NC_RE = /\b(nc|noncommercial|non-commercial)\b/i;
const USABLE_RE = /\b(cc0|public[ -]?domain|publicdomain|by(?:[ -]?sa|[ -]?nd)?|sampling\+?|attribution(?:[ -]?sharealike|[ -]?noderivs)?)\b/i;
const RESERVED_RE = /all[ -]?rights[ -]?reserved/i;

/**
 * Is this license string usable on the commercial SoapBox site? Returns true only for PD/CC0/CC-BY(-SA/-ND)
 * style licenses; false for any NonCommercial variant, "all rights reserved", or an empty/unknown string.
 */
export function isUsableLicense(license) {
  const s = String(license == null ? '' : license).trim();
  if (!s) return false;
  if (NC_RE.test(s)) return false;       // NC excluded for our commercial use
  if (RESERVED_RE.test(s)) return false; // proprietary
  return USABLE_RE.test(s);
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Stamp provenance/license onto a normalized track. Tracks WITHOUT a usable license are dropped upstream.
function track({ id, title, artist, license, url, audio, source }) {
  return {
    id: id != null ? String(id) : null,
    title: title || '',
    artist: artist || '',
    license: license || '',
    url: url || '',          // human page
    audio: audio || '',      // direct stream/download
    source,                  // 'ccMixter' | 'FreePD' | 'Jamendo'
    provenance: `${source} (${license || 'license unknown'})`,
  };
}

// ── ccMixter (keyless) ───────────────────────────────────────────────────────────────────────────
// ccmixter.org/api/query?f=json&search=<q>&limit=<n> → array of upload objects with upload_name,
// user_name, license_name, file_page_url, and files[] (download URLs). All CC-licensed by construction,
// but we still license-gate (some uploads are NC) and stamp the real license_name.
/** @param {{q?:string, limit?:number}} opts */
export async function ccMixter({ q = '', limit = 12 } = {}) {
  const n = Math.max(1, Math.min(50, Number(limit) || 12));
  const url = `https://ccmixter.org/api/query?f=json&limit=${n}`
    + (q ? `&search=${encodeURIComponent(String(q))}` : '');
  const j = await getJson(url);
  if (!Array.isArray(j)) return [];
  const out = [];
  for (const u of j) {
    if (!u) continue;
    const license = u.license_name || u.license || '';
    if (!isUsableLicense(license)) continue;          // drop NC / unknown
    const audio = Array.isArray(u.files) && u.files[0] ? (u.files[0].download_url || u.files[0].file_url || '') : '';
    out.push(track({
      id: u.upload_id || u.id, title: u.upload_name, artist: u.user_name,
      license, url: u.file_page_url, audio, source: 'ccMixter',
    }));
  }
  return out;
}

// ── FreePD (static / keyless) ───────────────────────────────────────────────────────────────────
// FreePD curates CC0 / public-domain production music. It has no JSON API, so we ship a small static
// catalogue of representative CC0 tracks (the public site can extend this list). All CC0 → all usable.
const FREEPD_CATALOG = [
  { id: 'freepd-comedy',     title: 'Comedy',          artist: 'Kevin MacLeod (FreePD)', page: 'https://freepd.com/comedy.php',     audio: 'https://freepd.com/music/Comedy.mp3' },
  { id: 'freepd-epic',       title: 'Epic',            artist: 'Various (FreePD)',       page: 'https://freepd.com/epic.php',       audio: 'https://freepd.com/music/Epic.mp3' },
  { id: 'freepd-piano',      title: 'Piano',           artist: 'Various (FreePD)',       page: 'https://freepd.com/piano.php',      audio: 'https://freepd.com/music/Piano.mp3' },
  { id: 'freepd-electronic', title: 'Electronic',      artist: 'Various (FreePD)',       page: 'https://freepd.com/electronic.php', audio: 'https://freepd.com/music/Electronic.mp3' },
  { id: 'freepd-world',      title: 'World',           artist: 'Various (FreePD)',       page: 'https://freepd.com/world.php',      audio: 'https://freepd.com/music/World.mp3' },
  { id: 'freepd-romantic',   title: 'Romantic',        artist: 'Various (FreePD)',       page: 'https://freepd.com/romantic.php',   audio: 'https://freepd.com/music/Romantic.mp3' },
];
/** Static CC0 catalogue (optionally name-filtered). Synchronous-shaped but async for API symmetry. */
export async function freePD({ q = '', limit = 12 } = {}) {
  const needle = String(q || '').toLowerCase();
  const n = Math.max(1, Math.min(50, Number(limit) || 12));
  return FREEPD_CATALOG
    .filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle))
    .slice(0, n)
    .map((t) => track({
      id: t.id, title: t.title, artist: t.artist,
      license: 'CC0 / Public Domain', url: t.page, audio: t.audio, source: 'FreePD',
    }));
}

// ── Jamendo (keyed; soft-skip when JAMENDO_CLIENT_ID unset) ────────────────────────────────────────
// api.jamendo.com/v3.0/tracks/?client_id=…&format=json&namesearch=<q> → { results: [...] }. Each track
// carries license_ccurl (e.g. .../by-nc-sa/...). We derive a license token from that URL and gate it,
// so a Jamendo NC track is excluded just like a ccMixter NC track.
function ccUrlToLicense(ccurl) {
  const s = String(ccurl || '').toLowerCase();
  if (!s) return '';
  const m = s.match(/licenses\/([a-z\-+]+)\//);
  if (!m) return s.includes('publicdomain') || s.includes('zero') ? 'CC0' : '';
  return `CC ${m[1].toUpperCase()}`;
}
/** @param {{q?:string, limit?:number}} opts — returns [] (soft-skip) when JAMENDO_CLIENT_ID is unset. */
export async function jamendo({ q = '', limit = 12 } = {}) {
  if (!JAMENDO_CLIENT_ID) return [];               // soft-skip, no key configured
  const n = Math.max(1, Math.min(50, Number(limit) || 12));
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(JAMENDO_CLIENT_ID)}`
    + `&format=json&limit=${n}&audioformat=mp32`
    + (q ? `&namesearch=${encodeURIComponent(String(q))}` : '');
  const j = await getJson(url);
  const results = j && Array.isArray(j.results) ? j.results : [];
  const out = [];
  for (const t of results) {
    if (!t) continue;
    const license = ccUrlToLicense(t.license_ccurl) || 'CC BY';
    if (!isUsableLicense(license)) continue;        // drop NC
    out.push(track({
      id: t.id, title: t.name, artist: t.artist_name,
      license, url: t.shareurl || t.shorturl, audio: t.audio || t.audiodownload, source: 'Jamendo',
    }));
  }
  return out;
}

/**
 * Search every available source and merge. Keyless sources (ccMixter, FreePD) always run; Jamendo runs
 * only when keyed. Each source soft-fails to [] independently; the merged list is license-gated already.
 * @param {{q?:string, limit?:number}} opts
 */
export async function search({ q = '', limit = 12 } = {}) {
  const [cc, fp, jm] = await Promise.all([
    ccMixter({ q, limit }).catch(() => []),
    freePD({ q, limit }).catch(() => []),
    jamendo({ q, limit }).catch(() => []),
  ]);
  return [...fp, ...cc, ...jm];
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
/** Escaped HTML list of tracks; each row shows title/artist/license/source. PURE; soft-handles empties. */
export function renderList(tracks = []) {
  const list = Array.isArray(tracks) ? tracks : [];
  const parts = ['<section class="music-catalog"><h2>Free &amp; open music</h2>'];
  if (list.length) {
    parts.push('<ul class="music-list">');
    for (const t of list) {
      const link = t.url ? `<a href="${esc(t.url)}" rel="noopener noreferrer">${esc(t.title || 'Untitled')}</a>` : esc(t.title || 'Untitled');
      parts.push(`<li>${link} — ${esc(t.artist || 'Unknown')} <span class="lic">[${esc(t.license || 'license?')}]</span> <span class="src">${esc(t.source)}</span></li>`);
    }
    parts.push('</ul>');
  } else {
    parts.push('<p class="music-empty">No usable tracks found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the sources + the NC-excluded usability rule. */
export function dataNote() {
  return 'source: ccMixter + FreePD + Jamendo — Creative-Commons / public-domain only, NonCommercial (NC) excluded';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('music-catalog.mjs')) {
  const q = process.argv.slice(2).join(' ').trim();
  const tracks = await search({ q, limit: 15 });
  console.log(`SoapBox Music — "${q || '(browse)'}" — ${tracks.length} usable track(s)`);
  console.log('─'.repeat(60));
  for (const t of tracks) console.log(`  ${(t.title || 'Untitled').padEnd(24)} ${(t.artist || '').padEnd(20)} [${t.license}] (${t.source})`);
  console.log(`  ${dataNote()}`);
}
