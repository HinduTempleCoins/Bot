// plant-products.test.mjs — offline. `node --test`. Versatility-driven model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIALS, DOMAINS, PRODUCTS, RECIPES, MATERIAL_VALUE, PRODUCT_VALUE,
  versatilityOf, harvestMaterials, craftable, craft, canCraft, productTree, auditNoPump,
} from './plant-products.mjs';

const DOMSET = new Set(DOMAINS);

test('materials and products are well-formed with valid domains', () => {
  assert.ok(MATERIALS.length >= 8);
  for (const m of MATERIALS) {
    assert.ok(m.item && m.name && Array.isArray(m.domains) && m.domains.length >= 1);
    for (const d of m.domains) assert.ok(DOMSET.has(d), `bad domain ${d}`);
  }
  for (const p of PRODUCTS) assert.ok(DOMSET.has(p.domain), `bad product domain ${p.domain}`);
});

test('THE CORRECTION: cannabis flower is the LOWEST-versatility, lowest-value material', () => {
  assert.equal(versatilityOf('flower'), 1); // only 'lifestyle'
  const others = MATERIALS.filter((m) => m.item !== 'flower' && m.item !== 'trim');
  for (const m of others) {
    assert.ok(versatilityOf(m.item) >= versatilityOf('flower'), `${m.item} less versatile than flower?`);
    assert.ok(MATERIAL_VALUE[m.item] >= MATERIAL_VALUE.flower, `${m.item} cheaper than flower?`);
  }
  // hay really is worth more than marijuana
  assert.ok(MATERIAL_VALUE.hay > MATERIAL_VALUE.flower);
  assert.ok(MATERIAL_VALUE.grain > MATERIAL_VALUE.flower);
  assert.ok(MATERIAL_VALUE.fiber > MATERIAL_VALUE.flower);
});

test('grain and fiber are the most versatile backbone', () => {
  assert.equal(versatilityOf('grain'), 4);
  assert.equal(versatilityOf('fiber'), 4);
  assert.ok(MATERIAL_VALUE.grain >= 8 && MATERIAL_VALUE.fiber >= 8);
});

test('value = labor: the whole tree passes the no-money-pump audit', () => {
  const a = auditNoPump();
  assert.equal(a.ok, true, JSON.stringify(a.offenders));
});

test('harvestMaterials yields the versatile backbone per crop', () => {
  assert.ok(harvestMaterials({ crop: 'cereal' }).materials.grain > 0);
  assert.ok(harvestMaterials({ crop: 'cereal' }).materials.straw > 0);
  assert.ok(harvestMaterials({ crop: 'hemp' }).materials.fiber > 0);
  assert.ok(harvestMaterials({ crop: 'grass' }).materials.hay > 0);
  assert.ok(harvestMaterials({ crop: 'tree' }).materials.lumber > 0);
});

test('a cannabis plot yields mostly backbone + a little (low-value) flower + quality', () => {
  const h = harvestMaterials({ crop: 'cannabis', phenotype: { yield: 78, potency: 72, aroma: 66 } });
  assert.ok(h.materials.flower > 0);
  assert.ok(h.materials.fiber > 0);           // even the weed plant gives versatile fiber
  assert.equal(h.quality.potency, 72);
});

test('the ranch feed loop crafts from hay + grain (the biggest sink)', () => {
  const inv = { hay: 4, grain: 2 };
  const feed = RECIPES.find((r) => r.id === 'mix-feed');
  assert.ok(canCraft(feed, inv));
  const after = craft(feed, inv);
  assert.equal(after.animal_feed, 1);
});

test('an empty inventory can craft nothing', () => {
  assert.deepEqual(craftable({}), []);
});

test('preroll (the low-value cannabis sink) feeds Pass a Joint', () => {
  const p = PRODUCTS.find((x) => x.item === 'preroll');
  assert.equal(p.feeds, 'pass-a-joint');
  assert.equal(p.domain, 'lifestyle');
});

test('productTree ranks materials by versatility with flower last', () => {
  const rank = productTree().versatilityRanking;
  assert.equal(rank[rank.length - 1].item === 'flower' || rank[rank.length - 1].item === 'trim', true);
  // sorted descending
  for (let i = 1; i < rank.length; i++) assert.ok(rank[i - 1].versatility >= rank[i].versatility);
});
