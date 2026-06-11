// swedenborg-correspondences.test.mjs — offline unit tests for the Swedenborg correspondences
// data module (backlog d504603ec8). node:test + node:assert/strict, fully offline, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORRESPONDENCES,
  lookup,
  search,
  byTheme,
  toMarkdown,
  esc,
} from './swedenborg-correspondences.mjs';

test('CORRESPONDENCES is a frozen, non-empty array', () => {
  assert.ok(Array.isArray(CORRESPONDENCES));
  assert.ok(CORRESPONDENCES.length > 0);
  assert.ok(Object.isFrozen(CORRESPONDENCES));
  assert.ok(Object.isFrozen(CORRESPONDENCES[0]));
});

test('lookup resolves a known term (case-insensitive, trims)', () => {
  const e = lookup('  WaTeR  ');
  assert.ok(e);
  assert.equal(e.term, 'Water');
  assert.match(e.meaning, /truth/i);
});

test('lookup returns null for an unknown term and for empty/garbage input', () => {
  assert.equal(lookup('quasar'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup('   '), null);
  assert.equal(lookup(null), null);
  assert.equal(lookup(undefined), null);
});

test('search matches a substring of the term', () => {
  const hits = search('sun');
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((e) => e.term === 'Sun'));
});

test('search matches a substring of the meaning, not just the term', () => {
  const hits = search('innocence');
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((e) => e.term === 'Lamb'));
});

test('search returns [] for empty/whitespace query and never throws', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search('zzz-no-such-symbol'), []);
});

test('byTheme returns entries of that theme (case-insensitive)', () => {
  const celestial = byTheme('CELESTIAL');
  assert.ok(celestial.length >= 1);
  assert.ok(celestial.every((e) => e.theme === 'celestial'));
  assert.deepEqual(byTheme(''), []);
  assert.deepEqual(byTheme('no-theme'), []);
});

test('every entry carries PD provenance: a source and a ref', () => {
  for (const e of CORRESPONDENCES) {
    assert.ok(typeof e.source === 'string' && e.source.length > 0, `source for ${e.term}`);
    assert.ok(typeof e.ref === 'string' && e.ref.length > 0, `ref for ${e.term}`);
    assert.ok(typeof e.term === 'string' && e.term.length > 0);
    assert.ok(typeof e.meaning === 'string' && e.meaning.length > 0);
  }
});

test('toMarkdown defaults to the full corpus and is deterministic', () => {
  const a = toMarkdown();
  const b = toMarkdown();
  assert.equal(a, b);
  assert.match(a, /# Swedenborg/);
  assert.match(a, /\| Term \| Spiritual meaning \| Source \| Ref \|/);
  assert.ok(a.endsWith('\n'));
  // one body row per corpus entry
  for (const e of CORRESPONDENCES) {
    assert.ok(a.includes(e.term), `table includes ${e.term}`);
  }
});

test('toMarkdown escapes HTML-sensitive cell content', () => {
  const evil = [
    { term: '<b>x</b>', meaning: 'a & b "c" <i>', source: "S'rc", ref: '<n>1</n>' },
  ];
  const md = toMarkdown(evil);
  assert.ok(!md.includes('<b>x</b>'));
  assert.ok(md.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(md.includes('&amp;'));
  assert.ok(md.includes('&quot;'));
  assert.ok(md.includes('&#39;'));
});

test('toMarkdown soft-fails on a non-array argument (empty body, no throw)', () => {
  const md = toMarkdown(null);
  assert.match(md, /# Swedenborg/);
  assert.ok(md.endsWith('\n'));
});

test('esc handles nullish and the five sensitive chars', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
});
