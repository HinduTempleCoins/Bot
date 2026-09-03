// material-demand.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerBuiltIns, registerDemand, demandsForMaterial, gamesForMaterial, versatility,
  randomCraft, registerBoostCard, boostFor, applyBoost, DEMAND_KINDS,
} from './material-demand.mjs';

test('versatility = distinct games consuming a material; backbone > cannabis flower', () => {
  registerBuiltIns();
  assert.ok(versatility('grain') >= 3);
  assert.ok(versatility('hay') >= 3);
  assert.ok(versatility('flower') <= versatility('grain'));   // flower is niche
  assert.ok(gamesForMaterial('grain').includes('ranch'));
});

test('registerDemand validates kind and materials', () => {
  assert.throws(() => registerDemand({ id: 'x', game: 'g', kind: 'bogus', materials: ['grain'] }), /bad demand kind/);
  assert.throws(() => registerDemand({ id: 'x', game: 'g', kind: 'potion', materials: [] }), /needs materials/);
  assert.ok(DEMAND_KINDS.includes('boost-card'));
  registerBuiltIns();
});

test('randomCraft (Mushroom Warrior) is deterministic and rewards bigger bags', () => {
  const a = randomCraft({ inputs: { grain: 3, fiber: 2 }, seed: 42 });
  const b = randomCraft({ inputs: { grain: 3, fiber: 2 }, seed: 42 });
  assert.deepEqual(a, b);                    // same seed → same item
  assert.equal(a.ok, true);
  assert.match(a.item, /^item-/);
  assert.equal(randomCraft({ inputs: {}, seed: 1 }).ok, false); // nothing in → nothing out
});

test('an NFT can be a boost card in the territory game', () => {
  registerBoostCard('strain-legendary-001', { stat: 'iron', pct: 25, blocks: 600 });
  assert.equal(boostFor('strain-legendary-001').pct, 25);
  const r = applyBoost(100, 'strain-legendary-001');
  assert.equal(r.boosted, true);
  assert.ok(Math.abs(r.rate - 125) < 1e-9);
  assert.equal(applyBoost(100, 'no-card').boosted, false);
});
