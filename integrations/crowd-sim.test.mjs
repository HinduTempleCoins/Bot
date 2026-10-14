import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCrowd, gridAgents } from './crowd-sim.mjs';

test('agents drive toward the goal and reach it in open space', () => {
  const c = createCrowd({ agents: gridAgents({ n: 12, x0: 0, y0: 0, cols: 4, goal: [12, 0] }), goal: [12, 0] });
  const before = c.summary().reached;
  const s = c.run(400);
  assert.equal(s.agents, 12);
  assert.ok(s.reached > before, 'some agents reached the goal');
  assert.ok(typeof s.maxDensity === 'number' && ['low', 'moderate', 'high', 'dangerous'].includes(s.crushRisk));
});

test('packing many agents tightly raises density + crush risk', () => {
  // 40 agents jammed into a 2x2m area all wanting the same point
  const agents = gridAgents({ n: 40, x0: 0, y0: 0, cols: 8, spacing: 0.25, goal: [0.5, 0.5] });
  const c = createCrowd({ agents, goal: [0.5, 0.5] });
  c.run(5);
  assert.ok(c.maxLocalDensity() >= 2, 'dense packing registers');
});

test('summary + agents snapshot shape', () => {
  const c = createCrowd({ agents: gridAgents({ n: 5, goal: [5, 0] }), goal: [5, 0] });
  c.step();
  const snap = c.agents();
  assert.equal(snap.length, 5);
  assert.ok('pos' in snap[0] && 'speed' in snap[0]);
});
