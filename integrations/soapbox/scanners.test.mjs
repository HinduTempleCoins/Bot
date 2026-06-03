import { test } from 'node:test';
import assert from 'node:assert';
import {
  SCANNER_CATEGORIES, SDR_DIRECTORIES, NOAA_WEATHER,
  listenableCategories, sdrReceivers, atcFeeds, scannersSummary,
} from './scanners.mjs';

// All offline — assert directory shape + the pure encrypted-filter. No network.

test('SCANNER_CATEGORIES are well-formed and include the lawful core services', () => {
  assert.ok(SCANNER_CATEGORIES.length >= 6);
  const ids = SCANNER_CATEGORIES.map((c) => c.id);
  for (const must of ['fire', 'ems', 'aviation', 'rail', 'weather', 'ham']) {
    assert.ok(ids.includes(must), `missing core category: ${must}`);
  }
  for (const c of SCANNER_CATEGORIES) {
    assert.ok(c.id && c.label && c.desc);
    assert.equal(typeof c.encrypted, 'boolean');
    assert.match(c.browse, /^https?:\/\//);
  }
});

test('police is present but flagged encrypted (frequently-unavailable, not a defeat path)', () => {
  const police = SCANNER_CATEGORIES.find((c) => c.id === 'police');
  assert.ok(police, 'police category retained for labelling');
  assert.equal(police.encrypted, true);
});

test('listenableCategories drops the encrypted services', () => {
  const out = listenableCategories();
  assert.ok(out.length >= 6);
  assert.ok(out.every((c) => c.encrypted === false));
  assert.ok(!out.some((c) => c.id === 'police'), 'encrypted police is filtered out');
});

test('listenableCategories is a pure filter over the passed list', () => {
  const fake = [
    { id: 'a', encrypted: false }, { id: 'b', encrypted: true }, { id: 'c', encrypted: false },
  ];
  const out = listenableCategories(fake);
  assert.deepEqual(out.map((c) => c.id), ['a', 'c']);
});

test('sdrReceivers returns the WebSDR/KiwiSDR directory + receivers, all link-outs', async () => {
  const { directories, receivers } = await sdrReceivers();
  assert.ok(directories.length >= 2);
  assert.deepEqual(SDR_DIRECTORIES, directories);
  assert.ok(receivers.length >= 4);
  for (const r of receivers) {
    assert.ok(r.name && r.type && r.location);
    assert.match(r.url, /^https?:\/\//);
    assert.ok(['WebSDR', 'KiwiSDR'].includes(r.type));
  }
});

test('sdrReceivers type filter narrows to one receiver kind', async () => {
  const { receivers } = await sdrReceivers({ type: 'KiwiSDR' });
  assert.ok(receivers.length >= 1);
  assert.ok(receivers.every((r) => r.type === 'KiwiSDR'));
});

test('atcFeeds are LiveATC.net link-outs; icao filter works', async () => {
  const all = await atcFeeds();
  assert.ok(all.length >= 4);
  for (const f of all) {
    assert.ok(f.name && f.icao && f.city);
    assert.match(f.url, /^https:\/\/www\.liveatc\.net\//);
  }
  const jfk = await atcFeeds({ icao: 'KJFK' });
  assert.equal(jfk.length, 1);
  assert.equal(jfk[0].icao, 'KJFK');
});

test('NOAA_WEATHER lists the seven all-hazards channels in the 162 MHz band', () => {
  assert.equal(NOAA_WEATHER.channels.length, 7);
  for (const ch of NOAA_WEATHER.channels) {
    assert.match(ch.ch, /^WX\d$/);
    assert.ok(ch.mhz >= 162.4 && ch.mhz <= 162.55);
  }
});

test('scannersSummary aggregates everything and never throws (offline, no key)', async () => {
  delete process.env.BROADCASTIFY_KEY;
  const s = await scannersSummary();
  assert.match(s.legal, /unencrypted/i);
  assert.match(s.legal, /ECPA/);
  assert.deepEqual(s.categories, SCANNER_CATEGORIES);
  assert.ok(s.listenable.every((c) => !c.encrypted));
  assert.ok(s.sdr.receivers.length >= 4);
  assert.ok(s.atc.length >= 4);
  assert.equal(s.weather.channels.length, 7);
  assert.equal(s.broadcastify.source, 'static');
  assert.equal(s.broadcastify.enriched, false);
  assert.equal(s.counts.categories, SCANNER_CATEGORIES.length);
  assert.equal(s.counts.sdr, s.sdr.receivers.length);
  assert.equal(s.counts.atc, s.atc.length);
});
