import { test } from 'node:test';
import assert from 'node:assert';
import {
  RARITY, RARITY_LADDER, rarityWeight, createAsset,
  acquire, listForSale, sell, ownedBy, createStore,
} from './economy.mjs';

test('rarity weights are ordered: Common most likely → Legendary least', () => {
  const weights = RARITY_LADDER.map(rarityWeight);
  for (let i = 1; i < weights.length; i++) {
    assert.ok(weights[i] < weights[i - 1], `${RARITY_LADDER[i]} should be rarer than ${RARITY_LADDER[i - 1]}`);
  }
  assert.equal(rarityWeight('Nonsense'), 0, 'unknown rarity has zero weight');
});

test('acquire → asset appears in owner roster, unlisted', () => {
  const store = createStore();
  const sword = createAsset({ type: 'sword', rarity: RARITY.RARE });
  acquire(sword, 'alice', store);

  const roster = ownedBy('alice', store);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].id, sword.id);
  assert.equal(roster[0].ownerId, 'alice');
  assert.equal(roster[0].listed, false);
  assert.equal(ownedBy('bob', store).length, 0);
});

test('list → sell transfers ownership and clears the listing', () => {
  const store = createStore();
  const shield = createAsset({ type: 'shield', rarity: RARITY.EPIC });
  acquire(shield, 'alice', store);

  listForSale(shield, 25, store);
  assert.equal(shield.listed, true);
  assert.equal(shield.price, 25);

  sell(shield, 'bob', store);
  assert.equal(shield.ownerId, 'bob', 'ownership moved to buyer');
  assert.equal(shield.listed, false, 'listing cleared');
  assert.equal(shield.price, 0);

  assert.equal(ownedBy('alice', store).length, 0, 'gone from seller roster');
  assert.equal(ownedBy('bob', store).length, 1, 'in buyer roster');
});

test("can't sell an unowned asset", () => {
  const store = createStore();
  const gem = createAsset({ type: 'gem', rarity: RARITY.LEGENDARY });
  // never acquired, so not in store and ownerId null
  assert.throws(() => sell(gem, 'bob', store), /unknown asset|unowned/);
});

test("can't sell an asset that isn't listed", () => {
  const store = createStore();
  const ring = createAsset({ type: 'ring', rarity: RARITY.UNCOMMON });
  acquire(ring, 'alice', store);
  assert.throws(() => sell(ring, 'bob', store), /not listed/);
});

test('createAsset rejects unknown rarity and missing type', () => {
  assert.throws(() => createAsset({ type: 'x', rarity: 'Mythic' }), /unknown rarity/);
  assert.throws(() => createAsset({ rarity: RARITY.COMMON }), /type is required/);
});
