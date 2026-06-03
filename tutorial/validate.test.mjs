/**
 * validate.test.mjs — OFFLINE unit tests for the tutorial FSM validator.
 *
 * All graphs are crafted in-memory; no file or chain reads. Run with:
 *   node --test tutorial/validate.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateStages, simulateWalk } from './validate.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A valid linear graph mirroring the real stages.json shape.
const linear = {
  _meta: { version: 1 },
  stages: [
    { id: 1, key: 'a', next_stage: 2 },
    { id: 2, key: 'b', next_stage: 3 },
    { id: 3, key: 'c', next_stage: null },
  ],
};

// A valid branching graph (uses transitions).
const branching = {
  _meta: { version: 1, start: 1 },
  stages: [
    { id: 1, key: 'start', transitions: { yes: 2, no: 3 } },
    { id: 2, key: 'left', next_stage: 4 },
    { id: 3, key: 'right', next_stage: 4 },
    { id: 4, key: 'end', next_stage: null },
  ],
};

test('valid linear graph passes', () => {
  const r = validateStages(linear);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.stats.terminals, [3]);
  assert.deepEqual(r.stats.unreachable, []);
  assert.equal(r.stats.startId, 1);
});

test('valid branching graph passes', () => {
  const r = validateStages(branching);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.deepEqual(r.stats.terminals, [4]);
});

test('missing next-stage target is caught', () => {
  const bad = { stages: [
    { id: 1, next_stage: 2 },
    { id: 2, next_stage: 99 }, // 99 does not exist
  ] };
  const r = validateStages(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('99')), r.errors.join('; '));
});

test('no terminal (all stages have outgoing edges) is caught', () => {
  // A 2-cycle: 1 -> 2 -> 1, no terminal.
  const bad = { stages: [
    { id: 1, next_stage: 2 },
    { id: 2, next_stage: 1 },
  ] };
  const r = validateStages(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('terminal')), r.errors.join('; '));
});

test('unreachable stage is caught', () => {
  const bad = {
    _meta: { start: 1 },
    stages: [
      { id: 1, next_stage: 2 },
      { id: 2, next_stage: null },
      { id: 3, next_stage: null }, // never referenced, unreachable
    ],
  };
  const r = validateStages(bad);
  assert.equal(r.ok, false);
  assert.deepEqual(r.stats.unreachable, [3]);
  assert.ok(r.errors.some((e) => e.includes('unreachable')), r.errors.join('; '));
});

test('missing start is caught', () => {
  // Empty stage list => no start.
  const r = validateStages({ stages: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('no stages')), r.errors.join('; '));
});

test('explicit missing start id is caught', () => {
  const bad = {
    _meta: { start: 42 }, // no such stage
    stages: [{ id: 1, next_stage: null }],
  };
  const r = validateStages(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('start')), r.errors.join('; '));
});

test('duplicate ids are caught', () => {
  const bad = { stages: [
    { id: 1, next_stage: null },
    { id: 1, next_stage: null },
  ] };
  const r = validateStages(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes('duplicate')), r.errors.join('; '));
});

test('non-object input is caught without throwing', () => {
  const r = validateStages(null);
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
});

test('simulateWalk reaches a terminal on a linear graph', () => {
  const w = simulateWalk(linear);
  assert.equal(w.ok, true, w.error ?? '');
  assert.deepEqual(w.path, [1, 2, 3]);
  assert.equal(w.terminal, 3);
  assert.equal(w.error, null);
});

test('simulateWalk follows branch choices to a terminal', () => {
  const w = simulateWalk(branching, ['no']);
  assert.equal(w.ok, true, w.error ?? '');
  assert.deepEqual(w.path, [1, 3, 4]);
  assert.equal(w.terminal, 4);
});

test('simulateWalk reports a dead end (missing target)', () => {
  const bad = { stages: [
    { id: 1, next_stage: 2 },
    { id: 2, next_stage: 99 },
  ] };
  const w = simulateWalk(bad);
  assert.equal(w.ok, false);
  assert.equal(w.terminal, null);
  assert.ok(w.error.includes('dead end'), w.error);
});

test('simulateWalk detects a loop', () => {
  const bad = { stages: [
    { id: 1, next_stage: 2 },
    { id: 2, next_stage: 1 },
  ] };
  const w = simulateWalk(bad);
  assert.equal(w.ok, false);
  assert.ok(w.error.includes('loop'), w.error);
});

test('simulateWalk errors when a branch has no choice provided', () => {
  const w = simulateWalk(branching, []); // branch at stage 1 needs a choice
  assert.equal(w.ok, false);
  assert.ok(w.error.includes('dead end') || w.error.includes('choice'), w.error);
});

test('simulateWalk errors on invalid choice label', () => {
  const w = simulateWalk(branching, ['maybe']);
  assert.equal(w.ok, false);
  assert.ok(w.error.includes('invalid choice'), w.error);
});

test('the real stages.json shape (linear, 6 stages, terminal null) validates', () => {
  // Reconstruct the real shape inline so this test stays offline & does not
  // read the file. Mirrors id 1..6 with next_stage chaining to null.
  const real = {
    _meta: { version: 1 },
    stages: [
      { id: 1, key: 'intro_post', next_stage: 2 },
      { id: 2, key: 'engage_three_posts', next_stage: 3 },
      { id: 3, key: 'share_what_you_know', next_stage: 4 },
      { id: 4, key: 'first_organic_upvote', next_stage: 5 },
      { id: 5, key: 'power_up', next_stage: 6 },
      { id: 6, key: 'vote_for_a_witness', next_stage: null },
    ],
  };
  const r = validateStages(real);
  assert.equal(r.ok, true, r.errors.join('; '));
  const w = simulateWalk(real);
  assert.deepEqual(w.path, [1, 2, 3, 4, 5, 6]);
  assert.equal(w.terminal, 6);
});

test('the live stages.json has 19 valid stages, all reachable, single terminal', () => {
  const doc = JSON.parse(
    readFileSync(path.join(__dirname, 'stages.json'), 'utf8'),
  );
  assert.equal(doc.stages.length, 19, 'expected exactly 19 stages');

  const r = validateStages(doc);
  assert.equal(r.ok, true, r.errors.join('; '));
  assert.equal(r.stats.total, 19);
  assert.deepEqual(r.stats.unreachable, [], 'no stage may be unreachable');
  assert.deepEqual(r.stats.terminals, [19], 'stage 19 is the only terminal');
  assert.equal(r.stats.startId, 1);

  // The dry-run simulator must walk a linear path through all 19 to the end.
  const w = simulateWalk(doc);
  assert.equal(w.ok, true, w.error ?? '');
  assert.equal(w.terminal, 19);
  assert.equal(w.path.length, 19);
  assert.deepEqual(
    w.path,
    Array.from({ length: 19 }, (_, i) => i + 1),
  );

  // The original 6 CryptoKannon stages must remain intact (ids + keys).
  const expected = [
    [1, 'intro_post'],
    [2, 'engage_three_posts'],
    [3, 'share_what_you_know'],
    [4, 'first_organic_upvote'],
    [5, 'power_up'],
    [6, 'vote_for_a_witness'],
  ];
  for (const [id, key] of expected) {
    const s = doc.stages.find((x) => x.id === id);
    assert.ok(s, `stage ${id} present`);
    assert.equal(s.key, key, `stage ${id} key unchanged`);
  }

  // Every stage carries a tier across A/B/C.
  const tiers = new Set(doc.stages.map((s) => s.tier));
  for (const t of ['A', 'B', 'C']) {
    assert.ok(tiers.has(t), `tier ${t} represented`);
  }
});
