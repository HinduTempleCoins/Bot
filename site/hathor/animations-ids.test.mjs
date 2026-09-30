// animations-ids.test.mjs — OFFLINE. Named series ids (dna-ep1) are served like the worker's 12-hex ids; nothing
// path-like ever is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { serveAnimMedia } from './animations.mjs';

function fakeRes() {
  const r = { code: 0, body: null, writeHead(c) { r.code = c; }, end(b) { r.body = b; } };
  return r;
}

test('named series ids and hex ids are served; path tricks are not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'anims-'));
  for (const id of ['dna-ep1', 'abcdef012345']) { mkdirSync(join(dir, id)); writeFileSync(join(dir, id, 'clip.mp4'), 'DATA'); }
  writeFileSync(join(dir, 'manifest.json'), '{}');
  for (const ok of ['dna-ep1/clip.mp4', 'abcdef012345/clip.mp4']) {
    const res = fakeRes(); serveAnimMedia({ headers: {} }, res, ok, dir); assert.equal(res.code, 200, ok);
  }
  for (const bad of ['../manifest.json', 'dna-ep1/../manifest.json', 'DNA-EP1/clip.mp4', '.hidden/clip.mp4', 'dna-ep1/recipe.json', '-x/clip.mp4', 'ab/clip.mp4']) {
    const res = fakeRes(); serveAnimMedia({ headers: {} }, res, bad, dir); assert.equal(res.code, 404, bad);
  }
});
