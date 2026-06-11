// knowledge/cryptocurrency/dpos-witness-explainer.test.mjs
//
// Offline tests for the DPoS / witness-system explainer. node:test only,
// no network, no disk, no clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TERMS,
  lookup,
  list,
  renderMarkdown,
  esc,
} from './dpos-witness-explainer.mjs';

test('lookup hit is case-insensitive and returns the entry', () => {
  const hit = lookup('Witness');
  assert.ok(hit, 'expected an entry for "Witness"');
  assert.equal(hit.term, 'Witness');

  const lower = lookup('top-21 schedule');
  assert.ok(lower);
  assert.equal(lower.term, 'Top-21 schedule');

  const padded = lookup('  Block production  ');
  assert.ok(padded);
  assert.equal(padded.term, 'Block production');
});

test('lookup miss returns null (soft-fail, no throw)', () => {
  assert.equal(lookup('proof of work'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup('   '), null);
  assert.equal(lookup(null), null);
  assert.equal(lookup(undefined), null);
});

test('list returns sorted term names matching TERMS', () => {
  const names = list();
  assert.equal(names.length, TERMS.length);
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted);
  // every listed name resolves back via lookup
  for (const n of names) {
    assert.ok(lookup(n), `lookup should resolve "${n}"`);
  }
});

test('TERMS is frozen and immutable', () => {
  assert.ok(Object.isFrozen(TERMS));
  assert.throws(() => { TERMS.push({}); }, 'push into frozen array should throw');
  for (const e of TERMS) {
    assert.ok(Object.isFrozen(e), `entry "${e.term}" should be frozen`);
    assert.throws(() => { e.term = 'mutated'; }, 'mutating a frozen entry should throw');
  }
});

test('every entry has all four sourced fields, non-empty', () => {
  for (const e of TERMS) {
    for (const k of ['term', 'plain', 'detail', 'source']) {
      assert.equal(typeof e[k], 'string', `${e.term}.${k} should be a string`);
      assert.ok(e[k].trim().length > 0, `${e.term}.${k} should be non-empty`);
    }
  }
});

test('renderMarkdown is deterministic and esc-safe', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b, 'render should be stable across calls');
  assert.ok(a.startsWith('# DPoS / Witness System — Explainer'));
  // every term name appears as a heading
  for (const e of TERMS) {
    assert.ok(a.includes(`## ${esc(e.term)}`), `markdown should contain heading for "${e.term}"`);
    assert.ok(a.includes(`_Source: ${esc(e.source)}_`), `markdown should cite source for "${e.term}"`);
  }
  // no raw angle brackets leaked from any field (everything is esc()'d)
  // (TERMS text has none, but guard against accidental HTML injection)
  assert.ok(!a.includes('<script'), 'no raw script tags');
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(21), '21');
});

test('MELEK-specific Hathor slot-protection entry is present and chain-code-scoped', () => {
  const hit = lookup("Hathor's slot protection (MELEK-specific)");
  assert.ok(hit);
  assert.match(hit.detail, /chain[- ]code/i);
  assert.match(hit.detail, /NOT a custom chain operation|not a custom/i);
});
