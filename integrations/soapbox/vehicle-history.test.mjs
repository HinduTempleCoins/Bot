// vehicle-history.test.mjs — OFFLINE tests for the NMVTIS-backed vehicle history reader.
// No network: we inject fetch via __setFetch and exercise the pure summarizeHistory flag logic and
// normalization directly. Run: node --test integrations/soapbox/vehicle-history.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeRecord, summarizeHistory, providerStatus, history, __setFetch } from './vehicle-history.mjs';

// --- normalization ----------------------------------------------------------------------------------

test('normalizeRecord maps varied provider field names into the stable shape', () => {
  const rec = normalizeRecord({
    vin: '1HGED123',
    titles: [{ state: 'OH', title_date: '2018-05-01', odometer: 30000, is_current: true }],
    title_brands: ['Rebuilt', { type: 'Flood', state: 'LA', date: '2017-09-01' }],
    odometer: [{ mileage: 30000, date: '2018-05-01', source: 'title' }],
    salvage: [{ disposition: 'Total Loss', date: '2017-09-15', state: 'LA' }],
    theft: [{ status: 'Stolen', date: '2016-01-01', recovered: false }],
  }, { vin: '1HGED123', source: 'vinaudit', fetched_at: '2026-06-03T00:00:00Z' });

  assert.equal(rec.vin, '1HGED123');
  assert.equal(rec.source, 'vinaudit');
  assert.equal(rec.fetched_at, '2026-06-03T00:00:00Z');
  assert.equal(rec.titleRecords.length, 1);
  assert.equal(rec.titleRecords[0].state, 'OH');
  assert.equal(rec.titleRecords[0].date, '2018-05-01');
  assert.equal(rec.titleRecords[0].mileage, 30000);
  assert.equal(rec.titleRecords[0].current, true);
  // brands: a bare string and an object both normalize to {type,...}
  assert.deepEqual(rec.brands.map((b) => b.type), ['Rebuilt', 'Flood']);
  assert.equal(rec.brands[1].state, 'LA');
  assert.equal(rec.odometer.length, 1);
  assert.equal(rec.odometer[0].reading, 30000);
  assert.equal(rec.salvage.length, 1);
  assert.equal(rec.salvage[0].type, 'Total Loss');
  assert.equal(rec.theft.length, 1);
  assert.equal(rec.theft[0].status, 'Stolen');
});

test('normalizeRecord always returns full shape with empty arrays on junk input', () => {
  for (const bad of [null, undefined, 42, 'x', {}]) {
    const r = normalizeRecord(bad, { vin: 'V' });
    assert.deepEqual(Object.keys(r).sort(), ['brands', 'fetched_at', 'odometer', 'salvage', 'source', 'theft', 'titleRecords', 'vin'].sort());
    for (const k of ['titleRecords', 'brands', 'odometer', 'salvage', 'theft']) assert.ok(Array.isArray(r[k]));
  }
});

// --- summarizeHistory flags -------------------------------------------------------------------------

test('summarizeHistory: clean record raises no flags', () => {
  const rec = normalizeRecord({
    titles: [{ state: 'TX', date: '2019-01-01', mileage: 10000 }, { state: 'TX', date: '2021-01-01', mileage: 35000 }],
    odometer: [{ reading: 10000, date: '2019-01-01' }, { reading: 35000, date: '2021-01-01' }],
  }, { vin: 'CLEAN1' });
  const s = summarizeHistory(rec);
  assert.equal(s.clean, true);
  assert.deepEqual(s.flags, { salvage: false, odometerRollback: false, theft: false });
  assert.equal(s.titleCount, 2);
  assert.equal(s.notes.length, 0);
});

test('summarizeHistory: salvage record OR salvage-implying brand flags salvage', () => {
  const viaRecord = summarizeHistory(normalizeRecord({ salvage: [{ type: 'Total Loss', date: '2020-01-01' }] }));
  assert.equal(viaRecord.flags.salvage, true);
  assert.equal(viaRecord.clean, false);

  const viaBrand = summarizeHistory(normalizeRecord({ brands: ['Flood Damage'] }));
  assert.equal(viaBrand.flags.salvage, true);

  const viaRebuilt = summarizeHistory(normalizeRecord({ brands: [{ type: 'Rebuilt/Reconstructed' }] }));
  assert.equal(viaRebuilt.flags.salvage, true);

  // a benign brand does NOT trip salvage
  const benign = summarizeHistory(normalizeRecord({ brands: ['Taxi Use'] }));
  assert.equal(benign.flags.salvage, false);
});

test('summarizeHistory: a later odometer reading lower than an earlier one flags rollback', () => {
  const rec = normalizeRecord({
    odometer: [
      { reading: 80000, date: '2020-01-01' },
      { reading: 25000, date: '2022-06-01' }, // went DOWN later → rollback
    ],
  }, { vin: 'ROLL1' });
  const s = summarizeHistory(rec);
  assert.equal(s.flags.odometerRollback, true);
  assert.equal(s.clean, false);
  assert.ok(s.notes.some((n) => /rollback/i.test(n)));
});

test('summarizeHistory: rollback detection also spans title mileages, sorted by date', () => {
  const rec = normalizeRecord({
    titles: [
      { state: 'A', date: '2018-01-01', mileage: 50000 },
      { state: 'B', date: '2021-01-01', mileage: 49000 }, // lower later → rollback
    ],
  });
  assert.equal(summarizeHistory(rec).flags.odometerRollback, true);
});

test('summarizeHistory: monotonic increasing odometer does NOT flag rollback', () => {
  const rec = normalizeRecord({
    odometer: [
      { reading: 10000, date: '2019-01-01' },
      { reading: 60000, date: '2021-01-01' },
      { reading: 60000, date: '2022-01-01' }, // equal is fine
    ],
  });
  assert.equal(summarizeHistory(rec).flags.odometerRollback, false);
});

test('summarizeHistory: any theft record flags theft', () => {
  const s = summarizeHistory(normalizeRecord({ theft: [{ status: 'Recovered', recovered: true }] }));
  assert.equal(s.flags.theft, true);
  assert.equal(s.clean, false);
});

test('summarizeHistory: tolerant of junk / partial records, never throws', () => {
  for (const bad of [null, undefined, 7, 'x', {}, { brands: 'notarray' }]) {
    const s = summarizeHistory(bad);
    assert.deepEqual(s.flags, { salvage: false, odometerRollback: false, theft: false });
    assert.equal(s.clean, true);
  }
});

// --- provider status + soft-fail reader -------------------------------------------------------------

test('providerStatus reports honest NMVTIS scope and the not-CarFax disclaimer', () => {
  const ps = providerStatus();
  assert.equal(ps.backed_by, 'NMVTIS');
  assert.match(ps.not_included, /CarFax/i);
  assert.equal(typeof ps.configured, 'boolean');
});

test('history soft-fails to a configure-provider stub with no key, never throwing', async () => {
  const saved = process.env.VINAUDIT_KEY;
  delete process.env.VINAUDIT_KEY;
  // fetch should never be called in the no-key path
  let called = false;
  __setFetch(async () => { called = true; throw new Error('should not fetch without key'); });
  try {
    const r = await history('1HGCM82633A004352');
    assert.equal(called, false, 'must not hit network without a key');
    assert.equal(r.configured, false);
    assert.equal(r.source, 'none');
    assert.match(r.message, /VINAUDIT_KEY/);
    for (const k of ['titleRecords', 'brands', 'odometer', 'salvage', 'theft']) assert.deepEqual(r[k], []);
    // the stub is consumable by summarizeHistory without error
    assert.equal(summarizeHistory(r).clean, true);
  } finally {
    __setFetch(null);
    if (saved !== undefined) process.env.VINAUDIT_KEY = saved;
  }
});

test('history with a key normalizes an injected provider response', async () => {
  const saved = process.env.VINAUDIT_KEY;
  process.env.VINAUDIT_KEY = 'test-key';
  __setFetch(async () => ({
    ok: true,
    json: async () => ({
      history: {
        vin: 'TESTVIN0001',
        titles: [{ state: 'NY', date: '2020-02-02', mileage: 12000 }],
        brands: [{ type: 'Salvage' }],
        theft: [{ status: 'Stolen', date: '2019-01-01' }],
      },
    }),
  }));
  try {
    const r = await history('TESTVIN0001');
    assert.equal(r.configured, true);
    assert.equal(r.source, 'vinaudit');
    assert.equal(r.titleRecords.length, 1);
    assert.equal(r.titleRecords[0].state, 'NY');
    const s = summarizeHistory(r);
    assert.equal(s.flags.salvage, true);
    assert.equal(s.flags.theft, true);
  } finally {
    __setFetch(null);
    if (saved === undefined) delete process.env.VINAUDIT_KEY; else process.env.VINAUDIT_KEY = saved;
  }
});
