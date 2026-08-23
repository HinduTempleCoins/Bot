// art-open-access.test.mjs — offline tests for the public-domain / open-access ART reader.
// All network is stubbed via __setFetch; no live calls, no keys. Run:
//   node --test integrations/soapbox/art-open-access.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  search, searchMet, searchArtic,
  normalizeWork, attributionLine, renderGallery, dataNote,
  __setFetch,
} from './art-open-access.mjs';

function jsonFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function throwingFetch() {
  return async () => { throw new Error('network down'); };
}

// The Met search returns IDs only; each /objects/{id} is a separate call. This routed mock serves the
// ID list and a per-id object record (one of which is NOT public-domain → must be dropped).
const MET_OBJECTS = {
  101: { objectID: 101, isPublicDomain: true, title: 'Wheat Field', artistDisplayName: 'Van Gogh', objectDate: '1889', primaryImage: 'https://img.met/101.jpg', primaryImageSmall: 'https://img.met/101s.jpg' },
  102: { objectID: 102, isPublicDomain: false, title: 'Still Under Copyright', artistDisplayName: 'Modern', objectDate: '1990', primaryImage: 'https://img.met/102.jpg' },
  103: { objectID: 103, isPublicDomain: true, title: 'Lotus Pond', artistDisplayName: 'Monet', objectDate: '1904', primaryImage: 'https://img.met/103.jpg' },
};
function metFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes('/search')) return { ok: true, json: async () => ({ total: 3, objectIDs: [101, 102, 103] }) };
    const m = u.match(/\/objects\/(\d+)/);
    if (m) return { ok: true, json: async () => MET_OBJECTS[m[1]] };
    return { ok: false, json: async () => ({}) };
  };
}

const ARTIC_PAYLOAD = {
  data: [
    { id: 201, title: 'A Sunday', artist_display: 'Seurat', date_display: '1884', is_public_domain: true, image_id: 'abc-image' },
    { id: 202, title: 'Restricted Loan', artist_display: 'Anon', date_display: '2001', is_public_domain: false, image_id: 'def-image' }, // not PD → dropped
  ],
};

// Combined router so search() can exercise Met + Artic in one call.
function routedFetch() {
  return async (url) => {
    const u = String(url);
    if (u.includes('artic.edu/api')) return { ok: true, json: async () => ARTIC_PAYLOAD };
    if (u.includes('metmuseum.org') && u.includes('/search')) return { ok: true, json: async () => ({ objectIDs: [101, 102, 103] }) };
    const m = u.match(/\/objects\/(\d+)/);
    if (m) return { ok: true, json: async () => MET_OBJECTS[m[1]] };
    return { ok: false, json: async () => ({}) };
  };
}

// ── normalizeWork: the load-bearing PD gate ───────────────────────────────────────────────────────────
test('normalizeWork drops a non-PD Met object (isPublicDomain=false → null)', () => {
  assert.equal(normalizeWork(MET_OBJECTS[102], 'The Met'), null);
});

test('normalizeWork drops a non-PD Artic object (is_public_domain=false → null)', () => {
  assert.equal(normalizeWork(ARTIC_PAYLOAD.data[1], 'Art Institute of Chicago'), null);
});

test('normalizeWork keeps a PD Met work with imageUrl + attribution + host posture', () => {
  const w = normalizeWork(MET_OBJECTS[101], 'The Met');
  assert.ok(w);
  assert.equal(w.id, '101');
  assert.equal(w.title, 'Wheat Field');
  assert.equal(w.artist, 'Van Gogh');
  assert.equal(w.imageUrl, 'https://img.met/101.jpg');
  assert.equal(w.thumbUrl, 'https://img.met/101s.jpg');
  assert.equal(w.source, 'The Met');
  assert.equal(w.license, 'PD/CC0');
  assert.equal(w.posture, 'host');
  assert.match(w.attribution, /Wheat Field/);
  assert.match(w.attribution, /Van Gogh/);
  assert.match(w.attribution, /Public Domain/);
});

test('normalizeWork keeps a PD Artic work, building the IIIF image URL from image_id', () => {
  const w = normalizeWork(ARTIC_PAYLOAD.data[0], 'Art Institute of Chicago');
  assert.ok(w);
  assert.equal(w.id, '201');
  assert.equal(w.title, 'A Sunday');
  assert.equal(w.source, 'Art Institute of Chicago');
  assert.equal(w.imageUrl, 'https://www.artic.edu/iiif/2/abc-image/full/843,/0/default.jpg');
  assert.equal(w.thumbUrl, 'https://www.artic.edu/iiif/2/abc-image/full/200,/0/default.jpg');
  assert.equal(w.license, 'PD/CC0');
  assert.equal(w.posture, 'host');
});

test('normalizeWork returns null for junk input', () => {
  assert.equal(normalizeWork(null, 'The Met'), null);
  assert.equal(normalizeWork('nope', 'The Met'), null);
  assert.equal(normalizeWork({}, 'The Met'), null);              // no PD flag → dropped
});

// ── attributionLine ───────────────────────────────────────────────────────────────────────────────────
test('attributionLine credits title / artist / date / source and marks Public Domain', () => {
  const line = attributionLine({ title: 'Lotus Pond', artist: 'Monet', date: '1904', source: 'The Met' });
  assert.match(line, /Lotus Pond/);
  assert.match(line, /Monet/);
  assert.match(line, /1904/);
  assert.match(line, /The Met/);
  assert.match(line, /Public Domain/);
});

test('attributionLine soft-handles a missing/blank work', () => {
  assert.equal(attributionLine(null), '');
  assert.match(attributionLine({}), /Untitled/);
});

// ── The Met (keyless) ─────────────────────────────────────────────────────────────────────────────────
test('searchMet fetches objects, keeps PD only, drops the non-PD object', async () => {
  __setFetch(metFetch());
  const r = await searchMet({ query: 'landscape' });
  __setFetch(null);
  assert.equal(r.length, 2);                                    // 101 + 103 kept; 102 dropped
  assert.ok(r.every((w) => w.license === 'PD/CC0' && w.posture === 'host'));
  assert.ok(r.every((w) => w.imageUrl));
  assert.ok(r.some((w) => w.id === '101'));
  assert.ok(r.some((w) => w.id === '103'));
  assert.ok(!r.some((w) => w.id === '102'));                    // non-PD excluded
});

test('searchMet soft-fails to [] on network error and on a malformed payload', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await searchMet({ query: 'x' }), []);
  __setFetch(jsonFetch({ nope: true }));
  assert.deepEqual(await searchMet({ query: 'x' }), []);
  __setFetch(null);
});

// ── Art Institute of Chicago (keyless) ────────────────────────────────────────────────────────────────
test('searchArtic parses data, keeps PD only, drops the non-PD record', async () => {
  __setFetch(jsonFetch(ARTIC_PAYLOAD));
  const r = await searchArtic({ query: 'seurat' });
  __setFetch(null);
  assert.equal(r.length, 1);                                    // 202 dropped
  assert.equal(r[0].id, '201');
  assert.equal(r[0].title, 'A Sunday');
  assert.equal(r[0].license, 'PD/CC0');
  assert.equal(r[0].posture, 'host');
  assert.ok(r[0].imageUrl.includes('/iiif/2/abc-image/'));
  assert.ok(!r.some((w) => w.title === 'Restricted Loan'));     // non-PD excluded
});

test('searchArtic soft-fails to [] on network error and on non-shaped payload', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await searchArtic({ query: 'x' }), []);
  __setFetch(jsonFetch({ not: 'data' }));
  assert.deepEqual(await searchArtic({ query: 'x' }), []);
  __setFetch(null);
});

// ── merged search ─────────────────────────────────────────────────────────────────────────────────────
test('search merges Met + Artic, PD-filtered, and dedupes', async () => {
  __setFetch(routedFetch());
  const r = await search({ query: 'painting' });
  __setFetch(null);
  assert.ok(r.some((w) => w.source === 'The Met'));
  assert.ok(r.some((w) => w.source === 'Art Institute of Chicago'));
  assert.ok(r.every((w) => w.license === 'PD/CC0' && w.posture === 'host'));
  // dedupe: no two entries share the same source|id|imageUrl key
  const keys = r.map((w) => `${w.source}|${w.id}|${w.imageUrl}`);
  assert.equal(keys.length, new Set(keys).size);
});

test('search excludes every non-PD work from both sources', async () => {
  __setFetch(routedFetch());
  const r = await search({ query: 'anything' });
  __setFetch(null);
  assert.ok(!r.some((w) => w.id === '102'));                    // Met non-PD excluded
  assert.ok(!r.some((w) => w.title === 'Restricted Loan'));     // Artic non-PD excluded
});

test('search soft-fails to [] when every source errors', async () => {
  __setFetch(throwingFetch());
  const r = await search({ query: 'x' });
  __setFetch(null);
  assert.deepEqual(r, []);
});

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────────
test('renderGallery escapes a malicious title and image URL, shows attribution + data note', () => {
  const html = renderGallery([
    {
      title: '<script>alert(1)</script>',
      artist: 'x',
      imageUrl: 'https://e.x/1.jpg"><img onerror=alert(1)>',
      thumbUrl: 'https://e.x/1.jpg"><img onerror=alert(1)>',
      source: 'The Met',
      license: 'PD/CC0',
      posture: 'host',
      attribution: '“t” — x (Public Domain)',
    },
  ]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('.jpg"><img onerror'));             // the src quote-break is escaped, not raw
  assert.ok(html.includes('&quot;&gt;&lt;img onerror'));       // dangerous chars neutralized in the src attr
  assert.ok(html.includes('Public Domain'));
  assert.ok(html.includes('Public-domain &amp; open-access art'));
});

test('renderGallery handles empty / null and dataNote states the PD-only, fail-closed rule', () => {
  assert.ok(renderGallery([]).includes('No public-domain works'));
  assert.ok(renderGallery(null).includes('</section>'));
  assert.match(dataNote(), /public-domain \/ CC0 only/);
  assert.match(dataNote(), /fail-closed/);
  assert.match(dataNote(), /The Met/);
});
