// sprite-export.mjs — TURNING A GENERATED IMAGE INTO AN ASSET A GAME ENGINE CAN ACTUALLY LOAD.
//
// The gap between "the AI made a picture" and "I can use this in my game" is not the model. It is the
// FILE FORMAT. A PNG is not a sprite; a sprite is a packed atlas plus the metadata that says where each
// frame sits, what its trimmed bounds were, and what the untrimmed source size was. Engines will not
// guess any of that.
//
// So this module does the boring, decisive half: deterministic bin-packing, then emission of the four
// formats that cover the open-source stack —
//
//   TexturePacker JSON (hash + array)  Phaser · PixiJS · Cocos · most 2D web engines
//   Godot .tres AtlasTexture           Godot 4
//   Tiled .tsx tileset                 Tiled → imported by Godot, Unity and Phaser
//   Aseprite JSON                      the de-facto interchange for 2D pipelines
//
// ⚠️ TRIM AND sourceSize ARE NOT OPTIONAL. If you pack trimmed frames and do not record
// spriteSourceSize/sourceSize, every frame draws at the wrong offset and the animation jitters. That
// single omission is the most common reason a generated sprite sheet "looks broken" in an engine, and
// it is why these emitters carry the fields even when trim is off.
//
// PURE. No image bytes are touched here — packing is arithmetic over frame dimensions, so it is fully
// testable offline and deterministic. Compositing the pixels is a separate, optional step.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * Shelf-pack frames into an atlas. Chosen over MaxRects deliberately: shelf packing is stable — the
 * same input always yields the same layout — which means an atlas can be regenerated without
 * invalidating anything that referenced it by coordinate. A marginally tighter pack is not worth a
 * non-reproducible build.
 *
 * @param {{name:string,w:number,h:number,trimmed?:object}[]} frames
 * @param {{padding?:number,maxWidth?:number,powerOfTwo?:boolean}} [opts]
 */
export function packFrames(frames = [], { padding = 2, maxWidth = 2048, powerOfTwo = true } = {}) {
  const items = (frames || [])
    .filter((f) => f && f.name && Number.isFinite(+f.w) && Number.isFinite(+f.h) && +f.w > 0 && +f.h > 0)
    .map((f) => ({ ...f, w: Math.ceil(+f.w), h: Math.ceil(+f.h) }))
    // Tallest first, then by name so ties are deterministic rather than input-order dependent.
    .sort((a, b) => b.h - a.h || a.name.localeCompare(b.name));

  const placed = [];
  let x = padding, y = padding, shelfH = 0, usedW = 0;
  for (const it of items) {
    if (x + it.w + padding > maxWidth && x > padding) { // new shelf
      y += shelfH + padding; x = padding; shelfH = 0;
    }
    placed.push({ ...it, x, y });
    usedW = Math.max(usedW, x + it.w + padding);
    shelfH = Math.max(shelfH, it.h);
    x += it.w + padding;
  }
  let W = Math.max(usedW, padding * 2);
  let H = y + shelfH + padding;
  if (powerOfTwo) { W = nextPow2(W); H = nextPow2(H); }
  return { width: W, height: H, frames: placed, padding };
}

/** The frame record every emitter needs, with trim fields always present. */
const frameMeta = (f) => {
  const t = f.trimmed || {};
  const sw = Number.isFinite(+t.sourceW) ? +t.sourceW : f.w;
  const sh = Number.isFinite(+t.sourceH) ? +t.sourceH : f.h;
  return {
    frame: { x: f.x, y: f.y, w: f.w, h: f.h },
    rotated: false,
    trimmed: sw !== f.w || sh !== f.h,
    spriteSourceSize: { x: +t.offsetX || 0, y: +t.offsetY || 0, w: f.w, h: f.h },
    sourceSize: { w: sw, h: sh },
  };
};

/** TexturePacker JSON — `hash` (Phaser/Pixi default) or `array`. */
export function texturePackerJSON(atlas, { image = 'sprites.png', format = 'hash', app = 'SoapBox GenAI' } = {}) {
  const meta = {
    app, version: '1.0', image, format: 'RGBA8888',
    size: { w: atlas.width, h: atlas.height }, scale: '1',
  };
  if (format === 'array') {
    return JSON.stringify({ frames: atlas.frames.map((f) => ({ filename: f.name, ...frameMeta(f) })), meta }, null, 2);
  }
  const frames = {};
  for (const f of atlas.frames) frames[f.name] = frameMeta(f);
  return JSON.stringify({ frames, meta }, null, 2);
}

/** Aseprite's JSON export shape — array form with a frameTags section for animations. */
export function asepriteJSON(atlas, { image = 'sprites.png', tags = [] } = {}) {
  return JSON.stringify({
    frames: atlas.frames.map((f) => ({ filename: f.name, ...frameMeta(f), duration: +f.duration || 100 })),
    meta: {
      app: 'https://www.aseprite.org/', version: '1.3', image, format: 'RGBA8888',
      size: { w: atlas.width, h: atlas.height }, scale: '1',
      frameTags: (tags || []).map((t) => ({ name: t.name, from: +t.from || 0, to: +t.to || 0, direction: t.direction || 'forward' })),
    },
  }, null, 2);
}

/**
 * Godot 4 .tres — one AtlasTexture sub-resource per frame over a shared texture.
 * ⚠️ load_steps must equal sub-resource count + 1 (the ext_resource) or Godot refuses the file.
 */
export function godotTres(atlas, { image = 'sprites.png', resourcePath = 'res://sprites.png' } = {}) {
  const n = atlas.frames.length;
  const head = `[gd_resource type="Resource" load_steps=${n + 2} format=3]\n\n`
    + `[ext_resource type="Texture2D" path="${resourcePath}" id="1_atlas"]\n\n`;
  const subs = atlas.frames.map((f, i) => `[sub_resource type="AtlasTexture" id="Atlas_${i}"]\n`
    + `atlas = ExtResource("1_atlas")\n`
    + `region = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})\n`
    + `; ${f.name}\n`).join('\n');
  const res = `\n[resource]\n`
    + `frames = [${atlas.frames.map((_, i) => `SubResource("Atlas_${i}")`).join(', ')}]\n`
    + `names = [${atlas.frames.map((f) => `"${String(f.name).replace(/"/g, '')}"`).join(', ')}]\n`;
  return head + subs + res;
}

/**
 * Tiled .tsx tileset. Tiled is the interchange that Godot, Unity and Phaser all import, so this is
 * the widest-reach single file. Uses a collection-of-images tileset so frames need not be uniform.
 */
export function tiledTsx(atlas, { name = 'sprites', image = 'sprites.png' } = {}) {
  const tiles = atlas.frames.map((f, i) => `  <tile id="${i}" type="${esc(f.name)}">\n`
    + `    <image width="${f.w}" height="${f.h}" source="${esc(image)}"/>\n`
    + `    <objectgroup draworder="index"><object id="1" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}"/></objectgroup>\n`
    + `  </tile>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<tileset version="1.10" tiledversion="1.10.2" name="${esc(name)}" tilewidth="${atlas.width}" tileheight="${atlas.height}" tilecount="${atlas.frames.length}" columns="0">\n`
    + `  <grid orientation="orthogonal" width="1" height="1"/>\n${tiles}\n</tileset>\n`;
}

export const FORMATS = Object.freeze([
  { id: 'texturepacker-hash', ext: '.json', label: 'TexturePacker JSON (hash)', engines: ['Phaser', 'PixiJS', 'Cocos'] },
  { id: 'texturepacker-array', ext: '.json', label: 'TexturePacker JSON (array)', engines: ['Phaser', 'PixiJS'] },
  { id: 'aseprite', ext: '.json', label: 'Aseprite JSON', engines: ['Aseprite', 'most 2D pipelines'] },
  { id: 'godot', ext: '.tres', label: 'Godot 4 AtlasTexture', engines: ['Godot 4'] },
  { id: 'tiled', ext: '.tsx', label: 'Tiled tileset', engines: ['Tiled', 'Godot', 'Unity', 'Phaser'] },
]);

/** Emit one named format. Unknown id → null, never a throw into a request path. */
export function emit(formatId, atlas, opts = {}) {
  switch (String(formatId || '')) {
    case 'texturepacker-hash': return texturePackerJSON(atlas, { ...opts, format: 'hash' });
    case 'texturepacker-array': return texturePackerJSON(atlas, { ...opts, format: 'array' });
    case 'aseprite': return asepriteJSON(atlas, opts);
    case 'godot': return godotTres(atlas, opts);
    case 'tiled': return tiledTsx(atlas, opts);
    default: return null;
  }
}

/**
 * ⭐ 3D: glTF 2.0 (.glb) is the only export worth supporting — Godot, Blender, Unity, Unreal,
 * three.js and Babylon all import it natively. Anything that does not emit glTF is a dead end.
 * Stated here rather than implemented because generated MESHES are not yet good enough for
 * characters: open text-to-3D produces messy topology and no clean UVs. Props and set dressing work;
 * anything that needs rigging does not.
 */
export const GLTF_NOTE = Object.freeze({
  format: 'glTF 2.0 (.glb)',
  importedBy: ['Godot', 'Blender', 'Unity', 'Unreal', 'three.js', 'Babylon.js'],
  honest: 'Generated 3D is usable for props and set dressing. It is not yet usable for characters — '
        + 'topology is messy and UVs are not clean, so rigging and animation fight it.',
});
