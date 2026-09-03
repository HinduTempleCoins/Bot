import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyBook, submitItem, reviewSubmission, listAll, listByGame, recipeFor, registryWith,
  MAX_INPUTS, MIN_INPUT_KINDS,
} from './indie-mint.mjs';
import { buildRegistry, itemsById } from './botanica-registry.mjs';

const REG = buildRegistry();

// The operator's own example: a shooter wants a stimulant made from coffee.
// coffee is a real Botanica plant yielding beverage_bean, so the chain starts in the ground.
const STIMULANT = {
  game: 'Trench Run',
  item: 'field_stimulant',
  name: 'Field Stimulant',
  station: 'apothecary',
  effort: 3,
  inputs: [{ item: 'beverage_bean', qty: 4 }, { item: 'oil', qty: 1 }],
  cap: 5000,
  note: 'consumed on use; a shooter buff brewed from coffee',
};

test('a shooter can register a stimulant brewed from real coffee', () => {
  const r = submitItem(emptyBook(), STIMULANT, REG);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.entry.item, 'field_stimulant');
  assert.equal(r.entry.game, 'Trench Run');
  assert.equal(r.entry.station, 'apothecary');
  assert.equal(r.entry.cap, 5000);
});

test('its inputs are things Botanica actually grows', () => {
  const known = itemsById(REG);
  for (const i of STIMULANT.inputs) assert.ok(known[i.item], `${i.item} must already exist`);
  // beverage_bean is what the coffee plant yields — the chain starts in the ground.
  const coffee = REG.plants.find((p) => p.id === 'coffee');
  assert.ok(coffee, 'coffee must be a real plant');
  assert.ok(coffee.yields.includes('beverage_bean'));
});

test('the registered item becomes a normal recipe in the economy', () => {
  const { book } = submitItem(emptyBook(), STIMULANT, REG);
  const rec = recipeFor(book, 'field_stimulant');
  assert.equal(rec.output.item, 'field_stimulant');
  assert.equal(rec.station, 'apothecary');
  assert.equal(rec.source, 'indie:Trench Run');
  assert.deepEqual(rec.inputs, [{ item: 'beverage_bean', qty: 4 }, { item: 'oil', qty: 1 }]);
});

test('registryWith folds indie items into one world, not a bolt-on', () => {
  const { book } = submitItem(emptyBook(), STIMULANT, REG);
  const merged = registryWith(REG, book);
  assert.equal(merged.items.length, REG.items.length + 1);
  assert.equal(merged.recipes.length, REG.recipes.length + 1);
  assert.ok(merged.items.some((i) => i.id === 'field_stimulant'));
});

test('an item made of nothing Botanica has is refused, and names the gap', () => {
  // The operator's other example: copper. Botanica has no metals branch at all.
  const ammo = { ...STIMULANT, item: 'copper_round', inputs: [{ item: 'copper', qty: 2 }, { item: 'oil', qty: 1 }] };
  const v = reviewSubmission(ammo, REG);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'unknown_inputs');
  assert.deepEqual(v.detail, ['copper']);
});

test('a station that does not exist is refused and the real ones are offered', () => {
  const v = reviewSubmission({ ...STIMULANT, station: 'fusion_reactor' }, REG);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'unknown_station');
  assert.ok(Array.isArray(v.known) && v.known.includes('apothecary'));
});

test('a game cannot redefine an item the economy already has', () => {
  const v = reviewSubmission({ ...STIMULANT, item: 'tincture' }, REG);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'item_exists');
});

test('the same item cannot be registered twice', () => {
  const { book } = submitItem(emptyBook(), STIMULANT, REG);
  const again = submitItem(book, STIMULANT, REG);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already_registered');
  assert.equal(again.book.items.length, 1, 'a rejected submission changes nothing');
});

test('one input is a rename, not a production chain', () => {
  const v = reviewSubmission({ ...STIMULANT, inputs: [{ item: 'beverage_bean', qty: 1 }] }, REG);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'too_few_input_kinds');
  assert.ok(MIN_INPUT_KINDS >= 2);
});

test('duplicate and over-long input lists are refused', () => {
  const dup = reviewSubmission({ ...STIMULANT, inputs: [{ item: 'oil', qty: 1 }, { item: 'oil', qty: 2 }] }, REG);
  assert.equal(dup.reason, 'duplicate_inputs');
  const many = Array.from({ length: MAX_INPUTS + 1 }, (_, i) => ({ item: REG.items[i].id, qty: 1 }));
  assert.equal(reviewSubmission({ ...STIMULANT, inputs: many }, REG).reason, 'too_many_inputs');
});

test('supply must be finite and sane', () => {
  assert.equal(reviewSubmission({ ...STIMULANT, cap: 0 }, REG).reason, 'no_cap');
  assert.equal(reviewSubmission({ ...STIMULANT, cap: -5 }, REG).reason, 'no_cap');
  assert.equal(reviewSubmission({ ...STIMULANT, cap: 99999999 }, REG).reason, 'cap_too_large');
});

test('listing works per game and overall', () => {
  let book = submitItem(emptyBook(), STIMULANT, REG).book;
  book = submitItem(book, { ...STIMULANT, item: 'ration_pack', game: 'Other Game' }, REG).book;
  assert.equal(listAll(book).length, 2);
  assert.equal(listByGame(book, 'Trench Run').length, 1);
  assert.equal(listByGame(book, 'Nobody').length, 0);
});

test('missing game or item id is refused', () => {
  assert.equal(reviewSubmission({ ...STIMULANT, game: '' }, REG).reason, 'no_game');
  assert.equal(reviewSubmission({ ...STIMULANT, item: '' }, REG).reason, 'no_item_id');
  assert.equal(reviewSubmission({ ...STIMULANT, inputs: [] }, REG).reason, 'no_inputs');
  assert.equal(reviewSubmission({ ...STIMULANT, station: '' }, REG).reason, 'no_station');
});

test('never throws on garbage', () => {
  assert.doesNotThrow(() => reviewSubmission(null, REG));
  assert.doesNotThrow(() => submitItem(null, null, REG));
  assert.doesNotThrow(() => recipeFor(null, null));
  assert.doesNotThrow(() => registryWith(null, null));
  assert.equal(reviewSubmission(undefined, REG).ok, false);
  assert.equal(recipeFor(emptyBook(), 'nope'), null);
});
