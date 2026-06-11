// roman-pantheon.test.mjs — offline tests for the Roman pantheon + Greek↔Roman cross-reference.
// node:test + node:assert/strict. Fully offline; no network, no fetch, no fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PANTHEON,
  byName,
  byDomain,
  greekToRoman,
  romanToGreek,
  search,
  renderMarkdown,
  esc,
} from './roman-pantheon.mjs';

test('PANTHEON is a non-empty frozen array of well-shaped entries', () => {
  assert.ok(Array.isArray(PANTHEON));
  assert.ok(PANTHEON.length >= 12);
  assert.ok(Object.isFrozen(PANTHEON));
  for (const d of PANTHEON) {
    assert.ok(Object.isFrozen(d), `${d.name} entry frozen`);
    assert.equal(typeof d.name, 'string');
    assert.ok(d.name.length > 0);
    assert.equal(typeof d.domain, 'string');
    assert.ok(d.domain.length > 0);
    assert.equal(typeof d.summary, 'string');
    assert.ok(d.summary.length > 0);
    assert.ok(Array.isArray(d.symbols) && Object.isFrozen(d.symbols));
    assert.ok(Array.isArray(d.epithets) && Object.isFrozen(d.epithets));
    // greekEquivalent is a string or null
    assert.ok(d.greekEquivalent === null || typeof d.greekEquivalent === 'string');
  }
});

test('PANTHEON cannot be mutated (frozen corpus)', () => {
  const before = PANTHEON.length;
  try {
    PANTHEON.push({ name: 'Fake' });
  } catch {
    /* strict-mode throw is acceptable */
  }
  assert.equal(PANTHEON.length, before);
  // entry mutation is silently ignored under freeze
  const jup = byName('Jupiter');
  try {
    jup.name = 'Hacked';
  } catch {
    /* acceptable */
  }
  assert.equal(byName('Jupiter').name, 'Jupiter');
});

test('byName: exact, case-insensitive, accent-insensitive, padded', () => {
  assert.equal(byName('Jupiter').name, 'Jupiter');
  assert.equal(byName('jupiter').name, 'Jupiter');
  assert.equal(byName('JUPITER').name, 'Jupiter');
  assert.equal(byName('  Júpiter  ').name, 'Jupiter');
  assert.equal(byName('Vénus').name, 'Venus');
});

test('byName: soft-fail on misses and bad input', () => {
  assert.equal(byName('Quetzalcoatl'), null);
  assert.equal(byName(''), null);
  assert.equal(byName('   '), null);
  assert.equal(byName(null), null);
  assert.equal(byName(undefined), null);
  assert.equal(byName(123), null);
  assert.equal(byName({}), null);
});

test('byDomain: substring match, case-insensitive, soft-fail', () => {
  const war = byDomain('war');
  assert.ok(war.some((d) => d.name === 'Mars'));
  assert.ok(war.some((d) => d.name === 'Minerva'));
  assert.ok(Object.isFrozen(war));

  const sea = byDomain('SEA');
  assert.ok(sea.some((d) => d.name === 'Neptune'));

  assert.deepEqual([...byDomain('')], []);
  assert.deepEqual([...byDomain(null)], []);
  assert.deepEqual([...byDomain('nonexistent-domain-xyz')], []);
});

test('greekToRoman: known, case/accent-insensitive, and misses', () => {
  assert.equal(greekToRoman('Zeus'), 'Jupiter');
  assert.equal(greekToRoman('zeus'), 'Jupiter');
  assert.equal(greekToRoman('Poseidon'), 'Neptune');
  assert.equal(greekToRoman('Aphrodite'), 'Venus');
  assert.equal(greekToRoman('Hades'), 'Pluto');
  // Apollo keeps its name across both pantheons
  assert.equal(greekToRoman('Apollo'), 'Apollo');
  // misses / bad input
  assert.equal(greekToRoman('Jupiter'), null); // Jupiter is Roman, not a Greek key
  assert.equal(greekToRoman('NotAGod'), null);
  assert.equal(greekToRoman(''), null);
  assert.equal(greekToRoman(null), null);
});

test('romanToGreek: known, and null for the genuinely-Roman Janus', () => {
  assert.equal(romanToGreek('Jupiter'), 'Zeus');
  assert.equal(romanToGreek('venus'), 'Aphrodite');
  assert.equal(romanToGreek('Mars'), 'Ares');
  assert.equal(romanToGreek('Bacchus'), 'Dionysus');
  // Janus has no Greek equivalent -> not present in the map -> null
  assert.equal(romanToGreek('Janus'), null);
  assert.equal(romanToGreek('Zeus'), null); // Zeus is Greek, not a Roman key
  assert.equal(romanToGreek(''), null);
  assert.equal(romanToGreek(undefined), null);
});

test('round-trip: romanToGreek <-> greekToRoman are consistent for mapped deities', () => {
  for (const d of PANTHEON) {
    if (d.greekEquivalent) {
      assert.equal(romanToGreek(d.name), d.greekEquivalent);
      assert.equal(greekToRoman(d.greekEquivalent), d.name);
    } else {
      assert.equal(romanToGreek(d.name), null);
    }
  }
});

test('search: matches name, domain, and epithet; soft-fail', () => {
  // by name
  assert.ok(search('jupiter').some((d) => d.name === 'Jupiter'));
  // by domain
  assert.ok(search('forge').some((d) => d.name === 'Vulcan'));
  // by epithet
  assert.ok(search('Optimus Maximus').some((d) => d.name === 'Jupiter'));
  assert.ok(search('liber').some((d) => d.name === 'Bacchus'));
  // accent-insensitive
  assert.ok(search('vénus').some((d) => d.name === 'Venus'));
  // frozen + soft-fail
  assert.ok(Object.isFrozen(search('jupiter')));
  assert.deepEqual([...search('')], []);
  assert.deepEqual([...search(null)], []);
  assert.deepEqual([...search('zzzznotfound')], []);
});

test('Janus is present and genuinely Roman (null greekEquivalent)', () => {
  const janus = byName('Janus');
  assert.ok(janus);
  assert.equal(janus.greekEquivalent, null);
});

test('every greekEquivalent resolves in the cross-reference map', () => {
  for (const d of PANTHEON) {
    if (d.greekEquivalent) {
      assert.equal(greekToRoman(d.greekEquivalent), d.name);
    }
  }
});

test('renderMarkdown: deterministic, escaped, byte-stable, newline-terminated', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b);
  assert.ok(a.endsWith('\n'));
  assert.ok(a.includes('Roman Pantheon'));
  assert.ok(a.includes('Jupiter'));
  assert.ok(a.includes('Zeus'));
  // Janus row notes the absence of a Greek equivalent
  assert.ok(a.includes('no Greek equivalent'));
});

test('esc escapes HTML metacharacters and soft-handles nullish', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
