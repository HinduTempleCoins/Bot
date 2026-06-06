// discord-organize.test.mjs — the pure planner: creates + moves only, never deletes.
import { test } from 'node:test';
import assert from 'node:assert';
import { planChanges, renderPlan, LAYOUT } from './discord-organize.mjs';

const cat = (id, name) => ({ id, name, type: 4 });
const txt = (id, name, parent_id = null) => ({ id, name, type: 0, parent_id });

test('empty guild → all categories and channels created, nothing moved', () => {
  const plan = planChanges([]);
  assert.equal(plan.summary.createCategories, LAYOUT.length);
  assert.ok(plan.summary.createChannels > 10);
  assert.equal(plan.summary.moveChannels, 0);
  assert.ok(!plan.ops.some((o) => /delete|remove/.test(o.kind))); // never destructive
});

test('existing channels are MOVED into their category, not recreated', () => {
  const plan = planChanges([txt('1', 'general'), txt('2', 'mining')]);
  const moveGeneral = plan.ops.find((o) => o.kind === 'move-channel' && o.name === 'general');
  assert.ok(moveGeneral);
  assert.equal(moveGeneral.category, '🎮 COMMUNITY');
  // 'general' is in COMMUNITY's create list but must NOT be created again
  assert.ok(!plan.ops.some((o) => o.kind === 'create-channel' && o.name === 'general'));
});

test('channels already in the right category are left alone', () => {
  const guild = [cat('c1', '🎮 COMMUNITY'), txt('1', 'general', 'c1')];
  const plan = planChanges(guild);
  assert.ok(!plan.ops.some((o) => o.kind === 'move-channel' && o.name === 'general'));
  assert.ok(!plan.ops.some((o) => o.kind === 'create-category' && o.name === '🎮 COMMUNITY'));
});

test('unknown channels are untouched and counted', () => {
  const plan = planChanges([txt('9', 'my-special-channel')]);
  assert.equal(plan.summary.untouched, 1);
  assert.ok(!plan.ops.some((o) => o.id === '9'));
});

test('a channel matches at most one category (first wins)', () => {
  const plan = planChanges([txt('1', 'welcome')]);
  const moves = plan.ops.filter((o) => o.kind === 'move-channel' && o.id === '1');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].category, '📜 START HERE');
});

test('renderPlan mentions the non-destructive guarantee', () => {
  const out = renderPlan(planChanges([]));
  assert.match(out, /nothing deleted/);
});
