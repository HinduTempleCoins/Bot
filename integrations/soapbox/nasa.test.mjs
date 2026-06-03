// nasa.test.mjs — OFFLINE tests for the SoapBox NASA portal. We inject a fake fetch via __setFetch
// and assert the normalization/shape of every exported feeder. No network is touched. Caches are
// invalidated between cases so each test sees its own injected response.

import { test } from 'node:test';
import assert from 'node:assert';
import { invalidate } from './cache.mjs';
import { __setFetch, apod, nearEarthObjects, marsPhotos, spaceWeather, naturalEvents } from './nasa.mjs';

// build a fake fetch from a url→response map. Each value is { ok, json } or a matcher function.
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, resp] of routes) {
      if (url.includes(needle)) {
        const r = typeof resp === 'function' ? resp(url) : resp;
        return { ok: r.ok !== false, json: async () => r.body };
      }
    }
    return { ok: false, json: async () => ({}) };
  };
}

test('apod normalizes to a flat card', async () => {
  invalidate();
  __setFetch(fakeFetch([
    ['/planetary/apod', { body: {
      title: 'The Crab Nebula', date: '2026-06-03', explanation: 'A supernova remnant.',
      media_type: 'image', url: 'https://apod.nasa.gov/img.jpg', hdurl: 'https://apod.nasa.gov/hd.jpg',
      copyright: '  Jane Doe  ',
    } }],
  ]));
  const pic = await apod();
  assert.equal(pic.title, 'The Crab Nebula');
  assert.equal(pic.date, '2026-06-03');
  assert.equal(pic.mediaType, 'image');
  assert.equal(pic.url, 'https://apod.nasa.gov/img.jpg');
  assert.equal(pic.hdUrl, 'https://apod.nasa.gov/hd.jpg');
  assert.equal(pic.copyright, 'Jane Doe', 'copyright trimmed');
});

test('apod soft-fails to null on non-OK response', async () => {
  invalidate();
  __setFetch(fakeFetch([['/planetary/apod', { ok: false, body: {} }]]));
  assert.equal(await apod(), null);
});

test('nearEarthObjects flattens, normalizes and sorts by miss distance', async () => {
  invalidate();
  __setFetch(fakeFetch([
    ['/neo/rest/v1/feed', { body: { near_earth_objects: {
      '2026-06-03': [
        {
          id: '1', name: '(2026 FAR)', is_potentially_hazardous_asteroid: false,
          nasa_jpl_url: 'https://jpl/1',
          estimated_diameter: { meters: { estimated_diameter_min: 10.4, estimated_diameter_max: 23.7 } },
          close_approach_data: [{
            close_approach_date: '2026-06-03', close_approach_date_full: '2026-Jun-03 12:00',
            miss_distance: { kilometers: '5000000.9' },
            relative_velocity: { kilometers_per_hour: '42000.5' },
          }],
        },
        {
          id: '2', name: '(2026 NEAR)', is_potentially_hazardous_asteroid: true,
          estimated_diameter: { meters: { estimated_diameter_min: 100, estimated_diameter_max: 200 } },
          close_approach_data: [{
            close_approach_date: '2026-06-03',
            miss_distance: { kilometers: '100000.0' },
            relative_velocity: { kilometers_per_hour: '99000.0' },
          }],
        },
      ],
    } } }],
  ]));
  const res = await nearEarthObjects({ days: 1 });
  assert.equal(res.count, 2);
  assert.equal(res.hazardousCount, 1);
  assert.equal(res.objects[0].id, '2', 'nearest miss sorted first');
  assert.equal(res.objects[0].missDistanceKm, 100000);
  assert.equal(res.objects[0].name, '2026 NEAR', 'parens stripped');
  assert.equal(res.objects[0].diameterMin, 100);
  assert.equal(res.objects[0].velocityKph, 99000);
  assert.equal(res.objects[1].missDistanceKm, 5000001, 'rounded');
});

test('nearEarthObjects soft-fails to an empty shape', async () => {
  invalidate();
  __setFetch(fakeFetch([['/neo/rest/v1/feed', { ok: false, body: {} }]]));
  const res = await nearEarthObjects({ days: 1 });
  assert.deepEqual(res, { count: 0, hazardousCount: 0, objects: [] });
});

test('marsPhotos normalizes latest_photos and drops entries without an image', async () => {
  invalidate();
  __setFetch(fakeFetch([
    ['/mars-photos/', { body: { latest_photos: [
      { id: 11, img_src: 'https://mars/a.jpg', earth_date: '2026-06-01', sol: 4000,
        camera: { full_name: 'Mast Camera', name: 'MAST' }, rover: { name: 'Curiosity' } },
      { id: 12, img_src: '', earth_date: '2026-06-01', sol: 4000 }, // dropped (no img)
    ] } }],
  ]));
  const photos = await marsPhotos({ rover: 'curiosity', limit: 12 });
  assert.equal(photos.length, 1);
  assert.equal(photos[0].img, 'https://mars/a.jpg');
  assert.equal(photos[0].camera, 'Mast Camera');
  assert.equal(photos[0].sol, 4000);
  assert.equal(photos[0].rover, 'Curiosity');
});

test('marsPhotos soft-fails to an empty array', async () => {
  invalidate();
  __setFetch(fakeFetch([['/mars-photos/', { ok: false, body: {} }]]));
  assert.deepEqual(await marsPhotos({ limit: 5 }), []);
});

test('spaceWeather normalizes flares + storms and computes max Kp', async () => {
  invalidate();
  __setFetch(fakeFetch([
    ['/DONKI/FLR', { body: [
      { classType: 'M1.5', beginTime: '2026-06-01T00:00Z', peakTime: '2026-06-01T00:30Z',
        sourceLocation: 'N10E20', link: 'https://donki/flr/1' },
    ] }],
    ['/DONKI/GST', { body: [
      { startTime: '2026-06-02T00:00Z', link: 'https://donki/gst/1',
        allKpIndex: [{ kpIndex: 4 }, { kpIndex: 6 }, { kpIndex: 5 }] },
    ] }],
  ]));
  const sw = await spaceWeather({ days: 7 });
  assert.equal(sw.flareCount, 1);
  assert.equal(sw.stormCount, 1);
  assert.equal(sw.flares[0].class, 'M1.5');
  assert.equal(sw.storms[0].maxKp, 6, 'max of the Kp series');
});

test('spaceWeather soft-fails both feeds to empty', async () => {
  invalidate();
  __setFetch(fakeFetch([
    ['/DONKI/FLR', { ok: false, body: {} }],
    ['/DONKI/GST', { ok: false, body: {} }],
  ]));
  const sw = await spaceWeather({ days: 7 });
  assert.deepEqual(sw, { flares: [], storms: [], flareCount: 0, stormCount: 0 });
});

test('naturalEvents normalizes EONET events and takes the latest geometry point', async () => {
  invalidate();
  __setFetch(fakeFetch([
    ['/events', { body: { events: [
      {
        id: 'EONET_1', title: 'Wildfire — California', closed: null,
        categories: [{ title: 'Wildfires' }],
        geometry: [
          { date: '2026-05-30T00:00Z', coordinates: [-120, 38] },
          { date: '2026-06-02T00:00Z', coordinates: [-121, 39] },
        ],
        sources: [{ url: 'https://inciweb/1' }],
      },
    ] } }],
  ]));
  const events = await naturalEvents({ limit: 20 });
  assert.equal(events.length, 1);
  assert.equal(events[0].category, 'Wildfires');
  assert.equal(events[0].date, '2026-06-02T00:00Z', 'latest geometry point');
  assert.deepEqual(events[0].coordinates, [-121, 39]);
  assert.equal(events[0].closed, false);
  assert.equal(events[0].link, 'https://inciweb/1');
});

test('naturalEvents soft-fails to an empty array', async () => {
  invalidate();
  __setFetch(fakeFetch([['/events', { ok: false, body: {} }]]));
  assert.deepEqual(await naturalEvents({ limit: 5 }), []);
});
