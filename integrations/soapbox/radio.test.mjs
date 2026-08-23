import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStation, searchStations, dallasStations, stationsByTag, scannerStations, isScannerStation, SCANNER_TAGS, renderList, dataNote, esc, __setFetch } from './radio.mjs';

const RAW = {
  stationuuid: 'uuid-1', name: 'KERA 90.1 Dallas', url_resolved: 'https://stream.kera.org/live',
  homepage: 'https://kera.org', favicon: 'https://kera.org/fav.png', tags: 'news,public,talk',
  country: 'The United States Of America', state: 'Texas', codec: 'MP3', bitrate: 128,
};

test('esc escapes html', () => assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;'));

test('toStation normalizes + tags POINT posture (never rehost)', () => {
  const s = toStation(RAW);
  assert.equal(s.name, 'KERA 90.1 Dallas');
  assert.equal(s.stream, 'https://stream.kera.org/live');
  assert.equal(s.posture, 'point');
  assert.deepEqual(s.tags, ['news', 'public', 'talk']);
  assert.equal(s.state, 'Texas');
});

test('toStation rejects records with no name or no stream', () => {
  assert.equal(toStation({ name: 'x' }), null);       // no stream
  assert.equal(toStation({ url_resolved: 'x' }), null); // no name
  assert.equal(toStation({}), null);
});

function mockFetch(rows) {
  return async () => ({ ok: true, json: async () => rows });
}

test('searchStations returns shaped stations, clamps limit', async () => {
  __setFetch(mockFetch([RAW, { ...RAW, stationuuid: 'u2', name: 'KKDA' }]));
  const out = await searchStations({ state: 'Texas', limit: 5000 });
  assert.equal(out.length, 2);
  assert.equal(out[0].posture, 'point');
  __setFetch(null);
});

test('searchStations soft-fails to [] on a bad response', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await searchStations({ state: 'Texas' }), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await searchStations({ name: 'Dallas' }), []);
  __setFetch(null);
});

test('dallasStations dedupes across name+state queries', async () => {
  __setFetch(mockFetch([RAW])); // both sub-queries return the same station → deduped to 1
  const out = await dallasStations(40);
  assert.equal(out.length, 1);
  __setFetch(null);
});

test('stationsByTag queries a genre', async () => {
  __setFetch(mockFetch([{ ...RAW, tags: 'jazz' }]));
  const out = await stationsByTag('jazz', 10);
  assert.equal(out[0].tags[0], 'jazz');
  __setFetch(null);
});

test('renderList emits an esc-safe station list with the POINT stream + play button', () => {
  const html = renderList([toStation(RAW)]);
  assert.match(html, /KERA 90\.1 Dallas/);
  assert.match(html, /data-stream="https:\/\/stream\.kera\.org\/live"/);
  assert.match(html, /class=play/);
  assert.match(renderList([]), /No stations/);
});

test('dataNote states the never-rehost posture', () => {
  assert.match(dataNote(), /never rehost|point to/i);
});

// ── public-safety / police-scanner feeds ──────────────────────────────────────────────────────────────
const SCANNER_RAW = {
  stationuuid: 'scan-1', name: 'Dallas Police & Fire Scanner', url_resolved: 'https://scan.example/dpd.mp3',
  tags: 'scanner,police,emergency', country: 'The United States Of America', state: 'Texas', codec: 'MP3', bitrate: 64,
};

test('SCANNER_TAGS lists the public-safety tags', () => {
  assert.ok(SCANNER_TAGS.includes('scanner'));
  assert.ok(SCANNER_TAGS.includes('police'));
});

test('isScannerStation matches scanner tags/name, rejects a music station', () => {
  assert.equal(isScannerStation(toStation(SCANNER_RAW)), true);
  assert.equal(isScannerStation(toStation({ ...SCANNER_RAW, tags: '', name: 'Dallas PD Live Scanner' })), true);
  assert.equal(isScannerStation(toStation(RAW)), false); // KERA news/public/talk — not a scanner feed
});

test('scannerStations returns shaped POINT stations filtered to scanner feeds', async () => {
  // The tag query returns a scanner feed AND a non-scanner station; only the scanner one survives.
  __setFetch(mockFetch([SCANNER_RAW, { ...RAW, stationuuid: 'kera' }]));
  const out = await scannerStations({ state: 'Texas', limit: 10 });
  assert.equal(out.length, 1);
  assert.equal(out[0].posture, 'point');
  assert.equal(out[0].name, 'Dallas Police & Fire Scanner');
  __setFetch(null);
});

test('scannerStations dedupes across the per-tag queries and ranks Dallas first', async () => {
  const houston = { ...SCANNER_RAW, stationuuid: 'scan-2', name: 'Houston Fire Scanner', state: 'Texas' };
  __setFetch(mockFetch([houston, SCANNER_RAW])); // every tag query returns the same two → deduped to 2
  const out = await scannerStations({ state: 'Texas', limit: 10 });
  assert.equal(out.length, 2);
  assert.equal(out[0].name, 'Dallas Police & Fire Scanner'); // Dallas ranked ahead of Houston
  __setFetch(null);
});

test('scannerStations soft-fails to [] on a bad response', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await scannerStations({ state: 'Texas' }), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await scannerStations({}), []);
  __setFetch(null);
});
