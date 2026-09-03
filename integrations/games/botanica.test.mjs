// botanica.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEMS, ITEM_TYPES, EFFECT_STATS, ITEM_VALUE, ITEM_RECIPES,
  canCraftItem, craftItem, applyEffect, isGiftable, bazaar, auditNoPump,
} from './botanica.mjs';

test('items are well-formed: valid type, effect stat, and recipe', () => {
  assert.ok(ITEMS.length >= 8);
  for (const i of ITEMS) {
    assert.ok(ITEM_TYPES.includes(i.type), `bad type ${i.type}`);
    assert.ok(EFFECT_STATS[i.effect.stat], `unknown effect stat ${i.effect.stat}`);
    assert.ok(['persistent', 'consumable'].includes(i.effect.kind));
    assert.ok(Array.isArray(i.recipe) && i.recipe.length >= 1);
  }
});

test('every effect maps to a real game system (cross-game versatility)', () => {
  const systems = new Set(ITEMS.map((i) => i.effect.stat));
  for (const s of ['grow-speed', 'yield', 'breed-luck', 'craft-luck', 'territory', 'vibes']) {
    assert.ok(systems.has(s), `no item buffs ${s}`);
  }
});

test('item recipes obey value = labor (no money pump); items are terminal sinks', () => {
  const a = auditNoPump();
  assert.equal(a.ok, true, JSON.stringify(a.offenders));
});

test('crafting a talisman consumes materials and mints the item', () => {
  assert.equal(canCraftItem('talisman_verdant', { essential_oil: 1, resin: 1 }), true);
  assert.equal(canCraftItem('talisman_verdant', { essential_oil: 1 }), false);
  const after = craftItem('talisman_verdant', { essential_oil: 1, resin: 1, grain: 5 });
  assert.equal(after.talisman_verdant, 1);
  assert.equal(after.essential_oil, undefined); // consumed
  assert.equal(after.grain, 5);                 // untouched
});

test('applyEffect buffs the base stat by the item percentage', () => {
  const r = applyEffect(100, 'talisman_verdant'); // +12% grow-speed
  assert.ok(Math.abs(r.value - 112) < 1e-9);
  assert.equal(r.stat, 'grow-speed');
  assert.equal(r.kind, 'persistent');
  assert.equal(applyEffect(100, 'nope').applied, false);
});

test('a territory item is a timed boost for the castle game', () => {
  const r = applyEffect(100, 'oil_ward');
  assert.equal(r.stat, 'territory');
  assert.ok(Math.abs(r.value - 120) < 1e-9);
  assert.equal(r.blocks, 600);
});

test('cannabis items (cart/dab) are the giftable, low-value lifestyle corner', () => {
  assert.equal(isGiftable('cart'), true);
  assert.equal(isGiftable('dab'), true);
  assert.equal(isGiftable('talisman_verdant'), false);
  // their effect is a small vibes bump, not an economic buff
  assert.equal(ITEMS.find((i) => i.id === 'cart').effect.stat, 'vibes');
});

test('bazaar lists every item with its effect, the system it touches, and a price', () => {
  const b = bazaar();
  assert.equal(b.length, ITEMS.length);
  for (const row of b) {
    assert.ok(row.effect.includes('%'));
    assert.ok(row.system && row.price > 0);
  }
  assert.ok(b.some((r) => r.giftable)); // carts/dabs
});
