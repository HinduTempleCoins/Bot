// gov-readers.test.mjs — OFFLINE unit tests for the keyless gov readers. No network: every reader's
// fetch is replaced via __setFetch with a canned response. We assert (1) normalized shape + provenance
// tagging on a good response, and (2) soft-fail to [] on error / non-ok / missing-required-key.
//
//   node --test integrations/soapbox/gov-readers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  __setFetch,
  usaspendingAwards, congressBills, openFecDonors,
  usgsWater, femaDisasters, openStatesBills, socrata,
} from './gov-readers.mjs';

// fetch stub that returns a fixed JSON payload (ok=true).
const okJson = (payload) => async () => ({ ok: true, status: 200, json: async () => payload });
// fetch stub that returns a non-ok HTTP response.
const notOk = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
// fetch stub that throws (network error).
const boom = async () => { throw new Error('network down'); };

function withFetch(fn, run) {
  __setFetch(fn);
  try { return run(); } finally { __setFetch(null); }
}

// ── USAspending ─────────────────────────────────────────────────────────────────────────────────────
test('usaspendingAwards normalizes awards + tags provenance', async () => {
  const out = await withFetch(okJson({
    results: [{ 'Award ID': 'ABC123', 'Recipient Name': 'Lockheed Martin', 'Awarding Agency': 'DoD', 'Award Amount': 5000000, 'Start Date': '2025-01-01', 'Award Type': 'A', Description: 'jets' }],
  }), () => usaspendingAwards({ recipient: 'Lockheed' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'ABC123');
  assert.equal(out[0].recipient, 'Lockheed Martin');
  assert.equal(out[0].amount, 5000000);
  assert.equal(out[0].source, 'USAspending');
  assert.match(out[0].fetched_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('usaspendingAwards soft-fails to [] with no recipient/agency (no fetch)', async () => {
  const out = await withFetch(boom, () => usaspendingAwards({}));
  assert.deepEqual(out, []);
});

test('usaspendingAwards soft-fails to [] on error/non-ok', async () => {
  assert.deepEqual(await withFetch(boom, () => usaspendingAwards({ recipient: 'X' })), []);
  assert.deepEqual(await withFetch(notOk, () => usaspendingAwards({ recipient: 'X' })), []);
});

// ── Congress.gov (needs key) ─────────────────────────────────────────────────────────────────────────
test('congressBills soft-fails to [] when no api.data.gov key', async () => {
  const saved = process.env.CONGRESS_GOV_KEY; const saved2 = process.env.API_DATA_GOV_KEY;
  delete process.env.CONGRESS_GOV_KEY; delete process.env.API_DATA_GOV_KEY;
  try {
    const out = await withFetch(boom, () => congressBills({ q: 'budget' }));
    assert.deepEqual(out, []);
  } finally {
    if (saved !== undefined) process.env.CONGRESS_GOV_KEY = saved;
    if (saved2 !== undefined) process.env.API_DATA_GOV_KEY = saved2;
  }
});

test('congressBills normalizes bills + tags provenance when key present', async () => {
  const saved = process.env.CONGRESS_GOV_KEY;
  process.env.CONGRESS_GOV_KEY = 'TESTKEY';
  try {
    const out = await withFetch(okJson({
      bills: [{ number: '1', type: 'HR', congress: 119, title: 'A Bill', latestAction: { text: 'Referred', actionDate: '2025-02-02' }, url: 'https://x' }],
    }), () => congressBills({ q: 'bill' }));
    assert.equal(out.length, 1);
    assert.equal(out[0].number, '1');
    assert.equal(out[0].title, 'A Bill');
    assert.equal(out[0].latest_action, 'Referred');
    assert.equal(out[0].source, 'Congress.gov');
  } finally {
    if (saved === undefined) delete process.env.CONGRESS_GOV_KEY; else process.env.CONGRESS_GOV_KEY = saved;
  }
});

// ── OpenFEC (needs key) ──────────────────────────────────────────────────────────────────────────────
test('openFecDonors soft-fails to [] when no key', async () => {
  const saved = process.env.OPENFEC_KEY; const saved2 = process.env.API_DATA_GOV_KEY;
  delete process.env.OPENFEC_KEY; delete process.env.API_DATA_GOV_KEY;
  try {
    assert.deepEqual(await withFetch(boom, () => openFecDonors({ q: 'Smith' })), []);
  } finally {
    if (saved !== undefined) process.env.OPENFEC_KEY = saved;
    if (saved2 !== undefined) process.env.API_DATA_GOV_KEY = saved2;
  }
});

test('openFecDonors normalizes contributions + tags provenance when key present', async () => {
  const saved = process.env.OPENFEC_KEY;
  process.env.OPENFEC_KEY = 'TESTKEY';
  try {
    const out = await withFetch(okJson({
      results: [{ contributor_name: 'JANE SMITH', contributor_employer: 'Acme', contribution_receipt_amount: 2800, contribution_receipt_date: '2024-09-01', committee: { name: 'PAC X' } }],
    }), () => openFecDonors({ q: 'Smith' }));
    assert.equal(out.length, 1);
    assert.equal(out[0].contributor, 'JANE SMITH');
    assert.equal(out[0].amount, 2800);
    assert.equal(out[0].recipient, 'PAC X');
    assert.equal(out[0].source, 'OpenFEC');
  } finally {
    if (saved === undefined) delete process.env.OPENFEC_KEY; else process.env.OPENFEC_KEY = saved;
  }
});

// ── USGS Water (keyless) ─────────────────────────────────────────────────────────────────────────────
test('usgsWater normalizes time series + tags provenance', async () => {
  const out = await withFetch(okJson({
    value: { timeSeries: [{
      sourceInfo: { siteName: 'Potomac', siteCode: [{ value: '01646500' }] },
      variable: { variableName: 'Streamflow', unit: { unitCode: 'ft3/s' } },
      values: [{ value: [{ value: '1234', dateTime: '2025-06-03T12:00:00Z' }] }],
    }] },
  }), () => usgsWater({ site: '01646500' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].site_name, 'Potomac');
  assert.equal(out[0].parameter, 'Streamflow');
  assert.equal(out[0].value, 1234);
  assert.equal(out[0].source, 'USGS Water');
});

test('usgsWater soft-fails to [] on no site and on error', async () => {
  assert.deepEqual(await withFetch(boom, () => usgsWater({})), []);
  assert.deepEqual(await withFetch(boom, () => usgsWater({ site: '01646500' })), []);
});

// ── OpenFEMA (keyless) ───────────────────────────────────────────────────────────────────────────────
test('femaDisasters normalizes declarations + tags provenance', async () => {
  const out = await withFetch(okJson({
    DisasterDeclarationsSummaries: [{ disasterNumber: 4567, state: 'CA', declarationTitle: 'WILDFIRE', incidentType: 'Fire', declarationType: 'DR', declarationDate: '2025-01-10', designatedArea: 'Los Angeles' }],
  }), () => femaDisasters({ state: 'ca' }));
  assert.equal(out.length, 1);
  assert.equal(out[0].disaster_number, 4567);
  assert.equal(out[0].title, 'WILDFIRE');
  assert.equal(out[0].county, 'Los Angeles');
  assert.equal(out[0].source, 'OpenFEMA');
});

test('femaDisasters soft-fails to [] on no state and on non-ok', async () => {
  assert.deepEqual(await withFetch(notOk, () => femaDisasters({})), []);
  assert.deepEqual(await withFetch(notOk, () => femaDisasters({ state: 'CA' })), []);
});

// ── OpenStates (needs key) ───────────────────────────────────────────────────────────────────────────
test('openStatesBills soft-fails to [] when no key', async () => {
  const saved = process.env.OPENSTATES_KEY;
  delete process.env.OPENSTATES_KEY;
  try {
    assert.deepEqual(await withFetch(boom, () => openStatesBills({ state: 'ca', q: 'tax' })), []);
  } finally {
    if (saved !== undefined) process.env.OPENSTATES_KEY = saved;
  }
});

test('openStatesBills normalizes bills + tags provenance when key present', async () => {
  const saved = process.env.OPENSTATES_KEY;
  process.env.OPENSTATES_KEY = 'TESTKEY';
  try {
    const out = await withFetch(okJson({
      results: [{ identifier: 'AB 1', title: 'A State Bill', jurisdiction: { name: 'California' }, session: '2025', classification: ['bill'], latest_action_description: 'Introduced', latest_action_date: '2025-01-05', openstates_url: 'https://os' }],
    }), () => openStatesBills({ state: 'ca', q: 'bill' }));
    assert.equal(out.length, 1);
    assert.equal(out[0].identifier, 'AB 1');
    assert.equal(out[0].jurisdiction, 'California');
    assert.deepEqual(out[0].classification, ['bill']);
    assert.equal(out[0].source, 'OpenStates');
  } finally {
    if (saved === undefined) delete process.env.OPENSTATES_KEY; else process.env.OPENSTATES_KEY = saved;
  }
});

// ── Socrata (app token optional, keyless works) ──────────────────────────────────────────────────────
test('socrata passes rows through + tags provenance (keyless)', async () => {
  const saved = process.env.SOCRATA_APP_TOKEN;
  delete process.env.SOCRATA_APP_TOKEN;
  try {
    const out = await withFetch(okJson([{ name: 'Park A', borough: 'Manhattan' }, { name: 'Park B', borough: 'Queens' }]),
      () => socrata({ portal: 'data.cityofnewyork.us', datasetId: 'abcd-1234', q: 'park' }));
    assert.equal(out.length, 2);
    assert.equal(out[0].portal, 'data.cityofnewyork.us');
    assert.equal(out[0].dataset, 'abcd-1234');
    assert.deepEqual(out[0].record, { name: 'Park A', borough: 'Manhattan' });
    assert.equal(out[0].source, 'Socrata');
    assert.match(out[0].fetched_at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    if (saved !== undefined) process.env.SOCRATA_APP_TOKEN = saved;
  }
});

test('socrata soft-fails to [] without portal/datasetId and on error', async () => {
  assert.deepEqual(await withFetch(boom, () => socrata({ portal: 'x' })), []);
  assert.deepEqual(await withFetch(boom, () => socrata({ portal: 'x', datasetId: 'y' })), []);
});
