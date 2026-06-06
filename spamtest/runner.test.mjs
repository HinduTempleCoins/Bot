// spamtest/runner.test.mjs — offline. Run: node --test spamtest/runner.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, dryRun, broadcastPlan } from './runner.mjs';

test('buildPlan makes N ops of the requested kind', () => {
  const plan = buildPlan({ count: 10, kind: 'comment' });
  assert.equal(plan.length, 10);
  assert.ok(plan.every((p) => p.kind === 'comment'));
  assert.ok(plan.every((p) => p.op[0] === 'comment' && p.op[1].parent_author));
});

test('buildPlan post vs comment: posts have no parent_author', () => {
  const posts = buildPlan({ count: 3, kind: 'post' });
  assert.ok(posts.every((p) => p.op[1].parent_author === ''));
});

test('buildPlan vote ops are well-formed', () => {
  const plan = buildPlan({ count: 4, kind: 'vote', target: 'hathor/intro' });
  assert.ok(plan.every((p) => p.op[0] === 'vote' && p.op[1].author === 'hathor' && p.op[1].permlink === 'intro'));
});

test('buildPlan --mix cycles post/comment/vote', () => {
  const plan = buildPlan({ count: 6, mix: true });
  assert.deepEqual(plan.map((p) => p.kind), ['post', 'comment', 'vote', 'post', 'comment', 'vote']);
});

test('buildPlan intervalSec spaces ops in time', () => {
  const plan = buildPlan({ count: 3, intervalSec: 5 });
  assert.deepEqual(plan.map((p) => p.tSec), [0, 5, 10]);
});

test('dryRun on an instant flood: consensus rejects nearly all posts', () => {
  const plan = buildPlan({ count: 50, kind: 'post', intervalSec: 0 });
  const r = dryRun(plan, { config: {}, policyName: 'unverified' });
  assert.equal(r.chain.summary.accepted, 1);           // only first post clears 300s
  assert.ok(r.application.summary.rejected > 0);        // app limiter also throttles
  assert.equal(r.wouldReachForum, Math.min(r.chain.summary.accepted, r.application.summary.accepted));
  assert.ok(r.wouldReachForum <= 1);
});

test('dryRun: spacing posts past the interval lets more through consensus', () => {
  const plan = buildPlan({ count: 5, kind: 'post', intervalSec: 400 });
  const r = dryRun(plan, { config: {}, policyName: 'human' });
  assert.equal(r.chain.summary.accepted, 5);           // all clear the 300s gap
});

test('dryRun: zero-stake bandwidth note flags the real throttle', () => {
  const plan = buildPlan({ count: 5, kind: 'post' });
  const r = dryRun(plan, { vestsShare: 0 });
  assert.match(r.bandwidth.note, /zero stake/);
});

test('broadcastPlan refuses without a signer (no local-key fallback)', async () => {
  await assert.rejects(() => broadcastPlan(buildPlan({ count: 1 }), { signer: null }), /signer not configured|No local-key/i);
});

test('broadcastPlan uses the app limiter and an injected mock signer', async () => {
  const sent = [];
  const mockSigner = { broadcast: async (ops, meta) => { sent.push(meta.clientRef); return { id: 'tx-' + sent.length }; } };
  // 10 instant comments under the unverified policy (minGap 60s) → only the first sends,
  // the rest are app-blocked before ever reaching the (mock) signer.
  const plan = buildPlan({ count: 10, kind: 'comment', intervalSec: 0 });
  const logs = [];
  const res = await broadcastPlan(plan, { signer: mockSigner, policyName: 'unverified', logger: { log: (m) => logs.push(m) } });
  assert.equal(res.sent.length, 1, 'app limiter should let only the first comment through an instant flood');
  assert.equal(res.blockedByApp.length, 9);
  assert.equal(sent.length, 1, 'mock signer should only have been called once');
});

test('broadcastPlan records a chain rejection without aborting', async () => {
  let calls = 0;
  const mockSigner = {
    broadcast: async () => { calls++; throw new Error('bandwidth limit exceeded'); },
  };
  // spaced past the app limiter so they reach the signer, where the chain "rejects".
  const plan = buildPlan({ count: 2, kind: 'post', intervalSec: 700 });
  const res = await broadcastPlan(plan, { signer: mockSigner, policyName: 'human', logger: { log() {} } });
  assert.equal(res.rejectedByChain.length, 2);
  assert.match(res.rejectedByChain[0].reason, /bandwidth/);
});
