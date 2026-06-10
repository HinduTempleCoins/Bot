// spamtest/limits.test.mjs — offline. Run: node --test spamtest/limits.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAIN_DEFAULTS, chainLimits, replayChainConsensus, bandwidthVerdict,
  applicationLimiter, POLICY,
  rcMeter, simulateSpam, RC_COST, RC_REGEN_SEC, MIN_REPLY_INTERVAL_HF20_SEC,
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

// ── RESOURCE CREDITS (RC) ─────────────────────────────────────────────────────────

test('rcMeter: zero stake → every op blocked (cannot post until delegated POWER)', () => {
  const m = rcMeter({ max: 0, now: () => 0 });
  const v = m.check('comment');
  assert.equal(v.allowed, false);
  assert.match(v.reason, /no RC|0 staked/);
  assert.equal(v.retryAfterSec, Infinity);
});

test('rcMeter: a funded account spends until depleted, then blocks', () => {
  let now = 0;
  // budget = 2.5 comments' worth (comment cost 1000)
  const m = rcMeter({ max: 2500, now: () => now });
  assert.equal(m.charge('comment').allowed, true);  // 1500 left
  assert.equal(m.charge('comment').allowed, true);  // 500 left
  const v = m.charge('comment');                     // need 1000, have 500
  assert.equal(v.allowed, false);
  assert.match(v.reason, /insufficient RC/);
  assert.ok(v.retryAfterSec > 0 && Number.isFinite(v.retryAfterSec));
});

test('rcMeter: pool recovers over time (regen) and lets a blocked op through later', () => {
  let now = 0;
  const m = rcMeter({ max: 1000, current: 0, regenSec: 1000, now: () => now }); // empty pool
  assert.equal(m.check('comment').allowed, false);   // need 1000, have 0
  now = 1000 * 1000;                                  // a full regen window later
  assert.equal(m.check('comment').allowed, true);    // back to full → affordable
});

test('rcMeter: regen never exceeds capacity', () => {
  let now = 0;
  const m = rcMeter({ max: 1000, current: 1000, regenSec: 100, now: () => now });
  now = 10 * 100 * 1000; // way past full regen
  assert.equal(Math.floor(m.available()), 1000);
});

test('rcMeter: votes are cheaper than comments', () => {
  assert.ok(RC_COST.vote < RC_COST.comment);
  assert.ok(RC_COST.comment <= RC_COST.post);
  assert.equal(RC_REGEN_SEC, 432_000); // 5 days
});

// ── simulateSpam ──────────────────────────────────────────────────────────────────

test('simulateSpam: 0-RC account is fully blocked regardless of spacing', () => {
  const r = simulateSpam({ ops: 10, intervalMs: 60_000, rcBudget: 0, kind: 'comment' });
  assert.equal(r.summary.accepted, 0);
  assert.equal(r.summary.rejected, 10);
  assert.equal(r.summary.byReason['rc-zero'], 10);
  assert.equal(r.rcRemaining, 0);
});

test('simulateSpam: instant comment flood is spaced by the consensus interval (HF20 3s)', () => {
  // plenty of RC; 10 comments fired in the SAME instant. Only the first clears the 3s gap.
  const r = simulateSpam({
    ops: 10, intervalMs: 0, rcBudget: 1_000_000, kind: 'comment',
    minIntervalSec: MIN_REPLY_INTERVAL_HF20_SEC,
  });
  assert.equal(r.summary.accepted, 1);
  assert.equal(r.summary.byReason['consensus-interval'], 9);
});

test('simulateSpam: comments spaced past 3s all pass (enough RC)', () => {
  const r = simulateSpam({
    ops: 5, intervalMs: 3500, rcBudget: 1_000_000, kind: 'comment',
    minIntervalSec: MIN_REPLY_INTERVAL_HF20_SEC,
  });
  assert.equal(r.summary.accepted, 5);
  assert.equal(r.summary.rejected, 0);
});

test('simulateSpam: spaced past the interval but RC runs out → rc-depleted rejections', () => {
  // 5 comments spaced 4s apart (clears the 3s gap), but budget only covers 2 comments.
  const r = simulateSpam({
    ops: 5, intervalMs: 4000, rcBudget: 2000, kind: 'comment',
    regenSec: 432_000, minIntervalSec: MIN_REPLY_INTERVAL_HF20_SEC,
  });
  assert.equal(r.summary.accepted, 2);                 // 2000 / 1000 per comment
  assert.equal(r.summary.byReason['rc-depleted'], 3);  // the rest priced out
});

test('simulateSpam: RC regen mid-burst lets a later op through', () => {
  // budget = 1 comment; regen window short enough that ~1 comment regenerates every 10s.
  // Fire 3 comments spaced 11s apart: #1 spends it, #2 after regen, #3 after regen.
  const r = simulateSpam({
    ops: 3, intervalMs: 11_000, rcBudget: 1000, kind: 'comment',
    regenSec: 10, minIntervalSec: MIN_REPLY_INTERVAL_HF20_SEC,
  });
  assert.equal(r.summary.accepted, 3);
});

test('simulateSpam: default kind is comment and default rcBudget blocks (safe default)', () => {
  const r = simulateSpam({ ops: 3 });
  assert.equal(r.summary.accepted, 0); // rcBudget defaults to 0 → blocked
});
