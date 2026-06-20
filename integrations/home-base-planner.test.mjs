import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRegion, buildPlanPrompt, parsePlan, planHomeBase, layoutToActions } from './home-base-planner.mjs';

const region = selectRegion({ x: 0, y: 68, z: 0 }, 64);
const goodPlan = JSON.stringify({ theme: 'sun-temple precinct', layout: [
  { what: 'temple', x: 0, z: 0, note: 'heart' },
  { what: 'desert pyramid', x: 40, z: 0, note: 'egyptian' },
  { what: 'amethyst geode', x: -40, z: 30, note: 'violet' },
  { what: 'tnt', x: 10, z: 10, note: 'illegal' },          // dropped (not allow-listed)
  { what: 'igloo', x: 1, z: 1, note: 'too close to temple' }, // dropped (spacing)
  { what: 'village_plains', x: 200, z: 200, note: 'outside region' }, // dropped (out of region)
] });

test('selectRegion clamps radius', () => {
  assert.equal(selectRegion({ x: 0, z: 0 }, 5).radius, 24);
  assert.equal(selectRegion({ x: 0, z: 0 }, 9999).radius, 256);
});
test('buildPlanPrompt offers her the placeables + her own builds + aesthetic', () => {
  const p = buildPlanPrompt(region);
  assert.match(p, /desert pyramid/);
  assert.match(p, /temple at the heart/i);
  assert.match(p, /compact JSON/);
});
test('parsePlan keeps valid, drops illegal/out-of-region/too-close', () => {
  const { theme, layout } = parsePlan(goodPlan, region);
  assert.match(theme, /precinct/);
  assert.ok(layout.some((i) => i.what === 'temple' && i.kind === 'own'));
  assert.ok(layout.some((i) => /pyramid/.test(i.what)));
  assert.ok(!layout.some((i) => i.what === 'tnt'));
  assert.ok(!layout.some((i) => Math.abs(i.x) > 64 || Math.abs(i.z) > 64));
  assert.ok(layout.length <= 3); // igloo too close + tnt + out-of-region all dropped
});
test('planHomeBase soft-fails without a decider', async () => {
  assert.deepEqual((await planHomeBase(region, {})).layout, []);
});
test('planHomeBase runs the LoRA + optional corpus inspiration', async () => {
  let inspired = false;
  const retrieve = async () => { inspired = true; return [{ text: 'pylons frame the sacred', source: 'knowledge/architecture' }]; };
  const decide = async (prompt) => { assert.match(prompt, /pylons frame/); return goodPlan; };
  const p = await planHomeBase(region, { decide, retrieve });
  assert.equal(inspired, true);
  assert.ok(p.layout.length >= 2);
});
test('layoutToActions splits own-builds vs vanilla /place', () => {
  const acts = layoutToActions(parsePlan(goodPlan, region));
  assert.ok(acts.some((a) => a.type === 'temple'));
  assert.ok(acts.some((a) => a.type === 'place' && a.id));
});
