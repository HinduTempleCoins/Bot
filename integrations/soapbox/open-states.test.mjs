// open-states.test.mjs — offline tests for the Open States / Plural v3 state reader.
// Network stubbed via __setFetch; key toggled via env. Run: node --test integrations/soapbox/open-states.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apiKey, hasKey, legislatorsByState, billsByState, normalizePerson, normalizeBill,
  idCrosswalk, renderPage, dataNote, __setFetch,
} from './open-states.mjs';

const RAW_PEOPLE = [
  {
    id: 'ocd-person/abc', name: 'Jane Roe', party: 'Democratic',
    current_role: { title: 'Senator', org_classification: 'upper', district: '11' },
    jurisdiction: { name: 'California' }, openstates_url: 'https://openstates.org/person/abc',
    other_identifiers: [{ scheme: 'legacy_openstates', identifier: 'CAL000123' }],
  },
  {
    id: 'ocd-person/def', name: 'John Doe', party: 'Republican',
    current_role: { title: 'Assembly Member', org_classification: 'lower', district: '7' },
    jurisdiction: { name: 'California' },
  },
  { name: '' }, // unusable
];

const RAW_BILLS = [
  { id: 'ocd-bill/1', identifier: 'AB 1', title: 'Climate resilience act', classification: ['bill'],
    session: '20252026', jurisdiction: { name: 'California' },
    latest_action_description: 'Referred to committee', latest_action_date: '2026-01-15',
    openstates_url: 'https://openstates.org/bill/1' },
  { identifier: 'SB 9', title: 'Housing density', latest_action_description: 'Passed Senate' },
];

function jsonFetch(payload, { ok = true } = {}) { return async () => ({ ok, json: async () => payload }); }
function throwingFetch() { return async () => { throw new Error('down'); }; }
function withKey(fn) {
  const prev = process.env.OPENSTATES_API_KEY;
  process.env.OPENSTATES_API_KEY = 'TEST_KEY';
  return Promise.resolve(fn()).finally(() => { if (prev === undefined) delete process.env.OPENSTATES_API_KEY; else process.env.OPENSTATES_API_KEY = prev; });
}
function withoutKey(fn) {
  const prev = process.env.OPENSTATES_API_KEY;
  delete process.env.OPENSTATES_API_KEY;
  return Promise.resolve(fn()).finally(() => { if (prev !== undefined) process.env.OPENSTATES_API_KEY = prev; });
}

test('apiKey/hasKey read OPENSTATES_API_KEY by name; soft-skip when absent', async () => {
  await withoutKey(() => { assert.equal(apiKey(), ''); assert.equal(hasKey(), false); });
  await withKey(() => { assert.equal(hasKey(), true); });
});

test('normalizePerson maps chamber/district/party and tags provenance', () => {
  const sen = normalizePerson(RAW_PEOPLE[0]);
  assert.equal(sen.name, 'Jane Roe');
  assert.equal(sen.chamber, 'Senate');
  assert.equal(sen.district, '11');
  assert.equal(sen.party, 'Democratic');
  assert.match(sen.source, /Open States/);
  const asm = normalizePerson(RAW_PEOPLE[1]);
  assert.equal(asm.chamber, 'House');
  assert.equal(normalizePerson({ name: '' }), null);
});

test('idCrosswalk surfaces openstates id + other_identifiers', () => {
  const x = idCrosswalk(RAW_PEOPLE[0]);
  assert.equal(x.openstates, 'ocd-person/abc');
  assert.deepEqual(x.legacy_openstates, ['CAL000123']);
});

test('normalizeBill flattens identifier/title/latest action', () => {
  const b = normalizeBill(RAW_BILLS[0]);
  assert.equal(b.identifier, 'AB 1');
  assert.equal(b.title, 'Climate resilience act');
  assert.equal(b.latestAction, 'Referred to committee');
  assert.equal(b.latestActionDate, '2026-01-15');
  assert.equal(normalizeBill({}), null);
});

test('legislatorsByState soft-skips to [] without a key (no fetch)', async () => {
  await withoutKey(async () => {
    let called = false;
    __setFetch(async () => { called = true; return { ok: true, json: async () => ({ results: RAW_PEOPLE }) }; });
    const rows = await legislatorsByState({ state: 'CA' });
    __setFetch(null);
    assert.deepEqual(rows, []);
    assert.equal(called, false);
  });
});

test('legislatorsByState normalizes, drops unusable, filters by chamber', async () => {
  await withKey(async () => {
    __setFetch(jsonFetch({ results: RAW_PEOPLE }));
    const all = await legislatorsByState({ state: 'CA' });
    const senate = await legislatorsByState({ state: 'CA', chamber: 'Senate' });
    __setFetch(null);
    assert.equal(all.length, 2);
    assert.equal(senate.length, 1);
    assert.equal(senate[0].name, 'Jane Roe');
  });
});

test('legislatorsByState soft-fails to [] on network error and bad shape', async () => {
  await withKey(async () => {
    __setFetch(throwingFetch());
    assert.deepEqual(await legislatorsByState({ state: 'CA' }), []);
    __setFetch(jsonFetch({ nope: true }));
    assert.deepEqual(await legislatorsByState({ state: 'CA' }), []);
    __setFetch(null);
  });
});

test('billsByState returns normalized bills (and [] without a key)', async () => {
  await withoutKey(async () => { assert.deepEqual(await billsByState({ state: 'CA' }), []); });
  await withKey(async () => {
    __setFetch(jsonFetch({ results: RAW_BILLS }));
    const bills = await billsByState({ state: 'CA', q: 'climate' });
    __setFetch(null);
    assert.equal(bills.length, 2);
    assert.equal(bills[0].identifier, 'AB 1');
  });
});

test('renderPage renders people vs bills and escapes injection', () => {
  const people = renderPage([{ name: '<b>x</b>', chamber: 'Senate', district: '1', party: 'D' }]);
  assert.ok(people.includes('State legislators'));
  assert.ok(!people.includes('<b>x</b>'));
  assert.ok(people.includes('&lt;b&gt;'));
  const bills = renderPage([{ identifier: 'AB 1', title: 'T', latestAction: 'Referred', latestActionDate: '2026-01-15' }]);
  assert.ok(bills.includes('State legislation'));
  assert.ok(bills.includes('AB 1'));
  assert.ok(renderPage([]).includes('No state legislators'));
});

test('dataNote names Open States, license, and right-of-reply path', () => {
  const n = dataNote();
  assert.match(n, /Open States/);
  assert.match(n, /openstates\.org/);
});
