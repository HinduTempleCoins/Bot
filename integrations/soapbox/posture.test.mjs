// posture.test.mjs — offline tests for the HOST-vs-WINDOW source-posture rule. Pure; no network, no keys.
// Run: node --test integrations/soapbox/posture.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  postureFor, isHost, isWindow, mayStore, resolveSource, describe, SOURCES, HOST, WINDOW,
} from './posture.mjs';

test('OSM / Overture / PD-gov are HOST (the database we keep)', () => {
  assert.equal(postureFor('openstreetmap'), HOST);
  assert.equal(postureFor('osm'), HOST);
  assert.equal(postureFor('overpass'), HOST);
  assert.equal(postureFor('nominatim'), HOST);
  assert.equal(postureFor('Overture Maps'), HOST);
  assert.equal(postureFor('pd-gov'), HOST);
  assert.equal(postureFor('census'), HOST);
  assert.ok(isHost('geonames'));
});

test('Google Places / Yelp / Numbeo are WINDOW (last-mile display only)', () => {
  assert.equal(postureFor('google-places'), WINDOW);
  assert.equal(postureFor('google'), WINDOW);
  assert.equal(postureFor('Google Maps'), WINDOW);
  assert.equal(postureFor('yelp'), WINDOW);
  assert.equal(postureFor('numbeo'), WINDOW);
  assert.ok(isWindow('foursquare'));
});

test('unknown sources default to WINDOW (safe: never store unproven data)', () => {
  assert.equal(postureFor('some-random-vendor'), WINDOW);
  assert.equal(postureFor(''), WINDOW);
  assert.equal(postureFor(null), WINDOW);
  assert.equal(postureFor(undefined), WINDOW);
  assert.equal(resolveSource('some-random-vendor'), null);
});

test('mayStore is true ONLY for HOST sources', () => {
  assert.equal(mayStore('osm'), true);
  assert.equal(mayStore('overture'), true);
  assert.equal(mayStore('google'), false);
  assert.equal(mayStore('numbeo'), false);
  assert.equal(mayStore('unknown'), false); // safe default
});

test('alias resolution is case/separator-insensitive', () => {
  assert.equal(resolveSource('OSM'), 'openstreetmap');
  assert.equal(resolveSource('google_maps'), 'google-places');
  assert.equal(resolveSource('overture maps'), 'overture');
  assert.equal(resolveSource('Google.Places'), 'google-places');
});

test('describe returns posture + license + rationale for a known source', () => {
  const d = describe('google');
  assert.equal(d.source, 'google-places');
  assert.equal(d.posture, WINDOW);
  assert.match(d.license, /Google/);
  assert.match(d.why, /display only/i);
  assert.equal(describe('nope'), null);
});

test('every registered source is exactly host or window with a license', () => {
  for (const [key, def] of Object.entries(SOURCES)) {
    assert.ok([HOST, WINDOW].includes(def.posture), `${key} posture`);
    assert.ok(typeof def.license === 'string' && def.license.length, `${key} license`);
    assert.ok(typeof def.why === 'string' && def.why.length, `${key} why`);
  }
});
