// elections-info.test.mjs — offline tests for the Google Civic elections/voterinfo reader.
// Network is stubbed via __setFetch; the key is toggled via env; the clock is injected via nowMs.
// Run: node --test integrations/soapbox/elections-info.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiKey, hasKey, elections, voterInfo, dropExpiredElections, isExpired,
  normalizeElection, renderPage, dataNote, deferNote, __setFetch,
} from './elections-info.mjs';

const NOW = Date.UTC(2026, 5, 3); // 2026-06-03
const FUTURE = { id: '8000', name: 'November 2026 General Election', electionDay: '2026-11-03', ocdDivisionId: 'ocd-division/country:us' };
const PAST = { id: '7000', name: 'November 2024 General Election', electionDay: '2024-11-05' };

function jsonFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function throwingFetch() { return async () => { throw new Error('network down'); }; }

function withKey(fn) {
  const prev = process.env.GOOGLE_CIVIC_API_KEY;
  process.env.GOOGLE_CIVIC_API_KEY = 'TEST_KEY';
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.GOOGLE_CIVIC_API_KEY; else process.env.GOOGLE_CIVIC_API_KEY = prev;
  });
}
function withoutKey(fn) {
  const prev = process.env.GOOGLE_CIVIC_API_KEY;
  delete process.env.GOOGLE_CIVIC_API_KEY;
  return Promise.resolve(fn()).finally(() => {
    if (prev !== undefined) process.env.GOOGLE_CIVIC_API_KEY = prev;
  });
}

test('apiKey/hasKey read GOOGLE_CIVIC_API_KEY by name and soft-skip when absent', async () => {
  await withoutKey(() => { assert.equal(apiKey(), ''); assert.equal(hasKey(), false); });
  await withKey(() => { assert.equal(apiKey(), 'TEST_KEY'); assert.equal(hasKey(), true); });
});

test('isExpired / dropExpiredElections honor VIP auto-expiry past election day', () => {
  assert.equal(isExpired(PAST, NOW), true);
  assert.equal(isExpired(FUTURE, NOW), false);
  // an election on election day itself is still valid through end of day
  assert.equal(isExpired({ electionDay: '2026-06-03' }, NOW), false);
  // unparseable date → not provably expired
  assert.equal(isExpired({ electionDay: '' }, NOW), false);
  const kept = dropExpiredElections([FUTURE, PAST], NOW);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].id, '8000');
});

test('normalizeElection flattens and drops unusable input', () => {
  const e = normalizeElection(FUTURE);
  assert.equal(e.name, 'November 2026 General Election');
  assert.equal(e.electionDay, '2026-11-03');
  assert.ok(e.fetchedAt);
  assert.equal(normalizeElection(null), null);
  assert.equal(normalizeElection({}), null);
});

test('elections() soft-skips to [] without a key (never calls fetch)', async () => {
  await withoutKey(async () => {
    let called = false;
    __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
    const rows = await elections({ nowMs: NOW });
    __setFetch(null);
    assert.deepEqual(rows, []);
    assert.equal(called, false);
  });
});

test('elections() returns only non-expired elections (auto-expiry enforced)', async () => {
  await withKey(async () => {
    __setFetch(jsonFetch({ elections: [FUTURE, PAST] }));
    const rows = await elections({ nowMs: NOW });
    __setFetch(null);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, '8000');
    assert.ok(rows[0].source.includes('Google Civic'));
  });
});

test('elections() soft-fails to [] on network error', async () => {
  await withKey(async () => {
    __setFetch(throwingFetch());
    assert.deepEqual(await elections({ nowMs: NOW }), []);
    __setFetch(null);
  });
});

test('voterInfo() returns null without a key, and for a blank address', async () => {
  await withoutKey(async () => { assert.equal(await voterInfo({ address: '123 Main St' }), null); });
  await withKey(async () => {
    __setFetch(jsonFetch({}));
    assert.equal(await voterInfo({ address: '', nowMs: NOW }), null);
    __setFetch(null);
  });
});

test('voterInfo() surfaces official admin links + deferNote, timestamped', async () => {
  await withKey(async () => {
    __setFetch(jsonFetch({
      election: FUTURE,
      pollingLocations: [{ name: 'City Hall', address: { line1: '1 Main St', city: 'Town', state: 'CA', zip: '90000' }, pollingHours: '7am-8pm', sources: [{ name: 'County Registrar', official: true }] }],
      state: [{ electionAdministrationBody: { name: 'CA Secretary of State', electionRegistrationUrl: 'https://registertovote.ca.gov', electionInfoUrl: 'https://sos.ca.gov' } }],
    }));
    const v = await voterInfo({ address: '1 Main St, Town CA', nowMs: NOW });
    __setFetch(null);
    assert.equal(v.election.name, 'November 2026 General Election');
    assert.equal(v.administration.name, 'CA Secretary of State');
    assert.equal(v.administration.registrationUrl, 'https://registertovote.ca.gov');
    assert.equal(v.administration.official, true);
    assert.equal(v.pollingLocations.length, 1);
    assert.equal(v.pollingLocations[0].sources[0].name, 'County Registrar');
    assert.equal(v.deferNote, deferNote());
    assert.ok(v.fetchedAt);
  });
});

test('voterInfo() AUTO-EXPIRY: returns null when the resolved election has passed', async () => {
  await withKey(async () => {
    __setFetch(jsonFetch({ election: PAST, pollingLocations: [{ name: 'Old Hall' }] }));
    const v = await voterInfo({ address: '1 Main St', nowMs: NOW });
    __setFetch(null);
    assert.equal(v, null);
  });
});

test('renderPage always prints the defer-to-officials note and escapes injection', () => {
  const list = renderPage([FUTURE]);
  assert.ok(list.includes('Upcoming elections'));
  assert.ok(list.includes(deferNote()));

  const vi = renderPage({
    election: { name: '<script>x</script>', electionDay: '2026-11-03' },
    administration: { name: 'SoS', registrationUrl: 'https://x', official: true },
    pollingLocations: [], earlyVoteSites: [], dropOffLocations: [],
    deferNote: deferNote(),
  });
  assert.ok(!vi.includes('<script>x'));
  assert.ok(vi.includes('&lt;script&gt;'));
  assert.ok(vi.includes(deferNote())); // HARD RULE: always present
});

test('dataNote names Google Civic / VIP and the official-source + expiry caveats', () => {
  const n = dataNote();
  assert.match(n, /Google Civic/);
  assert.match(n, /election officials/);
  assert.match(n, /through election day/);
});
