// crypto-protocol-catalog.test.mjs — offline tests for the crypto-protocol catalog.
// node:test + node:assert/strict, fully offline, happy + edge/soft-fail paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATALOG,
  KNOWN_FAMILIES,
  byFamily,
  find,
  byStatus,
  families,
  manifest,
} from './crypto-protocol-catalog.mjs';

test('CATALOG is a frozen, non-empty array of frozen well-shaped records', () => {
  assert.ok(Array.isArray(CATALOG));
  assert.ok(Object.isFrozen(CATALOG));
  assert.ok(CATALOG.length > 0);
  for (const r of CATALOG) {
    assert.ok(Object.isFrozen(r), 'each record frozen');
    for (const k of ['family', 'number', 'title', 'status', 'canonicalUrl', 'license']) {
      assert.equal(typeof r[k], 'string', `${k} is a string`);
      assert.ok(r[k].length > 0, `${k} non-empty`);
    }
    assert.ok(KNOWN_FAMILIES.includes(r.family), `${r.family} is a known family`);
    assert.ok(/^https?:\/\//.test(r.canonicalUrl), 'canonicalUrl is an http(s) URL');
  }
});

test('seed set contains the named representative specs', () => {
  const has = (family, number) =>
    CATALOG.some((r) => r.family === family && r.number === number);
  assert.ok(has('EIP', '20'));
  assert.ok(has('EIP', '721'));
  assert.ok(has('EIP', '1559'));
  assert.ok(has('BIP', '32'));
  assert.ok(has('BIP', '39'));
  assert.ok(has('BIP', '141'));
  // BOLT 1..11 (4,6 excluded historically; module ships 1,2,3,4,5,7,8,9,10,11)
  for (const n of ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11']) {
    assert.ok(has('BOLT', n), `BOLT ${n} present`);
  }
});

test('byFamily filters case-insensitively and soft-fails on blank/unknown', () => {
  const eips = byFamily('EIP');
  assert.ok(eips.length >= 3);
  assert.ok(eips.every((r) => r.family === 'EIP'));

  // case-insensitive
  assert.deepEqual(byFamily('bolt').length, byFamily('BOLT').length);
  assert.ok(byFamily('bolt').length >= 10);

  // soft-fail
  assert.deepEqual(byFamily(''), []);
  assert.deepEqual(byFamily(null), []);
  assert.deepEqual(byFamily('   '), []);
  assert.deepEqual(byFamily('NOPE'), []);
  assert.deepEqual(byFamily(undefined), []);
});

test('find matches over number AND title, case-insensitive, soft-fails on blank', () => {
  // by number
  const byNum = find('1559');
  assert.equal(byNum.length, 1);
  assert.equal(byNum[0].family, 'EIP');

  // by title substring, case-insensitive
  const byTitle = find('segregated witness');
  assert.equal(byTitle.length, 1);
  assert.equal(byTitle[0].number, '141');

  // partial number substring can match multiple
  assert.ok(find('2').length >= 1);

  // soft-fail: blank query returns [] (not the whole catalog)
  assert.deepEqual(find(''), []);
  assert.deepEqual(find('   '), []);
  assert.deepEqual(find(null), []);

  // no match
  assert.deepEqual(find('zzz-no-such-spec'), []);
});

test('byStatus matches case-insensitively and soft-fails', () => {
  const active = byStatus('Active');
  assert.ok(active.length >= 10); // all BOLTs + devp2p
  assert.ok(active.every((r) => r.status === 'Active'));
  assert.equal(byStatus('active').length, active.length);

  assert.ok(byStatus('Final').length >= 4);

  assert.deepEqual(byStatus(''), []);
  assert.deepEqual(byStatus(null), []);
  assert.deepEqual(byStatus('imaginary'), []);
});

test('families returns distinct families with counts, sorted, summing to total', () => {
  const fams = families();
  // distinct family names
  const names = fams.map((f) => f.family);
  assert.equal(new Set(names).size, names.length);
  // sorted by name
  assert.deepEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
  // counts sum to CATALOG length
  const sum = fams.reduce((acc, f) => acc + f.count, 0);
  assert.equal(sum, CATALOG.length);
  // each count matches byFamily
  for (const { family, count } of fams) {
    assert.equal(byFamily(family).length, count);
  }
});

test('manifest is deterministic and self-consistent', () => {
  const m1 = manifest();
  const m2 = manifest();
  assert.deepEqual(m1, m2, 'deterministic');

  assert.equal(m1.total, CATALOG.length);

  // byFamily map sums to total and matches the families() counts
  const famSum = Object.values(m1.byFamily).reduce((a, b) => a + b, 0);
  assert.equal(famSum, m1.total);
  for (const { family, count } of families()) {
    assert.equal(m1.byFamily[family], count);
  }

  // licenses are distinct, sorted, and cover every record's license
  assert.deepEqual(
    m1.licenses,
    m1.licenses.slice().sort((a, b) => a.localeCompare(b)));
  for (const r of CATALOG) {
    assert.ok(m1.licenses.includes(r.license), `${r.license} present in manifest`);
  }
  assert.equal(new Set(m1.licenses).size, m1.licenses.length);
});
