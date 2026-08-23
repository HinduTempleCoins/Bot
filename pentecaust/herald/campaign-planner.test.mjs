// pentecaust/herald/campaign-planner.test.mjs — offline, deterministic tests for the Herald campaign planner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaign, advance, currentWeek, progress, nextSteps, handler,
  STAGES, STATUSES,
} from './campaign-planner.mjs';

const HERALD_MODULES = ['prompt-packs', 'seo-execution', 'pr-pipeline', 'link-exchange', 'crossposter', 'outreach-db'];

function allSteps(plan) {
  return plan.stages.flatMap((st) => st.steps);
}

test('buildCampaign returns the four canonical stages in order, week-indexed', () => {
  const plan = buildCampaign({ brand: 'MELEK', goal: 'onboard witnesses', channels: ['x', 'blog'], weeks: 4 });
  assert.equal(plan.ok, true);
  assert.equal(plan.brand, 'MELEK');
  assert.deepEqual(plan.stages.map((s) => s.stage), STAGES);
  assert.deepEqual(plan.stages.map((s) => s.week), [1, 2, 3, 4]);
  // every stage has a human title + at least one step
  for (const st of plan.stages) {
    assert.ok(st.title && typeof st.title === 'string');
    assert.ok(st.steps.length > 0);
  }
});

test('buildCampaign tailors steps to channels and references real Herald module names', () => {
  const plan = buildCampaign({ brand: 'Acme', goal: 'get sales', channels: ['x', 'youtube'], weeks: 4 });
  const steps = allSteps(plan);
  // every step carries the required shape
  for (const sp of steps) {
    assert.ok(sp.id && sp.stage && sp.week >= 1);
    assert.equal(sp.status, 'pending');
    assert.ok(HERALD_MODULES.includes(sp.module), `unexpected module ${sp.module}`);
  }
  // channels are woven into the copy + carried on channel-specific steps
  assert.ok(steps.some((s) => s.channel === 'x' && /Acme/.test(s.action)));
  assert.ok(steps.some((s) => s.channel === 'youtube'));
  // the plan spans the OTHER Herald modules, not just one
  const used = new Set(steps.map((s) => s.module));
  for (const m of HERALD_MODULES) assert.ok(used.has(m), `campaign never uses ${m}`);
});

test('buildCampaign is deterministic (same input → identical plan)', () => {
  const input = { brand: 'MELEK', goal: 'grow', channels: ['blog'], weeks: 6 };
  assert.deepEqual(buildCampaign(input), buildCampaign(input));
});

test('buildCampaign spreads stages across a custom horizon and defaults weeks', () => {
  const eight = buildCampaign({ brand: 'B', weeks: 8 });
  assert.equal(eight.weeks, 8);
  assert.deepEqual(eight.stages.map((s) => s.week), [2, 4, 6, 8]);
  // bad/absent weeks → default 4
  assert.equal(buildCampaign({ brand: 'B' }).weeks, 4);
  assert.equal(buildCampaign({ brand: 'B', weeks: 'nope' }).weeks, 4);
  assert.equal(buildCampaign({ brand: 'B', weeks: -3 }).weeks, 4);
});

test('buildCampaign soft-fails on garbage input (never throws)', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const plan = buildCampaign(bad);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.stages.map((s) => s.stage), STAGES);
  }
});

test('advance transitions pending → active → done', () => {
  const plan = buildCampaign({ brand: 'MELEK', channels: ['x'], weeks: 4 });
  const id = plan.stages[0].steps[0].id;
  const active = advance(plan, id, 'active');
  assert.equal(active.stages[0].steps[0].status, 'active');
  const done = advance(active, id, 'done');
  assert.equal(done.stages[0].steps[0].status, 'done');
  // original plan is untouched (immutable-ish)
  assert.equal(plan.stages[0].steps[0].status, 'pending');
});

test('advance soft-fails on unknown id and unknown status (unchanged plan)', () => {
  const plan = buildCampaign({ brand: 'MELEK', channels: ['x'], weeks: 4 });
  assert.equal(advance(plan, 'no-such-step', 'done'), plan);
  const id = plan.stages[0].steps[0].id;
  assert.equal(advance(plan, id, 'bogus-status'), plan);
  assert.ok(STATUSES.includes('active'));
});

test('currentWeek returns only that week\'s steps', () => {
  const plan = buildCampaign({ brand: 'MELEK', channels: ['x', 'blog'], weeks: 4 });
  const wk1 = currentWeek(plan, 1);
  assert.ok(wk1.length > 0);
  assert.ok(wk1.every((s) => s.week === 1 && s.stage === 'content'));
  assert.equal(currentWeek(plan, 99).length, 0);
  assert.equal(currentWeek(null, 1).length, 0);
});

test('progress counts per stage/status and computes percent done', () => {
  const plan = buildCampaign({ brand: 'MELEK', channels: ['x'], weeks: 4 });
  const total = allSteps(plan).length;
  const p0 = progress(plan);
  assert.equal(p0.total, total);
  assert.equal(p0.done, 0);
  assert.equal(p0.percent, 0);
  assert.equal(p0.byStatus.pending, total);
  assert.deepEqual(Object.keys(p0.byStage).sort(), [...STAGES].sort());

  // mark every step done → 100%
  let done = plan;
  for (const sp of allSteps(plan)) done = advance(done, sp.id, 'done');
  const p1 = progress(done);
  assert.equal(p1.done, total);
  assert.equal(p1.percent, 100);
  assert.equal(p1.byStatus.done, total);
});

test('nextSteps returns pending steps in week-then-stage order', () => {
  const plan = buildCampaign({ brand: 'MELEK', channels: ['x'], weeks: 4 });
  const next = nextSteps(plan);
  assert.equal(next.length, allSteps(plan).length); // all pending initially
  for (let i = 1; i < next.length; i++) {
    assert.ok(next[i - 1].week <= next[i].week, 'weeks must be non-decreasing');
  }
  // completed steps drop out of nextSteps
  const advanced = advance(plan, next[0].id, 'done');
  assert.ok(!nextSteps(advanced).some((s) => s.id === next[0].id));
});

// ── handler ──────────────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    code: 0, body: '', headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; },
  };
}

test('handler: GET /health → ok', async () => {
  const res = mockRes();
  await handler({ url: '/health', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).ok, true);
});

test('handler: POST /api/campaign → a plan', async () => {
  const res = mockRes();
  await handler({ url: '/api/campaign', method: 'POST', body: { brand: 'MELEK', channels: ['x'], weeks: 4 } }, res);
  assert.equal(res.code, 200);
  const plan = JSON.parse(res.body);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.stages.map((s) => s.stage), STAGES);
});

test('handler: unknown route → 404 soft-fail', async () => {
  const res = mockRes();
  await handler({ url: '/nope', method: 'GET' }, res);
  assert.equal(res.code, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});
