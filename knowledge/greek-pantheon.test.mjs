// greek-pantheon.test.mjs — offline tests for the Greek pantheon dataset + graph transforms
// (backlog 852d7ecd77).
//
// node:test + node:assert/strict, fully offline. Covers: static-data shape + freezing, deity()
// lookup (case-insensitive, soft-fail), relationsOf() resolution + dropping of unknown names,
// lineage() ancestor walk + cycle/termination guard, deterministic byte-stable renderMarkdown(),
// and esc() of interpolated fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEITIES,
  deity,
  relationsOf,
  lineage,
  renderMarkdown,
  esc,
} from './greek-pantheon.mjs';

test('DEITIES static data has the expected shape', () => {
  assert.ok(Array.isArray(DEITIES));
  assert.ok(DEITIES.length >= 12, 'at least the twelve Olympians-ish corpus');
  for (const d of DEITIES) {
    assert.equal(typeof d.name, 'string');
    assert.ok(d.name.length > 0, 'name present');
    assert.equal(typeof d.domain, 'string');
    assert.ok(Array.isArray(d.parents));
    assert.ok(Array.isArray(d.consorts));
    assert.ok(Array.isArray(d.children));
    assert.ok(Array.isArray(d.epithets));
    assert.equal(typeof d.source, 'string');
    assert.ok(d.source.length > 0, `${d.name} has a source`);
  }
  // names are unique
  const names = DEITIES.map((d) => d.name);
  assert.equal(new Set(names).size, names.length, 'deity names are unique');
});

test('DEITIES is frozen (read-only corpus)', () => {
  assert.ok(Object.isFrozen(DEITIES));
  const zeus = deity('Zeus');
  assert.ok(Object.isFrozen(zeus));
  assert.ok(Object.isFrozen(zeus.parents));
  assert.throws(() => {
    'use strict';
    DEITIES.push({});
  });
  assert.throws(() => {
    'use strict';
    zeus.name = 'mutated';
  });
});

test('deity() is case-insensitive and trims', () => {
  const a = deity('Zeus');
  assert.ok(a);
  assert.equal(a.name, 'Zeus');
  assert.equal(deity('zeus'), a);
  assert.equal(deity('  ZEUS  '), a);
  assert.equal(deity('zEuS'), a);
});

test('deity() soft-fails on unknown / empty / non-string', () => {
  assert.equal(deity('Odin'), null);
  assert.equal(deity(''), null);
  assert.equal(deity('   '), null);
  assert.equal(deity(null), null);
  assert.equal(deity(undefined), null);
  assert.equal(deity(42), null);
  assert.equal(deity({}), null);
});

test('relationsOf() resolves named relations to known deity entries', () => {
  const rel = relationsOf('Zeus');
  const parentNames = rel.parents.map((d) => d.name).sort();
  assert.deepEqual(parentNames, ['Cronus', 'Rhea']);
  // each resolved relation is a full frozen deity entry, not a string
  for (const p of rel.parents) {
    assert.equal(typeof p, 'object');
    assert.ok(Object.isFrozen(p));
    assert.ok(p.domain);
  }
  // children include known Olympians
  const childNames = rel.children.map((d) => d.name);
  assert.ok(childNames.includes('Athena'));
  assert.ok(childNames.includes('Apollo'));
});

test('relationsOf() drops relations that are not known deities (soft-fail)', () => {
  // Dionysus' mother Semele is mortal and has no corpus entry; only Zeus should resolve.
  const rel = relationsOf('Dionysus');
  const parentNames = rel.parents.map((d) => d.name);
  assert.deepEqual(parentNames, ['Zeus']);
  assert.ok(!parentNames.includes('Semele'));
});

test('relationsOf() on an unknown subject returns empty arrays', () => {
  const rel = relationsOf('Loki');
  assert.deepEqual(rel.parents, []);
  assert.deepEqual(rel.children, []);
  assert.deepEqual(rel.consorts, []);
  assert.ok(Object.isFrozen(rel));
});

test('lineage() walks the ancestor chain to a primordial root', () => {
  const chain = lineage('Zeus');
  // Zeus <- Cronus <- Uranus <- Gaia <- Chaos (first known parent at each step)
  assert.ok(chain.length >= 3, 'multi-step lineage');
  assert.equal(chain[0], 'Cronus');
  assert.ok(chain.includes('Gaia') || chain.includes('Uranus'));
  // ends at a parentless primordial
  assert.equal(chain[chain.length - 1], 'Chaos');
});

test('lineage() terminates despite genealogical cycles', () => {
  // Uranus is born of Gaia and is also her consort; Gaia is born of Chaos. The walk must not loop.
  const chain = lineage('Uranus');
  assert.ok(Array.isArray(chain));
  assert.ok(chain.length >= 1);
  // no repeated ancestor (cycle guard)
  assert.equal(new Set(chain).size, chain.length, 'no repeats in lineage');
  // a primordial has an empty chain
  assert.deepEqual(lineage('Chaos'), []);
});

test('lineage() soft-fails on unknown subject', () => {
  assert.deepEqual(lineage('Thor'), []);
  assert.deepEqual(lineage(''), []);
  assert.deepEqual(lineage(null), []);
});

test('renderMarkdown() is deterministic (byte-stable) and escapes fields', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b, 'identical across calls');
  assert.ok(a.startsWith('# Greek Pantheon'));
  assert.ok(a.endsWith('\n'));
  assert.ok(a.includes('| Deity | Domain | Parents | Source |'));
  assert.ok(a.includes('## Lineage'));
  // a known deity row is present
  assert.ok(a.includes('Zeus'));
  // no raw angle brackets leaked (everything routed through esc); the doc itself uses none
  assert.ok(!a.includes('<script'));
});

test('esc() escapes HTML-significant characters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(123), '123');
});
