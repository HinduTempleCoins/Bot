// credentials-catalog.test.mjs — the by-industry credentialing catalog. Pure, offline.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  INDUSTRIES, CREDENTIALS, industry, getCredential, byIndustry, search,
  industriesWithCounts, validateCatalog,
} from './credentials-catalog.mjs';

test('catalog validates: unique https entries, known industries, valid costs', () => {
  const v = validateCatalog();
  assert.ok(v.ok, 'catalog invalid: ' + v.errors.join('; '));
  assert.ok(v.credentials >= 30);
  assert.ok(v.industries >= 8);
});

test('the operator-named anchors are present', () => {
  for (const id of ['iacet', 'modernstates', 'saylor', 'clep']) {
    assert.ok(getCredential(id), `missing ${id}`);
  }
  // English-teaching family
  for (const id of ['tefl-120', 'tesol', 'celta']) assert.ok(getCredential(id), `missing ${id}`);
});

test('IACET is filed under continuing-education as an accreditor', () => {
  const x = getCredential('iacet');
  assert.equal(x.industry, 'continuing-education');
  assert.equal(x.type, 'accreditor');
  assert.match(x.url, /^https:\/\/www\.iacet\.org/);
});

test('byIndustry lists free credentials before paid ones', () => {
  const cc = byIndustry('college-credit');
  assert.ok(cc.length >= 3);
  const firstPaid = cc.findIndex((x) => x.cost === 'paid');
  const lastFree = cc.map((x) => x.cost).lastIndexOf('free');
  if (firstPaid !== -1 && lastFree !== -1) assert.ok(lastFree < firstPaid, 'free must precede paid');
  // Modern States (free) is the lead college-credit path
  assert.equal(cc[0].id, 'modernstates');
});

test('byIndustry returns [] for an unknown industry (never throws)', () => {
  assert.deepEqual(byIndustry('not-an-industry'), []);
});

test('search finds TEFL and free college credit by goal words', () => {
  const tefl = search('teach english abroad');
  assert.ok(tefl.some((x) => /tefl|tesol|celta/i.test(x.id)), 'TEFL family should surface');
  const credit = search('free college credit');
  assert.ok(credit.some((x) => ['modernstates', 'saylor', 'clep'].includes(x.id)), 'credit-by-exam should surface');
});

test('search is empty-safe and bounded', () => {
  assert.deepEqual(search(''), []);
  assert.ok(search('certificate', { limit: 3 }).length <= 3);
});

test('industriesWithCounts reports totals and free counts per industry', () => {
  const rows = industriesWithCounts();
  assert.equal(rows.length, INDUSTRIES.length);
  const cc = rows.find((r) => r.id === 'college-credit');
  assert.ok(cc.total >= 3 && cc.free >= 1);
});

test('every credential carries an official issuer link + a plain description', () => {
  for (const x of CREDENTIALS) {
    assert.match(x.url, /^https:\/\//, `${x.id} url`);
    assert.ok((x.what || '').length > 20, `${x.id} needs a real description`);
    assert.ok(industry(x.industry), `${x.id} industry resolves`);
  }
});
