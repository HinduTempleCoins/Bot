// new-user-stitch.test.mjs — OFFLINE. node:test + node:assert/strict. No network.
// Fakes are the injected step deps; we assert ordering, short-circuit, and shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stitchFlow, describeFlow, renderFlow, esc, STEPS,
} from './new-user-stitch.mjs';

const ALL_KEYS = STEPS.map((s) => s.key);

// build a deps object where every step succeeds, recording call order
function happyDeps(order) {
  const mk = (key) => async () => { order.push(key); return { ok: true, step: key }; };
  return Object.fromEntries(ALL_KEYS.map((k) => [k, mk(k)]));
}

test('describeFlow: ordered, plain-described, full set', () => {
  const flow = describeFlow();
  assert.equal(flow.length, ALL_KEYS.length);
  assert.deepEqual(flow.map((s) => s.key), ALL_KEYS);
  assert.deepEqual(flow.map((s) => s.order), [1, 2, 3, 4]);
  assert.deepEqual(flow.map((s) => s.key), ['signup', 'welcomer', 'tutorial-start', 'first-post']);
  for (const s of flow) assert.ok(typeof s.desc === 'string' && s.desc.length > 10);
});

test('happy path: all steps run in order, ok=true, no failedAt', async () => {
  const order = [];
  const r = await stitchFlow(STEPS, happyDeps(order));
  assert.equal(r.ok, true);
  assert.equal(r.failedAt, null);
  assert.deepEqual(r.completed, ALL_KEYS);
  assert.deepEqual(order, ALL_KEYS); // ran strictly in order
  assert.equal(r.results.length, ALL_KEYS.length);
  assert.ok(r.results.every((x) => x.ok === true));
});

test('mid-flow failure short-circuits at the failing step', async () => {
  const order = [];
  const deps = happyDeps(order);
  // tutorial-start (step 3) fails
  deps['tutorial-start'] = async () => { order.push('tutorial-start'); return { ok: false, error: 'lesson seat failed' }; };
  const r = await stitchFlow(STEPS, deps);

  assert.equal(r.ok, false);
  assert.equal(r.failedAt, 'tutorial-start');
  assert.deepEqual(r.completed, ['signup', 'welcomer']);
  // first-post must NOT have run
  assert.ok(!order.includes('first-post'));
  assert.deepEqual(order, ['signup', 'welcomer', 'tutorial-start']);
  // results stop at the failing step
  assert.equal(r.results.length, 3);
  assert.equal(r.results[2].error, 'lesson seat failed');
});

test('first step failure: nothing else runs', async () => {
  const order = [];
  const deps = happyDeps(order);
  deps['signup'] = async () => { order.push('signup'); return false; };
  const r = await stitchFlow(STEPS, deps);
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, 'signup');
  assert.deepEqual(r.completed, []);
  assert.deepEqual(order, ['signup']);
});

test('soft-fail: a throwing step becomes ok=false and stops, never throws out', async () => {
  const deps = happyDeps([]);
  deps['welcomer'] = async () => { throw new Error('boom'); };
  const r = await stitchFlow(STEPS, deps);
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, 'welcomer');
  assert.match(r.results[1].error, /threw: boom/);
  assert.deepEqual(r.completed, ['signup']);
});

test('soft-fail: missing dep for a step is a recorded failure, not a throw', async () => {
  const deps = happyDeps([]);
  delete deps['first-post'];
  const r = await stitchFlow(STEPS, deps);
  assert.equal(r.ok, false);
  assert.equal(r.failedAt, 'first-post');
  assert.match(r.results[3].error, /no dep provided/);
});

test('boolean true return is accepted as ok; ctx carries prior outputs forward', async () => {
  let sawCtx = null;
  const deps = {
    signup: async () => ({ ok: true, account: 'alice' }),
    welcomer: async (ctx) => { sawCtx = ctx; return true; },
    'tutorial-start': async () => true,
    'first-post': async () => true,
  };
  const r = await stitchFlow(STEPS, deps);
  assert.equal(r.ok, true);
  // welcomer saw the signup result in ctx
  assert.equal(sawCtx.signup.account, 'alice');
  assert.equal(r.ctx['first-post'].ok, true);
});

test('renderFlow: marks pass/fail and notes skipped steps', () => {
  const passRep = { ok: true, failedAt: null, completed: ALL_KEYS, results: ALL_KEYS.map((k) => ({ key: k, ok: true })) };
  const passOut = renderFlow(passRep);
  assert.match(passOut, /PASS \(full journey\)/);

  const failRep = {
    ok: false, failedAt: 'welcomer', completed: ['signup'],
    results: [{ key: 'signup', ok: true }, { key: 'welcomer', ok: false, error: 'x' }],
  };
  const failOut = renderFlow(failRep);
  assert.match(failOut, /FAIL at "welcomer"/);
  assert.match(failOut, /skipped \(prior failure\)/); // tutorial-start + first-post noted
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('STEPS is frozen and immutable', () => {
  assert.ok(Object.isFrozen(STEPS));
});
