import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, itemsById, producedBy, consumedBy, chainTo, validate, factorItems, sinkItems, REGISTRY_VERSION } from './botanica-registry.mjs';

const REG = buildRegistry();

test('the registry collects every catalog into one view', () => {
  assert.equal(REG.version, REGISTRY_VERSION);
  assert.ok(REG.items.length > 100, `only ${REG.items.length} items`);
  assert.ok(REG.recipes.length > 40);
  assert.ok(REG.plants.length > 40);
  assert.ok(REG.stations.includes('kiln') && REG.stations.includes('still'));
});

test('it is internally consistent — no orphan inputs, no unreachable goods', () => {
  const v = validate(REG);
  assert.equal(v.orphanInputs.length, 0, JSON.stringify(v.orphanInputs.slice(0, 5)));
  assert.equal(v.unreachable.length, 0, JSON.stringify(v.unreachable.slice(0, 5)));
  assert.equal(v.duplicateRecipeIds.length, 0, JSON.stringify(v.duplicateRecipeIds));
  assert.equal(v.ok, true);
});

test('items record every catalog that named them', () => {
  const by = itemsById(REG);
  assert.ok(by.grain, 'grain must exist');
  assert.ok(by.grain.sources.includes('plant-catalog'));
  assert.ok(by.grain.domains.includes('food'));
});

test('the soap chain is intact: timber to ash to potash to lye', () => {
  assert.ok(producedBy(REG, 'ash').some((r) => r.inputs.some((i) => i.item === 'timber')));
  assert.ok(producedBy(REG, 'potash').some((r) => r.inputs.some((i) => i.item === 'ash')));
  assert.ok(producedBy(REG, 'lye').some((r) => r.inputs.some((i) => i.item === 'potash')));
  assert.ok(consumedBy(REG, 'ash').length > 0);
});

test('chainTo walks a production chain backwards without looping forever', () => {
  const chain = chainTo(REG, 'lye', 6);
  assert.ok(chain.length >= 3, `chain too short: ${chain.length}`);
  const outputs = chain.map((r) => r.output.item);
  assert.ok(outputs.includes('lye') && outputs.includes('potash') && outputs.includes('ash'));
  assert.deepEqual(chainTo(REG, 'nothing_here', 4), []);
  assert.deepEqual(chainTo(REG, 'lye', 0).length >= 1, true);
});

test('plants declare what they yield, and those yields are real items', () => {
  const by = itemsById(REG);
  const wheat = REG.plants.find((p) => p.id === 'wheat');
  assert.ok(wheat);
  assert.ok(wheat.yields.includes('grain'));
  for (const p of REG.plants) for (const y of p.yields) assert.ok(by[y], `${p.id} yields unknown ${y}`);
});

test('every recipe output and input is a registered item', () => {
  const by = itemsById(REG);
  for (const r of REG.recipes) {
    assert.ok(by[r.output.item], `output ${r.output.item} unregistered`);
    for (const i of r.inputs) assert.ok(by[i.item], `input ${i.item} unregistered`);
  }
});

test('anything a recipe makes is classed as a good', () => {
  const by = itemsById(REG);
  for (const r of REG.recipes) assert.equal(by[r.output.item].kind, 'good', r.output.item);
});

test('queries soft-fail on nonsense', () => {
  assert.deepEqual(producedBy(REG, ''), []);
  assert.deepEqual(consumedBy(null, 'grain'), []);
  assert.deepEqual(producedBy(null, null), []);
  assert.doesNotThrow(() => validate(null));
  assert.doesNotThrow(() => itemsById(null));
});

// ── v2: the non-growing factors ─────────────────────────────────────────────────────────────────
test('the registry carries the non-growing factor classes', () => {
  assert.equal(REGISTRY_VERSION, 2);
  for (const cls of ['mineral', 'burnable', 'vessel', 'made']) {
    assert.ok(factorItems(REG, cls).length >= 5, `${cls}: ${factorItems(REG, cls).length}`);
  }
  // the fifth class is the plant catalog, not a duplicate list
  assert.equal(factorItems(REG, 'grown').length, REG.plants.length);
  assert.ok(factorItems(REG).length >= 30);
});

test('diatomaceous earth is in the one canonical registry, both grades', () => {
  const by = itemsById(REG);
  assert.ok(by.de_food_grade, 'food-grade DE missing from the registry');
  assert.ok(by.de_calcined, 'calcined DE missing from the registry');
  assert.equal(by.de_food_grade.factorClass, 'mineral');
  assert.ok(by.de_food_grade.sources.includes('botanica-factors'));
});

test('pottery and burnables reach the registry with their class intact', () => {
  const by = itemsById(REG);
  assert.equal(by.offering_bowl.factorClass, 'vessel');
  assert.equal(by.murti_small.factorClass, 'vessel');
  assert.equal(by.incense_stick.factorClass, 'burnable');
  assert.equal(by.vibhuti.factorClass, 'made');
  // and they are craftable through the same recipe graph as everything else
  assert.ok(producedBy(REG, 'offering_bowl').length > 0);
  assert.ok(consumedBy(REG, 'clay_body').length > 0);
});

test('the pottery chain resolves backwards to its minerals', () => {
  const chain = chainTo(REG, 'offering_bowl', 6).map((r) => r.output.item);
  assert.ok(chain.includes('offering_bowl'));
  assert.ok(chain.includes('glaze_frit'), 'the bowl should pull in its frit');
});

test('sinkItems names what is destroyed on use', () => {
  const sinks = sinkItems(REG).map((i) => i.id);
  assert.ok(sinks.includes('incense_stick'));
  assert.ok(sinks.includes('de_food_grade'));
  assert.ok(!sinks.includes('terracotta_planter'), 'a durable is not a sink');
  assert.ok(!sinks.includes('murti_small'), 'a murti is not consumed');
});

test('the factor queries soft-fail like the rest of the registry', () => {
  assert.deepEqual(factorItems(null), []);
  assert.deepEqual(factorItems(REG, 'nope'), []);
  assert.deepEqual(sinkItems(null), []);
});
