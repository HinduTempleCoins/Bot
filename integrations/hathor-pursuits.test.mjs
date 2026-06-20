import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planComplex, createPursuits } from './hathor-pursuits.mjs';

test('planComplex lays a coherent sacred axis: gateway → colonnade → altar', () => {
  const items = planComplex({ x: 0, y: 68, z: 0 }, { axis: 'z', step: 6 });
  assert.equal(items[0].structure, 'gateway');                 // threshold first
  assert.ok(items.some((i) => i.structure === 'altar'));        // sanctuary present
  assert.ok(items.filter((i) => i.structure === 'pillar').length >= 6); // a colonnade
  assert.ok(items.some((i) => i.structure === 'wesekhBand'));
  // the altar is farther along the axis than the gateway
  const gate = items.find((i) => i.structure === 'gateway');
  const altar = items.find((i) => i.structure === 'altar');
  assert.ok(altar.origin.z > gate.origin.z);
});

test('colonnade pillars are paired (flanking the avenue)', () => {
  const items = planComplex({ x: 0, y: 68, z: 0 }, { axis: 'z' });
  const pillars = items.filter((i) => i.structure === 'pillar');
  // each axis position has a west (-x) and east (+x) pillar
  const west = pillars.filter((p) => p.origin.x < 0);
  const east = pillars.filter((p) => p.origin.x > 0);
  assert.equal(west.length, east.length);
});

test('pursuits hands out one action per tick, in build order', () => {
  const p = createPursuits();
  const a0 = p.next({ built: 0 });
  const a1 = p.next({ built: 1 });
  assert.equal(a0.action, 'build');
  assert.equal(a0.item.structure, 'gateway');
  assert.equal(a0.indexInComplex, 0);
  assert.notDeepEqual(a0.item.origin, a1.item.origin); // advances
  assert.match(a0.journal, /raised .* at -?\d+ \d+ -?\d+/);
});

test('when a complex finishes she begins another, offset (the city grows)', () => {
  const p = createPursuits();
  const per = p.perComplex();
  const first = p.next({ built: 0 });
  const nextComplex = p.next({ built: per });   // first item of complex #2
  assert.equal(nextComplex.complex, 1);
  assert.equal(nextComplex.indexInComplex, 0);
  assert.equal(nextComplex.item.structure, 'gateway');
  // complex 2 is offset from complex 1
  assert.notEqual(nextComplex.item.origin.x, first.item.origin.x);
});

test('every build action carries a journal line with coordinates (so she remembers what is where)', () => {
  const p = createPursuits();
  for (let b = 0; b < p.perComplex(); b++) {
    const a = p.next({ built: b });
    assert.equal(a.action, 'build');
    assert.match(a.journal, /\d+ \d+ -?\d+/);
    assert.ok(a.item.note);
  }
});
