// pentecaust/herald/seo-execution.test.mjs — offline, deterministic. node --test.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildPlan, approveTask, completeTask, nextActions, summary, handler, PHASES,
} from './seo-execution.mjs';

const SAMPLE = {
  site: 'melek.salon',
  goal: 'rank for MELEK onboarding',
  keywords: ['MELEK blockchain', 'MELEK witness'],
  competitors: ['hive.io', 'blurt.blog'],
};

test('buildPlan returns ordered phases with tailored tasks', () => {
  const plan = buildPlan(SAMPLE);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.phases.map((p) => p.phase), PHASES);

  const flat = plan.phases.flatMap((p) => p.tasks);
  // every task has the required shape
  for (const t of flat) {
    assert.ok(t.id && t.phase && t.action);
    assert.equal(t.status, 'pending');
    assert.equal(typeof t.requiresApproval, 'boolean');
  }
  // ids are unique + deterministic per phase
  const ids = flat.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('technical-1'));

  // tasks are tailored to inputs
  const content = plan.phases.find((p) => p.phase === 'content').tasks;
  assert.ok(content.some((t) => t.action.includes('MELEK blockchain')), 'title-variant task per keyword');
  assert.ok(content.some((t) => t.action.includes('MELEK witness')));

  const authority = plan.phases.find((p) => p.phase === 'authority').tasks;
  assert.ok(authority.some((t) => t.action.includes('hive.io')), 'outreach per competitor');
  assert.ok(authority.some((t) => t.action.includes('blurt.blog')));

  const ai = plan.phases.find((p) => p.phase === 'ai-search-visibility').tasks;
  assert.ok(ai.some((t) => t.action.includes('llms.txt')), 'llms.txt task present');

  const tech = plan.phases.find((p) => p.phase === 'technical').tasks;
  assert.ok(tech.some((t) => t.detail.includes('melek.salon')), 'technical detail references the site');
});

test('buildPlan is deterministic', () => {
  assert.deepEqual(buildPlan(SAMPLE), buildPlan(SAMPLE));
});

test('buildPlan soft-fails on bad input to a shaped empty-but-valid plan', () => {
  for (const bad of [undefined, null, 'nope', 42, []]) {
    const plan = buildPlan(bad);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.phases.map((p) => p.phase), PHASES);
    assert.doesNotThrow(() => summary(plan));
  }
  // with no keywords/competitors it still produces useful fallback tasks
  const plan = buildPlan({ site: 'x.com', goal: 'grow' });
  const authority = plan.phases.find((p) => p.phase === 'authority').tasks;
  assert.ok(authority.length >= 1);
});

test('approveTask / completeTask transition status, pure, unknown id unchanged', () => {
  const plan = buildPlan(SAMPLE);
  const id = 'content-1';

  const approved = approveTask(plan, id);
  assert.notEqual(approved, plan, 'returns a new plan');
  assert.equal(findTask(plan, id).status, 'pending', 'original unmutated');
  assert.equal(findTask(approved, id).status, 'approved');

  const done = completeTask(approved, id);
  assert.equal(findTask(done, id).status, 'done');

  // unknown id → unchanged plan (soft-fail, same reference)
  assert.equal(approveTask(plan, 'nope-999'), plan);
  assert.equal(completeTask(plan, ''), plan);
  assert.equal(approveTask(null, id), null);
});

test('nextActions: pending unapproved-gated tasks are blocked; approving unblocks', () => {
  const plan = buildPlan(SAMPLE);
  const flat = plan.phases.flatMap((p) => p.tasks);
  const gated = flat.filter((t) => t.requiresApproval);
  assert.ok(gated.length > 0, 'some tasks require approval');

  const next = nextActions(plan);
  // no gated-and-still-pending task appears
  for (const t of next) assert.ok(!(t.requiresApproval && t.status === 'pending'));
  // ordering follows phase order
  const order = next.map((t) => t.phase);
  const idx = order.map((p) => PHASES.indexOf(p));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'next actions are in phase order');

  // approving a gated task makes it appear in nextActions
  const g = gated[0];
  const after = nextActions(approveTask(plan, g.id));
  assert.ok(after.some((t) => t.id === g.id), 'approved gated task becomes actionable');
});

test('summary: counts per phase + per status', () => {
  const plan = buildPlan(SAMPLE);
  const s = summary(plan);
  assert.equal(typeof s.total, 'number');
  // per-phase counts sum to total
  const sum = Object.values(s.byPhase).reduce((a, b) => a + b, 0);
  assert.equal(sum, s.total);
  // initially everything pending
  assert.equal(s.byStatus.pending, s.total);
  assert.equal(s.byStatus.approved, 0);
  assert.equal(s.byStatus.done, 0);

  // after transitions the counts move
  const id = plan.phases[0].tasks[0].id;
  const s2 = summary(completeTask(approveTask(plan, id), id));
  assert.equal(s2.byStatus.done, 1);
  assert.equal(s2.byStatus.pending, s.total - 1);
});

test('handler: /health, POST /api/plan, and 404', async () => {
  // health
  {
    const res = mockRes();
    await handler({ url: '/health', method: 'GET' }, res);
    assert.equal(res.code, 200);
    assert.equal(JSON.parse(res.body).ok, true);
  }
  // plan
  {
    const res = mockRes();
    await handler({ url: '/api/plan', method: 'POST', body: SAMPLE }, res);
    assert.equal(res.code, 200);
    const out = JSON.parse(res.body);
    assert.equal(out.ok, true);
    assert.deepEqual(out.phases.map((p) => p.phase), PHASES);
  }
  // 404
  {
    const res = mockRes();
    await handler({ url: '/nope', method: 'GET' }, res);
    assert.equal(res.code, 404);
    assert.equal(JSON.parse(res.body).ok, false);
  }
  // bad body soft-fails (still 200, shaped plan)
  {
    const res = mockRes();
    await handler({ url: '/api/plan', method: 'POST', body: '{bad json' }, res);
    assert.equal(res.code, 200);
    assert.equal(JSON.parse(res.body).ok, true);
  }
});

// ── helpers ──
function findTask(plan, id) {
  return plan.phases.flatMap((p) => p.tasks).find((t) => t.id === id);
}
function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(b) { this.body = b || ''; },
  };
}
