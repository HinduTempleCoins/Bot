// knowledge/cryptocurrency/karma-merit-philosophy.test.mjs
//
// Offline tests for the Karma / Merit philosophy explainer. node:test only,
// no network/clock/disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  esc, PRINCIPLES, lookup, list, search, renderMarkdown,
} from './karma-merit-philosophy.mjs';

test('lookup hit returns the entry (case/space-insensitive)', () => {
  const hit = lookup('karma-is-earned-merit');
  assert.ok(hit);
  assert.equal(hit.key, 'karma-is-earned-merit');
  assert.match(hit.name, /earned merit/i);
  // case + surrounding whitespace tolerated
  assert.equal(lookup('  KARMA-IS-EARNED-MERIT  ').key, 'karma-is-earned-merit');
});

test('lookup miss / bad input soft-fails to null (never throws)', () => {
  assert.equal(lookup('does-not-exist'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup('   '), null);
  assert.equal(lookup(null), null);
  assert.equal(lookup(undefined), null);
});

test('list returns all keys in declaration order', () => {
  const keys = list();
  assert.equal(keys.length, PRINCIPLES.length);
  assert.deepEqual(keys, PRINCIPLES.map((e) => e.key));
  assert.ok(keys.includes('off-chain-accrual'));
  assert.ok(keys.includes('decay-over-time'));
  assert.ok(keys.includes('non-punitive-crediting'));
});

test('search is case-insensitive substring across fields', () => {
  const decay = search('DECAY');
  assert.ok(decay.some((e) => e.key === 'decay-over-time'));
  // matches in detail text
  assert.ok(search('off-chain').some((e) => e.key === 'off-chain-accrual'));
  assert.ok(search('cheetah').some((e) => e.key === 'non-punitive-crediting'));
  // matches by name
  assert.ok(search('stake').length >= 1);
});

test('search blank / bad input soft-fails to []', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search(undefined), []);
  assert.deepEqual(search('zzz-no-such-term'), []);
});

test('PRINCIPLES is frozen and every entry has the full shape', () => {
  assert.ok(Object.isFrozen(PRINCIPLES));
  for (const e of PRINCIPLES) {
    assert.ok(Object.isFrozen(e), `entry ${e.key} should be frozen`);
    for (const f of ['key', 'name', 'plain', 'detail', 'source']) {
      assert.equal(typeof e[f], 'string', `${e.key}.${f} is a string`);
      assert.ok(e[f].length > 0, `${e.key}.${f} is non-empty`);
    }
  }
  // keys are unique
  const keys = PRINCIPLES.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('frozen immutability: mutation attempts do not take effect', () => {
  assert.throws(() => { PRINCIPLES.push({}); }, TypeError);
  const before = PRINCIPLES[0].name;
  try { PRINCIPLES[0].name = 'mutated'; } catch { /* strict-mode TypeError ok */ }
  assert.equal(PRINCIPLES[0].name, before);
});

test('renderMarkdown is deterministic and contains known names', () => {
  const md = renderMarkdown();
  assert.equal(md, renderMarkdown());
  assert.match(md, /# Karma \/ Merit — Philosophy Explainer/);
  assert.match(md, /Karma is earned merit, not bought stake/);
  assert.match(md, /Off-chain accrual feeding on-chain curation/);
  assert.match(md, /Decay toward neutral over time/);
  assert.match(md, /Non-punitive crediting/);
  // notes it is philosophy-only, not the scoring math
  assert.match(md, /Does not implement the karma scoring math/);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});
