// plant-catalog.test.mjs — offline. `node --test`. Proves breadth + the versatility value order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLANTS, MATERIALS, CATEGORIES, DOMAINS, plantsByCategory, materialsForPlant,
  plantsForMaterial, versatilityOf, valueOf, versatilityRanking,
} from './plant-catalog.mjs';

const MATSET = new Set(MATERIALS.map((m) => m.item));
const DOMSET = new Set(DOMAINS);

test('the catalog is BROAD — many plants across many categories, not a pot farm', () => {
  assert.ok(PLANTS.length >= 40, `only ${PLANTS.length} plants`);
  const cats = new Set(PLANTS.map((p) => p.category));
  assert.ok(cats.size >= 12, `only ${cats.size} categories`);
  // cannabis is exactly ONE plant, not the center
  assert.equal(PLANTS.filter((p) => p.id === 'cannabis').length, 1);
});

test('every plant yields real materials; every material has valid domains', () => {
  for (const p of PLANTS) {
    assert.ok(p.yields.length >= 1);
    for (const y of p.yields) assert.ok(MATSET.has(y), `${p.id} yields unknown material ${y}`);
  }
  for (const m of MATERIALS) for (const d of m.domains) assert.ok(DOMSET.has(d), `bad domain ${d}`);
});

test('THE CORRECTION: cannabis flower is the least versatile, lowest-value material', () => {
  assert.equal(versatilityOf('cannabis_flower'), 1);
  assert.equal(valueOf('cannabis_flower'), 2);
  for (const m of MATERIALS) {
    if (m.item === 'cannabis_flower') continue;
    assert.ok(valueOf(m.item) >= valueOf('cannabis_flower'), `${m.item} cheaper than cannabis flower?`);
  }
  const rank = versatilityRanking();
  assert.equal(rank[rank.length - 1].item, 'cannabis_flower'); // dead last
});

test('versatile backbone materials (oil/grain/fiber/timber/resin) outrank the niche', () => {
  for (const item of ['oil', 'grain', 'fiber', 'resin', 'timber', 'spice', 'mushroom']) {
    assert.ok(valueOf(item) > valueOf('cannabis_flower'), `${item} not > cannabis flower`);
  }
  assert.ok(valueOf('oil') >= valueOf('grain')); // oil serves the most domains
});

test('a material class spans MANY plants (that breadth is the value)', () => {
  const fiberPlants = plantsForMaterial('fiber');
  assert.ok(fiberPlants.length >= 5, 'fiber should come from many plants, not just hemp');
  assert.ok(fiberPlants.includes('cotton') && fiberPlants.includes('flax') && fiberPlants.includes('jute'));
  const oilPlants = plantsForMaterial('oil');
  assert.ok(oilPlants.length >= 5);
});

test('cannabis is a normal catalog entry yielding mostly versatile materials + a little niche flower', () => {
  const y = materialsForPlant('cannabis');
  assert.deepEqual(y, ['fiber', 'oil', 'cannabis_flower']);
  assert.equal(PLANTS.find((p) => p.id === 'cannabis').category, 'medicinal');
});

test('categories partition and queries work', () => {
  assert.ok(plantsByCategory('fiber').length >= 5);
  assert.ok(plantsByCategory('dye').length >= 2);
  assert.ok(plantsByCategory('beverage').length >= 2);
  for (const p of PLANTS) assert.ok(CATEGORIES.includes(p.category), `bad category ${p.category}`);
});
