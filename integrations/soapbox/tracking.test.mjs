import { test } from 'node:test';
import assert from 'node:assert';
import { detectCarrier, track, CARRIERS, __setFetch } from './tracking.mjs';

// ── PURE detectCarrier ──────────────────────────────────────────────────────────────────────────
test('detectCarrier: UPS 1Z is unambiguous', () => {
  assert.equal(detectCarrier('1Z999AA10123456784'), 'ups');
  assert.equal(detectCarrier('1z999aa10123456784'), 'ups'); // case-insensitive
});

test('detectCarrier: UPS T-form (T + 10 digits)', () => {
  assert.equal(detectCarrier('T1234567890'), 'ups');
});

test('detectCarrier: USPS S10 international ...US', () => {
  assert.equal(detectCarrier('EC123456789US'), 'usps');
  assert.equal(detectCarrier('LZ987654321US'), 'usps');
});

test('detectCarrier: USPS long IMpb / 20+ digit numerics', () => {
  assert.equal(detectCarrier('9400111899223817428490'), 'usps'); // 22-digit 94-prefix
  assert.equal(detectCarrier('92055901755477000000000'), 'usps');
});

test('detectCarrier: USPS tolerates spaces and dashes', () => {
  assert.equal(detectCarrier('9400 1118 9922 3817 4284 90'), 'usps');
});

test('detectCarrier: FedEx 12-digit Express', () => {
  assert.equal(detectCarrier('123456789012'), 'fedex');
});

test('detectCarrier: FedEx 15-digit Ground', () => {
  assert.equal(detectCarrier('123456789012345'), 'fedex');
});

test('detectCarrier: DHL eCommerce JJD/JDD prefix', () => {
  assert.equal(detectCarrier('JJD0099999999'), 'dhl');   // JJD + 10 digits
  assert.equal(detectCarrier('JDD0099999999999'), 'dhl'); // JDD + 13 digits
});

test('detectCarrier: DHL Express 10–11 digit air waybill', () => {
  assert.equal(detectCarrier('1234567890'), 'dhl');  // 10
  assert.equal(detectCarrier('12345678901'), 'dhl'); // 11
});

test('detectCarrier: unknown for garbage / empty / non-string', () => {
  assert.equal(detectCarrier(''), 'unknown');
  assert.equal(detectCarrier('   '), 'unknown');
  assert.equal(detectCarrier('hello-world'), 'unknown');
  assert.equal(detectCarrier(null), 'unknown');
  assert.equal(detectCarrier(12345), 'unknown');
});

test('detectCarrier is PURE (same input → same output, no throw)', () => {
  const n = '1Z999AA10123456784';
  assert.equal(detectCarrier(n), detectCarrier(n));
});

test('CARRIERS registry exposes the four direct carriers + unknown', () => {
  for (const slug of ['usps', 'ups', 'fedex', 'dhl']) {
    assert.ok(CARRIERS[slug], `${slug} present`);
    assert.equal(CARRIERS[slug].direct, true);
    assert.ok(CARRIERS[slug].label);
  }
  assert.equal(CARRIERS.unknown.direct, false);
});

// ── provider normalization with injected fetch ──────────────────────────────────────────────────
// We inject fetch + set the env key so the AfterShip tier fires, and assert the normalized schema.

function withEnv(key, val, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const prev = process.env[key];
  process.env[key] = val;
  return Promise.resolve(fn()).finally(() => {
    if (had) process.env[key] = prev; else delete process.env[key];
  });
}

test('track normalizes an AfterShip response to the canonical schema', async () => {
  await withEnv('AFTERSHIP_KEY', 'test-key', async () => {
    __setFetch(async () => ({
      ok: true,
      json: async () => ({
        data: {
          tracking: {
            slug: 'ups',
            tag: 'InTransit',
            expected_delivery: '2026-06-10',
            checkpoints: [
              { checkpoint_time: '2026-06-03T10:00:00Z', message: 'Picked up', city: 'Atlanta', state: 'GA', country_name: 'United States', tag: 'InfoReceived' },
              { checkpoint_time: '2026-06-04T08:00:00Z', message: 'Departed facility', city: 'Memphis', tag: 'InTransit' },
            ],
          },
        },
      }),
    }));
    const res = await track('1Z999AA10123456784');
    __setFetch(null);

    assert.equal(res.provider, 'aftership', 'provenance tagged');
    assert.equal(res.carrier, 'ups');
    assert.equal(res.status, 'InTransit');
    assert.equal(res.eta, '2026-06-10');
    assert.equal(res.tracking, '1Z999AA10123456784');
    assert.equal(res.checkpoints.length, 2);
    const c = res.checkpoints[0];
    assert.deepEqual(Object.keys(c).sort(), ['location', 'message', 'status', 'time']);
    assert.equal(c.location, 'Atlanta, GA, United States');
    assert.equal(c.message, 'Picked up');
  });
});

test('track falls through tiers and lands on the carrier-direct stub when no keys are set', async () => {
  // No *_KEY env → every aggregator soft-fails (returns null) → carrier-direct stub answers.
  const keys = ['AFTERSHIP_KEY', 'SHIP24_KEY', 'SEVENTEENTRACK_KEY', 'T17_KEY'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  let called = false;
  __setFetch(async () => { called = true; return { ok: false, json: async () => ({}) }; });
  try {
    const res = await track('123456789012'); // FedEx 12-digit
    assert.equal(res.carrier, 'fedex');
    assert.equal(res.provider, 'fedex-direct', 'fell to the carrier-direct stub');
    assert.deepEqual(res.checkpoints, []);
    assert.ok(res.note && /stub/.test(res.note));
    assert.equal(called, false, 'no aggregator fetch was made without keys');
  } finally {
    __setFetch(null);
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test('track never throws on a thrown fetch (soft-fail) and returns normalized empty', async () => {
  await withEnv('AFTERSHIP_KEY', 'test-key', async () => {
    __setFetch(async () => { throw new Error('network down'); });
    const res = await track('1Z999AA10123456784');
    __setFetch(null);
    assert.equal(res.carrier, 'ups');
    // aggregator threw → null; falls to ups-direct stub
    assert.equal(res.provider, 'ups-direct');
    assert.deepEqual(res.checkpoints, []);
  });
});

test('track on empty input returns a normalized empty result, no throw', async () => {
  const res = await track('');
  assert.equal(res.carrier, 'unknown');
  assert.deepEqual(res.checkpoints, []);
  assert.equal(res.status, 'unknown');
});
