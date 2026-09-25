// genai-library-pull.mjs — INCREMENTAL bulk-pull of bucket-A (mint-safe, CC0) assets into our HELD
// corpus. Bounded per run + skips what we already hold (by id), so the daily timer GROWS the library
// safely without blowing disk or re-downloading. Every asset gets a provenance sidecar (source/url/
// license/bucket/sha256). Sources (all keyless, no Cloudflare challenge): Poly Haven (CC0 3D), the Met /
// Art Institute of Chicago / Cleveland (CC0 art), Wikimedia Commons + Openverse (filtered to CC0/PD),
// NASA Images (public-domain space imagery), the Wellcome Collection (CC0/PDM via IIIF) and the Internet
// Archive (public-domain-marked images). No GPU, no key, no paid service. Corpus stays mint-safe (bucket A).
//
//   import { pullBatch } from './genai-library-pull.mjs'
//   node integrations/genai-library-pull.mjs --max 20 --dir knowledge/genai-library/assets

import fs from 'node:fs';
import path from 'node:path';
import { harvestPolyHaven, polyHavenFileUrl, provenance } from './genai-asset-library.mjs';

let _fetch = (...a) => fetch(...a);
export function __setFetch(f) { _fetch = f || ((...a) => fetch(...a)); }

const held = (dir) => { try { return new Set(fs.readdirSync(dir).map((f) => f.replace(/\.(provenance\.json|jpg|jpeg|png|webp)$/i, ''))); } catch { return new Set(); } };

async function save(dir, id, url, buffer, license, source) {
  fs.mkdirSync(dir, { recursive: true });
  const src = source || (dir.includes('met') ? 'met' : 'polyhaven');
  const ext = String(url).split('.').pop().split('?')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4) || 'jpg';
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer);
  fs.writeFileSync(path.join(dir, `${id}.provenance.json`), JSON.stringify(provenance({ source: src, id, url, license, buffer }), null, 2));
}

// Poly Haven: pull up to `max` NEW assets across textures/hdris/models (1k where applicable).
async function pullPolyHaven(baseDir, max) {
  const dir = path.join(baseDir, 'polyhaven');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const type of ['textures', 'models', 'hdris']) {
    if (pulled >= max) break;
    const list = await harvestPolyHaven(type, 200);
    for (const id of (list.ids || [])) {
      if (pulled >= max) break;
      if (have.has(id)) continue;
      try {
        const url = await polyHavenFileUrl(id, '1k'); if (!url) continue;
        const r = await _fetch(url); if (!r || !r.ok) continue;
        const b = Buffer.from(await r.arrayBuffer());
        if (b.length > 30 * 1024 * 1024) continue; // skip anything huge in the incremental lane
        await save(dir, id, url, b, 'CC0', 'polyhaven'); pulled++; bytes += b.length;
      } catch { /* skip */ }
    }
  }
  return { source: 'polyhaven', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// The Met Open Access: pull up to `max` NEW CC0 (public-domain) images. Rotates queries so re-runs keep
// finding NEW objects instead of re-hitting the same "portrait" set.
const MET_QUERIES = ['portrait', 'landscape', 'sculpture', 'egyptian', 'ornament', 'textile', 'vessel', 'jewelry'];
async function pullMet(baseDir, max) {
  const dir = path.join(baseDir, 'met');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of MET_QUERIES) {
    if (pulled >= max) break;
    try {
      const r = await _fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${q}`);
      const ids = ((await r.json()).objectIDs || []).slice(0, max * 6);
      for (const oid of ids) {
        if (pulled >= max) break;
        if (have.has(String(oid))) continue;
        try {
          const o = await (await _fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${oid}`)).json();
          if (!o || !o.isPublicDomain || !o.primaryImageSmall) continue;
          const ir = await _fetch(o.primaryImageSmall); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          await save(dir, String(oid), o.primaryImageSmall, b, 'CC0', 'met'); pulled++; bytes += b.length; have.add(String(oid));
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'met', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// Art Institute of Chicago Open Access: keyless, CC0 public-domain artworks. IIIF image server gives a
// single JPG per work. Rotates queries for variety on re-runs.
const ARTIC_QUERIES = ['portrait', 'landscape', 'egyptian', 'sculpture', 'textile', 'deity', 'ornament', 'figure'];
async function pullArtic(baseDir, max) {
  const dir = path.join(baseDir, 'artic');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of ARTIC_QUERIES) {
    if (pulled >= max) break;
    try {
      const u = `https://api.artic.edu/api/v1/artworks/search?q=${q}&query[term][is_public_domain]=true&fields=id,image_id,title&limit=100`;
      const j = await (await _fetch(u)).json();
      for (const it of (j && j.data) || []) {
        if (pulled >= max) break;
        if (!it.image_id || have.has(String(it.id))) continue;
        try {
          const url = `https://www.artic.edu/iiif/2/${it.image_id}/full/843,/0/default.jpg`;
          const ir = await _fetch(url); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          await save(dir, String(it.id), url, b, 'CC0', 'artic'); pulled++; bytes += b.length; have.add(String(it.id));
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'artic', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// Openverse: aggregates 700M+ CC items across many providers. Works anonymously (rate-limited). We FILTER
// license=cc0 so everything pulled is mint-safe bucket A. Rotates queries for breadth.
const OV_QUERIES = ['angel', 'goddess', 'egyptian', 'temple', 'landscape', 'portrait', 'ornament', 'pattern'];
async function pullOpenverse(baseDir, max) {
  const dir = path.join(baseDir, 'openverse');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of OV_QUERIES) {
    if (pulled >= max) break;
    try {
      const u = `https://api.openverse.org/v1/images/?license=cc0&page_size=50&q=${q}`;
      // Openverse anonymous tier is rate-limited and returns a transient 401 under load — retry once with backoff.
      let r = await _fetch(u);
      if (r && r.status === 401) { await new Promise((s) => setTimeout(s, 1500)); r = await _fetch(u); }
      if (!r || !r.ok) continue;
      const j = await r.json();
      for (const it of (j && j.results) || []) {
        if (pulled >= max) break;
        const id = String(it.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
        if (!it.url || !id || have.has(id)) continue;
        try {
          const ir = await _fetch(it.url); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          if (b.length > 30 * 1024 * 1024 || b.length < 1024) continue;
          await save(dir, id, it.url, b, 'CC0', 'openverse'); pulled++; bytes += b.length; have.add(id);
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'openverse', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// Cleveland Museum of Art: keyless, CC0 open access, no Cloudflare challenge. Single web-res JPG per work.
const CMA_QUERIES = ['egyptian', 'deity', 'portrait', 'landscape', 'ornament', 'textile', 'sculpture', 'figure'];
async function pullCleveland(baseDir, max) {
  const dir = path.join(baseDir, 'cleveland');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of CMA_QUERIES) {
    if (pulled >= max) break;
    try {
      const u = `https://openaccess-api.clevelandart.org/api/artworks/?cc0=1&has_image=1&limit=100&q=${q}`;
      const r = await _fetch(u); if (!r || !r.ok) continue;
      const j = await r.json();
      for (const it of (j && j.data) || []) {
        if (pulled >= max) break;
        const url = it.images && it.images.web && it.images.web.url;
        if (!url || have.has(String(it.id))) continue;
        try {
          const ir = await _fetch(url); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          await save(dir, String(it.id), url, b, 'CC0', 'cleveland'); pulled++; bytes += b.length; have.add(String(it.id));
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'cleveland', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// Wikimedia Commons: massive, keyless. Mixed licenses — we KEEP ONLY CC0 / public-domain files so the
// held corpus stays mint-safe bucket A. License read from extmetadata.LicenseShortName.
const WC_QUERIES = ['egyptian goddess', 'ancient egypt relief', 'angel painting', 'temple architecture', 'byzantine icon', 'illuminated manuscript', 'hindu deity sculpture', 'baroque ceiling'];
const isFreeLic = (s) => /cc0|public domain|pd-|no restrictions/i.test(String(s || ''));
async function pullCommons(baseDir, max) {
  const dir = path.join(baseDir, 'commons');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of WC_QUERIES) {
    if (pulled >= max) break;
    try {
      const u = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=40&prop=imageinfo&iiprop=url|extmetadata&format=json`;
      const r = await _fetch(u); if (!r || !r.ok) continue;
      const j = await r.json();
      const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
      for (const p of pages) {
        if (pulled >= max) break;
        const ii = p.imageinfo && p.imageinfo[0];
        if (!ii || !ii.url || !/\.(jpe?g|png)(\?|$)/i.test(ii.url)) continue;
        const lic = ii.extmetadata && ii.extmetadata.LicenseShortName && ii.extmetadata.LicenseShortName.value;
        if (!isFreeLic(lic)) continue; // keep the corpus mint-safe
        const id = 'wc' + String(p.pageid || p.title || '').replace(/[^a-z0-9]/gi, '').slice(0, 38);
        if (have.has(id)) continue;
        try {
          const ir = await _fetch(ii.url.split('?')[0]); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          if (b.length > 30 * 1024 * 1024 || b.length < 1024) continue;
          await save(dir, id, ii.url.split('?')[0], b, /cc0/i.test(lic) ? 'CC0' : 'Public Domain', 'commons'); pulled++; bytes += b.length; have.add(id);
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'commons', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// NASA Images: keyless, public-domain space imagery. search → per-item asset manifest (collection.json)
// → pick a mid-size https jpg. Rotates queries for breadth. PROVEN keyless from this env (2026-09-25).
const NASA_QUERIES = ['nebula', 'galaxy', 'mars', 'earth from space', 'moon', 'saturn', 'aurora', 'sun'];
async function pullNasa(baseDir, max) {
  const dir = path.join(baseDir, 'nasa');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of NASA_QUERIES) {
    if (pulled >= max) break;
    try {
      const r = await _fetch(`https://images-api.nasa.gov/search?media_type=image&page_size=50&q=${encodeURIComponent(q)}`);
      if (!r || !r.ok) continue;
      const items = ((((await r.json()) || {}).collection) || {}).items || [];
      for (const it of items) {
        if (pulled >= max) break;
        const nasaId = it.data && it.data[0] && it.data[0].nasa_id;
        const id = 'nasa' + String(nasaId || '').replace(/[^a-z0-9]/gi, '').slice(0, 44);
        if (!nasaId || !it.href || have.has(id)) continue;
        try {
          const col = await (await _fetch(it.href)).json();
          const jpgs = ((col || []).filter((u) => /\.jpe?g$/i.test(u)).map((u) => String(u).replace(/^http:/, 'https:')));
          const url = jpgs.find((u) => /~medium/.test(u)) || jpgs.find((u) => /~small/.test(u)) || jpgs[0];
          if (!url) continue;
          const ir = await _fetch(url); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          if (b.length > 30 * 1024 * 1024 || b.length < 1024) continue;
          await save(dir, id, url, b, 'Public Domain', 'nasa'); pulled++; bytes += b.length; have.add(id);
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'nasa', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// Wellcome Collection: keyless catalogue API filtered to CC0 / Public-Domain-Mark works, images pulled
// from its IIIF server. PROVEN keyless from this env (2026-09-25). Rotates queries for breadth.
const WELL_QUERIES = ['egypt', 'anatomy', 'botanical', 'alchemy', 'astronomy', 'herbal', 'manuscript', 'deity'];
async function pullWellcome(baseDir, max) {
  const dir = path.join(baseDir, 'wellcome');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of WELL_QUERIES) {
    if (pulled >= max) break;
    try {
      const u = `https://api.wellcomecollection.org/catalogue/v2/works?query=${encodeURIComponent(q)}&include=items&items.locations.license=cc0,pdm&pageSize=50`;
      const r = await _fetch(u); if (!r || !r.ok) continue;
      const results = ((await r.json()) || {}).results || [];
      for (const w of results) {
        if (pulled >= max) break;
        let iiif = null, lic = null;
        for (const it of (w.items || [])) for (const l of (it.locations || [])) {
          if (l.locationType && l.locationType.id === 'iiif-image' && l.url) { iiif = l.url; lic = (l.license || {}).id; }
        }
        const m = iiif && iiif.match(/\/image\/([^/]+)\/info\.json/);
        if (!m) continue;
        const id = 'wl' + String(w.id || m[1]).replace(/[^a-z0-9]/gi, '').slice(0, 46);
        if (have.has(id)) continue;
        try {
          const url = `https://iiif.wellcomecollection.org/image/${m[1]}/full/600,/0/default.jpg`;
          const ir = await _fetch(url); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          if (b.length > 30 * 1024 * 1024 || b.length < 1024) continue;
          await save(dir, id, url, b, lic === 'cc0' ? 'CC0' : 'Public Domain', 'wellcome'); pulled++; bytes += b.length; have.add(id);
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'wellcome', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// Internet Archive: keyless. Filter to items whose licenseurl is a public-domain mark so the corpus stays
// mint-safe, then pick the largest real (non-thumb) image file from the item. PROVEN keyless (2026-09-25).
const IA_QUERIES = ['egypt', 'temple', 'goddess', 'manuscript', 'ancient ruins', 'ornament', 'sculpture', 'relic'];
async function pullArchive(baseDir, max) {
  const dir = path.join(baseDir, 'archive');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  for (const q of IA_QUERIES) {
    if (pulled >= max) break;
    try {
      const query = `mediatype:image AND licenseurl:*publicdomain* AND (${q})`;
      const u = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&rows=40&output=json`;
      const r = await _fetch(u); if (!r || !r.ok) continue;
      const docs = (((await r.json()) || {}).response || {}).docs || [];
      for (const doc of docs) {
        if (pulled >= max) break;
        const ident = doc.identifier;
        const id = 'ia' + String(ident || '').replace(/[^a-z0-9]/gi, '').slice(0, 46);
        if (!ident || have.has(id)) continue;
        try {
          const meta = await (await _fetch(`https://archive.org/metadata/${encodeURIComponent(ident)}`)).json();
          const files = (meta && meta.files) || [];
          const cand = files
            .filter((f) => /\.(jpe?g|png)$/i.test(f.name || '') && !/thumb|__ia|_thumb|tile/i.test(f.name || ''))
            .sort((a, b) => (+b.size || 0) - (+a.size || 0));
          const f = cand[0]; if (!f) continue;
          const url = `https://archive.org/download/${encodeURIComponent(ident)}/${encodeURIComponent(f.name)}`;
          const ir = await _fetch(url); if (!ir || !ir.ok) continue;
          const b = Buffer.from(await ir.arrayBuffer());
          if (b.length > 30 * 1024 * 1024 || b.length < 1024) continue;
          await save(dir, id, url, b, 'Public Domain', 'archive'); pulled++; bytes += b.length; have.add(id);
        } catch { /* skip */ }
      }
    } catch { /* skip this query */ }
  }
  return { source: 'archive', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

export async function pullBatch({ max = 20, dir = 'knowledge/genai-library/assets' } = {}) {
  // Spread across the reliably-keyless sources. Openverse is best-effort (Cloudflare may challenge it).
  const lanes = [pullPolyHaven, pullMet, pullArtic, pullCleveland, pullCommons, pullNasa, pullWellcome, pullArchive, pullOpenverse];
  const share = Math.max(1, Math.floor(max / lanes.length));
  const sources = [];
  let remaining = max;
  for (const lane of lanes) {
    if (remaining <= 0) break;
    const want = Math.min(share || 1, remaining) || 1;
    const s = await lane(dir, want);
    sources.push(s); remaining -= s.pulled;
  }
  return { pulled: sources.reduce((s, x) => s + x.pulled, 0), mb: +sources.reduce((s, x) => s + x.mb, 0).toFixed(1), sources, at: new Date().toISOString() };
}

if (process.argv[1] && process.argv[1].endsWith('genai-library-pull.mjs')) {
  const a = process.argv; const gi = (k, d) => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : d; };
  const r = await pullBatch({ max: parseInt(gi('--max', '20'), 10), dir: gi('--dir', 'knowledge/genai-library/assets') });
  console.log(JSON.stringify(r, null, 2));
}
