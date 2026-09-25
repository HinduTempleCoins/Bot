import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, enginesCatalog, opExists, runOp } from './genai-tool-runner.mjs';
test('engine-agnostic: multiple engines registered, not just GIMP', () => {
  assert.ok(ENGINES.imagemagick && ENGINES.gmic && ENGINES.gimp);
  const cat = enginesCatalog();
  assert.ok(cat.length >= 3);
  assert.ok(cat.find((e) => e.id === 'gmic').ops.find((o) => o.op === 'painting'));
});
test('opExists gates unknown engine/op', () => {
  assert.equal(opExists('imagemagick', 'oilpaint'), true);
  assert.equal(opExists('imagemagick', 'rm-rf'), false);
  assert.equal(opExists('bogus', 'x'), false);
});
test('runOp soft-fails on unknown engine/op, never throws', async () => {
  const r = await runOp('bogus', 'x', '/tmp/none.png');
  assert.equal(r.ok, false);
});
