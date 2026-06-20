import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildComplexCommands } from './burst-builder.mjs';

test('a complex is a big burst of fill commands (thousands of blocks)', () => {
  const b = buildComplexCommands(0);
  assert.ok(b.commands.length >= 10);
  assert.ok(b.commands.filter((c) => c.startsWith('fill ')).length >= 5);
  assert.ok(b.blocks > 3000);
});

test('it is GROUNDED — foundation plinth extends below the floor', () => {
  const b = buildComplexCommands(0, { groundY: 68 });
  const plinth = b.commands.find((c) => /smooth_sandstone/.test(c) && /fill/.test(c));
  assert.ok(plinth);
  const ys = plinth.match(/-?\d+/g).map(Number); // x1 y1 z1 x2 y2 z2
  assert.ok(ys[1] < 68, 'foundation starts below the floor (no floating)');
});

test('it clears the air above so terrain does not poke through', () => {
  assert.ok(buildComplexCommands(0).commands.some((c) => /minecraft:air/.test(c)));
});

test('it is an enclosed structure — hollow walls + a roof + columns', () => {
  const c = buildComplexCommands(0).commands.join('\n');
  assert.match(c, /cut_sandstone hollow/);   // walls form an enclosure
  assert.match(c, /quartz_pillar/);          // columns
  assert.match(c, /smooth_quartz/);          // floor + roof
  assert.match(c, /gold_block/);             // capitals/altar
});

test('complex 0 has NO road; later complexes CONNECT to the previous one', () => {
  assert.ok(!buildComplexCommands(0).commands.some((c) => /road/.test(c) || c.includes('chiseled_sandstone')));
  const c1 = buildComplexCommands(1).commands.join('\n');
  assert.match(c1, /smooth_quartz/); // the connecting road
});

test('successive complexes step along the avenue (not stacked)', () => {
  assert.notEqual(buildComplexCommands(0).origin.z, buildComplexCommands(1).origin.z);
});

test('commands are well-formed minecraft fill/setblock', () => {
  for (const cmd of buildComplexCommands(1).commands) {
    assert.match(cmd, /^(fill|setblock) -?\d+ -?\d+ -?\d+/);
    assert.match(cmd, /minecraft:[a-z_]+( hollow| outline)?$/);
  }
});
