/**
 * nft.test.mjs — offline unit test for the Melek-Engine NFT contract.
 * Run: node --test engine/contracts/nft.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { nft } from './nft.mjs';

function fresh() { const s = new State(null); bootstrapGenesis(s); return s; }
const ctx = (sender, blockNum = 1) => ({ sender, blockNum, blockId: 'b', txId: 't', authLevel: 'active' });
const countOf = (s, account, collection, tokenId) => {
  const r = s.findOne('nftBalances', { account, collection, tokenId });
  return r ? r.count : null;
};

test('createCollection → defineType → mint → an account owns editions', () => {
  const s = fresh();
  assert.ok(nft.createCollection(s, ctx('hathor'), { collection: 'KUSHSEED', name: 'Kush Seeds' }).ok);
  assert.ok(nft.defineType(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'PUNICGOLD', name: 'Punic Gold', traits: { rarity: 'legendary' }, maxSupply: '500' }).ok);
  const m = nft.mint(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'PUNICGOLD', to: 'bob', quantity: '3' });
  assert.ok(m.ok, m.error);
  assert.equal(countOf(s, 'bob', 'KUSHSEED', 'PUNICGOLD'), '3');
  assert.equal(s.findOne('nftTypes', { collection: 'KUSHSEED', tokenId: 'PUNICGOLD' }).supply, '3');
  assert.deepEqual(s.findOne('nftTypes', { collection: 'KUSHSEED', tokenId: 'PUNICGOLD' }).traits, { rarity: 'legendary' });
});

test('only the collection issuer can defineType / mint', () => {
  const s = fresh();
  nft.createCollection(s, ctx('hathor'), { collection: 'KUSHSEED' });
  assert.equal(nft.defineType(s, ctx('mallory'), { collection: 'KUSHSEED', tokenId: 'X', maxSupply: '1' }).ok, false);
  nft.defineType(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'X', maxSupply: '10' });
  assert.equal(nft.mint(s, ctx('mallory'), { collection: 'KUSHSEED', tokenId: 'X', to: 'bob', quantity: '1' }).ok, false);
});

test('edition cap is enforced', () => {
  const s = fresh();
  nft.createCollection(s, ctx('hathor'), { collection: 'KUSHSEED' });
  nft.defineType(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'RARE', maxSupply: '2', capImmutable: true });
  assert.ok(nft.mint(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'RARE', to: 'bob', quantity: '2' }).ok);
  const over = nft.mint(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'RARE', to: 'bob', quantity: '1' });
  assert.equal(over.ok, false);
  assert.match(over.error, /cap/);
});

test('transfer + burn move and destroy editions; burn reduces supply', () => {
  const s = fresh();
  nft.createCollection(s, ctx('hathor'), { collection: 'KUSHSEED' });
  nft.defineType(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'X', maxSupply: '0' }); // uncapped
  nft.mint(s, ctx('hathor'), { collection: 'KUSHSEED', tokenId: 'X', to: 'bob', quantity: '5' });
  assert.ok(nft.transfer(s, ctx('bob'), { collection: 'KUSHSEED', tokenId: 'X', to: 'carol', quantity: '2' }).ok);
  assert.equal(countOf(s, 'bob', 'KUSHSEED', 'X'), '3');
  assert.equal(countOf(s, 'carol', 'KUSHSEED', 'X'), '2');
  assert.ok(nft.burn(s, ctx('bob'), { collection: 'KUSHSEED', tokenId: 'X', quantity: '1' }).ok);
  assert.equal(countOf(s, 'bob', 'KUSHSEED', 'X'), '2');
  assert.equal(s.findOne('nftTypes', { collection: 'KUSHSEED', tokenId: 'X' }).supply, '4'); // 5 minted − 1 burned
});

test('soft-fails (no throw) on bad input', () => {
  const s = fresh();
  assert.equal(nft.createCollection(s, ctx('hathor'), { collection: 'bad lower' }).ok, false);
  assert.equal(nft.defineType(s, ctx('hathor'), { collection: 'NOPE', tokenId: 'X' }).ok, false);
  assert.equal(nft.mint(s, ctx('hathor'), { collection: 'NOPE', tokenId: 'X', to: 'b', quantity: '1' }).ok, false);
  nft.createCollection(s, ctx('hathor'), { collection: 'C' });
  nft.defineType(s, ctx('hathor'), { collection: 'C', tokenId: 'T', maxSupply: '0' });
  assert.equal(nft.mint(s, ctx('hathor'), { collection: 'C', tokenId: 'T', to: 'b', quantity: '0' }).ok, false);
  assert.equal(nft.mint(s, ctx('hathor'), { collection: 'C', tokenId: 'T', to: 'b', quantity: '1.5' }).ok, false);
});
