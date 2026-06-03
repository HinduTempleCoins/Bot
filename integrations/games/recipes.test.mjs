import { test } from 'node:test';
import assert from 'node:assert';
import {
  RECIPES,
  canCraft,
  craft,
  consume,
  learnRecipe,
  validateNoMoneyPump,
} from './recipes.mjs';

const r = (id) => RECIPES.find((x) => x.id === id);

test('canCraft: true with enough inputs, false when short', () => {
  const smelt = r('smelt-ingot'); // 3 ore + 1 coal
  assert.equal(canCraft(smelt, { ore: 3, coal: 1 }), true);
  assert.equal(canCraft(smelt, { ore: 2, coal: 1 }), false); // short on ore
  assert.equal(canCraft(smelt, {}), false);
});

test('craft: consumes inputs and produces output (PURE, no mutation)', () => {
  const smelt = r('smelt-ingot');
  const inv = { ore: 5, coal: 2, gold: 9 };
  const out = craft(smelt, inv);
  // inputs consumed
  assert.equal(out.ore, 2);
  assert.equal(out.coal, 1);
  // output produced
  assert.equal(out.ingot, 1);
  // unrelated item untouched
  assert.equal(out.gold, 9);
  // original inventory NOT mutated
  assert.equal(inv.ore, 5);
  assert.equal(inv.ingot, undefined);
});

test('craft: throws when inputs are missing', () => {
  assert.throws(() => craft(r('forge-blade'), { ingot: 1 }));
});

test('consume: destroys the item on use (deflation sink)', () => {
  const inv = { potion: 2, bread: 1 };
  const after1 = consume('potion', inv);
  assert.equal(after1.potion, 1);
  // consuming the last unit removes the key entirely (gone from circulation)
  const after2 = consume('bread', after1);
  assert.equal(after2.bread, undefined);
  // original not mutated
  assert.equal(inv.potion, 2);
  // cannot consume what you don't have
  assert.throws(() => consume('sword', inv));
});

test('learnRecipe: unlocks the recipe and burns the NFT', () => {
  const user = {};
  learnRecipe(user, 'nft-001');
  assert.ok(user.learned.has('smelt-ingot')); // unlocked (permanent flag)
  assert.ok(user.burnedNfts.has('nft-001')); // NFT burned
});

test('learnRecipe: cannot redeem the same NFT twice (burned guard)', () => {
  const user = {};
  learnRecipe(user, 'nft-002');
  assert.throws(() => learnRecipe(user, 'nft-002'), /already burned/);
});

test('validateNoMoneyPump: passes on the shipped recipe web', () => {
  const audit = validateNoMoneyPump();
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.offenders, []);
});

test('validateNoMoneyPump: flags a recipe whose output out-values inputs + effort', () => {
  const pump = {
    id: 'gold-printer',
    inputs: [{ item: 'ore', qty: 1 }], // value 1
    output: { item: 'blade', qty: 1 }, // value 18
    station: 'forge',
    effort: 1,
  };
  const audit = validateNoMoneyPump([pump]);
  assert.equal(audit.ok, false);
  assert.equal(audit.offenders.length, 1);
  assert.equal(audit.offenders[0].id, 'gold-printer');
  assert.ok(audit.offenders[0].surplus > 0);
});
