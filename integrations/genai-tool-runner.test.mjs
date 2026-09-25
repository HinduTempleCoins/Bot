import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIMP_OPS, buildGimpScript, gimpOps, runGimp } from './genai-tool-runner.mjs';
test('safe: only whitelisted ops; params clamped; no raw script injection', () => {
  assert.ok(GIMP_OPS.oilify && GIMP_OPS.cartoon);
  const s = buildGimpScript('/t/a.png', '/t/a.oilify.png', 'oilify', { size: 999 });
  assert.match(s, /plug-in-oilify/);
  assert.match(s, / 30 /); // 999 clamped to max 30
  assert.throws(() => buildGimpScript('/t/a.png', '/t/o.png', 'rm -rf; drop', {}), /unknown gimp op/);
});
test('gimpOps lists ops + params', () => { const o = gimpOps(); assert.ok(o.find((x) => x.id === 'cartoon')); });
test('runGimp soft-fails on unknown op, never throws', async () => {
  const r = await runGimp('/tmp/none.png', 'notarealop');
  assert.equal(r.ok, false);
});
