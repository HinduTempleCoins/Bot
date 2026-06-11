// egyptian-pantheon.test.mjs — offline, deterministic tests for the frozen Egyptian-deity dataset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  DEITIES,
  deity,
  relationsOf,
  lineage,
  renderMarkdown,
} from './egyptian-pantheon.mjs';

test('esc escapes the five HTML metacharacters and coerces nullish to empty', () => {
  assert.equal(esc(`<a href="x" & 'y'>`), '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('DEITIES is a frozen non-empty corpus with the core Ennead/Osirian deities', () => {
  assert.ok(Object.isFrozen(DEITIES));
  assert.ok(DEITIES.length >= 14);
  const names = DEITIES.map((d) => d.name);
  for (const n of [
    'Ra', 'Atum', 'Shu', 'Tefnut', 'Geb', 'Nut',
    'Osiris', 'Isis', 'Set', 'Nephthys', 'Horus', 'Hathor', 'Thoth', 'Anubis',
  ]) {
    assert.ok(names.includes(n), `expected ${n} in corpus`);
  }
});

test('each entry and its array fields are deeply frozen and immutable', () => {
  for (const d of DEITIES) {
    assert.ok(Object.isFrozen(d), `${d.name} entry should be frozen`);
    assert.ok(Object.isFrozen(d.parents));
    assert.ok(Object.isFrozen(d.consorts));
    assert.ok(Object.isFrozen(d.children));
    assert.ok(Object.isFrozen(d.epithets));
  }
  const osiris = deity('Osiris');
  assert.throws(() => {
    osiris.parents.push('intruder');
  });
});

test('deity() is case-insensitive, trims, and soft-fails on unknown/empty/nullish', () => {
  assert.equal(deity('Osiris').name, 'Osiris');
  assert.equal(deity('osiris').name, 'Osiris');
  assert.equal(deity('  HATHOR  ').name, 'Hathor');
  assert.equal(deity('Zeus'), null);
  assert.equal(deity(''), null);
  assert.equal(deity('   '), null);
  assert.equal(deity(null), null);
  assert.equal(deity(undefined), null);
  assert.equal(deity(123), null);
});

test('Hathor carries her canonical relations (daughter of Ra, consort of Horus)', () => {
  const rel = relationsOf('Hathor');
  assert.deepEqual(rel.parents.map((p) => p.name), ['Ra']);
  assert.deepEqual(rel.consorts.map((c) => c.name), ['Horus']);
});

test('relationsOf resolves known relations and drops unknowns; unknown subject -> empty', () => {
  const osiris = relationsOf('Osiris');
  assert.deepEqual(osiris.parents.map((p) => p.name), ['Geb', 'Nut']);
  assert.deepEqual(osiris.consorts.map((c) => c.name), ['Isis']);
  assert.deepEqual(osiris.children.map((c) => c.name), ['Horus']);
  // resolved relations are themselves frozen entries
  assert.ok(Object.isFrozen(osiris.parents[0]));

  const unknown = relationsOf('Quetzalcoatl');
  assert.deepEqual(unknown.parents, []);
  assert.deepEqual(unknown.children, []);
  assert.deepEqual(unknown.consorts, []);
});

test('lineage walks parents to the primordial root and is empty for primordials/unknowns', () => {
  // Horus <- Osiris <- Geb <- Shu <- Atum (root, parentless)
  assert.deepEqual(lineage('Horus'), ['Osiris', 'Geb', 'Shu', 'Atum']);
  // Atum is a primordial creator with no parents
  assert.deepEqual(lineage('Atum'), []);
  assert.deepEqual(lineage('Ra'), []);
  // unknown subject soft-fails to []
  assert.deepEqual(lineage('Marduk'), []);
  assert.deepEqual(lineage(null), []);
});

test('lineage terminates (cycle-guarded) for every deity in the corpus', () => {
  for (const d of DEITIES) {
    const chain = lineage(d.name);
    // no deity appears twice, and the subject is never in its own chain
    assert.equal(new Set(chain).size, chain.length, `${d.name} lineage has a duplicate`);
    assert.ok(!chain.includes(d.name), `${d.name} appears in its own lineage`);
  }
});

test('renderMarkdown is deterministic, newline-terminated, and HTML-escapes interpolation', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b, 'render must be byte-stable');
  assert.ok(a.startsWith('# Egyptian Pantheon\n'));
  assert.ok(a.endsWith('\n'));
  assert.ok(a.includes('| Deity | Domain | Parents | Source |'));
  // every deity name appears in the table
  for (const d of DEITIES) {
    assert.ok(a.includes(esc(d.name)), `${d.name} missing from render`);
  }
  // no raw unescaped angle bracket from any field leaks (the doc uses '←' separators, not '<')
  assert.ok(!a.includes('<a '));
});

test('every deity field is a non-empty string / well-formed array', () => {
  for (const d of DEITIES) {
    assert.equal(typeof d.name, 'string');
    assert.ok(d.name.length > 0);
    assert.equal(typeof d.domain, 'string');
    assert.ok(d.domain.length > 0);
    assert.equal(typeof d.source, 'string');
    assert.ok(d.source.length > 0);
    assert.ok(Array.isArray(d.parents));
    assert.ok(Array.isArray(d.consorts));
    assert.ok(Array.isArray(d.children));
    assert.ok(Array.isArray(d.epithets) && d.epithets.length > 0);
  }
});
