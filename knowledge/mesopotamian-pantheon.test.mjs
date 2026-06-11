// mesopotamian-pantheon.test.mjs — offline tests for the static Mesopotamian pantheon reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANTHEON,
  byName,
  byDomain,
  byCity,
  search,
  esc,
  renderMarkdown,
} from './mesopotamian-pantheon.mjs';

test('PANTHEON is a non-empty frozen array of well-shaped, frozen entries', () => {
  assert.ok(Array.isArray(PANTHEON));
  assert.ok(PANTHEON.length >= 7);
  assert.ok(Object.isFrozen(PANTHEON));
  for (const d of PANTHEON) {
    assert.ok(Object.isFrozen(d));
    assert.equal(typeof d.name, 'string');
    assert.ok(d.name.length > 0);
    assert.ok('sumerianName' in d);
    assert.ok('akkadianName' in d);
    assert.equal(typeof d.domain, 'string');
    assert.equal(typeof d.cityCult, 'string');
    assert.ok(Array.isArray(d.symbols));
    assert.ok(Object.isFrozen(d.symbols));
    assert.equal(typeof d.summary, 'string');
  }
});

test('PANTHEON entries cannot be mutated (deep freeze)', () => {
  const before = PANTHEON[0].symbols.length;
  try {
    PANTHEON[0].symbols.push('intruder');
  } catch {
    /* strict-mode throw is acceptable; either way no mutation */
  }
  assert.equal(PANTHEON[0].symbols.length, before);
});

test('covers the spec-named deities', () => {
  for (const n of ['An', 'Anu', 'Enlil', 'Enki', 'Ea', 'Inanna', 'Ishtar', 'Marduk', 'Nanna', 'Sin', 'Utu', 'Shamash']) {
    assert.ok(byName(n), `expected to resolve ${n}`);
  }
});

test('byName matches by Sumerian or Akkadian name', () => {
  const bySum = byName('Inanna');
  const byAkk = byName('Ishtar');
  assert.ok(bySum);
  assert.equal(bySum, byAkk); // same frozen entry
  assert.equal(byName('Enki'), byName('Ea'));
});

test('byName is case- and accent-insensitive', () => {
  const base = byName('Sin');
  assert.ok(base);
  assert.equal(byName('SIN'), base);
  assert.equal(byName('sîn'), base); // long-mark / diacritic form
  assert.equal(byName('Sîn'), base); // capital + diacritic
  assert.equal(byName('  Shamash  '), byName('shámásh')); // padding + accents on a stored spelling
});

test('byName resolves the combined "X / Y" label and components', () => {
  const e = byName('An / Anu');
  assert.ok(e);
  assert.equal(e, byName('An'));
  assert.equal(e, byName('Anu'));
});

test('byName soft-fails to null on empty / unknown / non-string', () => {
  assert.equal(byName(''), null);
  assert.equal(byName('   '), null);
  assert.equal(byName('Zeus'), null);
  assert.equal(byName(null), null);
  assert.equal(byName(undefined), null);
  assert.equal(byName(42), null);
});

test('byDomain returns matching entries; empty/unknown -> []', () => {
  const war = byDomain('war');
  assert.ok(Array.isArray(war));
  assert.ok(war.length >= 1);
  assert.ok(war.some((d) => byName('Inanna') === d || byName('Ishtar') === d));
  assert.deepEqual(byDomain(''), []);
  assert.deepEqual(byDomain('xyzzy'), []);
  assert.deepEqual(byDomain(null), []);
});

test('byCity returns matching entries; case-insensitive; empty/unknown -> []', () => {
  const ur = byCity('Ur');
  assert.ok(ur.length >= 1);
  assert.ok(ur.some((d) => d === byName('Nanna')));
  assert.equal(byCity('uruk').length, byCity('Uruk').length);
  assert.ok(byCity('uruk').length >= 1);
  assert.deepEqual(byCity(''), []);
  assert.deepEqual(byCity('Atlantis'), []);
});

test('search scans across all fields incl. symbols and summary', () => {
  assert.ok(search('moon').length >= 1); // Nanna/Sin domain + summary
  assert.ok(search('Tiamat').length >= 1); // Marduk summary only
  assert.ok(search('lion').length >= 1); // symbols
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('nonexistent-term-zzz'), []);
  assert.deepEqual(search(undefined), []);
});

test('renderMarkdown is deterministic and esc-safe', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b);
  assert.ok(a.startsWith('# Mesopotamian Pantheon'));
  assert.ok(a.endsWith('\n'));
  // every deity name appears in the table
  for (const d of PANTHEON) assert.ok(a.includes(esc(d.name)));
});

test('esc neutralizes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
