import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldMemory } from './world-memory.mjs';

function seeded() {
  const wm = createWorldMemory();
  wm.addLandmark('w1', 'spawn', { x: 0, y: 64, z: 0 }, { note: 'where everyone arrives', kind: 'hub' });
  wm.addLandmark('w1', "VanKush's tower", { x: 40, y: 70, z: 10 }, { note: 'tall cobblestone tower', person: 'VanKushFam' });
  wm.addLandmark('w1', 'the river', { x: 55, y: 62, z: 8 }, { note: 'water, good for fishing' });
  return wm;
}

test('addLandmark stores per world; nearest sorts by distance', () => {
  const wm = seeded();
  const near = wm.nearest('w1', { x: 50, y: 66, z: 5 });
  assert.equal(near[0].name, 'the river'); // closest to (50,66,5)
  assert.ok(near[0].distance <= near[1].distance);
});

test('here() returns only landmarks within the radius', () => {
  const wm = seeded();
  const around = wm.here('w1', { x: 45, y: 70, z: 9 }, { radius: 20 });
  const names = around.map((m) => m.name);
  assert.ok(names.includes("VanKush's tower"));
  assert.ok(!names.includes('spawn')); // spawn is far
});

test('recallPlace matches by name/note/person', () => {
  const wm = seeded();
  assert.equal(wm.recallPlace('w1', 'tower')[0].name, "VanKush's tower");
  assert.ok(wm.recallPlace('w1', 'fishing')[0].name === 'the river');
  assert.ok(wm.recallPlace('w1', 'VanKushFam').length >= 1);
});

test('describeHere gives an orientation line', () => {
  const wm = seeded();
  assert.match(wm.describeHere('w1', { x: 41, y: 70, z: 10 }), /tower/);
  assert.match(wm.describeHere('w1', { x: 0, y: 64, z: 0 }), /spawn/);
  assert.match(wm.describeHere('empty-world', { x: 0, y: 0, z: 0 }), /new to me/);
});

test('updating a landmark by name does not duplicate it', () => {
  const wm = seeded();
  wm.addLandmark('w1', 'the river', { x: 55, y: 62, z: 8 }, { note: 'now has a dock' });
  const rivers = wm.landmarks('w1').filter((m) => m.name === 'the river');
  assert.equal(rivers.length, 1);
  assert.match(rivers[0].note, /dock/);
});

test('worlds are independent', () => {
  const wm = seeded();
  wm.addLandmark('w2', 'desert temple', { x: 100, y: 70, z: 100 }, {});
  assert.equal(wm.landmarks('w1').some((m) => m.name === 'desert temple'), false);
  assert.equal(wm.worlds().length, 2);
});

test('soft-fails on bad input', () => {
  const wm = createWorldMemory();
  assert.equal(wm.addLandmark('w', 'x', { x: NaN, z: 1 }).ok, false);
  assert.equal(wm.addLandmark('', 'x', { x: 1, z: 1 }).ok, false);
});
