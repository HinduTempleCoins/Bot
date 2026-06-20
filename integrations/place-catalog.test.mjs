import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeCommand, find, byTag, isAllowed, names } from './place-catalog.mjs';

test('placeCommand builds /place structure for a mansion/village/igloo', () => {
  assert.match(placeCommand('woodland mansion', 100, 68, 100), /^place structure minecraft:mansion 100 68 100$/);
  assert.match(placeCommand('plains village', 0, 68, 0), /place structure minecraft:village_plains/);
  assert.match(placeCommand('igloo', 0, 68, 0), /minecraft:igloo/);
});
test('placeCommand builds /place feature for a geode', () => {
  assert.match(placeCommand('amethyst geode', 1, 2, 3), /^place feature minecraft:amethyst_geode 1 2 3$/);
});
test('unknown / unsafe ids return null', () => {
  assert.equal(placeCommand('tnt cannon', 0, 0, 0), null);
  assert.equal(isAllowed('minecraft:tnt'), false);
});
test('find is fuzzy + byTag works', () => {
  assert.ok(find('mansion').id === 'minecraft:mansion');
  assert.ok(byTag('egyptian').some((p) => /pyramid/.test(p.id)));
  assert.ok(names().includes('igloo'));
});
