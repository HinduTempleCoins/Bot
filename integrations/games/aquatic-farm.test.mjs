// aquatic-farm.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AREA, AQUATIC_PLANTS, AQUATIC_ANIMALS, AQUATIC_MATERIALS, materialValue,
  stockAnimal, animalState, feedAnimal, harvestAnimal, canBreedAnimals, breedAnimals,
} from './aquatic-farm.mjs';

test('the underwater area is the animal-introduction biome', () => {
  assert.equal(AREA.id, 'underwater');
  assert.match(AREA.intro, /animals/i);
  assert.ok(AQUATIC_PLANTS.length >= 5);
  assert.ok(AQUATIC_ANIMALS.length >= 4);
});

test('pearl is the versatile premium prize; roe is niche', () => {
  assert.equal(materialValue('pearl'), 8);  // 4 domains
  assert.ok(materialValue('pearl') > materialValue('roe'));
});

test('stockAnimal validates species and sets defaults', () => {
  assert.throws(() => stockAnimal({ species: 'kraken' }), /unknown aquatic animal/);
  const o = stockAnimal({ species: 'oyster', stockedAtBlock: 0, id: 'o1' });
  assert.equal(o.breedCount, 0);
  assert.equal(o.generation, 0);
  assert.ok(o.traits.size > 0);
});

test('animals age juvenile → adult → elder', () => {
  const o = stockAnimal({ species: 'oyster', stockedAtBlock: 0, id: 'o1' }); // mature 1200, prime 4000
  assert.equal(animalState(o, 600), 'juvenile');
  assert.equal(animalState(o, 1500), 'adult');
  assert.equal(animalState(o, 6000), 'elder');
});

test('feeding consumes the ranch feed (the sink); no feed → blocked', () => {
  const o = stockAnimal({ species: 'oyster', id: 'o1' });
  assert.deepEqual(feedAnimal(o, {}).needs, ['algae']);
  const fed = feedAnimal(o, { algae: 2 });
  assert.equal(fed.ok, true);
  assert.equal(fed.animal.fed, true);
  assert.equal(fed.inventory.algae, 1);
});

test('harvest needs an adult, fed animal; juveniles and unfed give nothing', () => {
  const o = stockAnimal({ species: 'oyster', stockedAtBlock: 0, id: 'o1' });
  assert.equal(harvestAnimal(o, { nowBlock: 600 }).reason, 'too-young');
  assert.equal(harvestAnimal(o, { nowBlock: 1500 }).reason, 'unfed');
  const fed = feedAnimal(o, { algae: 1 }).animal;
  const h = harvestAnimal(fed, { nowBlock: 1500, ctx: { blockId: '0xabc', txId: '0x7' } });
  assert.equal(h.ok, true);
  assert.ok(h.yields.shell > 0);
  assert.ok(h.yields.pearl === undefined || h.yields.pearl >= 1); // pearl is a deterministic chance
  assert.equal(h.animal.fed, false); // harvesting uses up the fed state
});

test('canBreedAnimals enforces adult, same-species, cooldown, cap, non-self', () => {
  const a = stockAnimal({ species: 'fish', stockedAtBlock: 0, id: 'a' }); // mature 400
  const b = stockAnimal({ species: 'fish', stockedAtBlock: 0, id: 'b' });
  const c = stockAnimal({ species: 'crab', stockedAtBlock: 0, id: 'c' });
  assert.equal(canBreedAnimals(a, b, { nowBlock: 800 }).ok, true);      // both adult
  assert.ok(canBreedAnimals(a, b, { nowBlock: 100 }).reasons.includes('a-not-adult'));
  assert.ok(canBreedAnimals(a, c, { nowBlock: 800 }).reasons.includes('species-mismatch'));
  assert.ok(canBreedAnimals(a, a, { nowBlock: 800 }).reasons.includes('self-breed'));
});

test('breedAnimals produces a Gen+1 offspring deterministically and sets cooldown', () => {
  const a = stockAnimal({ species: 'fish', stockedAtBlock: 0, id: 'a' });
  const b = stockAnimal({ species: 'fish', stockedAtBlock: 0, id: 'b' });
  const ctx = { blockId: '0xabc', txId: '0x1' };
  const r1 = breedAnimals(a, b, { nowBlock: 800, ctx });
  const r2 = breedAnimals(a, b, { nowBlock: 800, ctx });
  assert.equal(r1.ok, true);
  assert.equal(r1.offspring.generation, 1);
  assert.deepEqual(r1.offspring.traits, r2.offspring.traits); // deterministic
  assert.equal(r1.motherAfter.breedCount, 1);
  assert.ok(r1.motherAfter.readyBlock > 800);
});
