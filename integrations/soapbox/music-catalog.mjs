// music-catalog.mjs — the SoapBox public-domain / Creative-Commons MUSIC catalog reader
// (Entertainment/Resource Center spec §2a — the DMCA-free music foundation that "solves the streamer
// music-DMCA problem"). This is a READER / aggregator: it surfaces track METADATA + stream/embed URLs.
// It does NOT download or rehost audio files — but because every track it emits is public-domain or
// CC-open (never NonCommercial), the posture is HOST-eligible ('host'): these are ours to serve.
//
// THE LOAD-BEARING LICENSE FILTER (isAllowedLicense): ingest ONLY
//   CC0 · CC-BY · CC-BY-SA · Public-Domain (pd)
// and FILTER OUT CC-NC (NonCommercial) — a platform with a wallet attached reads as commercial, so NC
// audio is never usable for us. CC-BY / CC-BY-SA REQUIRE an attribution line (attributionLine()); CC0 /
// PD require none. NC / all-rights-reserved / unknown are dropped at normalization (normalizeTrack →
// null). Every emitted track carries { source, license, streamUrl, attribution, posture:'host' }.
//
// Keyless sources (run in search()):
//   • Internet Archive audio (archive.org/advancedsearch.php — collections opensource_audio, netlabels,
//     and the pre-1926 '78rpm' Great-78 set). We return the item + IA's own embed/stream URL.
//   • ccMixter          (dig.ccmixter.org/api/query — keyless JSON; CC-licensed remixes & a cappellas)
//   • FreePD            (freepd.com — CC0 production music; no formal API, so a small curated seed list)
//
// Key-gated sources (Jamendo / FMA / Freesound / Musopen) share the __setKeys({...}) seam and SOFT-SKIP
// to [] until a key is injected. They are NOT part of search() and are never called in the test suite.
//
// Pattern matches video-discovery.mjs / radio.mjs: ESM, zero deps, __setFetch hook, keyless-first,
// graceful soft-fail (return []/null, NEVER throw), a guarded CLI block, escaped rendered HTML.
//
//   import { search, searchIA, searchCcMixter, freePd, jamendo, isAllowedLicense, normalizeTrack,
//            attributionLine, renderList, dataNote, __setFetch, __setKeys } from './music-catalog.mjs'
//   node integrations/soapbox/music-catalog.mjs "piano"   # search the keyless sources for "piano"

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Injected keys for the key-gated sources (Jamendo/FMA/Freesound/Musopen). Empty by default → those
// sources soft-skip to []. Never read from a public env literal here; never logged.
let _keys = {};
export function __setKeys(keys = {}) {
  _keys = keys && typeof keys === 'object' ? { ..._keys, ...keys } : {};
}

const UA = { 'User-Agent': 'SoapBoxMusic/1.0 (+https://data.soapbox.community)' };

// Openly-licensed IA audio collections we draw from.
export const IA_COLLECTIONS = ['opensource_audio', 'netlabels', '78rpm'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function clamp(n, def = 12) { return Math.max(1, Math.min(50, Number(n) || def)); }

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── license canonicalization + the allow filter ─────────────────────────────────────────────────────
// canon() reduces any license string (a token, a human label, or a creativecommons.org URL) to a stable
// comparable token: 'cc0' | 'pd' | 'publicdomain' | 'cc-by' | 'cc-by-sa' | 'cc-by-nc' | 'cc-by-nd' | ...
function normToken(s) {
  s = String(s || '')
    .replace(/[\s_/]+/g, '-')
    .replace(/-\d+(\.\d+)?(?=-|$)/g, '')   // strip a separated version suffix (…-4.0, …-3)
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (/^by(-|$)/.test(s)) s = 'cc-' + s;   // 'by', 'by-sa', 'by-nc' → cc-prefixed
  if (s === 'cc-pdm' || s === 'pdm' || s === 'public-domain') s = 'publicdomain';
  if (s === 'cc-zero' || s === 'zero') s = 'cc0';
  return s;
}

function canon(license) {
  let s = String(license == null ? '' : license).trim().toLowerCase();
  if (!s) return '';
  let m;
  // creativecommons.org URLs — decisive, return early.
  if ((m = s.match(/creativecommons\.org\/licenses\/([a-z+-]+)/))) return normToken('cc-' + m[1]);
  if (/creativecommons\.org\/publicdomain\/zero/.test(s)) return 'cc0';
  if (/creativecommons\.org\/publicdomain\/(mark|pdm)/.test(s)) return 'publicdomain';
  // strip parentheticals (ccMixter labels like "Attribution (3.0)")
  s = s.replace(/\([^)]*\)/g, ' ');
  // spelled-out CC terms → codes (order matters: run before separator collapse)
  s = s.replace(/attribution/g, 'by')
    .replace(/share[\s_-]*alike/g, 'sa')
    .replace(/no[\s_-]*derivatives?/g, 'nd')
    .replace(/no[\s_-]*derivs/g, 'nd')
    .replace(/non[\s_-]*commercial/g, 'nc')
    .replace(/noncommercial/g, 'nc');
  return normToken(s);
}

// The five allowed canonical tokens. Anything else (incl. cc-by-nd, cc-by-nc*, unknown) is rejected.
const ALLOWED = new Set(['cc0', 'pd', 'publicdomain', 'cc-by', 'cc-by-sa']);

/**
 * The load-bearing filter. TRUE only for CC0 / CC-BY / CC-BY-SA / Public-Domain (pd). FALSE for anything
 * NonCommercial (contains 'nc' / 'noncommercial'), all-rights-reserved, empty, or otherwise unknown.
 */
export function isAllowedLicense(license) {
  const c = canon(license);
  if (!c) return false;
  if (/(^|-)nc(-|$)/.test(c) || c.includes('noncommercial')) return false; // NC excluded — commercial platform
  return ALLOWED.has(c);
}

function licenseLabel(token) {
  return ({
    cc0: 'CC0', pd: 'Public Domain', publicdomain: 'Public Domain',
    'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA',
  })[token] || (token ? token.toUpperCase() : '');
}

// ── attribution ──────────────────────────────────────────────────────────────────────────────────────
/**
 * The required CC-BY / CC-BY-SA credit string. Empty ('') for CC0 / Public-Domain (no attribution owed)
 * and for anything that isn't a BY-family license.
 */
export function attributionLine(track = {}) {
  const c = canon(track && track.license);
  if (c !== 'cc-by' && c !== 'cc-by-sa') return '';
  const title = (track && track.title) || 'Untitled';
  const artist = (track && track.artist) || 'Unknown artist';
  const via = track && track.source ? ` (via ${track.source})` : '';
  return `“${title}” by ${artist} — ${licenseLabel(c)}${via}`;
}

// ── normalization (the single choke point where NC is filtered out) ───────────────────────────────────
/**
 * Shape a raw source record into our track. RETURNS NULL when the license isn't allowed (NC / reserved /
 * unknown are dropped here). Output: { id, title, artist, source, license, streamUrl, attribution,
 * posture:'host' }.
 */
export function normalizeTrack(raw = {}, source = '') {
  if (!raw || typeof raw !== 'object') return null;
  if (!isAllowedLicense(raw.license)) return null;      // NC / reserved / unknown → dropped
  const token = canon(raw.license);
  const src = source || raw.source || '';
  const streamUrl = raw.streamUrl || '';
  const track = {
    id: raw.id != null && raw.id !== '' ? String(raw.id) : String(streamUrl || raw.title || ''),
    title: raw.title || '',
    artist: raw.artist || '',
    source: src,
    license: licenseLabel(token),
    streamUrl,
    attribution: '',
    posture: 'host',            // PD / CC-open → ours to serve
  };
  track.attribution = attributionLine(track);
  return track;
}

// ── Internet Archive audio (keyless) ─────────────────────────────────────────────────────────────────
// advancedsearch.php?q=mediatype:audio AND (collection:…) AND <query> → { response:{ docs:[...] } }.
// license comes from the item's `licenseurl`; pre-1926 '78rpm' items with no licenseurl are treated as
// public domain by age. streamUrl points at IA's OWN embed player. Every doc runs the license filter.
/** @param {{query?:string, limit?:number}} opts */
export async function searchIA({ query = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const collClause = '(' + IA_COLLECTIONS.map((c) => `collection:${c}`).join(' OR ') + ')';
  const q = `mediatype:audio AND ${collClause}` + (query ? ` AND (${query})` : '');
  const fl = ['identifier', 'title', 'creator', 'licenseurl', 'collection', 'year']
    .map((f) => `fl[]=${encodeURIComponent(f)}`).join('&');
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}`
    + `&${fl}&rows=${n}&page=1&output=json`;
  const j = await getJson(url);
  const docs = j && j.response && Array.isArray(j.response.docs) ? j.response.docs : [];
  const out = [];
  for (const d of docs) {
    if (!d || !d.identifier) continue;
    const collection = Array.isArray(d.collection) ? d.collection : (d.collection ? [d.collection] : []);
    let license = d.licenseurl || '';
    if (!license && collection.some((c) => String(c).includes('78rpm'))) license = 'publicdomain';
    const t = normalizeTrack({
      id: d.identifier,
      title: Array.isArray(d.title) ? d.title[0] : (d.title || d.identifier),
      artist: Array.isArray(d.creator) ? d.creator.join(', ') : (d.creator || ''),
      license,
      streamUrl: `https://archive.org/embed/${d.identifier}`,
    }, 'Internet Archive');
    if (t) out.push(t);
  }
  return out;
}

// ── ccMixter (keyless) ───────────────────────────────────────────────────────────────────────────────
// dig.ccmixter.org/api/query?f=json&tags=<tag>&limit=n → array of upload objects (upload_name, user_name,
// license_name/license_url, file_page_url, files[]). All CC by construction, but we still license-gate
// (some uploads are NC) and stamp the real license.
/** @param {{tag?:string, limit?:number}} opts */
export async function searchCcMixter({ tag = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const p = new URLSearchParams({ f: 'json', limit: String(n) });
  if (tag) p.set('tags', String(tag));
  const url = `https://dig.ccmixter.org/api/query?${p.toString()}`;
  const j = await getJson(url);
  if (!Array.isArray(j)) return [];
  const out = [];
  for (const u of j) {
    if (!u) continue;
    const license = u.license_name || u.license_url || u.license || '';
    const audio = Array.isArray(u.files) && u.files[0]
      ? (u.files[0].download_url || u.files[0].file_url || '') : '';
    const t = normalizeTrack({
      id: u.upload_id || u.id,
      title: u.upload_name,
      artist: u.user_name,
      license,
      streamUrl: audio || u.file_page_url || '',
    }, 'ccMixter');
    if (t) out.push(t);
  }
  return out;
}

// ── FreePD (static / keyless) ────────────────────────────────────────────────────────────────────────
// FreePD curates CC0 production music but has no JSON API, so we ship a small curated seed list (the
// public site can extend it). All CC0 → all allowed, no attribution owed.
const FREEPD_SEED = [
  { id: 'freepd-comedy', title: 'Comedy', artist: 'FreePD', streamUrl: 'https://freepd.com/music/Comedy.mp3' },
  { id: 'freepd-epic', title: 'Epic', artist: 'FreePD', streamUrl: 'https://freepd.com/music/Epic.mp3' },
  { id: 'freepd-piano', title: 'Piano', artist: 'FreePD', streamUrl: 'https://freepd.com/music/Piano.mp3' },
  { id: 'freepd-electronic', title: 'Electronic', artist: 'FreePD', streamUrl: 'https://freepd.com/music/Electronic.mp3' },
  { id: 'freepd-world', title: 'World', artist: 'FreePD', streamUrl: 'https://freepd.com/music/World.mp3' },
  { id: 'freepd-romantic', title: 'Romantic', artist: 'FreePD', streamUrl: 'https://freepd.com/music/Romantic.mp3' },
];
/** Curated CC0 catalogue (optionally name-filtered). Async for symmetry with the other sources. */
export async function freePd({ query = '', limit = 12 } = {}) {
  const needle = String(query || '').toLowerCase();
  const n = clamp(limit);
  const out = [];
  for (const s of FREEPD_SEED) {
    if (needle && !(`${s.title} ${s.artist}`.toLowerCase().includes(needle))) continue;
    const t = normalizeTrack({ ...s, license: 'CC0' }, 'FreePD');
    if (t) out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

// ── Jamendo (key-gated; soft-skip when no key injected) ──────────────────────────────────────────────
// Concrete example of the __setKeys seam. FMA / Freesound / Musopen readers share the same pattern and
// are added here as keys become available; each soft-skips to [] until __setKeys() supplies its key.
/** @param {{query?:string, limit?:number}} opts — returns [] (soft-skip) until a Jamendo key is set. */
export async function jamendo({ query = '', limit = 12 } = {}) {
  const clientId = _keys.jamendoClientId || _keys.jamendo || '';
  if (!clientId) return [];                              // soft-skip: key-gated
  const n = clamp(limit);
  const url = `https://api.jamendo.com/v3.0/tracks/?client_id=${encodeURIComponent(clientId)}`
    + `&format=json&limit=${n}&audioformat=mp32`
    + (query ? `&namesearch=${encodeURIComponent(String(query))}` : '');
  const j = await getJson(url);
  const results = j && Array.isArray(j.results) ? j.results : [];
  const out = [];
  for (const r of results) {
    if (!r) continue;
    const t = normalizeTrack({
      id: r.id, title: r.name, artist: r.artist_name,
      license: r.license_ccurl, streamUrl: r.audio || r.audiodownload || r.shareurl,
    }, 'Jamendo');
    if (t) out.push(t);
  }
  return out;
}

// ── merged search across the keyless sources ─────────────────────────────────────────────────────────
/**
 * Search the keyless sources (Internet Archive + ccMixter + FreePD), merge, dedupe, and license-filter.
 * Each source soft-fails to [] independently. Key-gated sources (Jamendo/…) are NOT included here.
 * @param {{query?:string, limit?:number}} opts
 */
export async function search({ query = '', limit = 12 } = {}) {
  const [fp, ia, cc] = await Promise.all([
    freePd({ query, limit }).catch(() => []),
    searchIA({ query, limit }).catch(() => []),
    searchCcMixter({ tag: query, limit }).catch(() => []),
  ]);
  const seen = new Set();
  const out = [];
  for (const t of [...fp, ...ia, ...cc]) {
    if (!t || !isAllowedLicense(t.license)) continue;   // belt-and-suspenders NC/unknown guard
    const key = `${t.source || ''}|${t.id || ''}|${t.streamUrl || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────
/** Escaped HTML list of tracks; CC-BY/SA rows show the required attribution line. PURE; soft-handles empties. */
export function renderList(tracks = []) {
  const list = Array.isArray(tracks) ? tracks : [];
  const parts = ['<section class="music-catalog"><h2>Free &amp; open music</h2>'];
  if (list.length) {
    parts.push('<ul class="music-list">');
    for (const t of list) {
      const title = esc(t.title || 'Untitled');
      const link = t.streamUrl
        ? `<a href="${esc(t.streamUrl)}" rel="noopener noreferrer">${title}</a>` : title;
      const attr = t.attribution
        ? ` <span class="attribution">${esc(t.attribution)}</span>` : '';
      parts.push(
        `<li>${link} — ${esc(t.artist || 'Unknown')} `
        + `<span class="lic">[${esc(t.license || 'license?')}]</span> `
        + `<span class="src">${esc(t.source)}</span>${attr}</li>`,
      );
    }
    parts.push('</ul>');
  } else {
    parts.push('<p class="music-empty">No open-licensed tracks found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the keyless sources + the NC-excluded, host-posture rule. */
export function dataNote() {
  return 'source: Internet Archive + ccMixter + FreePD — public-domain / CC0 / CC-BY / CC-BY-SA only, '
    + 'NonCommercial (NC) excluded; metadata + stream/embed links (host-eligible, PD/CC-open)';
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('music-catalog.mjs')) {
  const q = process.argv.slice(2).join(' ').trim();
  const tracks = await search({ query: q, limit: 15 });
  console.log(`SoapBox Music — "${q || '(browse)'}" — ${tracks.length} open track(s)`);
  console.log('─'.repeat(60));
  for (const t of tracks) {
    console.log(`  ${(t.title || 'Untitled').padEnd(24)} ${(t.artist || '').padEnd(18)} [${t.license}] (${t.source})`
      + (t.attribution ? `  attr: ${t.attribution}` : ''));
  }
  console.log(`  ${dataNote()}`);
}
