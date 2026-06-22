/**
 * seeds.test.mjs — offline unit test for THE SEED MINT (seeds.mjs).
 * Exercises both kinds end-to-end: register → mint → plant, for a fungible token seed and an NFT seed.
 * Run: node --test engine/contracts/seeds.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { seeds } from './seeds.mjs';
import { config } from '../config.mjs';

function fresh() { const s = new State(null); bootstrapGenesis(s); return s; }
const ctx = (sender, blockNum = 1, txId = 't') => ({ sender, blockNum, blockId: 'b', txId, authLevel: 'active' });
const MINTER = config.seeds.minter; // 'hathor' on testnet
const tokenBal = (s, account, symbol) => { const r = s.findOne('balances', { account, symbol }); return r ? r.balance : null; };
const nftCount = (s, account, tokenId) => { const r = s.findOne('nftBalances', { account, collection: config.seeds.collection, tokenId }); return r ? r.count : null; };

test('register a TOKEN seed → mint to a grower → plant (burn)', () => {
  const s = fresh();
  const reg = seeds.register(s, ctx(MINTER), { symbol: 'AUTOSOUR', kind: 'token', name: 'Auto Sour', maxSupply: '100000000', growTier: 'day', rarity: 'common' });
  assert.ok(reg.ok, reg.error);
  assert.equal(reg.kind, 'token');
  assert.ok(s.findOne('tokens', { symbol: 'AUTOSOUR' }), 'underlying token created');

  const m = seeds.mint(s, ctx(MINTER), { to: 'bob', symbol: 'AUTOSOUR', quantity: '500' });
  assert.ok(m.ok, m.error);
  assert.equal(m.kind, 'token');
  assert.equal(tokenBal(s, 'bob', 'AUTOSOUR'), '500'); // precision 0 → base units == whole

  const plant = seeds.plant(s, ctx('bob', 2, 'plant-tx'), { symbol: 'AUTOSOUR', quantity: '10' });
  assert.ok(plant.ok, plant.error);
  assert.equal(tokenBal(s, 'bob', 'AUTOSOUR'), '490');
  const log = s.findOne('plantLog', { txId: 'plant-tx' });
  assert.ok(log && log.kind === 'token' && log.quantity === '10');
});

test('register an NFT seed → mint editions → plant (burn) reduces supply', () => {
  const s = fresh();
  const reg = seeds.register(s, ctx(MINTER), { symbol: 'PUNICGOLD', kind: 'nft', name: 'Punic Gold', maxSupply: '500', rarity: 'legendary', growTier: 'year', traits: { rarity: 'legendary', growTier: 'year' } });
  assert.ok(reg.ok, reg.error);
  assert.equal(reg.kind, 'nft');
  assert.equal(reg.collection, config.seeds.collection);
  assert.ok(s.findOne('nftCollections', { collection: config.seeds.collection }), 'collection auto-created');
  assert.ok(s.findOne('nftTypes', { collection: config.seeds.collection, tokenId: 'PUNICGOLD' }), 'type defined');

  const m = seeds.mint(s, ctx(MINTER), { to: 'bob', symbol: 'PUNICGOLD', quantity: '3' });
  assert.ok(m.ok, m.error);
  assert.equal(m.kind, 'nft');
  assert.equal(nftCount(s, 'bob', 'PUNICGOLD'), '3');

  const plant = seeds.plant(s, ctx('bob', 2, 'plant-nft'), { symbol: 'PUNICGOLD', quantity: '1' });
  assert.ok(plant.ok, plant.error);
  assert.equal(nftCount(s, 'bob', 'PUNICGOLD'), '2');
  assert.equal(s.findOne('nftTypes', { collection: config.seeds.collection, tokenId: 'PUNICGOLD' }).supply, '2');
});

test('only the minter may register and mint', () => {
  const s = fresh();
  assert.equal(seeds.register(s, ctx('mallory'), { symbol: 'EVIL', kind: 'token', maxSupply: '1' }).ok, false);
  seeds.register(s, ctx(MINTER), { symbol: 'VANKUSH', kind: 'token', maxSupply: '1000000' });
  const notMinter = seeds.mint(s, ctx('mallory'), { to: 'mallory', symbol: 'VANKUSH', quantity: '1' });
  assert.equal(notMinter.ok, false);
  assert.match(notMinter.error, /minter/);
});

test('soft-fails: unregistered seed, duplicate register, over-plant', () => {
  const s = fresh();
  assert.equal(seeds.mint(s, ctx(MINTER), { to: 'bob', symbol: 'GHOST', quantity: '1' }).ok, false);
  assert.equal(seeds.plant(s, ctx('bob'), { symbol: 'GHOST', quantity: '1' }).ok, false);
  seeds.register(s, ctx(MINTER), { symbol: 'DIESEL', kind: 'token', maxSupply: '1000000' });
  assert.equal(seeds.register(s, ctx(MINTER), { symbol: 'DIESEL', kind: 'token', maxSupply: '1' }).ok, false); // dup
  seeds.mint(s, ctx(MINTER), { to: 'bob', symbol: 'DIESEL', quantity: '5' });
  assert.equal(seeds.plant(s, ctx('bob'), { symbol: 'DIESEL', quantity: '999' }).ok, false); // more than held
});
