import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pullBatch, __setFetch } from './genai-library-pull.mjs';
import { __setFetch as __setAssetFetch } from './genai-asset-library.mjs';

function stub() {
  const png = Buffer.from('89504e470d0a1a0a', 'hex'); // tiny fake png bytes
  const f = async (url) => {
    const u = String(url);
    if (u.includes('/assets?type=')) return { ok: true, json: async () => ({ t1: {}, t2: {}, t3: {} }) };
    if (u.includes('/files/')) return { ok: true, json: async () => ({ Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/x/t1_diff_1k.jpg' } } } }) };
    if (u.includes('metmuseum') && u.includes('/search')) return { ok: true, json: async () => ({ objectIDs: [101, 102] }) };
    if (u.includes('metmuseum') && u.includes('/objects/')) return { ok: true, json: async () => ({ isPublicDomain: true, primaryImageSmall: 'https://images.met/obj.jpg' }) };
    return { ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
  };
  __setFetch(f); __setAssetFetch(f);
}

test('pullBatch pulls bucket-A assets with provenance, skips held (offline)', async () => {
  stub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libpull-'));
  const r1 = await pullBatch({ max: 4, dir });
  assert.ok(r1.pulled >= 1, 'pulled some');
  // provenance sidecars written
  const phDir = path.join(dir, 'polyhaven');
  const provs = fs.readdirSync(phDir).filter((f) => f.endsWith('.provenance.json'));
  assert.ok(provs.length >= 1);
  const p = JSON.parse(fs.readFileSync(path.join(phDir, provs[0]), 'utf8'));
  assert.equal(p.bucket, 'A');
  assert.equal(p.mintOK, true);
  assert.ok(p.sha256 && p.sha256.length === 64);
  // exhaust Poly Haven (3 stub ids), then a second run must pull 0 new PH assets (incremental dedup)
  await pullBatch({ max: 6, dir });               // grabs all 3 PH ids
  const r2 = await pullBatch({ max: 6, dir });     // everything held now
  assert.equal(r2.sources[0].source, 'polyhaven');
  assert.equal(r2.sources[0].pulled, 0, 'held PH assets are not re-pulled');
  __setFetch(null); __setAssetFetch(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
