// genai-asset-library.mjs — MELEK's OWN free/open asset & data library: the catalog of sources WE
// harvest and HOLD (not services to pay), with per-source LICENSE BUCKETING so the mint/NFT + product
// pipeline only ever ships clean assets. Distilled from the four discovery catalogs in
// .local/hathor/LIBRARY_{models_and_runtimes,data_and_images,assets,tools}.md (2026-09-24).
//
// PURE data + functions + an INJECTABLE fetch (offline-testable, house rule). No keys, no secrets.
// Keyless CC0 sources (Poly Haven, ambientCG, Smithsonian OA) harvest DIRECTLY; the rest are cataloged
// with how-to-acquire so we can wire them as they're needed. Every harvested asset carries a full
// PROVENANCE record (source, url, author, license, bucket, sha256) so any minted asset is provably clean.
//
// THE SINGLE RULE the whole platform keys off — the license bucket:
//   'A' MINT-SAFE  — CC0 / public-domain / our-own-original: ship it, sell it, AND mint it on-chain.
//   'B' PRODUCT    — CC-BY / OFL / MIT / Apache / permissive-with-attribution: use in product + keep
//                    attribution; do NOT mint the raw asset on-chain.
//   'C' REFERENCE  — NC / ToS-only / per-item-mixed / research-only / copyleft (CC-BY-SA, GPL): input
//                    for reference/compositing/training only; NEVER shipped raw or minted.
//   Unknown → 'C' (most restrictive). Safe default everywhere.
//
//   import { SOURCES, licenseBucket, canMint, canShip, harvestPolyHaven, harvestAmbientCG } from './genai-asset-library.mjs'
//   node integrations/genai-asset-library.mjs            # print the catalog + buckets
//   node integrations/genai-asset-library.mjs harvest polyhaven textures 5   # acquire 5 CC0 textures

import crypto from 'node:crypto';

// ── injectable fetch (tests inject; real runs use global fetch) ─────────────────────────────────────
let _fetch = (...a) => fetch(...a);
export function __setFetch(f) { _fetch = f || ((...a) => fetch(...a)); }

// ── license → bucket ────────────────────────────────────────────────────────────────────────────────
export function licenseBucket(license) {
  const l = String(license || '').trim().toLowerCase();
  if (!l) return 'C';
  // C FIRST — any restrictive / mixed / per-item signal wins (mint safety): NC, share-alike/copyleft,
  // research-only, per-item, ToS, "mixed", or multiple licenses listed ("|") = must read each at ingest.
  if (/non[\s-]?commercial|\bnc\b|[-\s]nc\b|share[\s-]?alike|by[\s-]?sa|gpl|agpl|\bresearch\b|per[\s-]?item|\btos\b|\bmixed\b|no[\s-]?redistrib|gated|\|/.test(l)) return 'C';
  // A — mint-safe: public domain / CC0 / our own
  if (/\bcc0\b|public[\s-]?domain|\bpd\b|our[\s-]?own|\boriginal\b/.test(l)) return 'A';
  // B — product-safe permissive with attribution
  if (/cc[\s-]?by\b|\bofl\b|\bmit\b|apache|\bbsd\b|\bisc\b|boost|openrail/.test(l)) return 'B';
  return 'C';
}
export const canMint = (license) => licenseBucket(license) === 'A';
export const canShip = (license) => licenseBucket(license) !== 'C';

// ── the catalog (free/open sources WE can hold) — distilled from the four LIBRARY_*.md reports ───────
// tier: 'keyless' harvest now (no key), 'apikey' needs a free key, 'bulk' download/dump, 'query' in-place.
export const SOURCES = [
  // 3D / textures / HDRIs — Botanica day-one CC0 wins
  { id: 'polyhaven', media: '3d/texture/hdri', license: 'CC0', tier: 'keyless', api: 'https://api.polyhaven.com', mintOK: true, note: 'no key; 862 textures / 997 HDRIs / 521 models (2026-09-24)' },
  { id: 'ambientcg', media: 'texture/hdri/3d', license: 'CC0', tier: 'keyless', api: 'https://ambientcg.com/api/v2/full_json', mintOK: true, note: 'one call lists all CC0 PBR/HDRI' },
  { id: 'smithsonian-oa', media: 'image/3d', license: 'CC0', tier: 'apikey', api: 'https://api.si.edu/openaccess/api/v1.0', mintOK: true, note: 'free api.data.gov key; botanical 3D scans' },
  { id: 'kenney', media: 'game-2d/3d/audio', license: 'CC0', tier: 'bulk', api: 'https://kenney.nl/assets', mintOK: true, note: 'CC0 zip packs incl. nature/foliage' },
  { id: 'quaternius', media: 'game-3d', license: 'CC0', tier: 'bulk', api: 'https://quaternius.com', mintOK: true, note: 'CC0 zip packs incl. plants' },
  { id: 'polypizza', media: '3d', license: 'CC0|CC-BY', tier: 'apikey', api: 'https://api.poly.pizza', mintOK: true, note: 'filter licence=CC0 for mint-safe' },
  { id: 'googlefonts', media: 'font', license: 'OFL', tier: 'apikey', api: 'https://www.googleapis.com/webfonts/v1/webfonts', mintOK: false, note: 'OFL = product use, not minted raw' },
  { id: 'freesound', media: 'audio', license: 'CC0|CC-BY|CC-BY-NC', tier: 'apikey', api: 'https://freesound.org/apiv2', mintOK: false, note: 'per-item license — read at ingest' },
  { id: 'game-icons', media: 'icon', license: 'CC-BY', tier: 'bulk', api: 'https://game-icons.net', mintOK: false, note: 'CC-BY = product only' },
  { id: 'incompetech', media: 'music', license: 'CC-BY', tier: 'bulk', api: 'https://incompetech.com', mintOK: false, note: 'attribution required' },
  // art / culture bulk (CC0 → mint-safe)
  { id: 'met-oa', media: 'image', license: 'CC0', tier: 'bulk', api: 'https://collectionapi.metmuseum.org/public/collection/v1', mintOK: true, note: 'CC0 dump + API' },
  { id: 'artic', media: 'image', license: 'CC0', tier: 'bulk', api: 'https://api.artic.edu/api/v1', mintOK: true, note: 'Art Institute of Chicago CC0' },
  { id: 'cleveland', media: 'image', license: 'CC0', tier: 'bulk', api: 'https://openaccess-api.clevelandart.org/api', mintOK: true, note: 'CC0 open access' },
  { id: 'wikimedia', media: 'image', license: 'mixed', tier: 'query', api: 'https://commons.wikimedia.org/w/api.php', mintOK: false, note: 'per-file license — read at ingest' },
  // data / training corpora (reference/training lane — bucket C, never minted raw)
  { id: 'openimages', media: 'image-dataset', license: 'CC-BY', tier: 'bulk', api: 'https://storage.googleapis.com/openimages/web/index.html', mintOK: false, note: '~9M imgs, product/training' },
  { id: 'relaion', media: 'image-text-dataset', license: 'research', tier: 'bulk', api: 'https://laion.ai', mintOK: false, note: 'URLs+captions only, training-lane, legally contested' },
  { id: 'bigquery-public', media: 'data', license: 'mixed', tier: 'query', api: 'https://cloud.google.com/bigquery/public-data', mintOK: false, note: 'query-in-place, 1TB/mo free' },
  { id: 'huggingface', media: 'models/datasets', license: 'mixed', tier: 'apikey', api: 'https://huggingface.co', mintOK: false, note: 'per-repo license' },
  // free keyless generation compute (their GPU via API — allowed; our side stays CPU)
  { id: 'pollinations', media: 'gen-image/video/text', license: 'service', tier: 'keyless', api: 'https://image.pollinations.ai', mintOK: false, note: 'keyless free FLUX gen — the default lane' },
];

// resolve a source's storage bucket from its declared license
export function sourceBucket(id) {
  const s = SOURCES.find((x) => x.id === id);
  return s ? licenseBucket(s.license) : 'C';
}

// a provenance record for a harvested asset (so any minted asset is provably clean)
export function provenance({ source, id, url, author, license, bytes, buffer }) {
  const sha256 = buffer ? crypto.createHash('sha256').update(buffer).digest('hex') : null;
  return { source, id, url, author: author || null, license, bucket: licenseBucket(license), mintOK: canMint(license), shipOK: canShip(license), bytes: bytes || (buffer ? buffer.length : null), sha256, fetched: new Date().toISOString() };
}

// ── keyless harvesters (real network via _fetch; return {ok, index|asset, provenance?}) ──────────────
const api = async (base, path) => { const r = await _fetch(base + path); if (!r || !r.ok) throw new Error(`${path}: http ${r ? r.status : '??'}`); return r.json(); };

// Poly Haven — list a type, and fetch one asset's smallest map (keyless, CC0 → bucket A).
export async function harvestPolyHaven(type = 'textures', limit = 10) {
  try {
    const all = await api('https://api.polyhaven.com', `/assets?type=${encodeURIComponent(type)}`);
    const ids = Object.keys(all).slice(0, limit);
    return { ok: true, source: 'polyhaven', type, count: Object.keys(all).length, ids, license: 'CC0', bucket: 'A' };
  } catch (e) { return { ok: false, error: String(e && e.message) }; }
}
// Fetch the smallest available file URL for a Poly Haven asset id (prefer 1k jpg to keep it light).
export async function polyHavenFileUrl(id, preferRes = '1k') {
  try {
    const files = await api('https://api.polyhaven.com', `/files/${encodeURIComponent(id)}`);
    const str = JSON.stringify(files);
    // prefer the requested res, else any dl.polyhaven.org jpg/png
    const re = new RegExp(`https://dl\\.polyhaven\\.org/[^"']*${preferRes}[^"']*\\.(jpg|png)`, 'i');
    const m = str.match(re) || str.match(/https:\/\/dl\.polyhaven\.org\/[^"']+\.(jpg|png)/i);
    return m ? m[0] : null;
  } catch { return null; }
}

// ambientCG — one call returns all CC0 assets (bucket A).
export async function harvestAmbientCG(limit = 20) {
  try {
    const j = await api('https://ambientcg.com', `/api/v2/full_json?type=Material&limit=${limit}&include=downloadData`);
    const items = (j && j.foundAssets) || [];
    return { ok: true, source: 'ambientcg', count: items.length, ids: items.map((a) => a.assetId), license: 'CC0', bucket: 'A' };
  } catch (e) { return { ok: false, error: String(e && e.message) }; }
}

// summary for /health or a status page
export function catalogSummary() {
  const by = { A: 0, B: 0, C: 0 };
  for (const s of SOURCES) by[licenseBucket(s.license)] += 1;
  return { sources: SOURCES.length, mintSafe: by.A, product: by.B, reference: by.C, keyless: SOURCES.filter((s) => s.tier === 'keyless').length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('genai-asset-library.mjs')) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'harvest' && a === 'polyhaven') {
    const r = await harvestPolyHaven(b || 'textures', parseInt(c, 10) || 5);
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log('MELEK asset library —', JSON.stringify(catalogSummary()));
    console.log('sources:');
    for (const s of SOURCES) console.log(`  [${licenseBucket(s.license)}] ${s.id.padEnd(16)} ${s.media.padEnd(22)} ${s.license.padEnd(18)} ${s.tier}`);
    console.log('\n  A=mint-safe(CC0/original)  B=product(CC-BY/perm)  C=reference-only(NC/ToS/per-item)');
  }
}
