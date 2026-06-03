// lawyer-directory.test.mjs — offline tests for the legal-services directory (task #217).
// Verifies the ABA Model Rules 5.4/7.2 are enforced STRUCTURALLY in code, not just disclaimed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeBarRecord,
  searchAttorneys,
  validateMonetization,
  priceListing,
  renderProfile,
  renderDirectory,
  renderPublicInterest,
  PUBLIC_INTEREST,
  NOT_ADVICE,
  ABA_RULES,
} from './lawyer-directory.mjs';

// --- normalizeBarRecord ---------------------------------------------------

test('normalizeBarRecord maps a canned record and keeps discipline sourced', () => {
  const raw = {
    name: 'Jane Q. Public',
    barNumber: 123456,
    status: 'Active in Good Standing',
    admitted: '2008-11-14',
    practiceAreas: ['Family Law', ' Estate Planning '],
    discipline: [{ date: '2015-03-02', action: 'Public reprimand', source: 'https://bar.example.gov/d/123456' }],
  };
  const r = normalizeBarRecord(raw, { state: 'CA' });
  assert.equal(r.name, 'Jane Q. Public');
  assert.equal(r.barNumber, '123456'); // stringified
  assert.equal(r.state, 'CA');
  assert.equal(r.status, 'active'); // normalized from "Active in Good Standing"
  assert.equal(r.admitted, '2008-11-14');
  assert.deepEqual(r.practiceAreas, ['Family Law', 'Estate Planning']); // trimmed
  assert.equal(r.discipline.length, 1);
  assert.equal(r.discipline[0].source, 'https://bar.example.gov/d/123456'); // source preserved
  assert.equal(r.discipline[0].action, 'Public reprimand');
  // public facts only — there is NO rating/score field on the record
  assert.equal('rating' in r, false);
  assert.equal('score' in r, false);
  assert.equal('recommendation' in r, false);
});

test('normalizeBarRecord normalizes suspended/disbarred and handles alt field names', () => {
  const r = normalizeBarRecord({ first_name: 'John', last_name: 'Doe', license_number: 'X9', licenseStatus: 'Suspended', state: 'NY' });
  assert.equal(r.name, 'John Doe');
  assert.equal(r.barNumber, 'X9');
  assert.equal(r.status, 'suspended');
  assert.equal(r.state, 'NY');
  assert.equal(normalizeBarRecord({ status: 'disbarred (2019)' }).status, 'disbarred');
  assert.equal(normalizeBarRecord(null), null);
});

// --- searchAttorneys (injected fetcher + soft-fail) -----------------------

test('searchAttorneys normalizes via injected fetcher (array shape)', async () => {
  const fetcher = async (q, { state }) => {
    assert.equal(q, 'smith');
    assert.equal(state, 'TX');
    return [{ name: 'Al Smith', barNumber: '777', status: 'active', state: 'TX' }];
  };
  const res = await searchAttorneys('smith', { state: 'TX', fetcher });
  assert.equal(res.length, 1);
  assert.equal(res[0].name, 'Al Smith');
  assert.equal(res[0].barNumber, '777');
});

test('searchAttorneys handles {results:[]} wrapper shape', async () => {
  const fetcher = async () => ({ results: [{ name: 'B', barNumber: '1' }, { name: 'C', barNumber: '2' }] });
  const res = await searchAttorneys('q', { fetcher });
  assert.equal(res.length, 2);
});

test('searchAttorneys soft-fails to [] on throw, missing fetcher, or empty query', async () => {
  const throwing = async () => { throw new Error('state bar down'); };
  assert.deepEqual(await searchAttorneys('q', { fetcher: throwing }), []);
  assert.deepEqual(await searchAttorneys('q', {}), []); // no fetcher
  assert.deepEqual(await searchAttorneys('', { fetcher: async () => [{ name: 'x' }] }), []); // empty query
});

// --- validateMonetization: the structural ABA guardrails ------------------

test('validateMonetization REJECTS fee-share (Rule 5.4)', () => {
  const r = validateMonetization({ type: 'fee-share', amount: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.rule, '5.4');
  assert.match(r.reason, /5\.4/);
});

test('validateMonetization REJECTS any percentage-bearing offer (Rule 5.4)', () => {
  const byField = validateMonetization({ type: 'listing', percent: 30 });
  assert.equal(byField.ok, false);
  assert.equal(byField.rule, '5.4');

  const byPercentage = validateMonetization({ type: 'premium', percentage: 15 });
  assert.equal(byPercentage.ok, false);
  assert.equal(byPercentage.rule, '5.4');

  const byAmountText = validateMonetization({ type: 'listing', amount: '20% of fee' });
  assert.equal(byAmountText.ok, false);
  assert.equal(byAmountText.rule, '5.4');
});

test('validateMonetization REJECTS pay-for-rank / pay-for-recommendation (Rule 7.2)', () => {
  const rank = validateMonetization({ type: 'pay-for-rank', amount: 500 });
  assert.equal(rank.ok, false);
  assert.equal(rank.rule, '7.2');
  assert.match(rank.reason, /7\.2/);

  const rec = validateMonetization({ type: 'paid-recommendation', amount: 200 });
  assert.equal(rec.ok, false);
  assert.equal(rec.rule, '7.2');

  const buysRank = validateMonetization({ type: 'advertising', amount: 99, buysRank: true });
  assert.equal(buysRank.ok, false);
  assert.equal(buysRank.rule, '7.2');
});

test('validateMonetization ACCEPTS flat-fee advertising/listing', () => {
  const r = validateMonetization({ type: 'flat-fee', amount: 49 });
  assert.equal(r.ok, true);
  assert.equal(r.normalized.model, 'flat-fee');
  assert.equal(r.normalized.amount, 49);
  assert.equal(r.normalized.disclosure, 'paid advertising');

  assert.equal(validateMonetization({ type: 'advertising', amount: 99 }).ok, true);
  assert.equal(validateMonetization({ type: 'display-ad', amount: 0 }).ok, true);
});

test('ABA_RULES carries the cited rule text', () => {
  assert.match(ABA_RULES['5.4'], /fees? with a nonlawyer/i);
  assert.match(ABA_RULES['7.2'], /recommendation/i);
});

// --- priceListing: flat amounts only --------------------------------------

test('priceListing returns flat USD amounts and a flat-fee model', () => {
  const p = priceListing({ tier: 'premium' });
  assert.equal(typeof p.price, 'number');
  assert.equal(p.currency, 'USD');
  assert.equal(p.model, 'flat-fee');
  assert.equal(priceListing({ tier: 'basic' }).price, 0);
  assert.equal(priceListing({ tier: 'featured' }).isAdvertising, true);
});

test('priceListing throws on an unknown tier (no way to smuggle a percentage)', () => {
  assert.throws(() => priceListing({ tier: 'percentage-of-fee' }), /Unknown listing tier/);
});

// --- rendering: escaped, no score/stars, not-advice + paid-ad disclosure ---

test('renderProfile escapes HTML, has NO score/stars, carries not-advice', () => {
  const attorney = normalizeBarRecord({
    name: '<script>alert(1)</script> Bad Name',
    barNumber: '42',
    status: 'active',
    admitted: '2010-01-01',
    practiceAreas: ['Criminal "Defense"'],
    discipline: [{ date: '2020-01-01', action: 'Censure <b>', source: 'https://x.example/"onerror=' }],
  }, { state: 'CA' });
  const html = renderProfile(attorney);

  // escaped
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;/);
  // discipline source rendered (escaped)
  assert.match(html, /\[source\]/);
  // NO rating/score/stars anywhere
  assert.equal(/star|★|☆|rating|score/i.test(html), false);
  // UPL not-advice line present
  assert.ok(html.includes(NOT_ADVICE));
});

test('renderProfile shows paid-advertising disclosure only for paid tiers', () => {
  const base = normalizeBarRecord({ name: 'A', barNumber: '1', status: 'active' });
  assert.match(renderProfile({ ...base, listingTier: 'featured' }), /paid advertising/i);
  assert.equal(/paid advertising/i.test(renderProfile({ ...base, listingTier: 'basic' })), false);
  assert.equal(/paid advertising/i.test(renderProfile(base)), false); // no tier → no tag
});

test('renderDirectory renders results and the not-advice line, soft-empties cleanly', () => {
  const a = normalizeBarRecord({ name: 'One', barNumber: '1', status: 'active' });
  const b = normalizeBarRecord({ name: 'Two', barNumber: '2', status: 'suspended' });
  const html = renderDirectory([a, b]);
  assert.match(html, /One/);
  assert.match(html, /Two/);
  assert.ok(html.includes(NOT_ADVICE));
  assert.equal(/star|score|rating/i.test(html), false);

  const empty = renderDirectory([]);
  assert.match(empty, /No matching public bar records/);
  assert.ok(empty.includes(NOT_ADVICE));
});

// --- PUBLIC_INTEREST: the clean set ---------------------------------------

test('PUBLIC_INTEREST entries all have urls', () => {
  const cats = Object.keys(PUBLIC_INTEREST);
  assert.ok(cats.length >= 3);
  for (const cat of cats) {
    for (const e of PUBLIC_INTEREST[cat]) {
      assert.ok(e.name, `entry in ${cat} missing name`);
      assert.match(e.url, /^https?:\/\//, `entry "${e.name}" missing valid url`);
    }
  }
});

test('renderPublicInterest is escaped and carries the not-advice line', () => {
  const html = renderPublicInterest();
  assert.ok(html.includes(NOT_ADVICE));
  assert.match(html, /Legal Services Corporation/);
  assert.match(html, /href="https/);
});
