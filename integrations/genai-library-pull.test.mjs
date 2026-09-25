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

// stub that serves the three NEW keyless PD/CC0 lanes (nasa, wellcome, archive) and returns nothing for
// the older lanes, so we can assert the new lanes pull real bucket-A assets with provenance + dedup.
function stubNewLanes() {
  // >=1024 bytes so it clears the new lanes' small-file (error-page) guard; PNG magic + padding.
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2048, 7)]);
  const img = { ok: true, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) };
  const f = async (url) => {
    const u = String(url);
    // NASA: search → manifest → jpg
    if (u.includes('images-api.nasa.gov/search')) return { ok: true, json: async () => ({ collection: { items: [{ data: [{ nasa_id: 'PIA1' }], href: 'https://images-assets.nasa.gov/image/PIA1/collection.json' }] } }) };
    if (u.includes('images-assets.nasa.gov') && u.endsWith('collection.json')) return { ok: true, json: async () => ['http://images-assets.nasa.gov/image/PIA1/PIA1~medium.jpg', 'http://images-assets.nasa.gov/image/PIA1/PIA1~orig.jpg'] };
    // Wellcome: works → iiif image
    if (u.includes('api.wellcomecollection.org/catalogue')) return { ok: true, json: async () => ({ results: [{ id: 'WL1', items: [{ locations: [{ locationType: { id: 'iiif-image' }, url: 'https://iiif.wellcomecollection.org/image/IMG1/info.json', license: { id: 'pdm' } }] }] }] }) };
    // Archive: search → metadata → download
    if (u.includes('archive.org/advancedsearch')) return { ok: true, json: async () => ({ response: { docs: [{ identifier: 'ID1' }] } }) };
    if (u.includes('archive.org/metadata/')) return { ok: true, json: async () => ({ files: [{ name: 'photo.jpg', size: '50000' }, { name: 'photo_thumb.jpg', size: '2000' }] }) };
    // any image download
    if (/\.(jpe?g|png)(\?|$)/i.test(u) || u.includes('images-assets.nasa.gov/image/PIA1/PIA1~') || u.includes('/download/') || u.includes('iiif.wellcomecollection.org/image/IMG1/full')) return img;
    // older lanes get empty lists → pull nothing
    return { ok: true, json: async () => ({}) };
  };
  __setFetch(f); __setAssetFetch(f);
}

test('new keyless lanes (nasa/wellcome/archive) pull bucket-A PD/CC0 assets with provenance + dedup', async () => {
  stubNewLanes();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libpull-new-'));
  const r1 = await pullBatch({ max: 30, dir });
  const byId = Object.fromEntries(r1.sources.map((s) => [s.source, s]));
  for (const src of ['nasa', 'wellcome', 'archive']) {
    assert.ok(byId[src] && byId[src].pulled >= 1, `${src} pulled at least one`);
    const sdir = path.join(dir, src);
    const provs = fs.readdirSync(sdir).filter((f) => f.endsWith('.provenance.json'));
    assert.ok(provs.length >= 1, `${src} wrote a provenance sidecar`);
    const p = JSON.parse(fs.readFileSync(path.join(sdir, provs[0]), 'utf8'));
    assert.equal(p.bucket, 'A', `${src} asset is mint-safe bucket A`);
    assert.equal(p.mintOK, true);
    assert.ok(p.sha256 && p.sha256.length === 64);
  }
  // second run: everything held → these lanes pull 0 new (incremental dedup)
  const r2 = await pullBatch({ max: 30, dir });
  const by2 = Object.fromEntries(r2.sources.map((s) => [s.source, s]));
  for (const src of ['nasa', 'wellcome', 'archive']) assert.equal(by2[src].pulled, 0, `${src} held assets not re-pulled`);
  __setFetch(null); __setAssetFetch(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

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
  // exhaust Poly Haven (3 stub ids), then a second run must pull 0 new PH assets (incremental dedup).
  // NOTE: pullBatch splits `max` across all lanes, so a big max is needed to give PH enough share to
  // grab every remaining id in one call.
  await pullBatch({ max: 90, dir });               // large share → grabs all remaining PH ids
  const r2 = await pullBatch({ max: 90, dir });     // everything held now
  assert.equal(r2.sources[0].source, 'polyhaven');
  assert.equal(r2.sources[0].pulled, 0, 'held PH assets are not re-pulled');
  __setFetch(null); __setAssetFetch(null);
  fs.rmSync(dir, { recursive: true, force: true });
});
