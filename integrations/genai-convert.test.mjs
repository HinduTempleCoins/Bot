import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportedTargets, pickTool, buildArgs, catalog, CONVERSIONS } from './genai-convert.mjs';

test('3D formats convert among each other (game assets)', () => {
  const t = supportedTargets('fbx');
  assert.ok(t.includes('glb'));
  assert.ok(t.includes('obj'));
  assert.ok(t.includes('gltf'));
  assert.equal(pickTool('fbx', 'glb'), 'assimp');
});

test('svg vectorizes to png and pdf (t-shirt/print)', () => {
  const t = supportedTargets('svg');
  assert.ok(t.includes('png'));
  assert.ok(t.includes('pdf'));
  assert.equal(pickTool('svg', 'pdf'), 'rsvg-convert');
});

test('video/animation + audio pairs route to ffmpeg', () => {
  assert.ok(supportedTargets('mp4').includes('gif'));
  assert.equal(pickTool('mp4', 'gif'), 'ffmpeg');
  assert.equal(pickTool('wav', 'mp3'), 'ffmpeg');
});

test('psd flattens to png (layered/design)', () => {
  assert.ok(supportedTargets('psd').includes('png'));
  assert.equal(pickTool('psd', 'png'), 'magick');
});

test('buildArgs is pure and injection-safe (array args, right binary)', () => {
  assert.deepEqual(buildArgs('/t/a.fbx', '/t/a.glb'), { bin: 'assimp', args: ['export', '/t/a.fbx', '/t/a.glb'] });
  const gif = buildArgs('/t/a.mp4', '/t/a.gif');
  assert.equal(gif.bin, 'ffmpeg');
  assert.ok(gif.args.includes('/t/a.mp4') && gif.args.includes('/t/a.gif'));
  const svg = buildArgs('/t/a.svg', '/t/a.pdf');
  assert.equal(svg.bin, 'rsvg-convert');
});

test('jpeg is normalized to jpg; unsupported pair throws', () => {
  assert.equal(pickTool('jpeg', 'png'), 'magick');
  assert.throws(() => buildArgs('/t/a.fbx', '/t/a.mp3'), /unsupported/);
});

test('catalog covers 3d, video, audio, vector, raster, pdf groups', () => {
  const groups = new Set(CONVERSIONS.map((c) => c.group));
  for (const g of ['3d', 'video', 'audio', 'vector', 'raster', 'pdf']) assert.ok(groups.has(g), g);
  assert.ok(Object.keys(catalog()).length >= 15);
});
