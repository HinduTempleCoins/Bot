// seed-tokens.test.mjs — OFFLINE. The grow-game ↔ NFT bridge: every seed is an NFT type with a valid symbol/
// token-id + traits; reading wallet holdings keeps only the seed NFTs you own (count > 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCatalog, seedSymbols, isSeedSymbol, seedForSymbol, symbolForStrain, ownedSeeds, SEED_COLLECTION } from './seed-tokens.mjs';

test('seedCatalog: every seed NFT has a valid SYMBOL/token-id (A-Z, <=10), a collection + traits', () => {
  const cat = seedCatalog();
  assert.ok(cat.length >= 10);
  for (const s of cat) {
    assert.match(s.symbol, /^[A-Z]{1,10}$/);
    assert.equal(s.tokenId, s.symbol);
    assert.equal(s.collection, s.kind === 'nft' ? SEED_COLLECTION : null);   // only NFTs carry a collection
    assert.ok(s.name && s.growTier && s.rarity);
    assert.ok(['year-round', 'spring', 'summer', 'autumn', 'winter'].includes(s.season));
  }
  // token-ids are unique
  assert.equal(new Set(cat.map((s) => s.symbol)).size, cat.length);
  // every seed is one of the two kinds; abundant→token, scarce→nft (rarity default)
  for (const s of cat) assert.ok(s.kind === 'token' || s.kind === 'nft');
  assert.equal(cat.find((s) => s.id === 'auto-sour').kind, 'token');   // common = fungible "milk"
  assert.equal(cat.find((s) => s.id === 'punic-gold').kind, 'nft');    // legendary = collectable NFT
  assert.equal(cat.find((s) => s.id === 'auto-sour').collection, null); // tokens carry no NFT collection
});

test('isSeedSymbol / seedForSymbol / symbolForStrain resolve the mapping both ways', () => {
  assert.equal(symbolForStrain('van-kush'), 'VANKUSH');
  assert.equal(isSeedSymbol('VANKUSH'), true);
  assert.equal(isSeedSymbol('vankush'), true);       // case-insensitive
  assert.equal(isSeedSymbol('MELEK'), false);        // not a seed
  assert.equal(seedForSymbol('VANKUSH').id, 'van-kush');
  assert.equal(seedForSymbol('NOPE'), null);
  assert.equal(symbolForStrain('not-a-strain'), '');
});

test('ownedSeeds keeps only seed NFTs you actually hold (count > 0), enriched with traits', () => {
  const holdings = [
    { symbol: 'MELEK', balance: '100' },                 // not a seed → dropped
    { symbol: 'VANKUSH', balance: '3' },                 // a seed you own ×3
    { tokenId: 'AUTOSOUR', count: '900' },               // a seed by tokenId/count
    { symbol: 'PUNICGOLD', balance: '0' },               // a seed you own 0 of → dropped
    { symbol: 'KULA', qty: '5' },                        // not a seed → dropped
  ];
  const out = ownedSeeds(holdings);
  assert.equal(out.length, 2);
  const van = out.find((s) => s.symbol === 'VANKUSH');
  assert.equal(van.owned, '3');
  assert.equal(van.name, 'Van Kush');
  assert.equal(van.kind, 'token');                        // uncommon = fungible
  assert.equal(out.find((s) => s.symbol === 'AUTOSOUR').owned, '900');
  assert.ok(!out.some((s) => s.symbol === 'PUNICGOLD'));  // zero-owned excluded
  // a seed appearing on both source lists is counted once
  assert.equal(ownedSeeds([{ symbol: 'VANKUSH', balance: '3' }, { symbol: 'VANKUSH', balance: '3' }]).length, 1);
  assert.deepEqual(ownedSeeds([]), []);
  assert.deepEqual(ownedSeeds(null), []);
});

test('seedSymbols is a Set covering the catalog', () => {
  const set = seedSymbols();
  assert.ok(set instanceof Set);
  assert.ok(set.has('PUNICGOLD'));
  assert.equal(set.size, seedCatalog().length);
});
