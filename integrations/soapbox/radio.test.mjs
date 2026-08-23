import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStation, searchStations, dallasStations, stationsByTag, renderList, dataNote, esc, __setFetch } from './radio.mjs';

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
