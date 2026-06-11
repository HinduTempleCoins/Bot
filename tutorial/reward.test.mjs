/**
 * tutorial/reward.test.mjs — OFFLINE tests for the per-stage completion reward
 * composer. No network, no chain reads beyond the in-repo stages.json (and an
 * injected reader for edge cases). Injected broadcaster (zero-WIF).
 *
 *   node --test tutorial/reward.test.mjs
 */

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeReward,
  broadcastReward,
  esc,
  __setReader,
  __setStore,
  __setFetch,
} from './reward.mjs';

afterEach(() => {
  __setReader(undefined); // restore default disk reader
  __setStore(null);
  __setFetch(null);
});

// ---- happy: upvote stage ----------------------------------------------------

test('upvote stage (intro_post) → comment + full upvote, no transfer', () => {
  const r = composeReward('intro_post', 'alice');
  assert.equal(r.ok, true);
  assert.equal(r.action, 'comment_and_upvote');
  assert.equal(r.upvoteWeight, 10000);
  assert.equal(r.transfer, undefined);
  assert.ok(r.comment && typeof r.comment.body === 'string' && r.comment.body.length > 0);
  assert.deepEqual(r.reward.sort(), ['comment', 'upvote']);
});

// ---- happy: transfer stage --------------------------------------------------

test('transfer stage (first_organic_upvote) → celebrate + 1 MELEK + comment', () => {
  const r = composeReward('first_organic_upvote', 'bob');
  assert.equal(r.ok, true);
  assert.equal(r.action, 'comment_and_transfer');
  assert.equal(r.upvoteWeight, 0, 'a transfer stage carries no upvote');
  assert.ok(r.transfer, 'transfer op present');
  assert.equal(r.transfer.to, 'bob');
  assert.equal(r.transfer.amount, '1.000 MELEK');
  assert.match(r.transfer.memo, /First organic upvote/);
  assert.ok(r.comment.body.length > 0);
  assert.deepEqual(r.reward.sort(), ['comment', 'transfer']);
});

test('terminal transfer stage marks tutorial_completion', () => {
  const r = composeReward('become_a_node_of_the_network', 'carol');
  assert.equal(r.ok, true);
  assert.equal(r.action, 'comment_and_transfer');
  assert.equal(r.transfer.amount, '1.000 MELEK');
  assert.equal(r.tutorial_completion, true);
});

test('vote_for_a_witness is an upvote stage flagged tutorial_completion', () => {
  const r = composeReward('vote_for_a_witness', 'dave');
  assert.equal(r.ok, true);
  assert.equal(r.upvoteWeight, 10000);
  assert.equal(r.tutorial_completion, true);
});

// ---- shape: every stage composes a valid reward -----------------------------

test('every stage in stages.json composes a deterministic, valid reward', async () => {
  // Read the real doc once to enumerate keys.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = (await import('node:path')).default;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const doc = JSON.parse(readFileSync(path.join(here, 'stages.json'), 'utf8'));

  for (const stage of doc.stages) {
    const a = composeReward(stage.key, 'someuser');
    const b = composeReward(stage.key, 'someuser');
    assert.deepEqual(a, b, `non-deterministic output for ${stage.key}`);
    assert.equal(a.ok, true, `composeReward failed for ${stage.key}`);
    assert.ok(a.reward.includes('comment'), `${stage.key} must include a comment`);
    if (a.action === 'comment_and_transfer') {
      assert.ok(a.transfer, `${stage.key} transfer op missing`);
      assert.match(a.transfer.amount, / MELEK$/);
    } else {
      assert.ok(a.upvoteWeight >= -10000 && a.upvoteWeight <= 10000, `${stage.key} weight out of range`);
    }
  }
});

// ---- edge: unknown / bad input soft-fails (never throws) ---------------------

test('unknown stage soft-fails with ok:false, no throw', () => {
  const r = composeReward('no_such_stage', 'eve');
  assert.equal(r.ok, false);
  assert.equal(r.upvoteWeight, 0);
  assert.match(r.error, /unknown stage/);
});

test('missing stageKey / account soft-fail', () => {
  const a = composeReward('', 'frank');
  assert.equal(a.ok, false);
  assert.match(a.error, /stageKey required/);
  const b = composeReward('intro_post', '');
  assert.equal(b.ok, false);
  assert.match(b.error, /account required/);
  // null inputs do not throw
  assert.equal(composeReward(null, null).ok, false);
});

test('a broken stages reader soft-fails to unknown stage, no throw', () => {
  __setReader(() => {
    throw new Error('disk gone');
  });
  const r = composeReward('intro_post', 'grace');
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown stage/);
});

// ---- esc(): account is neutralized in comment/transfer ----------------------

test('account interpolation is esc-escaped in comment and transfer', () => {
  const r = composeReward('first_organic_upvote', 'a<b>&c');
  assert.ok(!r.comment.body.includes('<b>'), 'angle brackets must be escaped in comment');
  assert.match(r.comment.body, /&lt;b&gt;/);
  assert.equal(r.transfer.to, 'a&lt;b&gt;&amp;c');
});

test('esc neutralizes control chars and markup', () => {
  assert.equal(esc('a\x00b<c>&d'), 'ab&lt;c&gt;&amp;d');
  assert.equal(esc(null), '');
});

// ---- upvote_weight clamping via injected reader -----------------------------

test('out-of-range upvote_weight is clamped to [-10000,10000]', () => {
  __setReader(() => ({
    stages: [
      {
        id: 99,
        key: 'odd',
        witness_response: { action: 'comment_and_upvote', upvote_weight: 999999 },
      },
    ],
  }));
  const r = composeReward('odd', 'heidi');
  assert.equal(r.ok, true);
  assert.equal(r.upvoteWeight, 10000);
});

// ---- broadcastReward: injected sink (zero-WIF) ------------------------------

test('broadcastReward returns the plan when no sink is injected', async () => {
  const res = await broadcastReward('intro_post', 'ivan');
  assert.equal(res.ok, true);
  assert.equal(res.sent, false);
  assert.equal(res.plan.action, 'comment_and_upvote');
});

test('broadcastReward dispatches to the injected sink and marks sent', async () => {
  const seen = [];
  const res = await broadcastReward('first_organic_upvote', 'judy', {
    broadcast: async (plan) => {
      seen.push(plan);
      return { txid: 'deadbeef' };
    },
    permlink: 'some-permlink',
  });
  assert.equal(res.ok, true);
  assert.equal(res.sent, true);
  assert.equal(res.result.txid, 'deadbeef');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].permlink, 'some-permlink');
  assert.equal(seen[0].transfer.amount, '1.000 MELEK');
});

test('broadcastReward soft-fails on a throwing sink (never throws)', async () => {
  const res = await broadcastReward('intro_post', 'ken', {
    broadcast: async () => {
      throw new Error('signer offline');
    },
  });
  assert.equal(res.ok, false);
  assert.equal(res.sent, false);
  assert.match(res.error, /signer offline/);
});

test('broadcastReward respects an injected idempotency store', async () => {
  const mem = new Map();
  __setStore({
    has: async (k) => mem.has(k),
    put: async (k, v) => void mem.set(k, v),
  });
  let calls = 0;
  const sink = async () => {
    calls += 1;
    return { ok: true };
  };
  const first = await broadcastReward('intro_post', 'leo', { broadcast: sink });
  assert.equal(first.sent, true);
  const second = await broadcastReward('intro_post', 'leo', { broadcast: sink });
  assert.equal(second.sent, false);
  assert.equal(second.skipped, true);
  assert.equal(calls, 1, 'sink must not be called twice for the same reward');
});

test('broadcastReward returns ok:false for an unknown stage', async () => {
  const res = await broadcastReward('no_such_stage', 'mia', { broadcast: async () => ({}) });
  assert.equal(res.ok, false);
  assert.equal(res.sent, false);
});
