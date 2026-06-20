import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTask, journalLine, ROLES, taskKeys } from './worksite.mjs';

test('each agent has a survival role with task types', () => {
  assert.ok(ROLES.Andy.includes('path'));      // the laborer builds infrastructure
  assert.ok(ROLES.Sophia.includes('garden'));  // tends/decorates
  assert.ok(ROLES.Hathor.includes('sacred'));  // raises the holy things
});

test('nextTask gives Andy real block ops (a path, wall, lights, terrace)', () => {
  const t = nextTask('Andy', { done: 0 });
  assert.ok(t.ops.length > 0);
  assert.ok(t.ops.every((o) => Number.isInteger(o.dx) && typeof o.block === 'string'));
  assert.match(t.verb, /path|wall|lantern|terrace/i);
});

test('tasks cycle through the role so work stays varied', () => {
  const types = new Set();
  for (let d = 0; d < 4; d++) types.add(nextTask('Andy', { done: d }).type);
  assert.ok(types.size >= 3); // not the same task every time
});

test('the worksite walks outward so the settlement grows (no pile-up)', () => {
  const a = nextTask('Andy', { done: 0 }).origin;
  const b = nextTask('Andy', { done: 1 }).origin;
  assert.notEqual(a.z, b.z); // advances along its corridor
});

test('agents work separate lanes (they do not collide)', () => {
  const andy = nextTask('Andy', { done: 0 }).origin;
  const sophia = nextTask('Sophia', { done: 0 }).origin;
  assert.notEqual(andy.x, sophia.x);
});

test("Hathor's sacred/art tasks defer to the Mason/designer (no raw block ops)", () => {
  // find a sacred/art task in her rotation
  let deferred = null;
  for (let d = 0; d < ROLES.Hathor.length; d++) { const t = nextTask('Hathor', { done: d }); if (t.defer) { deferred = t; break; } }
  assert.ok(deferred);
  assert.equal(deferred.ops.length, 0);
  assert.match(deferred.defer, /sacred|art/);
});

test('journalLine records who did what where', () => {
  const t = nextTask('Andy', { done: 0 });
  assert.match(journalLine('Andy', t), /Andy .* at -?\d+ \d+ -?\d+/);
});

test('taskKeys lists the work types', () => {
  const k = taskKeys();
  assert.ok(k.includes('path') && k.includes('garden') && k.includes('lights'));
});
