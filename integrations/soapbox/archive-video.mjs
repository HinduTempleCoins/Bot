// archive-video.mjs — the SoapBox STREAMING VOD adapter over the Internet Archive (archive.org).
//
// This is the CORE public-domain / open-licensed video source for the MELEK "Stream" surface
// (site/stream/). It is the streaming-shaped sibling of soapbox/video-discovery.mjs: where that reader
// returns a browse LIST (title/year + an IA-embed link, JustWatch model), this adapter normalizes IA
// items into the SHARED STREAMING TILE the catalog + player consume:
//
//   { id, title, kind, year, creator, thumb, streamUrl, license, source, embedUrl, attribution, posture }
//
// Two APIs, both KEYLESS:
//   1. advancedsearch.php — catalog. We query mediatype:movies inside the public-domain / CC film
//      collections (prelinger, feature_films, classic_tv, …) and normalize each doc → a tile. streamUrl
//      is IA's OWN first-party player (archive.org/embed/<id>), vetted through embed-whitelist so we
//      only ever frame the official player. A direct-download URL is also offered as a hint.
//   2. metadata/<id>   — per-item. Lists the item's files; we pick the best H.264 MP4 and build a REAL,
//      directly-playable stream URL (https://<server><dir>/<name>) so the player can use a plain
//      <video> element for public-domain items.
//
// LICENSING BASIS (why this is legal to stream): the collections below are Internet Archive's curated
// PUBLIC-DOMAIN / openly-licensed film sets. Prelinger is explicitly public-domain ephemeral film;
// feature_films / classic_tv / silent films are PD-by-age or CC. Every tile carries a `license` label
// (derived from the item's licenseurl when present, else the collection's PD basis) and every item is
// routed through integrations/license-router.mjs at the watch boundary before it can be streamed.
//
// House style: ESM, zero deps, __setFetch hook, keyless, soft-fail-never-throw (→ [] / null), esc()
// on rendered HTML, guarded CLI. Pattern matches video-discovery.mjs / radio.mjs.
//
//   import { searchArchive, archiveMetadata, parseSearch, parseMetadata, __setFetch } from './archive-video.mjs'
//   node integrations/soapbox/archive-video.mjs "moon"

import { allowedEmbed } from './embed-whitelist.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxStream/1.0 (+https://stream.soapbox.community)', accept: 'application/json' };
export const ARCHIVE_BASE = (process.env.ARCHIVE_BASE || 'https://archive.org').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Curated PUBLIC-DOMAIN / open-licensed IA film & TV collections, each with the license basis we label
// tiles with when the item itself carries no explicit licenseurl.
export const IA_COLLECTIONS = Object.freeze({
  prelinger: 'Public domain (Prelinger ephemeral films)',
  feature_films: 'Public domain / open (feature films)',
  classic_tv: 'Public domain (classic TV)',
  silenthdgames: 'Public domain (silent film)',
  film_noir: 'Public domain (film noir)',
  SciFi_Horror: 'Public domain (sci-fi / horror)',
  more_animation: 'Public domain / open (animation)',
});
export const FILM_COLLECTIONS = ['prelinger', 'feature_films', 'film_noir', 'SciFi_Horror', 'more_animation'];
export const SHOW_COLLECTIONS = ['classic_tv'];

// Kinds we can list.
const MEDIATYPE = 'movies';

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── license labelling ─────────────────────────────────────────────────────────────────────────────
// Turn an item's licenseurl (or its collection) into a { label, token } we show on every tile. The
// token feeds license-router at the watch gate; the label is what the viewer reads.
export function licenseLabel(licenseurl, collections = []) {
  const u = String(licenseurl || '').toLowerCase();
  if (/creativecommons\.org\/publicdomain\/(zero|mark)/.test(u)) return { label: 'Public domain (CC0/PDM)', token: 'cc0' };
  if (/creativecommons\.org\/licenses\/by-sa/.test(u)) return { label: 'CC BY-SA', token: 'cc-by-sa' };
  if (/creativecommons\.org\/licenses\/by-nc/.test(u)) return { label: 'CC BY-NC', token: 'cc-by-nc' };
  if (/creativecommons\.org\/licenses\/by-nd/.test(u)) return { label: 'CC BY-ND', token: 'cc-by-nd' };
  if (/creativecommons\.org\/licenses\/by/.test(u)) return { label: 'CC BY', token: 'cc-by' };
  if (/publicdomain/.test(u)) return { label: 'Public domain', token: 'public-domain' };
  // No explicit license on the item → fall back to the collection's curated PD basis.
  const colls = [].concat(collections || []).map((c) => String(c).toLowerCase());
  for (const c of colls) {
    for (const key of Object.keys(IA_COLLECTIONS)) {
      if (c === key.toLowerCase()) return { label: IA_COLLECTIONS[key], token: 'public-domain' };
    }
  }
  return { label: 'Public domain (Internet Archive — see item page)', token: 'public-domain' };
}

// ── normalize an advancedsearch doc → shared tile ──────────────────────────────────────────────────
export function toTile(doc = {}, kind = 'film') {
  if (!doc || !doc.identifier) return null;
  const id = String(doc.identifier);
  const details = `${ARCHIVE_BASE}/details/${id}`;
  const gate = allowedEmbed(`https://archive.org/details/${id}`); // route through embed-whitelist
  const collections = [].concat(doc.collection || []);
  const lic = licenseLabel(doc.licenseurl, collections);
  const year = doc.year != null ? String(Array.isArray(doc.year) ? doc.year[0] : doc.year) : '';
  return {
    id,
    title: Array.isArray(doc.title) ? doc.title[0] : (doc.title || id),
    kind,
    year,
    creator: Array.isArray(doc.creator) ? doc.creator.join(', ') : (doc.creator || ''),
    thumb: `${ARCHIVE_BASE}/services/img/${id}`,
    // streamUrl is IA's OWN official player (vetted). The player page frames this iframe, or resolves a
    // direct MP4 via archiveMetadata() for a native <video>. Never a scraped/rehosted stream.
    streamUrl: gate.ok ? gate.embed : '',
    embedUrl: gate.ok ? gate.embed : '',
    downloadHint: `${ARCHIVE_BASE}/download/${id}`,
    license: lic.label,
    licenseToken: lic.token,
    source: 'Internet Archive',
    attribution: `Internet Archive — ${id}`,
    posture: 'window', // owner's (IA's) official player surface; never rehosted
    details,
  };
}

// ── parse an advancedsearch response (PURE, for tests) ─────────────────────────────────────────────
export function parseSearch(json, kind = 'film') {
  const docs = json && json.response && Array.isArray(json.response.docs) ? json.response.docs : [];
  const out = [];
  for (const d of docs) { const t = toTile(d, kind); if (t) out.push(t); }
  return out;
}

/**
 * Search the Internet Archive's public-domain / open film collections. Soft-fails to [].
 * @param {{q?:string, rows?:number, collections?:string[], kind?:string}} opts
 */
export async function searchArchive({ q = '', rows = 12, collections = FILM_COLLECTIONS, kind = 'film' } = {}) {
  const n = Math.max(1, Math.min(50, Number(rows) || 12));
  const colls = (Array.isArray(collections) && collections.length ? collections : FILM_COLLECTIONS);
  const collClause = '(' + colls.map((c) => `collection:${c}`).join(' OR ') + ')';
  const query = `mediatype:${MEDIATYPE} AND ${collClause}` + (q ? ` AND (${q})` : '');
  const fl = ['identifier', 'title', 'year', 'creator', 'licenseurl', 'collection', 'description']
    .map((f) => `fl[]=${encodeURIComponent(f)}`).join('&');
  const url = `${ARCHIVE_BASE}/advancedsearch.php?q=${encodeURIComponent(query)}`
    + `&${fl}&rows=${n}&page=1&output=json`;
  const j = await getJson(url);
  return parseSearch(j, kind);
}

/** Convenience rows the surface calls: public-domain films, and classic-TV "shows". */
export async function films(opts = {}) { return searchArchive({ collections: FILM_COLLECTIONS, kind: 'film', ...opts }); }
export async function shows(opts = {}) { return searchArchive({ collections: SHOW_COLLECTIONS, kind: 'show', ...opts }); }

// ── metadata → a REAL directly-playable MP4 URL ────────────────────────────────────────────────────
// IA's metadata API returns { server, dir, metadata:{...}, files:[{ name, format, source, ... }] }.
// A directly-playable derivative is the "h.264" / MPEG4 file; we build https://<server><dir>/<name>.
const MP4_FORMAT_RE = /(h\.?264|mpeg-?4|512kb mpeg4|hd mpeg4)/i;
const MP4_NAME_RE = /\.(mp4|m4v|ogv|webm)$/i;

export function bestVideoFile(files = []) {
  const list = Array.isArray(files) ? files : [];
  // Prefer an explicit H.264 derivative; else any mp4/webm; skip thumbnails/originals that aren't video.
  const byFormat = list.find((f) => f && MP4_FORMAT_RE.test(String(f.format || '')) && MP4_NAME_RE.test(String(f.name || '')));
  if (byFormat) return byFormat;
  return list.find((f) => f && MP4_NAME_RE.test(String(f.name || ''))) || null;
}

/** Parse a metadata API response → a resolved item with a direct streamUrl. PURE; soft-null on junk. */
export function parseMetadata(json) {
  if (!json || typeof json !== 'object') return null;
  const md = json.metadata || {};
  const id = String(md.identifier || '');
  if (!id) return null;
  const file = bestVideoFile(json.files);
  let streamUrl = '';
  if (file && file.name) {
    const server = json.server ? String(json.server) : '';
    const dir = json.dir ? String(json.dir) : '';
    // https://<server><dir>/<name> when server/dir present; else the stable /download/ URL.
    const name = String(file.name).replace(/^\/+/, '');
    streamUrl = server && dir
      ? `https://${server}${dir.startsWith('/') ? '' : '/'}${dir}/${name}`.replace(/([^:])\/\//g, '$1/')
      : `${ARCHIVE_BASE}/download/${id}/${encodeURIComponent(name)}`;
  }
  const collections = [].concat(md.collection || []);
  const lic = licenseLabel(md.licenseurl, collections);
  return {
    id,
    title: md.title || id,
    year: md.year != null ? String(md.year) : '',
    creator: Array.isArray(md.creator) ? md.creator.join(', ') : (md.creator || ''),
    thumb: `${ARCHIVE_BASE}/services/img/${id}`,
    streamUrl,                                   // a REAL, directly-playable MP4 (or '' if none found)
    mimetype: file && file.name && /\.webm$/i.test(file.name) ? 'video/webm' : 'video/mp4',
    embedUrl: `https://archive.org/embed/${id}`, // IA's official player fallback (whitelisted)
    license: lic.label,
    licenseToken: lic.token,
    source: 'Internet Archive',
    attribution: `Internet Archive — ${id}`,
    posture: 'window',
  };
}

/** Fetch one item's metadata → resolved streamable item. Soft-fail → null. */
export async function archiveMetadata(id) {
  if (!id) return null;
  const j = await getJson(`${ARCHIVE_BASE}/metadata/${encodeURIComponent(String(id))}`);
  return parseMetadata(j);
}

export function dataNote() {
  return 'Films & shows via the Internet Archive public-domain / open-licensed collections (keyless). '
    + 'We stream IA\'s own official player or the item\'s directly-served public-domain file — never a rehost or a scraped mirror.';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('archive-video.mjs')) {
  const q = process.argv.slice(2).join(' ').trim();
  const items = await films({ q, rows: 15 });
  console.log(`SoapBox Stream · Internet Archive — "${q || '(browse)'}" — ${items.length} film(s)`);
  console.log('─'.repeat(66));
  for (const v of items) {
    console.log(`  ${(v.title || '').slice(0, 40).padEnd(42)} ${v.year || '----'}  [${v.license}]  ${v.streamUrl ? '▶' : '—'}`);
  }
  console.log('  ' + dataNote());
}
