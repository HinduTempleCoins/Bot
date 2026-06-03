import { test } from 'node:test';
import assert from 'node:assert';
import { kickback, normalize, searchHotels, __setFetch, PROVIDERS } from './hotels.mjs';

// --- PURE kickback math (the Atlas hotel model: commission funds a loyalty-token kickback) ---

test('kickback: basic share of commission', () => {
  // a $100 commission, routing 30% back as loyalty tokens, kicks back 30
  assert.equal(kickback(100, 0.3), 30);
});

test('kickback: fat hotel tier earns more than a thin tier on the same booking value', () => {
  const bookingValue = 1000;
  const hotelCommission = bookingValue * 0.07;  // fat 7% hotel tier
  const flightCommission = bookingValue * 0.02; // thin ~2% flight tier
  const share = 0.5;
  assert.ok(kickback(hotelCommission, share) > kickback(flightCommission, share),
    'hotels (fat tier) fund the bigger kickback');
  assert.equal(kickback(hotelCommission, share), 35);
});

test('kickback: clamps rate above 1 and below 0', () => {
  assert.equal(kickback(50, 2), 50, 'rate >1 clamps to full commission');
  assert.equal(kickback(50, -1), 0, 'negative rate clamps to 0');
});

test('kickback: non-finite / non-positive inputs return 0 (never NaN/negative)', () => {
  assert.equal(kickback(NaN, 0.5), 0);
  assert.equal(kickback(100, NaN), 0);
  assert.equal(kickback(0, 0.5), 0);
  assert.equal(kickback(-100, 0.5), 0);
  assert.equal(kickback(undefined, 0.5), 0);
});

test('kickback: zero rate yields zero (loyalty, not income — opt-out is clean)', () => {
  assert.equal(kickback(100, 0), 0);
});

// --- normalization (PURE given a provider + json) ---

test('normalize: Booking.com Demand shape → common rows', () => {
  const booking = PROVIDERS.find((p) => p.name === 'Booking.com Demand');
  const json = {
    data: [
      { name: 'Grand Hotel', price: { amount: '199.50' }, review_score: 8.6, url: 'https://book/grand?aid=X' },
      { hotel_name: 'No Price Inn', booking_url: 'https://book/inn?aid=X' },
    ],
  };
  const out = normalize(booking, json);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { name: 'Grand Hotel', price: 199.5, rating: 8.6, affiliateUrl: 'https://book/grand?aid=X' });
  assert.equal(out[1].name, 'No Price Inn');
  assert.equal(out[1].price, null, 'missing price normalizes to null, not a crash');
});

test('normalize: drops rows with no name', () => {
  const booking = PROVIDERS.find((p) => p.name === 'Booking.com Demand');
  const out = normalize(booking, { data: [{ price: { amount: 100 } }, { name: 'Real Hotel', price: { amount: 100 } }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Real Hotel');
});

test('normalize: empty / malformed json yields []', () => {
  const booking = PROVIDERS.find((p) => p.name === 'Booking.com Demand');
  assert.deepEqual(normalize(booking, {}), []);
  assert.deepEqual(normalize(booking, null), []);
});

// --- searchHotels with injected fetch (OFFLINE) ---

test('searchHotels: missing required args returns []', async () => {
  assert.deepEqual(await searchHotels({}), []);
  assert.deepEqual(await searchHotels({ city: 'Paris' }), []);
});

test('searchHotels: no provider keys set ⇒ [] (soft-fail, no throw)', async () => {
  const saved = snapshotKeys();
  clearKeys();
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  try {
    const out = await searchHotels({ city: 'Rome', checkin: '2026-07-01', checkout: '2026-07-03' });
    assert.deepEqual(out, []);
    assert.equal(called, false, 'no fetch when no keys configured');
  } finally { __setFetch(null); restoreKeys(saved); }
});

test('searchHotels: one configured provider, merged + sorted cheapest-first', async () => {
  const saved = snapshotKeys();
  clearKeys();
  process.env.BOOKING_DEMAND_KEY = 'test-key';
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ data: [
      { name: 'Pricey Palace', price: { amount: 500 }, review_score: 9.1, url: 'u1' },
      { name: 'Budget Bunk', price: { amount: 80 }, review_score: 7.0, url: 'u2' },
    ] }),
  }));
  try {
    const out = await searchHotels({ city: 'Rome', checkin: '2026-07-01', checkout: '2026-07-03' });
    assert.equal(out.length, 2);
    assert.equal(out[0].name, 'Budget Bunk', 'cheapest first');
    assert.equal(out[1].name, 'Pricey Palace');
    assert.equal(out[0].provider, 'Booking.com Demand');
  } finally { __setFetch(null); restoreKeys(saved); }
});

test('searchHotels: a provider that throws/!ok is dropped, others survive', async () => {
  const saved = snapshotKeys();
  clearKeys();
  process.env.BOOKING_DEMAND_KEY = 'k1';
  process.env.EXPEDIA_RAPID_KEY = 'k2';
  __setFetch(async (url) => {
    if (String(url).includes('ean.com')) throw new Error('expedia down');
    return { ok: true, json: async () => ({ data: [{ name: 'Survivor Suites', price: { amount: 120 }, review_score: 8, url: 'u' }] }) };
  });
  try {
    const out = await searchHotels({ city: 'Rome', checkin: '2026-07-01', checkout: '2026-07-03' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Survivor Suites', 'booking survived expedia throwing');
  } finally { __setFetch(null); restoreKeys(saved); }
});

test('searchHotels: rows with null price sort last', async () => {
  const saved = snapshotKeys();
  clearKeys();
  process.env.BOOKING_DEMAND_KEY = 'k1';
  __setFetch(async () => ({
    ok: true,
    json: async () => ({ data: [
      { name: 'No Price Inn', url: 'u1' },
      { name: 'Has Price Hotel', price: { amount: 90 }, url: 'u2' },
    ] }),
  }));
  try {
    const out = await searchHotels({ city: 'Rome', checkin: '2026-07-01', checkout: '2026-07-03' });
    assert.equal(out[0].name, 'Has Price Hotel');
    assert.equal(out[1].name, 'No Price Inn', 'null-price rows sink to the bottom');
  } finally { __setFetch(null); restoreKeys(saved); }
});

// --- helpers: snapshot/restore provider env keys so tests don't leak into each other ---
function snapshotKeys() {
  const s = {};
  for (const p of PROVIDERS) s[p.envKey] = process.env[p.envKey];
  return s;
}
function clearKeys() {
  for (const p of PROVIDERS) delete process.env[p.envKey];
}
function restoreKeys(s) {
  for (const p of PROVIDERS) {
    if (s[p.envKey] === undefined) delete process.env[p.envKey];
    else process.env[p.envKey] = s[p.envKey];
  }
}
