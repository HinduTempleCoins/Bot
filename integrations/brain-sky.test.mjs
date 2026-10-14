import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSky, phaseName } from './brain-sky.mjs';

const D = new Date('2026-01-03T05:00:00Z'); // fixed instant for determinism
const NYC = { lat: 40.71, lon: -74.0 };

test('phaseName buckets the lunar angle', () => {
  assert.equal(phaseName(0), 'New Moon');
  assert.equal(phaseName(180), 'Full Moon');
  assert.equal(phaseName(90), 'First Quarter');
  assert.equal(phaseName(270), 'Last Quarter');
});

test('moonPhase returns a named phase + illumination', () => {
  const sky = createSky();
  if (!sky.available()) return; // lib absent (shouldn't be)
  const mp = sky.moonPhase(D);
  assert.ok(mp && typeof mp.angle === 'number');
  assert.ok(mp.illumination >= 0 && mp.illumination <= 1);
  assert.ok(/Moon|Quarter|Crescent|Gibbous/.test(mp.name));
});

test('positions computes alt/az + constellation for the bodies', () => {
  const sky = createSky();
  if (!sky.available()) return;
  const pos = sky.positions({ date: D, ...NYC });
  assert.equal(pos.length, 9); // Sun, Moon, 7 planets
  const sun = pos.find((p) => p.body === 'Sun');
  assert.ok(typeof sun.altitude === 'number' && typeof sun.azimuth === 'number');
  assert.ok(sun.constellation, 'sun has a constellation');
  // every visible body is above the horizon
  for (const b of sky.whatsUp({ date: D, ...NYC })) assert.ok(b.altitude > 0);
});

test('riseSet returns a Date for the Sun; identify is a readable sentence', () => {
  const sky = createSky();
  if (!sky.available()) return;
  const rise = sky.riseSet({ body: 'Sun', date: D, ...NYC, dir: 1 });
  assert.ok(rise instanceof Date);
  const s = sky.identify({ date: D, ...NYC });
  assert.match(s, /Moon is a/);
});

test('soft-fails without coordinates', () => {
  const sky = createSky();
  assert.deepEqual(sky.positions({ date: D }), []); // no lat/lon
});

test('visibleStars + identifyStar + named lookup', () => {
  const sky = createSky();
  if (!sky.available()) return;
  const stars = sky.visibleStars({ date: D, ...NYC, limit: 5 });
  assert.ok(stars.length >= 1 && stars[0].name, 'has a brightest visible star');
  assert.ok(stars[0].mag <= stars[stars.length - 1].mag, 'sorted brightest first');
  // point at the brightest star's own direction -> it identifies itself
  const b = stars[0];
  const id = sky.identifyStar({ altitude: b.altitude, azimuth: b.azimuth, date: D, ...NYC });
  assert.equal(id.name, b.name);
  // named lookup with position
  const v = sky.star('Vega', { date: D, ...NYC });
  assert.equal(v.name, 'Vega'); assert.equal(v.constellation, 'Lyra');
  assert.equal(sky.star('NotAStar'), null);
});
