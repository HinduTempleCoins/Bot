// grants-catalog.test.mjs — the by-field grant aggregator. Pure, offline.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  FIELDS, GRANTS, field, getGrant, byField, search, fieldsWithCounts, validateCatalog,
} from './grants-catalog.mjs';

test('catalog validates: unique https entries, known fields, valid kinds', () => {
  const v = validateCatalog();
  assert.ok(v.ok, 'invalid: ' + v.errors.join('; '));
  assert.ok(v.grants >= 40);
  assert.ok(v.fields >= 7);
});

test('the master portals + the field anchors are present', () => {
  for (const id of ['grants-gov', 'sam-gov', 'candid']) assert.ok(getGrant(id), `missing portal ${id}`);
  for (const id of ['nsf', 'nih', 'sbir-sttr', 'title-i', 'nea', 'guggenheim']) assert.ok(getGrant(id), `missing ${id}`);
});

test('research, schools, small-business and RFP fields all have entries', () => {
  assert.ok(byField('research').length >= 5);
  assert.ok(byField('education-schools').length >= 5);
  assert.ok(byField('small-business').length >= 3);
  assert.ok(byField('rfp-procurement').length >= 3);
});

test('byField lists search portals first', () => {
  const p = byField('portals');
  assert.equal(p[0].kind, 'portal');
  // grants-gov is the lead portal
  assert.equal(p[0].id, 'grants-gov');
});

test('byField returns [] for an unknown field (never throws)', () => {
  assert.deepEqual(byField('nope'), []);
});

test('search finds research + school money by goal words', () => {
  assert.ok(search('research science funding').some((x) => ['nsf', 'nih', 'doe-science'].includes(x.id)));
  assert.ok(search('money for my school classroom').some((x) => ['title-i', 'donorschoose', 'ed-gov'].includes(x.id)));
  assert.ok(search('small business startup grant').some((x) => ['sbir-sttr', 'sba'].includes(x.id)));
});

test('search is empty-safe and bounded', () => {
  assert.deepEqual(search(''), []);
  assert.ok(search('grant', { limit: 3 }).length <= 3);
});

test('RFP lane points at the real aggregators', () => {
  const rfp = byField('rfp-procurement');
  const ids = rfp.map((x) => x.id);
  assert.ok(ids.includes('sam-contract-opps'));
  assert.ok(ids.includes('candid-rfp'));
});

test('every grant carries an official link + a description + a real field', () => {
  for (const x of GRANTS) {
    assert.match(x.url, /^https:\/\//, `${x.id} url`);
    assert.ok((x.what || '').length > 20, `${x.id} description`);
    assert.ok(field(x.field), `${x.id} field resolves`);
  }
});

test('fieldsWithCounts reports totals + portal counts', () => {
  const rows = fieldsWithCounts();
  assert.equal(rows.length, FIELDS.length);
  assert.ok(rows.find((r) => r.id === 'portals').portals >= 3);
});
