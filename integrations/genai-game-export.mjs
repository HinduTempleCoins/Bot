// genai-game-export.mjs — the "one asset → MANY games" 3D EXPORTER (PLATFORM_VISION_v2 § E).
// A common 3D source (glb/obj/fbx/…) fans out to per-engine game targets. Two kinds of target:
//   • MESH targets (Unity/Unreal/Godot/Roblox/generic glTF·USDZ·OBJ) — a straight format conversion
//     handled by `assimp` (already on the box; same tool `genai-convert.mjs` uses). CPU-only, keyless.
//   • VOXEL targets (Minecraft & other block games) — the mesh must be turned into a voxel grid and
//     written as a game schematic. The voxel grid → .schem (Sponge v2 NBT) writer is PURE JS and
//     PROVEN here; the mesh→voxel step is a real first-pass SURFACE voxelizer for OBJ input.
//
// HONESTY (charter §3 — prove, don't claim):
//   PROVEN offline in pure JS (no assimp, no network):
//     - parseObj, voxelizeMesh (first-pass surface voxelization), voxelGridToSchem / writeSchem
//       (Sponge-v2 gzipped NBT), parseSchem (round-trip), and exportModel for  OBJ → .schem.
//   RUNS on the box (needs assimp; SKIPPED in envs without it):
//     - all MESH targets (assimp export), and VOXEL export from a NON-obj source (glb→obj→voxels).
//   STAGED (declared, not implemented — returns a clear staged error, never a fake success):
//     - Minecraft .litematic (Litematica NBT), USDZ (assimp USD export unreliable), Roblox .rbxm,
//       Source .smd/.mdl. The pipeline for each is documented on its catalog entry.
//
// SAFE BY CONSTRUCTION (like genai-convert.mjs): target ids + extensions are allow-listed; every
// external command is run via execFile with an ARRAY of args (no shell, no injection); hard timeout;
// paths are caller-controlled temp files. All catalog/arg/writer functions are PURE and offline.
//
//   import { TARGETS, targetById, buildMeshArgs, exportModel, voxelGridToSchem } from './genai-game-export.mjs'
//   await exportModel('/tmp/build.obj', 'minecraft-schem', { block: 'minecraft:stone', resolution: 48 })
//   await exportModel('/tmp/build.glb', 'unity-glb')       // → assimp export (box only)
//   node integrations/genai-game-export.mjs in.obj minecraft-schem   // CLI

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { extname, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
const run = promisify(execFile);

// Minecraft world/data version stamped into schematics (configurable per export). 3465 ≈ 1.20.1.
export const DEFAULT_DATA_VERSION = 3465;

const norm = (f) => String(f || '').replace(/^\./, '').toLowerCase();

// ── Target catalog ──────────────────────────────────────────────────────────
// Each entry: { id, engine, ext, kind:'mesh'|'voxel', tool, status:'proven'|'staged', pipeline, desc }
// `status` is honest: 'proven' = a code path that runs and is verified (assimp-backed ones are proven
// on the box, exercised in tests only when assimp is present); 'staged' = declared, not yet implemented.
export const TARGETS = [
  // — generic interchange —
  { id: 'gltf2-glb', engine: 'Generic',  ext: 'glb',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → glTF 2.0 binary', desc: 'Portable glTF2 binary — the common hand-off format.' },
  { id: 'gltf2',     engine: 'Generic',  ext: 'gltf', kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → glTF 2.0 (text + buffers)', desc: 'glTF2 text form.' },
  { id: 'obj',       engine: 'Generic',  ext: 'obj',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → Wavefront OBJ', desc: 'Universal OBJ mesh.' },
  { id: 'usdz',      engine: 'Generic/AR', ext: 'usdz', kind: 'mesh', tool: 'assimp', status: 'staged',
    pipeline: 'USD export (assimp USD support incomplete) — stage: pxr/usd-tools or usdzip', desc: 'Apple AR Quick Look. STAGED.' },
  // — engines: straight mesh conversions —
  { id: 'unity-glb', engine: 'Unity',    ext: 'glb',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → glb; drop into Assets/ → prefab', desc: 'Unity via glTFast/native glTF.' },
  { id: 'unity-fbx', engine: 'Unity',    ext: 'fbx',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → FBX', desc: 'Unity FBX import.' },
  { id: 'unreal-glb', engine: 'Unreal',  ext: 'glb',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → glb; Unreal glTF/Interchange import', desc: 'Unreal via glTF/Datasmith.' },
  { id: 'unreal-fbx', engine: 'Unreal',  ext: 'fbx',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → FBX; Unreal FBX/Datasmith import', desc: 'Unreal FBX import.' },
  { id: 'godot-glb', engine: 'Godot',    ext: 'glb',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → glb; Godot imports glTF natively', desc: 'Godot native glTF.' },
  { id: 'roblox-obj', engine: 'Roblox',  ext: 'obj',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → OBJ; import as MeshPart in Studio', desc: 'Roblox mesh via OBJ.' },
  { id: 'roblox-fbx', engine: 'Roblox',  ext: 'fbx',  kind: 'mesh',  tool: 'assimp', status: 'proven',
    pipeline: 'assimp export → FBX; import as MeshPart in Studio', desc: 'Roblox mesh via FBX.' },
  { id: 'roblox-rbxm', engine: 'Roblox', ext: 'rbxm', kind: 'mesh',  tool: 'rojo',   status: 'staged',
    pipeline: 'OBJ/FBX → .rbxm (Roblox binary model) needs rbx-dom/rojo — STAGED', desc: 'Roblox .rbxm. STAGED.' },
  { id: 'source-smd', engine: 'Source',  ext: 'smd',  kind: 'mesh',  tool: 'assimp', status: 'staged',
    pipeline: 'SMD/MDL export via studiomdl toolchain — STAGED', desc: 'Valve Source model. STAGED.' },
  // — voxel / block games —
  { id: 'minecraft-schem', engine: 'Minecraft', ext: 'schem', kind: 'voxel', tool: 'js-voxelizer', status: 'proven',
    pipeline: 'mesh → surface voxel grid → block palette → Sponge-v2 .schem (gzipped NBT); WorldEdit //paste',
    desc: 'Minecraft WorldEdit .schem. Writer PROVEN; voxelizer first-pass (surface).' },
  { id: 'minecraft-litematic', engine: 'Minecraft', ext: 'litematic', kind: 'voxel', tool: 'js-voxelizer', status: 'staged',
    pipeline: 'mesh → voxel grid → Litematica NBT (Regions/BlockStates long-packed) — writer STAGED',
    desc: 'Litematica .litematic. STAGED (schem is the proven path).' },
  { id: 'minetest-schem', engine: 'Minetest', ext: 'schem', kind: 'voxel', tool: 'js-voxelizer', status: 'proven',
    pipeline: 'same voxel grid → Sponge-v2 .schem (Minetest schem via WorldEdit-compatible import)',
    desc: 'Block-game schematic (shared voxel stage).' },
];

const BY_ID = Object.fromEntries(TARGETS.map((t) => [t.id, t]));

export function targetById(id) { return BY_ID[String(id || '')] || null; }
export function listTargets(kind) { return kind ? TARGETS.filter((t) => t.kind === kind) : TARGETS.slice(); }
export function catalog() {
  return TARGETS.map(({ id, engine, ext, kind, tool, status, desc }) => ({ id, engine, ext, kind, tool, status, desc }));
}

// Source formats assimp can READ (mirrors genai-convert's 3d group).
export const MESH_SOURCE_EXTS = ['obj', 'fbx', 'gltf', 'glb', 'stl', 'dae', 'ply', '3ds', 'x'];

// ── PURE injection-safe argv builder for MESH (assimp) targets ────────────────
// Returns { bin, args } with args as an ARRAY (never a shell string). Throws on a bad target.
export function buildMeshArgs(srcPath, target, outPath) {
  const t = targetById(target);
  if (!t) throw new Error(`unknown target ${target}`);
  if (t.kind !== 'mesh') throw new Error(`target ${target} is not a mesh target (kind=${t.kind})`);
  const src = norm(extname(srcPath));
  if (src && !MESH_SOURCE_EXTS.includes(src)) throw new Error(`unsupported mesh source .${src}`);
  const out = outPath || replaceExt(srcPath, t.ext);
  // assimp selects the exporter from the output extension; args are literal, never interpolated into a shell.
  return { bin: 'assimp', args: ['export', srcPath, out] };
}

function replaceExt(p, ext) { return join(dirname(p), basename(p, extname(p)) + '.' + norm(ext)); }

// ─────────────────────────────────────────────────────────────────────────────
// PURE-JS OBJ PARSER  (positions + triangulated faces)  — PROVEN offline
// ─────────────────────────────────────────────────────────────────────────────
export function parseObj(text) {
  const positions = [];
  const faces = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v') {
      positions.push([+parts[1] || 0, +parts[2] || 0, +parts[3] || 0]);
    } else if (parts[0] === 'f') {
      // face tokens may be "v", "v/vt", "v/vt/vn", "v//vn"; indices are 1-based, may be negative.
      const idx = parts.slice(1).map((tok) => {
        let n = parseInt(tok.split('/')[0], 10);
        if (!Number.isFinite(n)) return null;
        return n < 0 ? positions.length + n : n - 1; // resolve to 0-based
      }).filter((n) => n !== null);
      // fan-triangulate polygons
      for (let i = 1; i + 1 < idx.length; i++) faces.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return { positions, faces };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRST-PASS SURFACE VOXELIZER  — PROVEN offline (surface shell only; no interior fill)
//   Pipeline: bbox → uniform scale so the longest axis spans `resolution` voxels → for each triangle,
//   barycentric-sample its surface densely enough to hit every voxel it crosses → mark occupancy.
//   Honest limits: this rasterizes the SURFACE (a hollow shell). Solid fill + interior scan-fill and
//   greedy palette meshing are the documented next pass; not implemented here.
// ─────────────────────────────────────────────────────────────────────────────
export function voxelizeMesh(mesh, opts = {}) {
  const resolution = Math.max(1, Math.min(512, Math.floor(opts.resolution || 32)));
  const { positions, faces } = mesh;
  if (!positions || !positions.length || !faces || !faces.length) {
    return { width: 0, height: 0, length: 0, filled: new Set() };
  }
  // bounding box
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) for (let a = 0; a < 3; a++) { if (p[a] < min[a]) min[a] = p[a]; if (p[a] > max[a]) max[a] = p[a]; }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const maxSize = Math.max(size[0], size[1], size[2]) || 1;
  const scale = (resolution - 1) / maxSize; // longest axis → resolution-1 span (indices 0..resolution-1)
  const dim = (a) => Math.max(1, Math.floor(size[a] * scale) + 1);
  const width = dim(0), height = dim(1), length = dim(2);
  const toVox = (p) => [
    clampi((p[0] - min[0]) * scale, width - 1),
    clampi((p[1] - min[1]) * scale, height - 1),
    clampi((p[2] - min[2]) * scale, length - 1),
  ];
  const filled = new Set();
  const put = (x, y, z) => filled.add(`${x},${y},${z}`);
  for (const f of faces) {
    const A = positions[f[0]], B = positions[f[1]], C = positions[f[2]];
    if (!A || !B || !C) continue;
    const a = toVox(A), b = toVox(B), c = toVox(C);
    // sample density from the triangle's voxel-space edge lengths (2 samples per voxel for coverage)
    const eAB = dist(a, b), eAC = dist(a, c), eBC = dist(b, c);
    const steps = Math.max(1, Math.ceil(Math.max(eAB, eAC, eBC) * 2));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, v = j / steps, w = 1 - u - v;
        const x = Math.round(a[0] * w + b[0] * u + c[0] * v);
        const y = Math.round(a[1] * w + b[1] * u + c[1] * v);
        const z = Math.round(a[2] * w + b[2] * u + c[2] * v);
        put(clamp0(x, width - 1), clamp0(y, height - 1), clamp0(z, length - 1));
      }
    }
  }
  return { width, height, length, filled };
}

const clampi = (v, hi) => Math.max(0, Math.min(hi, Math.round(v)));
const clamp0 = (v, hi) => Math.max(0, Math.min(hi, v));
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAL NBT WRITER (big-endian) — only the tags Sponge-v2 needs. PURE. PROVEN.
// ─────────────────────────────────────────────────────────────────────────────
const T = { END: 0, BYTE: 1, SHORT: 2, INT: 3, LONG: 4, FLOAT: 5, DOUBLE: 6, BYTE_ARRAY: 7, STRING: 8, LIST: 9, COMPOUND: 10, INT_ARRAY: 11, LONG_ARRAY: 12 };

function pShort(v) { const b = Buffer.allocUnsafe(2); b.writeInt16BE(v | 0); return b; }
function pInt(v) { const b = Buffer.allocUnsafe(4); b.writeInt32BE(v | 0); return b; }
function pString(s) { const sb = Buffer.from(String(s), 'utf8'); const len = Buffer.allocUnsafe(2); len.writeUInt16BE(sb.length); return Buffer.concat([len, sb]); }
function pByteArray(bytes) { const body = Buffer.from(bytes); return Buffer.concat([pInt(body.length), body]); }
function pIntArray(arr) { const b = Buffer.allocUnsafe(arr.length * 4); arr.forEach((v, i) => b.writeInt32BE(v | 0, i * 4)); return Buffer.concat([pInt(arr.length), b]); }
function named(type, name, payload) { return Buffer.concat([Buffer.from([type]), pString(name), payload]); }
function pCompound(entries) { return Buffer.concat([...entries, Buffer.from([T.END])]); }
function pList(elemType, elemPayloads) { return Buffer.concat([Buffer.from([elemType]), pInt(elemPayloads.length), ...elemPayloads]); }

// unsigned LEB128 varint (Sponge BlockData packing)
export function varint(n) {
  const bytes = []; let v = n >>> 0;
  do { let b = v & 0x7f; v >>>= 7; if (v !== 0) b |= 0x80; bytes.push(b); } while (v !== 0);
  return bytes;
}

// ─────────────────────────────────────────────────────────────────────────────
// VOXEL GRID → Sponge-v2 .schem (gzipped NBT). PURE. PROVEN (byte round-trip tested).
//   grid: { width, height, length, filled:Set<"x,y,z"> }  (from voxelizeMesh)
//   opts: { block='minecraft:stone', air='minecraft:air', dataVersion, gzip=true, name='Schematic' }
// ─────────────────────────────────────────────────────────────────────────────
export function voxelGridToSchem(grid, opts = {}) {
  const width = grid.width | 0, height = grid.height | 0, length = grid.length | 0;
  const block = opts.block || 'minecraft:stone';
  const air = opts.air || 'minecraft:air';
  const dataVersion = Number.isFinite(+opts.dataVersion) ? +opts.dataVersion : DEFAULT_DATA_VERSION;
  const filled = grid.filled || new Set();
  const palette = { [air]: 0, [block]: 1 };
  // BlockData: YZX order (x fastest), each index as an unsigned varint.
  const blockData = [];
  for (let y = 0; y < height; y++)
    for (let z = 0; z < length; z++)
      for (let x = 0; x < width; x++)
        blockData.push(...varint(filled.has(`${x},${y},${z}`) ? 1 : 0));

  const paletteEntries = Object.entries(palette).map(([name, idx]) => named(T.INT, name, pInt(idx)));
  const root = named(T.COMPOUND, opts.name || 'Schematic', pCompound([
    named(T.INT, 'Version', pInt(2)),
    named(T.INT, 'DataVersion', pInt(dataVersion)),
    named(T.SHORT, 'Width', pShort(width)),
    named(T.SHORT, 'Height', pShort(height)),
    named(T.SHORT, 'Length', pShort(length)),
    named(T.INT_ARRAY, 'Offset', pIntArray([0, 0, 0])),
    named(T.INT, 'PaletteMax', pInt(Object.keys(palette).length)),
    named(T.COMPOUND, 'Palette', pCompound(paletteEntries)),
    named(T.BYTE_ARRAY, 'BlockData', pByteArray(blockData)),
    named(T.LIST, 'BlockEntities', pList(T.COMPOUND, [])),
  ]));
  return opts.gzip === false ? root : gzipSync(root);
}

// ─────────────────────────────────────────────────────────────────────────────
// MINIMAL NBT READER — round-trip / import validation. PURE.
// ─────────────────────────────────────────────────────────────────────────────
export function parseSchem(buf) {
  let data = Buffer.from(buf);
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data); // gzip magic
  let o = 0;
  const u8 = () => data[o++];
  const i16 = () => { const v = data.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = data.readInt32BE(o); o += 4; return v; };
  const str = () => { const len = data.readUInt16BE(o); o += 2; const s = data.toString('utf8', o, o + len); o += len; return s; };
  function payload(type) {
    switch (type) {
      case T.BYTE: return data.readInt8(o++);
      case T.SHORT: return i16();
      case T.INT: return i32();
      case T.LONG: { const hi = i32(), lo = i32(); return (BigInt(hi) << 32n) | BigInt(lo >>> 0); }
      case T.FLOAT: { const v = data.readFloatBE(o); o += 4; return v; }
      case T.DOUBLE: { const v = data.readDoubleBE(o); o += 8; return v; }
      case T.BYTE_ARRAY: { const len = i32(); const a = Buffer.from(data.subarray(o, o + len)); o += len; return a; }
      case T.STRING: return str();
      case T.LIST: { const et = u8(); const len = i32(); const arr = []; for (let i = 0; i < len; i++) arr.push(payload(et)); return arr; }
      case T.COMPOUND: { const obj = {}; for (;;) { const t = u8(); if (t === T.END) break; const name = str(); obj[name] = payload(t); } return obj; }
      case T.INT_ARRAY: { const len = i32(); const arr = []; for (let i = 0; i < len; i++) arr.push(i32()); return arr; }
      case T.LONG_ARRAY: { const len = i32(); const arr = []; for (let i = 0; i < len; i++) { const hi = i32(), lo = i32(); arr.push((BigInt(hi) << 32n) | BigInt(lo >>> 0)); } return arr; }
      default: throw new Error('unsupported NBT tag ' + type);
    }
  }
  const type = u8(); const name = str(); const value = payload(type);
  return { name, value };
}

// decode a Sponge BlockData byte-array back to a flat index list (YZX order). Test/import helper.
export function decodeBlockData(buf, count) {
  const out = []; let i = 0;
  while (out.length < count && i < buf.length) {
    let shift = 0, val = 0, b;
    do { b = buf[i++]; val |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    out.push(val >>> 0);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// exportModel — the one entry point. soft-fail (never throws), execFile (no shell).
//   MESH target      → assimp export (box only; soft-fails if assimp missing).
//   VOXEL .schem     → OBJ source: pure-JS voxelize+write (works offline). Non-OBJ source:
//                      assimp converts to OBJ first (box only).
//   STAGED target    → { ok:false, staged:true, error } — declared, honestly not done.
// ─────────────────────────────────────────────────────────────────────────────
export async function exportModel(srcPath, target, opts = {}) {
  const t = targetById(target);
  if (!t) return { ok: false, error: `unknown target ${target}` };
  if (t.status === 'staged') return { ok: false, staged: true, error: `target ${t.id} is STAGED: ${t.pipeline}` };
  const outPath = opts.outPath || replaceExt(srcPath, t.ext);
  const timeout = opts.timeout || 120000;

  if (t.kind === 'mesh') {
    let bin, args;
    try { ({ bin, args } = buildMeshArgs(srcPath, t.id, outPath)); }
    catch (e) { return { ok: false, error: String(e && e.message) }; }
    try {
      await run(bin, args, { timeout, maxBuffer: 1 << 26 });
      return { ok: true, outPath, tool: bin, kind: 'mesh', target: t.id };
    } catch (e) { return { ok: false, error: `mesh export failed: ${String(e && e.message).slice(0, 200)}`, tool: bin }; }
  }

  // voxel target (.schem)
  try {
    const srcExt = norm(extname(srcPath));
    let objText;
    if (srcExt === 'obj') {
      objText = await readFile(srcPath, 'utf8');
    } else if (MESH_SOURCE_EXTS.includes(srcExt)) {
      // convert to OBJ via assimp first (box only)
      const tmpObj = join(tmpdir(), `gx_${Date.now()}_${Math.random().toString(36).slice(2)}.obj`);
      try { await run('assimp', ['export', srcPath, tmpObj], { timeout, maxBuffer: 1 << 26 }); }
      catch (e) { return { ok: false, error: `voxel export needs assimp to read .${srcExt}: ${String(e && e.message).slice(0, 160)}`, tool: 'assimp' }; }
      objText = await readFile(tmpObj, 'utf8');
    } else {
      return { ok: false, error: `unsupported voxel source .${srcExt}` };
    }
    const mesh = parseObj(objText);
    const grid = voxelizeMesh(mesh, { resolution: opts.resolution || 32 });
    if (!grid.filled.size) return { ok: false, error: 'voxelizer produced an empty grid (no geometry?)' };
    const schem = voxelGridToSchem(grid, opts);
    await writeFile(outPath, schem);
    return { ok: true, outPath, tool: 'js-voxelizer', kind: 'voxel', target: t.id,
      dims: { width: grid.width, height: grid.height, length: grid.length }, voxels: grid.filled.size };
  } catch (e) { return { ok: false, error: `voxel export failed: ${String(e && e.message).slice(0, 200)}` }; }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('genai-game-export.mjs')) {
  const [src, target] = process.argv.slice(2);
  if (!src) { console.log(JSON.stringify(catalog(), null, 2)); }
  else if (!target) { console.log('targets:', TARGETS.map((t) => `${t.id} (${t.status})`).join(', ')); }
  else { console.log(JSON.stringify(await exportModel(src, target), null, 2)); }
}
