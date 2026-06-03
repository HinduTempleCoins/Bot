// sam-gov.test.mjs — offline tests for the SAM.gov entity + exclusions reader. No network I/O; fetch is
// injected via __setFetch. The SAM_API_KEY env is set/cleared per-test so the soft-SKIP path is covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasKey, entity, exclusions, eligibilityCheck, renderPage, dataNote, esc,
  __setFetch, API_KEY_ENV,
} from './sam-gov.mjs';

const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });

// helpers to set/clear the key env for a test
function withKey(v, fn) {
  const prev = process.env.SAM_API_KEY;
  process.env.SAM_API_KEY = v;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env.SAM_API_KEY; else process.env.SAM_API_KEY = prev;
  });
}
function withoutKey(fn) {
  const a = process.env.SAM_API_KEY, b = process.env.SAM_GOV_API_KEY;
  delete process.env.SAM_API_KEY; delete process.env.SAM_GOV_API_KEY;
  return Promise.resolve(fn()).finally(() => {
    if (a !== undefined) process.env.SAM_API_KEY = a;
    if (b !== undefined) process.env.SAM_GOV_API_KEY = b;
  });
}

test('API_KEY_ENV includes the canonical name + alias', () => {
  assert.ok(API_KEY_ENV.includes('SAM_API_KEY'));
  assert.ok(API_KEY_ENV.includes('SAM_GOV_API_KEY'));
});

test('hasKey — reflects presence of SAM_API_KEY', async () => {
  await withoutKey(() => assert.equal(hasKey(), false));
  await withKey('k', () => assert.equal(hasKey(), true));
});

test('entity / exclusions / eligibilityCheck — SOFT-SKIP without a key (no network call)', async () => {
  await withoutKey(async () => {
    let called = false;
    __setFetch(async () => { called = true; return okJson({}); });
    const e = await entity({ name: 'Acme' });
    const x = await exclusions({ name: 'Acme' });
    const c = await eligibilityCheck({ name: 'Acme' });
    __setFetch();
    assert.equal(e.skipped, true);
    assert.equal(x.skipped, true);
    assert.equal(c.skipped, true);
    assert.equal(called, false, 'no network call when no key');
  });
});

test('entity — with key, queries + normalizes registration data', async () => {
  await withKey('k', async () => {
    let url = null;
    __setFetch(async (u) => {
      url = u;
      return okJson({ entityData: [{ entityRegistration: { legalBusinessName: 'Acme Corp', ueiSAM: 'ABC123', cageCode: 'XYZ', registrationStatus: 'Active', registrationExpirationDate: '2027-01-01' } }] });
    });
    const e = await entity({ name: 'Acme Corp' });
    __setFetch();
    assert.match(url, /api_key=k/);
    assert.match(url, /legalBusinessName=Acme/);
    assert.equal(e.entities.length, 1);
    assert.equal(e.entities[0].name, 'Acme Corp');
    assert.equal(e.entities[0].ueiSAM, 'ABC123');
    assert.equal(e.source, 'SAM.gov');
  });
});

test('exclusions — with key, an exclusion record sets excluded:true', async () => {
  await withKey('k', async () => {
    __setFetch(async () => okJson({ exclusionDetails: [{ exclusionName: 'John Doe', classificationType: 'Individual', excludingAgencyName: 'GSA', exclusionType: 'Ineligible' }] }));
    const x = await exclusions({ name: 'John Doe' });
    __setFetch();
    assert.equal(x.excluded, true);
    assert.equal(x.records.length, 1);
    assert.equal(x.records[0].name, 'John Doe');
  });
});

test('exclusions — empty/no-match → excluded:false; soft-fails on non-ok', async () => {
  await withKey('k', async () => {
    __setFetch(async () => okJson({ exclusionDetails: [] }));
    const clear = await exclusions({ name: 'Nobody' });
    assert.equal(clear.excluded, false);
    __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const fail = await exclusions({ name: 'Nobody' });
    __setFetch();
    assert.equal(fail.excluded, false);
    assert.deepEqual(fail.records, []);
  });
});

test('eligibilityCheck — combines registration + exclusions; excluded is a hard flag', async () => {
  await withKey('k', async () => {
    __setFetch(async (u) => {
      if (/exclusions/.test(u)) return okJson({ exclusionDetails: [{ exclusionName: 'Bad Actor', exclusionType: 'Ineligible' }] });
      return okJson({ entityData: [{ entityRegistration: { legalBusinessName: 'Bad Actor', registrationStatus: 'Active' } }] });
    });
    const c = await eligibilityCheck({ name: 'Bad Actor' });
    __setFetch();
    assert.equal(c.registered, true);
    assert.equal(c.excluded, true);
  });
});

test('renderPage — skipped marker, exclusion hard-stop, escaping, and data note', () => {
  const skipped = renderPage({ skipped: true, reason: 'no SAM.gov API key configured' });
  assert.match(skipped, /unavailable/i);
  assert.match(skipped, /SAM\.gov API key/);

  const excluded = renderPage({ name: 'X & Y', registered: false, excluded: true });
  assert.match(excluded, /EXCLUDED/);
  assert.match(excluded, /hard stop/i);
  assert.ok(excluded.includes('X &amp; Y'));

  const ent = renderPage({ entities: [{ name: '<b>z</b>', ueiSAM: 'U1', registrationStatus: 'Active', registrationExpirationDate: '2027' }] });
  assert.ok(!ent.includes('<b>z</b>'));
  assert.ok(ent.includes('&lt;b&gt;'));

  assert.ok(skipped.includes(esc(dataNote())));
});

test('dataNote — names SAM.gov + a verify caveat', () => {
  assert.match(dataNote(), /SAM\.gov/);
  assert.match(dataNote(), /confirm/i);
});

test('__setFetch is callable (seam exists)', () => {
  assert.doesNotThrow(() => __setFetch());
});
