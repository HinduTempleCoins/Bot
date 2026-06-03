import { test } from 'node:test';
import assert from 'node:assert';
import {
  rankItineraries,
  normalizeRome2Rio,
  normalizeOTP,
  normalizeTransitland,
  planTrip,
  __setFetch,
} from './routing.mjs';

// ── PURE rankItineraries ───────────────────────────────────────────────────
test('rankItineraries sorts by total duration first (shortest wins)', () => {
  const opts = [
    { id: 'slow', totalDuration: 600, legs: [{ mode: 'train' }] },
    { id: 'fast', totalDuration: 120, legs: [{ mode: 'fly' }] },
    { id: 'mid', totalDuration: 300, legs: [{ mode: 'car' }] },
  ];
  const ranked = rankItineraries(opts);
  assert.deepEqual(ranked.map((o) => o.id), ['fast', 'mid', 'slow']);
});

test('rankItineraries breaks duration ties by price, then transfers', () => {
  const opts = [
    { id: 'a', totalDuration: 200, price: { amount: 90, currency: 'USD' }, legs: [{}, {}, {}] },
    { id: 'b', totalDuration: 200, price: { amount: 50, currency: 'USD' }, legs: [{}, {}] },
    { id: 'c', totalDuration: 200, price: { amount: 50, currency: 'USD' }, legs: [{}] }, // cheaper-tie, fewer transfers
  ];
  const ranked = rankItineraries(opts);
  assert.deepEqual(ranked.map((o) => o.id), ['c', 'b', 'a']);
});

test('rankItineraries uses lowest leg price when no top-level price', () => {
  const opts = [
    { id: 'pricey', totalDuration: 100, legs: [{ price: { amount: 80 } }] },
    { id: 'cheap', totalDuration: 100, legs: [{ price: { amount: 20 } }, { price: { amount: 5 } }] },
  ];
  const ranked = rankItineraries(opts, { by: ['duration', 'price'] });
  assert.equal(ranked[0].id, 'cheap');
});

test('rankItineraries puts missing fields last and never mutates input', () => {
  const opts = [
    { id: 'noDur', legs: [{}] },
    { id: 'hasDur', totalDuration: 50, legs: [{}] },
  ];
  const copy = JSON.parse(JSON.stringify(opts));
  const ranked = rankItineraries(opts);
  assert.equal(ranked[0].id, 'hasDur');
  assert.equal(ranked[1].id, 'noDur');
  assert.deepEqual(opts, copy, 'input array untouched');
  assert.notStrictEqual(ranked, opts, 'returns a new array');
});

test('rankItineraries handles non-array input gracefully', () => {
  assert.deepEqual(rankItineraries(null), []);
  assert.deepEqual(rankItineraries(undefined), []);
});

test('rankItineraries respects a custom by-order (transfers first)', () => {
  const opts = [
    { id: 'many', totalDuration: 10, legs: [{}, {}, {}] },
    { id: 'one', totalDuration: 900, legs: [{}] },
  ];
  const ranked = rankItineraries(opts, { by: ['transfers'] });
  assert.equal(ranked[0].id, 'one');
});

// ── normalization ──────────────────────────────────────────────────────────
test('normalizeRome2Rio maps segments → legs with mode/operator/duration/price', () => {
  const json = {
    routes: [{
      totalDuration: 3, // hours
      indicativePrices: [{ price: 150, currency: 'EUR' }],
      segments: [
        { kind: 'fly', agency: { name: 'Air Example' }, hours: 2, indicativePrices: [{ price: 120, currency: 'EUR' }] },
        { kind: 'train', transit: { lineName: 'RegioExpress' }, hours: 1 },
      ],
    }],
  };
  const out = normalizeRome2Rio(json);
  assert.equal(out.legs.length, 2);
  assert.deepEqual(out.legs[0], { mode: 'fly', operator: 'Air Example', duration: 120, price: { amount: 120, currency: 'EUR' } });
  assert.equal(out.legs[1].mode, 'train');
  assert.equal(out.legs[1].duration, 60);
  assert.equal(out.totalDuration, 180, 'hours → minutes');
  assert.deepEqual(out.price, { amount: 150, currency: 'EUR' });
});

test('normalizeRome2Rio sums leg durations when route total is absent', () => {
  const out = normalizeRome2Rio({ routes: [{ segments: [{ kind: 'bus', hours: 1 }, { kind: 'walk', hours: 0.5 }] }] });
  assert.equal(out.totalDuration, 90);
});

test('normalizeRome2Rio returns null on empty/garbage', () => {
  assert.equal(normalizeRome2Rio({}), null);
  assert.equal(normalizeRome2Rio({ routes: [] }), null);
});

test('normalizeOTP converts seconds → minutes and normalizes modes', () => {
  const json = { plan: { itineraries: [{ duration: 3600, legs: [
    { mode: 'SUBWAY', agencyName: 'Metro Co', duration: 1200 },
    { mode: 'WALK', duration: 600 },
  ] }] } };
  const out = normalizeOTP(json);
  assert.equal(out.totalDuration, 60);
  assert.equal(out.legs[0].mode, 'train', 'subway → train');
  assert.equal(out.legs[0].operator, 'Metro Co');
  assert.equal(out.legs[0].duration, 20);
  assert.equal(out.legs[1].mode, 'walk');
});

test('normalizeTransitland reads duration_seconds and operator name', () => {
  const json = { itineraries: [{ duration: 1800, legs: [
    { mode: 'bus', operator: { name: 'City Transit' }, duration_seconds: 900 },
  ] }] };
  const out = normalizeTransitland(json);
  assert.equal(out.totalDuration, 30);
  assert.deepEqual(out.legs[0], { mode: 'bus', operator: 'City Transit', duration: 15 });
});

// ── planTrip (injected fetch, offline) ───────────────────────────────────────
test('planTrip returns null for missing endpoints', async () => {
  assert.equal(await planTrip({}), null);
  assert.equal(await planTrip({ from: 'A' }), null);
});

test('planTrip soft-fails to null when every provider errors', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const trip = await planTrip({ from: 'Nowhere1', to: 'Nowhere2' });
  __setFetch(null);
  assert.equal(trip, null);
});

test('planTrip via Rome2Rio is provenance-tagged when key present', async () => {
  process.env.ROME2RIO_KEY = 'test-key';
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ routes: [{ totalDuration: 2, segments: [{ kind: 'fly', agency: { name: 'TestAir' }, hours: 2 }] }] }),
  }));
  const trip = await planTrip({ from: 'CityProvA', to: 'CityProvB' });
  __setFetch(null);
  delete process.env.ROME2RIO_KEY;
  assert.ok(trip, 'got an itinerary');
  assert.equal(trip.source, 'rome2rio');
  assert.equal(trip.legs[0].mode, 'fly');
  assert.equal(trip.totalDuration, 120);
  assert.ok(['LIVE', 'cached'].includes(trip.provenance));
});
