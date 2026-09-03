import test from 'node:test';
import assert from 'node:assert/strict';
import {
  policyFor, metadataFor, salePrice, emptyLedger, supplyOf, remaining, phaseOf,
  canBuy, recordSale, canManufacture, recordManufacture,
} from './item-nft.mjs';
import { manufactureRecipe, variantById } from './tools-catalog.mjs';

const V = 'iron_pickaxe';
const RECIPE = manufactureRecipe('pickaxe', 'iron');
const FORGE_CTX = (over = {}) => ({
  station: 'forge',
  skills: { smithing: RECIPE.level },
  inventory: { ...RECIPE.materials },
  ...over,
});

test('policy splits one cap between a minority sale and the rest', () => {
  const p = policyFor(V);
  assert.equal(p.variantId, V);
  assert.equal(p.saleAllocation + p.manufactureAllocation, p.cap);
  assert.ok(p.saleAllocation < p.manufactureAllocation, 'the sale must be the minority slice');
  assert.equal(policyFor('not_a_thing'), null);
});

test('scarcity rises with tier rank', () => {
  const caps = ['clay_pickaxe', 'iron_pickaxe', 'star_iron_pickaxe'].map((v) => policyFor(v).cap);
  assert.ok(caps[0] > caps[1] && caps[1] > caps[2], `caps not descending: ${caps}`);
});

test('policy overrides are honoured and sanitised', () => {
  assert.equal(policyFor(V, { baseCap: 100, salePortion: 0.5 }).cap, Math.round(100 / 8));
  assert.equal(policyFor(V, { salePortion: 9 }).saleAllocation, policyFor(V, { salePortion: 9 }).cap);
  assert.equal(policyFor(V, { salePortion: -1 }).saleAllocation, 0);
  assert.equal(policyFor(V, { baseCap: 0 }).cap, 1);
});

test('sale price stays above the scrap value of its own inputs', () => {
  const price = salePrice(V);
  assert.ok(price > RECIPE.scrapValue, `${price} must exceed scrap ${RECIPE.scrapValue}`);
  assert.equal(price, Math.round(RECIPE.scrapValue * 2.5));
  assert.equal(salePrice('nope'), 0);
  // Even with a degenerate premium the price never drops to zero.
  assert.ok(salePrice(V, { salePremium: 0 }) >= 1);
});

test('metadata describes the same numbers the game runs on', () => {
  const m = metadataFor(V);
  const v = variantById(V);
  assert.equal(m.name, v.name);
  const attr = Object.fromEntries(m.attributes.map((a) => [a.trait_type, a.value]));
  assert.equal(attr.Skill, v.skill);
  assert.equal(attr.Level, v.level);
  assert.equal(attr.Durability, v.durability);
  assert.deepEqual(m.recipe, RECIPE);
  assert.equal(metadataFor('nope'), null);
});

test('a fresh ledger is empty and opens in the sale phase', () => {
  const l = emptyLedger();
  assert.deepEqual(supplyOf(l, V), { sale: 0, manufacture: 0, total: 0 });
  assert.equal(phaseOf(l, V), 'sale');
  const left = remaining(l, V);
  assert.equal(left.total, policyFor(V).cap);
});

test('recordSale mints and never mutates the ledger it was given', () => {
  const before = emptyLedger();
  const r = recordSale(before, V, 3, 'buyer-1');
  assert.equal(r.ok, true);
  assert.equal(r.qty, 3);
  assert.equal(r.total, salePrice(V) * 3);
  assert.deepEqual(supplyOf(before, V), { sale: 0, manufacture: 0, total: 0 }, 'input ledger mutated');
  assert.equal(supplyOf(r.ledger, V).sale, 3);
  assert.equal(r.ledger[V].mints.length, 3);
  assert.ok(r.ledger[V].mints.every((m) => m.origin === 'sale' && m.owner === 'buyer-1'));
});

test('the sale cannot exceed its allocation', () => {
  const alloc = policyFor(V).saleAllocation;
  let l = emptyLedger();
  l = recordSale(l, V, alloc).ledger;
  assert.equal(supplyOf(l, V).sale, alloc);
  const over = canBuy(l, V, 1);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'sale_allocation_exhausted');
  // ...and the phase rolls to manufacture rather than closing.
  assert.equal(phaseOf(l, V), 'manufacture');
});

test('buying rejects nonsense quantities and unknown items', () => {
  const l = emptyLedger();
  assert.equal(canBuy(l, V, 0).reason, 'bad_quantity');
  assert.equal(canBuy(l, V, -5).reason, 'bad_quantity');
  assert.equal(canBuy(l, 'nope', 1).reason, 'unknown_item');
  assert.equal(recordSale(l, 'nope', 1).ok, false);
});

test('manufacture mints, consumes the materials and returns the new inventory', () => {
  const ctx = FORGE_CTX({ inventory: { iron_bar: 5, timber: 2 } });
  const r = recordManufacture(emptyLedger(), V, 'maker-1', ctx);
  assert.equal(r.ok, true);
  assert.equal(supplyOf(r.ledger, V).manufacture, 1);
  assert.equal(r.ledger[V].mints[0].origin, 'manufacture');
  assert.equal(r.inventory.iron_bar, 5 - RECIPE.materials.iron_bar);
  assert.equal(r.inventory.timber, 2 - RECIPE.materials.timber);
  assert.deepEqual(ctx.inventory, { iron_bar: 5, timber: 2 }, 'input inventory mutated');
});

test('an exactly-sufficient inventory is emptied rather than left at zero', () => {
  const r = recordManufacture(emptyLedger(), V, 'maker-1', FORGE_CTX());
  assert.equal(r.ok, true);
  assert.deepEqual(r.inventory, {});
});

test('manufacture is gated on station, level and materials', () => {
  const l = emptyLedger();
  assert.equal(canManufacture(l, V, FORGE_CTX({ station: 'kiln' })).reason, 'wrong_station');
  assert.equal(canManufacture(l, V, FORGE_CTX({ skills: { smithing: RECIPE.level - 1 } })).reason, 'level_too_low');
  assert.equal(canManufacture(l, V, FORGE_CTX({ skills: {} })).reason, 'level_too_low');

  const short = canManufacture(l, V, FORGE_CTX({ inventory: { iron_bar: 1 } }));
  assert.equal(short.reason, 'missing_materials');
  assert.equal(short.missing.iron_bar, RECIPE.materials.iron_bar - 1);
  assert.equal(short.missing.timber, RECIPE.materials.timber);

  // A failed attempt changes nothing.
  const r = recordManufacture(l, V, 'm', FORGE_CTX({ station: 'kiln' }));
  assert.equal(r.ok, false);
  assert.deepEqual(supplyOf(r.ledger, V), { sale: 0, manufacture: 0, total: 0 });
});

test('manufacture can be held closed while the sale runs', () => {
  const closed = { manufactureOpen: false };
  assert.equal(canManufacture(emptyLedger(), V, FORGE_CTX(), closed).reason, 'manufacture_closed');
  assert.equal(canBuy(emptyLedger(), V, 1, closed).ok, true, 'the sale still runs');
});

test('the two paths share one hard cap and cannot overrun it', () => {
  const policy = { baseCap: 24, salePortion: 0.25 };   // iron is rank 3 → cap 3, sale 0... use rank 0
  const clay = 'clay_pickaxe';
  const p = policyFor(clay, policy);
  let l = emptyLedger();
  l = recordSale(l, clay, p.saleAllocation, 'b').ledger;

  const recipeClay = manufactureRecipe('pickaxe', 'clay');
  const ctx = { station: 'kiln', skills: { smithing: 99 }, inventory: { clay_block: 999, timber: 999 } };
  for (let i = 0; i < p.manufactureAllocation; i++) {
    const r = recordManufacture(l, clay, 'm', { ...ctx, inventory: { ...ctx.inventory } }, policy);
    assert.equal(r.ok, true, `manufacture ${i} should succeed`);
    l = r.ledger;
  }
  assert.equal(supplyOf(l, clay).total, p.cap);
  assert.equal(phaseOf(l, clay, policy), 'closed');
  assert.equal(canBuy(l, clay, 1, policy).reason, 'sold_out');
  assert.equal(canManufacture(l, clay, ctx, policy).reason, 'sold_out');
  assert.ok(recipeClay);
});

test('a corrupt ledger entry reads as zero rather than throwing', () => {
  const bad = { [V]: { sale: 'x', manufacture: null, mints: 'nope' } };
  assert.deepEqual(supplyOf(bad, V), { sale: 0, manufacture: 0, total: 0 });
  assert.equal(canBuy(bad, V, 1).ok, true);
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => policyFor(null));
  assert.doesNotThrow(() => remaining(null, null));
  assert.doesNotThrow(() => canBuy(null, null, null));
  assert.doesNotThrow(() => recordSale(null, null, null, null));
  assert.doesNotThrow(() => canManufacture(null, null, null));
  assert.doesNotThrow(() => recordManufacture(null, null, null, null));
  assert.equal(phaseOf(null, 'nope'), 'closed');
  assert.equal(remaining(null, 'nope'), null);
});
