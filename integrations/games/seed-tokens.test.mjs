// seed-tokens.test.mjs — OFFLINE. The grow-game ↔ engine-token bridge: every seed has a valid engine symbol,
// filtering wallet balances keeps only seeds, enriched with grow metadata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedCatalog, seedSymbols, isSeedSymbol, seedForSymbol, symbolForStrain, filterSeedBalances } from './seed-tokens.mjs';

test('seedCatalog: every seed has a valid engine SYMBOL (A-Z, <=10) + grow metadata', () => {
  const cat = seedCatalog();
  assert.ok(cat.length >= 10);
  for (const s of cat) {
    assert.match(s.symbol, /^[A-Z]{1,10}$/);
    assert.ok(s.name && s.growTier && s.rarity);
    assert.ok(['year-round', 'spring', 'summer', 'autumn', 'winter'].includes(s.season));
  }
  // symbols are unique
  assert.equal(new Set(cat.map((s) => s.symbol)).size, cat.length);
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

test('filterSeedBalances keeps only seed tokens and enriches them', () => {
  const balances = [
    { symbol: 'MELEK', balance: '100', stake: '0' },     // not a seed → dropped
    { symbol: 'VANKUSH', balance: '12.5', stake: '3' },  // a seed
    { symbol: 'AUTOSOUR', balance: '900' },              // a seed, no stake field
    { symbol: 'KULA', balance: '5' },                    // not a seed → dropped
  ];
  const out = filterSeedBalances(balances);
  assert.equal(out.length, 2);
  const van = out.find((s) => s.symbol === 'VANKUSH');
  assert.equal(van.liquid, '12.5');
  assert.equal(van.staked, '3');
  assert.equal(van.name, 'Van Kush');
  const auto = out.find((s) => s.symbol === 'AUTOSOUR');
  assert.equal(auto.staked, '0');                        // defaults when absent
  assert.deepEqual(filterSeedBalances([]), []);
  assert.deepEqual(filterSeedBalances(null), []);
});

test('seedSymbols is a Set covering the catalog', () => {
  const set = seedSymbols();
  assert.ok(set instanceof Set);
  assert.ok(set.has('PUNICGOLD'));
  assert.equal(set.size, seedCatalog().length);
});
