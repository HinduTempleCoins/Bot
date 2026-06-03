// private-assistant.test.mjs — offline tests for the privacy-first assistant core (task #133).
// Run: node --test integrations/private-assistant.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAssistant,
  privacyPosture,
  __setCloudComplete,
} from './private-assistant.mjs';

// A local stub model that reports a fixed confidence — lets us drive the routing branches.
const localModel = (confidence, tag = 'local') =>
  (prompt) => ({ text: `${tag}:${prompt}`, confidence });

test('ask() uses local model and returns private:true when cloud disallowed', async () => {
  const a = createAssistant({ model: localModel(1) });
  const r = await a.ask('hello');
  assert.equal(r.usedModel, 'local');
  assert.equal(r.private, true);
  assert.equal(r.answer, 'local:hello');
});

test('cloudAllowed false: a LOW-confidence local answer NEVER routes to cloud', async () => {
  // Wire a cloud completer that would fire if (incorrectly) called — it must NOT be.
  let cloudCalled = false;
  __setCloudComplete(async () => { cloudCalled = true; return 'CLOUD ANSWER'; });

  const a = createAssistant({ model: localModel(0.01), cloudAllowed: false });
  const r = await a.ask('hard question');

  assert.equal(r.usedModel, 'local', 'must stay local when cloud disallowed');
  assert.equal(r.private, true);
  assert.equal(cloudCalled, false, 'cloud completer must never be invoked when cloud disallowed');

  __setCloudComplete(null);
});

test('cloudAllowed true + low local confidence: escalates to cloud', async () => {
  __setCloudComplete(async () => 'CLOUD ANSWER');

  const a = createAssistant({ model: localModel(0.1), cloudAllowed: true });
  const r = await a.ask('hard question');

  assert.equal(r.usedModel, 'cloud');
  assert.equal(r.private, false);
  assert.equal(r.answer, 'CLOUD ANSWER');

  __setCloudComplete(null);
});

test('cloudAllowed true + HIGH local confidence: stays local (no escalation)', async () => {
  let cloudCalled = false;
  __setCloudComplete(async () => { cloudCalled = true; return 'CLOUD ANSWER'; });

  const a = createAssistant({ model: localModel(0.99), cloudAllowed: true });
  const r = await a.ask('easy question');

  assert.equal(r.usedModel, 'local');
  assert.equal(r.private, true);
  assert.equal(cloudCalled, false, 'high-confidence local should not escalate');

  __setCloudComplete(null);
});

test('cloudAllowed true but cloud fails: soft-falls back to local (still private)', async () => {
  __setCloudComplete(async () => null); // simulate cloud unavailable

  const a = createAssistant({ model: localModel(0.1), cloudAllowed: true });
  const r = await a.ask('hard question');

  assert.equal(r.usedModel, 'local');
  assert.equal(r.private, true);
  assert.equal(r.answer, 'local:hard question');

  __setCloudComplete(null);
});

test('side-effecting tool without confirm returns needsConfirm and does NOT run', async () => {
  let ran = false;
  const a = createAssistant();
  a.registerTool('email.send', async () => { ran = true; return 'sent'; }, { sideEffects: true });

  const r = await a.run('email.send', { to: 'x@y.z' });
  assert.equal(r.ok, false);
  assert.equal(r.needsConfirm, true);
  assert.equal(ran, false, 'write tool must not execute without confirm');
});

test('side-effecting tool WITH confirm runs', async () => {
  let ran = false;
  const a = createAssistant();
  a.registerTool('email.send', async (args) => { ran = true; return `sent:${args.to}`; }, { sideEffects: true });

  const r = await a.run('email.send', { to: 'x@y.z' }, { confirm: true });
  assert.equal(r.ok, true);
  assert.equal(r.result, 'sent:x@y.z');
  assert.equal(ran, true);
});

test('read-only (non-side-effecting) tool runs without confirm', async () => {
  const a = createAssistant();
  a.registerTool('calendar.read', async () => [{ summary: 'standup' }], { sideEffects: false });

  const r = await a.run('calendar.read', {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, [{ summary: 'standup' }]);
});

test('run() on unknown tool soft-fails', async () => {
  const a = createAssistant();
  const r = await a.run('nope', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown tool/);
});

test('privacyPosture reports localOnly true when cloud disallowed', async () => {
  const a = createAssistant();
  a.registerTool('calendar.read', async () => [], { sideEffects: false });
  const p = privacyPosture(a);
  assert.equal(p.cloudAllowed, false);
  assert.equal(p.localOnly, true);
  assert.deepEqual(p.tools, ['calendar.read']);
});

test('privacyPosture reports localOnly false when cloud allowed', async () => {
  const a = createAssistant({ cloudAllowed: true });
  const p = privacyPosture(a);
  assert.equal(p.cloudAllowed, true);
  assert.equal(p.localOnly, false);
});

test('pre-registered tools (constructor) honor sideEffects flag', async () => {
  let wrote = false;
  const a = createAssistant({
    tools: {
      'doc.read': async () => 'content',
      'doc.write': { fn: async () => { wrote = true; return 'ok'; }, sideEffects: true },
    },
  });
  assert.deepEqual(a.tools.sort(), ['doc.read', 'doc.write']);

  const w = await a.run('doc.write', {});
  assert.equal(w.needsConfirm, true);
  assert.equal(wrote, false);

  const rd = await a.run('doc.read', {});
  assert.equal(rd.ok, true);
  assert.equal(rd.result, 'content');
});

test('__setModel swaps the local model after construction', async () => {
  const a = createAssistant();
  a.__setModel(localModel(1, 'swapped'));
  const r = await a.ask('ping');
  assert.equal(r.answer, 'swapped:ping');
  assert.equal(r.usedModel, 'local');
});

test('ask() soft-fails when the local model throws (stays private)', async () => {
  const a = createAssistant({ model: () => { throw new Error('model down'); } });
  const r = await a.ask('hi');
  assert.equal(r.usedModel, 'local');
  assert.equal(r.private, true);
  assert.equal(r.answer, '');
});
