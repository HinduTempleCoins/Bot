// These formats are contracts with other people's software. A field that is merely "close" makes an
// engine draw the frame in the wrong place, which reads to a user as "the AI made a broken sprite".

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packFrames, texturePackerJSON, asepriteJSON, godotTres, tiledTsx, emit, FORMATS, GLTF_NOTE,
} from './sprite-export.mjs';

const FRAMES = [
  { name: 'walk_0', w: 32, h: 48 },
  { name: 'walk_1', w: 32, h: 48 },
  { name: 'idle_0', w: 32, h: 32 },
  { name: 'big', w: 96, h: 64 },
];

test('packing never overlaps two frames', () => {
  const a = packFrames(FRAMES, { padding: 2 });
  for (let i = 0; i < a.frames.length; i++) {
    for (let j = i + 1; j < a.frames.length; j++) {
      const p = a.frames[i]; const q = a.frames[j];
      const disjoint = p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
      assert.ok(disjoint, `${p.name} overlaps ${q.name}`);
    }
  }
});

test('every frame sits inside the atlas', () => {
  const a = packFrames(FRAMES);
  for (const f of a.frames) {
    assert.ok(f.x >= 0 && f.y >= 0, `${f.name} has a negative origin`);
    assert.ok(f.x + f.w <= a.width, `${f.name} overflows width`);
    assert.ok(f.y + f.h <= a.height, `${f.name} overflows height`);
  }
});

test('⭐ packing is deterministic — the same input yields the same layout', () => {
  // Shelf packing was chosen over MaxRects for exactly this: an atlas can be regenerated without
  // invalidating anything that referenced a frame by coordinate.
  const a = JSON.stringify(packFrames(FRAMES).frames);
  const b = JSON.stringify(packFrames([...FRAMES].reverse()).frames);
  assert.equal(a, b, 'input order must not change the layout');
});

test('power-of-two dimensions when asked, honest dimensions when not', () => {
  const p2 = packFrames(FRAMES, { powerOfTwo: true });
  for (const d of [p2.width, p2.height]) assert.equal(d & (d - 1), 0, `${d} is not a power of two`);
  const raw = packFrames(FRAMES, { powerOfTwo: false });
  assert.ok(raw.width <= p2.width && raw.height <= p2.height);
});

test('junk frames are dropped, never packed as zero-size holes', () => {
  const a = packFrames([...FRAMES, { name: 'bad', w: 0, h: 10 }, { name: '', w: 5, h: 5 }, null, { w: 4, h: 4 }]);
  assert.equal(a.frames.length, FRAMES.length);
});

test('⚠️ every emitter carries spriteSourceSize and sourceSize', () => {
  // Omitting them is the single most common reason a packed sheet draws offset and jitters.
  const a = packFrames(FRAMES);
  const tp = JSON.parse(texturePackerJSON(a));
  for (const [name, f] of Object.entries(tp.frames)) {
    assert.ok(f.spriteSourceSize, `${name} missing spriteSourceSize`);
    assert.ok(f.sourceSize, `${name} missing sourceSize`);
    assert.equal(typeof f.rotated, 'boolean');
  }
  const ase = JSON.parse(asepriteJSON(a));
  for (const f of ase.frames) { assert.ok(f.spriteSourceSize); assert.ok(f.sourceSize); }
});

test('trim offsets survive into the metadata', () => {
  const a = packFrames([{ name: 'trimmed', w: 20, h: 20, trimmed: { sourceW: 32, sourceH: 32, offsetX: 6, offsetY: 6 } }]);
  const f = JSON.parse(texturePackerJSON(a)).frames.trimmed;
  assert.equal(f.trimmed, true);
  assert.deepEqual(f.sourceSize, { w: 32, h: 32 });
  assert.equal(f.spriteSourceSize.x, 6);
});

test('TexturePacker hash and array forms are both valid and agree on count', () => {
  const a = packFrames(FRAMES);
  const hash = JSON.parse(texturePackerJSON(a, { format: 'hash' }));
  const arr = JSON.parse(texturePackerJSON(a, { format: 'array' }));
  assert.equal(Object.keys(hash.frames).length, FRAMES.length);
  assert.equal(arr.frames.length, FRAMES.length);
  assert.ok(arr.frames.every((f) => f.filename));
  assert.deepEqual(hash.meta.size, { w: a.width, h: a.height });
});

test('⚠️ Godot load_steps = ext + sub + 1, or Godot refuses the file', () => {
  const a = packFrames(FRAMES);
  const tres = godotTres(a);
  const declared = +tres.match(/load_steps=(\d+)/)[1];
  const subs = (tres.match(/\[sub_resource /g) || []).length;
  const ext = (tres.match(/\[ext_resource /g) || []).length;
  // Godot's own writer emits load_steps = ext_resources + sub_resources + 1 (the +1 is the main
  // [resource] itself). Too LOW and Godot refuses the file; too high is tolerated. Matching what
  // Godot writes is the only safe target.
  assert.equal(declared, subs + ext + 1, 'load_steps = ext + sub + 1, as Godot itself writes it');
  assert.ok(declared > subs + ext, 'must never under-count — that is the failing direction');
  assert.match(tres, /type="AtlasTexture"/);
  assert.match(tres, /region = Rect2\(/);
});

test('Tiled tileset is well-formed XML with one tile per frame', () => {
  const a = packFrames(FRAMES);
  const tsx = tiledTsx(a, { name: 'hero' });
  assert.match(tsx, /^<\?xml version="1\.0"/);
  assert.equal((tsx.match(/<tile id=/g) || []).length, FRAMES.length);
  assert.match(tsx, /tilecount="4"/);
  assert.ok(tsx.trim().endsWith('</tileset>'));
});

test('hostile frame names cannot break the XML', () => {
  const a = packFrames([{ name: 'evil"><script>alert(1)</script>', w: 8, h: 8 }]);
  const tsx = tiledTsx(a);
  assert.ok(!tsx.includes('<script>'), 'raw script injected into the tileset');
  assert.match(tsx, /&lt;script&gt;/);
});

test('emit() covers every advertised format and refuses unknown ones', () => {
  const a = packFrames(FRAMES);
  for (const f of FORMATS) {
    const out = emit(f.id, a);
    assert.ok(out && out.length > 40, `${f.id} produced nothing`);
    assert.ok(f.engines.length, `${f.id} must name the engines that read it`);
  }
  assert.equal(emit('nope', a), null);
  assert.equal(emit('', a), null);
});

test('the 3D note is honest about what generated meshes cannot do', () => {
  assert.match(GLTF_NOTE.format, /glTF 2\.0/);
  assert.ok(GLTF_NOTE.importedBy.includes('Godot'));
  assert.match(GLTF_NOTE.honest, /not yet usable for characters/i);
});
