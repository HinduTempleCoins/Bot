import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODES, EQUATIONS, TIERS, TRADITIONS, getNode, nodesByTradition,
  equationsFor, cluster, triangulate, weakLinks, registryGap, validate, tierRank,
} from './pantheon-map.mjs';

test('the data is structurally sound', () => {
  const v = validate();
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test('every equation at cultic or above carries a citable source', () => {
  for (const e of EQUATIONS) {
    if (tierRank(e.tier) >= tierRank('cultic')) {
      assert.ok(e.source && e.source.length > 10, `${e.a}=${e.b} needs a real source`);
    }
  }
});

test('no equation is duplicated in either direction', () => {
  const seen = new Set();
  for (const e of EQUATIONS) {
    const key = [e.a, e.b].sort().join('=');
    assert.ok(!seen.has(key), `duplicate equation ${key}`);
    seen.add(key);
  }
});

test('the Berber pantheon is present with primary sources', () => {
  const berber = nodesByTradition('berber').map((n) => n.id);
  assert.ok(berber.includes('gurzil'));
  assert.ok(berber.includes('anzar'));
  const gurzil = equationsFor('gurzil');
  assert.ok(gurzil.length >= 2);
  assert.match(gurzil[0].source, /Corippus/);
});

test('cluster() defaults to cultic and above, so conjecture cannot join an attested chain', () => {
  // Tanit reaches Athena ONLY through our own conjectured Tanit=Neith edge.
  const strict = cluster('tanit');
  assert.ok(!strict.includes('athena'), 'a structural link leaked into the default cluster');
  assert.ok(!strict.includes('neith'));

  const loose = cluster('tanit', { minTier: 'structural' });
  assert.ok(loose.includes('neith'));
  assert.ok(loose.includes('athena'));
});

test('Neith reaches Athena on attested evidence alone', () => {
  const c = cluster('neith', { minTier: 'attested' });
  assert.ok(c.includes('athena'), 'Plato Timaeus 21e should carry this');
  assert.ok(c.includes('minerva'));
});

test('triangulate() enforces the three-system rule and reports failure honestly', () => {
  const strong = triangulate('melqart', 'herakles');
  assert.equal(strong.connected, true);
  assert.equal(strong.met, true);
  assert.ok(strong.systems.length >= 3);

  // Tanit->Athena connects through Neith and meets the three-system rule.
  const chain = triangulate('tanit', 'athena');
  assert.equal(chain.connected, true);
  assert.equal(chain.met, true);
  assert.deepEqual(chain.path, ['tanit', 'neith', 'athena'], 'Neith is the intermediary, as the corpus argues');
  assert.ok(chain.systems.length >= 3);
  // ...and it still discloses that the whole chain rests on one structural edge.
  assert.equal(chain.weakest, 'structural', 'a chain is only as strong as its flimsiest link');

  // At cultic and above it breaks entirely: no ancient or archaeological path exists.
  const strict = triangulate('tanit', 'athena', { minTier: 'cultic' });
  assert.equal(strict.connected, false);
});

test('Tanit reaches Juno Caelestis on archaeology, which is the equation that actually holds', () => {
  const c = cluster('tanit');
  assert.ok(c.includes('juno-caelestis'), 'the Roman-Africa cult continuity is the strong one');
  const t = triangulate('tanit', 'juno-caelestis', { minTier: 'cultic' });
  assert.equal(t.connected, true);
  assert.equal(t.weakest, 'cultic');
});

test('triangulate() prefers the best-evidenced route, not the shortest one', () => {
  // A shortest-path search would take the single structural tanit=athena edge and report two
  // systems. The two-hop route through Neith carries three. Convergence is the point, not brevity.
  const t = triangulate('tanit', 'athena');
  assert.equal(t.hops, 2);
  assert.ok(t.systems.length > 2);

  // Melqart reaches Herakles with four systems converging on attested-or-better edges throughout.
  const m = triangulate('melqart', 'herakles');
  assert.equal(m.weakest, 'attested');
  assert.ok(m.systems.length >= 4);
});

test('the Indo-European equation is attested by sound law with no ancient author', () => {
  const e = EQUATIONS.find((x) => x.a === 'dyaus' && x.b === 'zeus');
  assert.equal(e.tier, 'attested');
  assert.deepEqual(e.systems, ['linguistics']);
  const t = triangulate('dyaus', 'zeus');
  assert.equal(t.connected, true);
  assert.equal(t.met, false, 'one system only — the rule must refuse it, and it still holds by sound law');
});

test('the Leto-at-Buto obstacle is recorded rather than dropped', () => {
  const e = EQUATIONS.find((x) => x.a === 'wadjet' && x.b === 'leto');
  assert.equal(e.tier, 'attested');
  assert.match(e.note, /obstacle/i);
});

test('Herodotus I.131 Mithra is kept as an attested equation that is nonetheless wrong', () => {
  const e = EQUATIONS.find((x) => x.a === 'mithra' && x.b === 'aphrodite');
  assert.equal(e.tier, 'attested');
  assert.match(e.note, /garbled|wrong/i);
});

test('weakLinks() surfaces everything we are proposing ourselves', () => {
  const w = weakLinks();
  assert.ok(w.length > 5);
  assert.ok(w.every((e) => e.tier === 'conjecture' || e.tier === 'structural'));
  const ours = w.filter((e) => (e.source || '').includes('VKFRI'));
  assert.ok(ours.length >= 3, 'our own proposals must be findable');
  assert.equal(w[0].tier, 'conjecture', 'weakest first');
});

test('equationsFor() sorts strongest evidence first and is soft on unknown ids', () => {
  const m = equationsFor('melqart');
  assert.equal(m[0].tier, 'epigraphic');
  assert.ok(m[0].other);
  assert.deepEqual(equationsFor('no-such-god'), []);
  assert.deepEqual(equationsFor(undefined), []);
});

test('cluster() is soft on unknown ids', () => {
  assert.deepEqual(cluster('no-such-god'), []);
  assert.equal(getNode('no-such-god'), null);
});

test('registryGap() reports the hierophant-entities backlog', () => {
  const gap = registryGap();
  assert.ok(gap.includes('neith'), 'Neith is referenced here but not in the entity registry');
  assert.ok(gap.includes('melqart'));
  assert.ok(gap.includes('gurzil'));
  assert.ok(!gap.includes('zeus'), 'Zeus is already registered');
});

test('the map spans the traditions the corpus actually argues across', () => {
  for (const t of ['egyptian', 'phoenician', 'punic', 'berber', 'libyan', 'greek', 'roman', 'etruscan', 'norse', 'vedic']) {
    assert.ok(TRADITIONS.includes(t), `missing tradition ${t}`);
  }
  assert.ok(NODES.length >= 80);
  assert.ok(EQUATIONS.length >= 60);
  assert.deepEqual(TIERS[0], 'conjecture');
  assert.deepEqual(TIERS[TIERS.length - 1], 'epigraphic');
});
