// farm-items.test.mjs — OFFLINE. The Seed Shop catalog: seeds + tools + consumables, priced + kinded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shopCatalog, boostItems, itemForSymbol, isShopItem, byCategory, priceForSeed } from './farm-items.mjs';

test('shopCatalog includes seeds, tools (nft) and consumables (token), all priced', () => {
  const cat = shopCatalog();
  const cats = new Set(cat.map((i) => i.category));
  assert.ok(cats.has('seed') && cats.has('tool') && cats.has('consumable'));
  for (const i of cat) {
    assert.ok(/^[A-Z]{1,10}$/.test(i.symbol), i.symbol);
    assert.ok(['token', 'nft'].includes(i.kind));
    assert.ok(/^\d+$/.test(i.price));
  }
  // tools are durable NFTs; consumables are fungible tokens
  assert.ok(cat.filter((i) => i.category === 'tool').every((i) => i.kind === 'nft'));
  assert.ok(cat.filter((i) => i.category === 'consumable').every((i) => i.kind === 'token'));
});

test('boostItems are the non-seed items and each carries a boost effect', () => {
  const b = boostItems();
  assert.ok(b.length >= 4);
  assert.ok(b.every((i) => i.category !== 'seed'));
  assert.ok(b.every((i) => i.boost && typeof i.boost.effect === 'string'));
  assert.ok(b.some((i) => i.symbol === 'WATERCAN'));
  assert.ok(b.some((i) => i.symbol === 'COMPOST'));
});

test('itemForSymbol / isShopItem resolve (case-insensitive)', () => {
  assert.equal(itemForSymbol('goldhoe').name, 'Golden Hoe');
  assert.equal(itemForSymbol('GOLDHOE').rarity, 'legendary');
  assert.equal(isShopItem('FERTILIZER'), true);
  assert.equal(isShopItem('NOTATHING'), false);
});

test('priceForSeed scales with rarity; byCategory groups', () => {
  assert.ok(BigInt(priceForSeed({ rarity: 'legendary' })) > BigInt(priceForSeed({ rarity: 'common' })));
  const g = byCategory();
  assert.ok(g.seed.length >= 10 && g.tool.length >= 1 && g.consumable.length >= 1);
});
