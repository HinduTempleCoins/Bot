// genai-library-pull.mjs — INCREMENTAL bulk-pull of bucket-A (mint-safe, CC0) assets into our HELD
// corpus. Bounded per run + skips what we already hold (by id), so the daily timer GROWS the library
// safely without blowing disk or re-downloading. Every asset gets a provenance sidecar (source/url/
// license/bucket/sha256). Sources: Poly Haven (CC0 textures/hdris/models, low-res) + the Met (CC0
// public-domain images via Open Access API). No GPU, no key, no paid service.
//
//   import { pullBatch } from './genai-library-pull.mjs'
//   node integrations/genai-library-pull.mjs --max 20 --dir knowledge/genai-library/assets

import fs from 'node:fs';
import path from 'node:path';
import { harvestPolyHaven, polyHavenFileUrl, provenance } from './genai-asset-library.mjs';

let _fetch = (...a) => fetch(...a);
export function __setFetch(f) { _fetch = f || ((...a) => fetch(...a)); }

const held = (dir) => { try { return new Set(fs.readdirSync(dir).map((f) => f.replace(/\.(provenance\.json|jpg|jpeg|png|webp)$/i, ''))); } catch { return new Set(); } };

async function save(dir, id, url, buffer, license) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = String(url).split('.').pop().split('?')[0].toLowerCase().slice(0, 4);
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer);
  fs.writeFileSync(path.join(dir, `${id}.provenance.json`), JSON.stringify(provenance({ source: dir.includes('met') ? 'met' : 'polyhaven', id, url, license, buffer }), null, 2));
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
        await save(dir, id, url, b, 'CC0'); pulled++; bytes += b.length;
      } catch { /* skip */ }
    }
  }
  return { source: 'polyhaven', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

// The Met Open Access: pull up to `max` NEW CC0 (public-domain) images.
async function pullMet(baseDir, max) {
  const dir = path.join(baseDir, 'met');
  const have = held(dir);
  let pulled = 0, bytes = 0;
  try {
    const r = await _fetch('https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=portrait');
    const ids = ((await r.json()).objectIDs || []).slice(0, max * 6);
    for (const oid of ids) {
      if (pulled >= max) break;
      if (have.has(String(oid))) continue;
      try {
        const o = await (await _fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${oid}`)).json();
        if (!o || !o.isPublicDomain || !o.primaryImageSmall) continue;
        const ir = await _fetch(o.primaryImageSmall); if (!ir || !ir.ok) continue;
        const b = Buffer.from(await ir.arrayBuffer());
        await save(dir, String(oid), o.primaryImageSmall, b, 'CC0'); pulled++; bytes += b.length;
      } catch { /* skip */ }
    }
  } catch { /* met unavailable */ }
  return { source: 'met', pulled, mb: +(bytes / 1048576).toFixed(1) };
}

export async function pullBatch({ max = 20, dir = 'knowledge/genai-library/assets' } = {}) {
  const half = Math.max(1, Math.floor(max / 2));
  const ph = await pullPolyHaven(dir, half);
  const met = await pullMet(dir, max - ph.pulled);
  return { pulled: ph.pulled + met.pulled, mb: +(ph.mb + met.mb).toFixed(1), sources: [ph, met], at: new Date().toISOString() };
}

if (process.argv[1] && process.argv[1].endsWith('genai-library-pull.mjs')) {
  const a = process.argv; const gi = (k, d) => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : d; };
  const r = await pullBatch({ max: parseInt(gi('--max', '20'), 10), dir: gi('--dir', 'knowledge/genai-library/assets') });
  console.log(JSON.stringify(r, null, 2));
}
