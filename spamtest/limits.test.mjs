// spamtest/limits.test.mjs — offline. Run: node --test spamtest/limits.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAIN_DEFAULTS, chainLimits, replayChainConsensus, bandwidthVerdict,
  applicationLimiter, POLICY,
} from './limits.mjs';

test('chainLimits decodes defaults to the right seconds', () => {
  const { params } = chainLimits({});
  assert.equal(params.rootCommentIntervalSec, 300);   // 5 min
  assert.equal(params.replyIntervalSec, 20);
  assert.equal(params.voteIntervalSec, 3);
  assert.equal(params.bandwidthWindowSec, 604800);
});

test('chainLimits prefers live config over defaults', () => {
  const { params } = chainLimits({ STEEM_MIN_ROOT_COMMENT_INTERVAL: 60_000_000 });
  assert.equal(params.rootCommentIntervalSec, 60); // live value wins
});

test('replayChainConsensus rejects posts fired faster than the interval', () => {
  // 5 posts, 1 second apart — only the first survives the 300s root interval.
  const ops = Array.from({ length: 5 }, (_, i) => ({ kind: 'post', tSec: i }));
  const r = replayChainConsensus(ops, {});
  assert.equal(r.summary.accepted, 1);
  assert.equal(r.summary.rejected, 4);
  assert.match(r.rejected[0].reason, /too soon/);
  assert.ok(r.rejected[0].retryAfterSec > 0);
});

test('replayChainConsensus accepts posts spaced beyond the interval', () => {
  const ops = [{ kind: 'post', tSec: 0 }, { kind: 'post', tSec: 301 }, { kind: 'post', tSec: 700 }];
  const r = replayChainConsensus(ops, {});
  assert.equal(r.summary.accepted, 3);
  assert.equal(r.summary.rejected, 0);
});

test('replayChainConsensus tracks each kind independently', () => {
  // a post and a vote at t=0 don't conflict (different kinds).
  const ops = [{ kind: 'post', tSec: 0 }, { kind: 'vote', tSec: 0 }, { kind: 'vote', tSec: 4 }];
  const r = replayChainConsensus(ops, {});
  assert.equal(r.summary.accepted, 3);
});

test('replayChainConsensus rejects oversized transactions', () => {
  const r = replayChainConsensus([{ kind: 'post', tSec: 0, sizeBytes: 999_999 }], {});
  assert.equal(r.summary.rejected, 1);
  assert.match(r.rejected[0].reason, /too large/);
});

test('bandwidthVerdict: zero stake → ~no affordable ops', () => {
  const v = bandwidthVerdict({ vestsShare: 0 }, {});
  assert.equal(v.affordableOpsPerWindow, 0);
  assert.match(v.note, /zero stake/);
});

test('bandwidthVerdict: more stake → more affordable ops', () => {
  const low = bandwidthVerdict({ vestsShare: 0.0001 }, {}).affordableOpsPerWindow;
  const high = bandwidthVerdict({ vestsShare: 0.01 }, {}).affordableOpsPerWindow;
  assert.ok(high > low);
});

test('applicationLimiter enforces min gap', () => {
  let now = 1_000_000;
  const lim = applicationLimiter({ policy: POLICY.unverified, now: () => now });
  assert.equal(lim.admit('bot', 'comment').allowed, true);     // 1st ok
  const v = lim.check('bot', 'comment');                        // immediately again
  assert.equal(v.allowed, false);
  assert.match(v.reason, /min gap/);
  now += 61_000;                                                // > 60s later
  assert.equal(lim.admit('bot', 'comment').allowed, true);
});

test('applicationLimiter enforces hourly quota', () => {
  let now = 0;
  const lim = applicationLimiter({ policy: POLICY.unverified, now: () => now });
  // unverified post quota = 2/hour, minGap 600s. Space them past the gap.
  assert.equal(lim.admit('bot', 'post').allowed, true);  now += 601_000;
  assert.equal(lim.admit('bot', 'post').allowed, true);  now += 601_000;
  const v = lim.check('bot', 'post');                     // 3rd within the hour
  assert.equal(v.allowed, false);
  assert.match(v.reason, /hourly quota/);
});

test('applicationLimiter burst guard fires across kinds', () => {
  let now = 0;
  // human policy has loose gaps but burst=8; fire 9 votes in <10s.
  const lim = applicationLimiter({ policy: { ...POLICY.human, vote: { perHour: 999, minGapSec: 0 } }, now: () => now });
  let blocked = 0;
  for (let i = 0; i < 12; i++) { if (!lim.admit('bot', 'vote').allowed) blocked++; now += 100; }
  assert.ok(blocked > 0, 'burst guard should block some ops in a 10s flood');
});

test('applicationLimiter isolates accounts', () => {
  let now = 0;
  const lim = applicationLimiter({ policy: POLICY.unverified, now: () => now });
  lim.admit('a', 'post');
  assert.equal(lim.check('b', 'post').allowed, true); // b unaffected by a
});

test('resident policy is more permissive than unverified', () => {
  assert.ok(POLICY.resident.comment.perHour > POLICY.unverified.comment.perHour);
  assert.ok(POLICY.resident.post.minGapSec <= CHAIN_DEFAULTS.rootCommentIntervalUs / 1e6);
});
