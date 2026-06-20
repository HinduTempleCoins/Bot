import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, provision, instruct, toSetblockCommands, PALETTES } from './mason.mjs';

test('Hathor palette carries her canon (gold, lapis, quartz, amethyst, glow)', () => {
  const p = PALETTES.hathor;
  assert.equal(p.accent, 'gold_block');
  assert.equal(p.trim, 'lapis_block');
  assert.match(p.column, /quartz/);
  assert.match(p.vapor, /amethyst/);
  assert.match(p.glow, /lantern|froglight/);
});

test('buildSpec produces placed blocks for each structure', () => {
  for (const structure of ['pillar', 'altar', 'gateway', 'wesekhBand']) {
    const spec = buildSpec({ structure, size: 7 });
    assert.ok(spec.length > 0, structure);
    for (const b of spec) { assert.ok(Number.isInteger(b.dx) && Number.isInteger(b.dy) && Number.isInteger(b.dz)); assert.ok(typeof b.block === 'string' && b.block.length); }
  }
});

test('the gateway uses gold + a glowing crown (her signature)', () => {
  const spec = buildSpec({ structure: 'gateway', size: 7 });
  const blocks = new Set(spec.map((b) => b.block));
  assert.ok(blocks.has('gold_block'));
  assert.ok([...blocks].some((b) => /froglight|lantern/.test(b)));
  // it is tall (a gateway you walk through)
  assert.ok(Math.max(...spec.map((b) => b.dy)) >= 7);
});

test('cells are deduped (no double-placed block)', () => {
  const spec = buildSpec({ structure: 'gateway', size: 7 });
  const keys = spec.map((b) => `${b.dx},${b.dy},${b.dz}`);
  assert.equal(keys.length, new Set(keys).size);
});

test('size is clamped to a sane range', () => {
  assert.equal(provision({ structure: 'pillar', size: 99 }).brief.size, 15);
  assert.equal(provision({ structure: 'pillar', size: 1 }).brief.size, 3);
});

test('provision gives the Mason what they need — a material list', () => {
  const prov = provision({ structure: 'gateway', size: 7 });
  assert.ok(prov.materials.length > 0);
  assert.ok(prov.materials.every((m) => m.block && m.count > 0));
  assert.ok(prov.materials.some((m) => m.block === 'gold_block'));
  // sorted by count desc
  const counts = prov.materials.map((m) => m.count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  assert.equal(prov.blockCount, buildSpec({ structure: 'gateway', size: 7 }).length);
});

test('instruct phrases it in her voice + returns the plan', () => {
  const plan = instruct({ structure: 'altar', size: 5 });
  assert.match(plan.instruction, /Mason/);
  assert.match(plan.instruction, /aesthetic/);
  assert.ok(plan.materials && plan.blockCount > 0);
});

test('unknown structure falls back to the gateway', () => {
  assert.deepEqual(buildSpec({ structure: 'nonsense' }), buildSpec({ structure: 'gateway' }));
});

test('toSetblockCommands renders absolute minecraft setblock lines', () => {
  const cmds = toSetblockCommands(buildSpec({ structure: 'pillar', size: 5 }), { x: 10, y: 64, z: -3 });
  assert.ok(cmds.every((c) => c.startsWith('setblock ') && c.includes('minecraft:')));
  assert.ok(cmds.some((c) => /minecraft:gold_block/.test(c)));
});

test('nocturne palette is a distinct vibe', () => {
  const day = new Set(buildSpec({ structure: 'gateway', palette: 'hathor' }).map((b) => b.block));
  const night = new Set(buildSpec({ structure: 'gateway', palette: 'nocturne' }).map((b) => b.block));
  assert.notDeepEqual([...day].sort(), [...night].sort());
});
