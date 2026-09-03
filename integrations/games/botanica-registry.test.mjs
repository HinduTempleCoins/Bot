import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, itemsById, producedBy, consumedBy, chainTo, validate, REGISTRY_VERSION } from './botanica-registry.mjs';

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
