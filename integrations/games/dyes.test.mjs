// dyes.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DYE_SOURCES, COLORS, MORDANTS, MATERIALS, extractPigment, applyMordant, dye,
  sourcesForColor, byKind, versatilityOf, dyeWeb,
} from './dyes.mjs';

test('finished dye is highly versatile; sources span flowers/fungus/lichen/insects/hulls', () => {
  assert.ok(versatilityOf('dye') >= 4);
  for (const k of ['flower', 'fungus', 'lichen', 'insect', 'hull']) assert.ok(byKind(k).length >= 1, `missing ${k}`);
  for (const s of Object.values(DYE_SOURCES)) assert.ok(COLORS.includes(s.color));
});

test('extractPigment scales with potency, deterministic; rejects non-sources', () => {
  const a = extractPigment('madder', { ctx: { blockId: '0x1', txId: '0x1' } });
  const b = extractPigment('madder', { ctx: { blockId: '0x1', txId: '0x1' } });
  assert.deepEqual(a, b);
  assert.ok(a.pigment > 0 && a.baseColor === 'red');
  assert.equal(extractPigment('plastic').reason, 'not-a-dye-source');
});

test('the MORDANT changes the color — one source is several dyes', () => {
  assert.equal(applyMordant('yellow', 'alum').color, 'yellow');
  assert.equal(applyMordant('yellow', 'iron').color, 'brown');   // iron saddens
  assert.equal(applyMordant('yellow', 'copper').color, 'green'); // copper greens
  assert.equal(applyMordant('yellow', 'none').fastness, 'fugitive');
  // marigold gives yellow with alum but brown with iron — genuinely different outputs
  assert.equal(dye('marigold', { mordant: 'alum' }).color, 'yellow');
  assert.equal(dye('marigold', { mordant: 'iron' }).color, 'brown');
});

test('cochineal & lac (the insect dyes) and indigo (vat) behave right', () => {
  assert.equal(dye('cochineal', { mordant: 'alum' }).color, 'crimson');
  assert.equal(DYE_SOURCES.lac_insect.kind, 'insect');
  const ind = dye('indigo', {});
  assert.equal(ind.mordant, 'vat');       // vat dye, no mordant needed
  assert.equal(ind.color, 'blue');
});

test('lookups: sourcesForColor + dyeWeb enumerate the palette', () => {
  assert.ok(sourcesForColor('red').includes('madder'));
  assert.ok(MORDANTS.includes('alum') && MORDANTS.includes('iron'));
  const web = dyeWeb();
  assert.equal(web.length, Object.keys(DYE_SOURCES).length);
  const marigold = web.find((w) => w.source === 'marigold');
  assert.equal(marigold.withIron, 'brown');
});
