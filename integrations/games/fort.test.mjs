import { test } from 'node:test';
import assert from 'node:assert';
import {
  FORT_BUILDINGS, createFort, build, route, collect, craftingStationFor,
} from './fort.mjs';

test('createFort: every building starts unbuilt (level 0), inventory empty', () => {
  const fort = createFort('alice');
  assert.equal(fort.owner, 'alice');
  for (const name of Object.keys(FORT_BUILDINGS)) {
    assert.equal(fort.buildings[name].level, 0);
  }
  assert.deepEqual(fort.inventory, {});
});

test('build: consumes materials and raises the building level', () => {
  const fort = createFort('alice');
  const cost = FORT_BUILDINGS.Grove.cost(0); // { wood, seed } for level 0 → 1
  const materials = { wood: cost.wood + 5, seed: cost.seed + 2 };

  const newLevel = build(fort, 'Grove', materials);

  assert.equal(newLevel, 1, 'Grove rose to level 1');
  assert.equal(fort.buildings.Grove.level, 1);
  assert.equal(materials.wood, 5, 'wood consumed exactly');
  assert.equal(materials.seed, 2, 'seed consumed exactly');
});

test('build: throws and consumes nothing when materials fall short', () => {
  const fort = createFort('alice');
  const materials = { wood: 0, seed: 0 };
  assert.throws(() => build(fort, 'Grove', materials), /not enough/);
  assert.equal(fort.buildings.Grove.level, 0, 'level unchanged on failure');
});

test('build: cost scales with level and stops at max', () => {
  const fort = createFort('alice');
  // give plenty of materials and upgrade Grove to its ceiling
  for (let i = 0; i < FORT_BUILDINGS.Grove.maxLevel; i++) {
    build(fort, 'Grove', { wood: 1000, seed: 1000 });
  }
  assert.equal(fort.buildings.Grove.level, FORT_BUILDINGS.Grove.maxLevel);
  assert.throws(() => build(fort, 'Grove', { wood: 1000, seed: 1000 }), /max level/);
});

test('route: returns the right sub-game entry context for a built station', () => {
  const fort = createFort('alice');
  build(fort, 'Botanist', { herb: 100, water: 100 });
  collect(fort, 'potions', { herb: 4 }); // seed some inventory

  const ctx = route(fort, 'potions');
  assert.equal(ctx.subGame, 'potions');
  assert.equal(ctx.building, 'Botanist');
  assert.equal(ctx.station, 'cauldron');
  assert.equal(ctx.level, 1);
  assert.equal(ctx.owner, 'alice');
  assert.equal(ctx.inventory.herb, 4, 'route exposes a snapshot of inventory');
});

test('route: refuses an unbuilt building and an unknown sub-game', () => {
  const fort = createFort('alice');
  assert.throws(() => route(fort, 'farming'), /must be built/);
  assert.throws(() => route(fort, 'nonsense'), /no building routes/);
});

test('collect: adds sub-game outputs into the fort inventory (accumulating)', () => {
  const fort = createFort('alice');
  collect(fort, 'farming', { wood: 3, seed: 2 });
  collect(fort, 'farming', { wood: 5 });

  assert.equal(fort.inventory.wood, 8, 'quantities accumulate');
  assert.equal(fort.inventory.seed, 2);
});

test('collect: rejects non-positive outputs and unknown sub-games', () => {
  const fort = createFort('alice');
  assert.throws(() => collect(fort, 'farming', { wood: 0 }), />\s*0/);
  assert.throws(() => collect(fort, 'nope', { wood: 1 }), /unknown sub-game/);
});

test('craftingStationFor: maps recipe station ids to buildings', () => {
  assert.equal(craftingStationFor('farm'), 'Grove');
  assert.equal(craftingStationFor('cauldron'), 'Botanist');
  assert.equal(craftingStationFor('still'), 'Kitchen');
  assert.equal(craftingStationFor('routing'), 'CommandCentre');
  assert.equal(craftingStationFor('unknown-station'), null);
});

test('full loop: collect → build → route round-trips through the fort', () => {
  const fort = createFort('alice');
  // pull farming outputs back, then spend them to build the Grove, then route back in.
  collect(fort, 'farming', { wood: 10, seed: 10 });
  build(fort, 'Grove', fort.inventory); // inventory map is mutated down by build
  assert.equal(fort.buildings.Grove.level, 1);

  const ctx = route(fort, 'farming');
  assert.equal(ctx.station, 'farm');
  assert.equal(ctx.level, 1);
});
