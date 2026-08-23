// art-open-access.mjs — the open-access / PUBLIC-DOMAIN ART reader. Foundation for "ArtCast" (casting
// public-domain art to TVs / digital frames) and the Resource Center art layer.
//
// POSTURE (mirrors license-router.mjs): open-access museum art that a museum itself marks
// public-domain / CC0 → HOST posture — ours to display and serve. Every emitted work is tagged
// { source, license:'PD/CC0', posture:'host', attribution }. This reader is FAIL-CLOSED: it surfaces
// ONLY works a museum explicitly marks public-domain / CC0 / open-access, and DROPS everything else at
// normalization (normalizeWork → null). "Public domain first."
//
// Keyless sources (run in search()):
//   • The Met      (collectionapi.metmuseum.org/public/collection/v1 — KEYLESS). /search → objectIDs;
//                  /objects/{id} → object. We keep ONLY objects with `isPublicDomain === true`.
//   • Art Institute of Chicago (api.artic.edu/api/v1 — KEYLESS). /artworks/search with a fields list
//                  incl. `is_public_domain` + `image_id`. We keep ONLY `is_public_domain === true`; the
//                  displayable image is the IIIF URL built from image_id.
//
// Key-gated sources (Rijksmuseum / Harvard Art Museums / Smithsonian Open Access) share the
// __setKeys({...}) seam and SOFT-SKIP to [] until a key is injected. They are NOT part of search() and
// are never called in the test suite.
//
// Pattern matches music-catalog.mjs / video-discovery.mjs: ESM, zero deps, __setFetch hook, keyless-first,
// graceful soft-fail (return []/null, NEVER throw), a guarded CLI block, escaped rendered HTML, no
// secrets logged.
//
//   import { search, searchMet, searchArtic, normalizeWork, attributionLine, renderGallery,
//            dataNote, __setFetch, __setKeys } from './art-open-access.mjs'
//   node integrations/soapbox/art-open-access.mjs "sunflowers"   # keyless Met + Artic PD search

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Injected keys for the key-gated sources (Rijksmuseum/Harvard/Smithsonian). Empty by default → those
// sources soft-skip to []. Never read from a public env literal here; never logged.
let _keys = {};
export function __setKeys(keys = {}) {
  _keys = keys && typeof keys === 'object' ? { ..._keys, ...keys } : {};
}

const UA = { 'User-Agent': 'SoapBoxArt/1.0 (+https://data.soapbox.community)' };

// How many object-detail records the Met tier will fetch while looking for `limit` PD works. The Met
// /search returns IDs only, so PD status costs one /objects call each; this caps that fan-out.
const MET_SCAN_CAP = 60;

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

// Art Institute IIIF image URL for a given image_id (width in px; 843 = the museum's recommended size).
function articIiif(imageId, width = 843) {
  return `https://www.artic.edu/iiif/2/${encodeURIComponent(imageId)}/full/${width},/0/default.jpg`;
}

// ── attribution ────────────────────────────────────────────────────────────────────────────────────
/**
 * Courtesy credit line for a public-domain work. PD / CC0 carry no LEGAL attribution requirement, but
 * museums ask that open-access works be credited — so we always emit a line. Empty for a non-object.
 */
export function attributionLine(work = {}) {
  if (!work || typeof work !== 'object') return '';
  const title = work.title || 'Untitled';
  const artist = work.artist || 'Unknown artist';
  const date = work.date ? `, ${work.date}` : '';
  const via = work.source ? ` — ${work.source}` : '';
  return `“${title}” — ${artist}${date}${via} (Public Domain)`;
}

// ── normalization (the single choke point where non-PD works are dropped) ────────────────────────────
/**
 * Shape a raw museum record into our work. RETURNS NULL unless the museum marks it public-domain /
 * open-access (Met `isPublicDomain === true`, Artic `is_public_domain === true`). Everything not marked
 * open is dropped here (fail-closed). Output:
 *   { id, title, artist, date, imageUrl, thumbUrl, source, license:'PD/CC0', posture:'host', attribution }
 * @param {object} raw    the source record
 * @param {string} source 'The Met' | 'Art Institute of Chicago' | ...
 */
export function normalizeWork(raw = {}, source = '') {
  if (!raw || typeof raw !== 'object') return null;
  const src = String(source || '').toLowerCase();
  const isMet = src.includes('met');
  const isArtic = src.includes('artic') || src.includes('chicago') || src.includes('art institute');

  // The load-bearing PD gate. Only a museum's own open-access flag passes.
  let isPd;
  if (isMet) isPd = raw.isPublicDomain === true;
  else if (isArtic) isPd = raw.is_public_domain === true;
  else isPd = raw.isPublicDomain === true || raw.is_public_domain === true;
  if (!isPd) return null;                                 // not marked open → dropped (fail-closed)

  let id, title, artist, date, imageUrl, thumbUrl, sourceName;
  if (isMet) {
    id = raw.objectID;
    title = raw.title;
    artist = raw.artistDisplayName;
    date = raw.objectDate;
    imageUrl = raw.primaryImage || '';
    thumbUrl = raw.primaryImageSmall || raw.primaryImage || '';
    sourceName = 'The Met';
  } else if (isArtic) {
    id = raw.id;
    title = raw.title;
    artist = raw.artist_display;
    date = raw.date_display;
    const imageId = raw.image_id || '';
    imageUrl = imageId ? articIiif(imageId, 843) : '';
    thumbUrl = imageId ? articIiif(imageId, 200) : '';
    sourceName = 'Art Institute of Chicago';
  } else {
    // generic fallback (a keyed source that already normalized field names)
    id = raw.id != null ? raw.id : raw.objectID;
    title = raw.title;
    artist = raw.artistDisplayName || raw.artist_display || raw.artist;
    date = raw.objectDate || raw.date_display || raw.date;
    imageUrl = raw.primaryImage || raw.imageUrl || '';
    thumbUrl = raw.primaryImageSmall || raw.thumbUrl || imageUrl || '';
    sourceName = source || raw.source || '';
  }

  const work = {
    id: id != null && id !== '' ? String(id) : String(imageUrl || title || ''),
    title: title || '',
    artist: artist || '',
    date: date || '',
    imageUrl: imageUrl || '',
    thumbUrl: thumbUrl || imageUrl || '',
    source: sourceName,
    license: 'PD/CC0',
    posture: 'host',              // open-access / PD → ours to display and serve
    attribution: '',
  };
  work.attribution = attributionLine(work);
  return work;
}

// ── The Met (keyless) ────────────────────────────────────────────────────────────────────────────────
// /search?q=&hasImages=true → { objectIDs:[...] }; then /objects/{id} → the object record carrying
// `isPublicDomain`, `primaryImage`, `title`, `artistDisplayName`, `objectDate`. Only PD objects survive
// normalizeWork. We scan IDs (bounded by MET_SCAN_CAP) until `limit` PD works are collected.
/** @param {{query?:string, limit?:number}} opts */
export async function searchMet({ query = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const base = 'https://collectionapi.metmuseum.org/public/collection/v1';
  const url = `${base}/search?q=${encodeURIComponent(query)}&hasImages=true`;
  const j = await getJson(url);
  const ids = j && Array.isArray(j.objectIDs) ? j.objectIDs : [];
  const out = [];
  const cap = Math.min(ids.length, MET_SCAN_CAP);
  for (let i = 0; i < cap && out.length < n; i += 1) {
    const obj = await getJson(`${base}/objects/${encodeURIComponent(ids[i])}`);
    if (!obj) continue;
    const w = normalizeWork(obj, 'The Met');            // keeps only isPublicDomain === true
    if (w) out.push(w);
  }
  return out;
}

// ── Art Institute of Chicago (keyless) ────────────────────────────────────────────────────────────────
// /artworks/search?q=&limit=n&fields=… → { data:[ { id, title, artist_display, date_display,
// is_public_domain, image_id } ] }. Only is_public_domain === true survives; the display image is the
// IIIF URL built from image_id.
/** @param {{query?:string, limit?:number}} opts */
export async function searchArtic({ query = '', limit = 12 } = {}) {
  const n = clamp(limit);
  const fields = ['id', 'title', 'artist_display', 'date_display', 'is_public_domain', 'image_id'];
  const p = new URLSearchParams({ q: String(query || ''), limit: String(n), fields: fields.join(',') });
  const url = `https://api.artic.edu/api/v1/artworks/search?${p.toString()}`;
  const j = await getJson(url);
  const data = j && Array.isArray(j.data) ? j.data : [];
  const out = [];
  for (const raw of data) {
    const w = normalizeWork(raw, 'Art Institute of Chicago');  // keeps only is_public_domain === true
    if (w) out.push(w);
  }
  return out;
}

// ── key-gated sources (soft-skip when no key injected) ────────────────────────────────────────────────
// Concrete examples of the __setKeys seam. Each returns [] until __setKeys() supplies its key, and each
// still routes through normalizeWork so the PD gate is enforced in one place. Not part of search(); never
// called in the test suite.
/** @param {{query?:string, limit?:number}} opts — [] until a Rijksmuseum key is set. */
export async function searchRijksmuseum({ query = '', limit = 12 } = {}) {
  const key = _keys.rijksmuseum || _keys.rijks || '';
  if (!key) return [];                                    // soft-skip: key-gated
  const n = clamp(limit);
  const url = `https://www.rijksmuseum.nl/api/en/collection?key=${encodeURIComponent(key)}`
    + `&q=${encodeURIComponent(String(query))}&imgonly=true&ps=${n}`;
  const j = await getJson(url);
  const arr = j && Array.isArray(j.artObjects) ? j.artObjects : [];
  const out = [];
  for (const a of arr) {
    if (!a) continue;
    // Rijksmuseum permitDownload / public-domain marking → map to the generic PD flag.
    const w = normalizeWork({
      id: a.objectNumber,
      isPublicDomain: a.permitDownload === true || a.permitDownload === 'true',
      title: a.title,
      artistDisplayName: a.principalOrFirstMaker,
      objectDate: a.longTitle || '',
      primaryImage: a.webImage && a.webImage.url ? a.webImage.url : '',
    }, 'Rijksmuseum');
    if (w) { w.source = 'Rijksmuseum'; w.attribution = attributionLine(w); out.push(w); }
  }
  return out;
}

/** @param {{query?:string, limit?:number}} opts — [] until a Harvard Art Museums key is set. */
export async function searchHarvard({ query = '', limit = 12 } = {}) {
  const key = _keys.harvard || _keys.harvardart || '';
  if (!key) return [];                                    // soft-skip: key-gated
  const n = clamp(limit);
  const url = `https://api.harvardartmuseums.org/object?apikey=${encodeURIComponent(key)}`
    + `&q=${encodeURIComponent(String(query))}&size=${n}&hasimage=1`;
  const j = await getJson(url);
  const records = j && Array.isArray(j.records) ? j.records : [];
  const out = [];
  for (const r of records) {
    if (!r) continue;
    const pd = /public\s*domain|cc0/i.test(String(r.copyright || '')) || r.accesslevel === 1;
    const w = normalizeWork({
      id: r.objectid,
      isPublicDomain: pd === true,
      title: r.title,
      artistDisplayName: Array.isArray(r.people) && r.people[0] ? r.people[0].displayname : '',
      objectDate: r.dated || '',
      primaryImage: r.primaryimageurl || '',
    }, 'Harvard Art Museums');
    if (w) { w.source = 'Harvard Art Museums'; w.attribution = attributionLine(w); out.push(w); }
  }
  return out;
}

/** @param {{query?:string, limit?:number}} opts — [] until a Smithsonian Open Access key is set. */
export async function searchSmithsonian({ query = '', limit = 12 } = {}) {
  const key = _keys.smithsonian || _keys.si || '';
  if (!key) return [];                                    // soft-skip: key-gated
  const n = clamp(limit);
  const url = `https://api.si.edu/openaccess/api/v1.0/search?api_key=${encodeURIComponent(key)}`
    + `&q=${encodeURIComponent(String(query))}&rows=${n}`;
  const j = await getJson(url);
  const rows = j && j.response && Array.isArray(j.response.rows) ? j.response.rows : [];
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const cnt = (r.content && r.content.descriptiveNonRepeating) || {};
    const usage = (cnt.metadata_usage && cnt.metadata_usage.access) || '';
    const w = normalizeWork({
      id: r.id,
      isPublicDomain: /cc0/i.test(String(usage)),        // Smithsonian marks open access as "CC0"
      title: r.title,
      artistDisplayName: '',
      objectDate: '',
      primaryImage: cnt.online_media && Array.isArray(cnt.online_media.media) && cnt.online_media.media[0]
        ? cnt.online_media.media[0].content : '',
    }, 'Smithsonian');
    if (w) { w.source = 'Smithsonian Open Access'; w.attribution = attributionLine(w); out.push(w); }
  }
  return out;
}

// ── merged search across the keyless sources ──────────────────────────────────────────────────────────
/**
 * Search the keyless sources (The Met + Art Institute of Chicago), merge, dedupe, and PD-filter. Each
 * source soft-fails to [] independently. Key-gated sources are NOT included here.
 * @param {{query?:string, limit?:number}} opts
 */
export async function search({ query = '', limit = 12 } = {}) {
  const [met, artic] = await Promise.all([
    searchMet({ query, limit }).catch(() => []),
    searchArtic({ query, limit }).catch(() => []),
  ]);
  const seen = new Set();
  const out = [];
  for (const w of [...met, ...artic]) {
    if (!w || w.license !== 'PD/CC0' || w.posture !== 'host') continue;  // belt-and-suspenders PD guard
    const key = `${w.source || ''}|${w.id || ''}|${w.imageUrl || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────
/** Escaped HTML image grid for the ArtCast display. PURE; soft-handles empty / null. */
export function renderGallery(works = []) {
  const list = Array.isArray(works) ? works : [];
  const parts = ['<section class="art-open-access"><h2>Public-domain &amp; open-access art</h2>'];
  if (list.length) {
    parts.push('<div class="art-gallery">');
    for (const w of list) {
      const img = w.thumbUrl || w.imageUrl || '';
      const alt = esc(w.title || 'Untitled');
      const fig = img
        ? `<img src="${esc(img)}" alt="${alt}" loading="lazy">`
        : '<div class="art-noimg"></div>';
      const cap = w.attribution ? `<figcaption>${esc(w.attribution)}</figcaption>` : '';
      parts.push(`<figure class="art-item">${fig}${cap}</figure>`);
    }
    parts.push('</div>');
  } else {
    parts.push('<p class="art-empty">No public-domain works found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the keyless sources + the PD-only, host-posture rule. */
export function dataNote() {
  return 'source: The Met + Art Institute of Chicago open-access collections — public-domain / CC0 only, '
    + 'everything not marked open is dropped (fail-closed); images host-eligible (PD/CC0, host posture)';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('art-open-access.mjs')) {
  const q = process.argv.slice(2).join(' ').trim();
  const works = await search({ query: q, limit: 15 });
  console.log(`SoapBox Art (open access) — "${q || '(browse)'}" — ${works.length} public-domain work(s)`);
  console.log('─'.repeat(60));
  for (const w of works) {
    console.log(`  ${(w.title || 'Untitled').slice(0, 34).padEnd(36)} ${(w.artist || '').slice(0, 22).padEnd(24)} (${w.source})`);
  }
  console.log(`  ${dataNote()}`);
}
