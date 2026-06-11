// xp-leveling.test.mjs — OFFLINE tests for the pure MEE6-style XP engine (e150fd639d).
// No network. Asserts: curve/inverse round-trip, cooldown suppression, deterministic award
// via seeded rng, level-up detection, leaderboard order, and soft-fail on junk input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  xpForLevel, levelForXp, xpToReachNext,
  awardMessageXp, leaderboard, progress,
  esc, renderProgress,
} from './xp-leveling.mjs';

// Deterministic rng factory: cycles through fixed values in [0,1).
function seededRng(values) {
  let i = 0;
  return () => values[(i++) % values.length];
}

test('xpToReachNext matches the MEE6 formula 5*L^2+50*L+100', () => {
  assert.equal(xpToReachNext(0), 100);
  assert.equal(xpToReachNext(1), 155);
  assert.equal(xpToReachNext(5), 475);
});

test('xpForLevel is cumulative; level 0 == 0', () => {
  assert.equal(xpForLevel(0), 0);
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(2), 100 + 155); // 255
});

test('curve / inverse round-trip for many levels', () => {
  for (let L = 0; L <= 100; L++) {
    const cum = xpForLevel(L);
    assert.equal(levelForXp(cum), L, `round-trip at level ${L}`);
    // One XP short of the level boundary should be the previous level.
    if (L > 0) assert.equal(levelForXp(cum - 1), L - 1, `boundary minus one at ${L}`);
  }
});

test('levelForXp soft-clamps negatives and junk to 0', () => {
  assert.equal(levelForXp(-500), 0);
  assert.equal(levelForXp('not a number'), 0);
  assert.equal(levelForXp(NaN), 0);
});

test('progress reports intoLevel / neededForNext / pct correctly', () => {
  // Sitting exactly at the start of level 2.
  const base2 = xpForLevel(2);
  const p = progress(base2);
  assert.equal(p.level, 2);
  assert.equal(p.intoLevel, 0);
  assert.equal(p.neededForNext, xpToReachNext(2));
  assert.equal(p.pct, 0);

  // Halfway-ish into level 0 (needs 100).
  const p0 = progress(50);
  assert.equal(p0.level, 0);
  assert.equal(p0.intoLevel, 50);
  assert.equal(p0.neededForNext, 100);
  assert.equal(p0.pct, 0.5);
});

test('awardMessageXp is deterministic with a seeded rng (min..max inclusive)', () => {
  // rng=0 -> min (15); rng just under 1 -> max (25).
  let res = awardMessageXp({}, { userId: 'u1', now: 0, rng: () => 0 });
  assert.equal(res.awarded, true);
  assert.equal(res.amount, 15);
  assert.equal(res.state.users.u1.xp, 15);
  assert.equal(res.state.users.u1.messages, 1);

  res = awardMessageXp({}, { userId: 'u1', now: 0, rng: () => 0.999999 });
  assert.equal(res.amount, 25);
});

test('cooldown suppresses a second award inside the window', () => {
  const first = awardMessageXp({}, { userId: 'u1', now: 1000, cooldownSec: 60, rng: () => 0 });
  assert.equal(first.awarded, true);

  // 30s later — still on cooldown.
  const second = awardMessageXp(first.state, { userId: 'u1', now: 31000, cooldownSec: 60, rng: () => 0 });
  assert.equal(second.awarded, false);
  assert.equal(second.onCooldown, true);
  assert.equal(second.state.users.u1.xp, 15); // unchanged

  // 61s after the first — cooldown elapsed, awards again.
  const third = awardMessageXp(first.state, { userId: 'u1', now: 62000, cooldownSec: 60, rng: () => 0 });
  assert.equal(third.awarded, true);
  assert.equal(third.state.users.u1.xp, 30);
});

test('level-up is detected when cumulative XP crosses a boundary', () => {
  // Drive a user up with max XP rolls past the level-0 boundary (100).
  const rng = () => 0.999999; // always 25
  let state = {};
  let leveledAt = null;
  for (let i = 0; i < 10; i++) {
    const res = awardMessageXp(state, { userId: 'u1', now: i * 100000, rng });
    state = res.state;
    if (res.leveledUp) { leveledAt = { i, newLevel: res.newLevel, oldLevel: res.oldLevel }; break; }
  }
  assert.ok(leveledAt, 'should level up at some point');
  // After 5 awards (125 XP) we cross 100 -> level 1.
  assert.equal(state.users.u1.level, 1);
  assert.equal(leveledAt.oldLevel, 0);
  assert.equal(leveledAt.newLevel, 1);
});

test('leaderboard sorts by xp desc, ranks, and honors limit', () => {
  const state = {
    users: {
      alice: { xp: 300, level: 2, messages: 20 },
      bob:   { xp: 900, level: 4, messages: 50 },
      carol: { xp: 300, level: 2, messages: 25 }, // ties alice on xp, more messages -> ranks higher
    },
  };
  const board = leaderboard(state, {});
  assert.deepEqual(board.map(r => r.userId), ['bob', 'carol', 'alice']);
  assert.equal(board[0].rank, 1);
  assert.equal(board[2].rank, 3);

  const top1 = leaderboard(state, { limit: 1 });
  assert.equal(top1.length, 1);
  assert.equal(top1[0].userId, 'bob');
});

test('soft-fail: missing userId is a no-op, junk state tolerated', () => {
  const r1 = awardMessageXp({}, { now: 0, rng: () => 0 }); // no userId
  assert.equal(r1.awarded, false);
  assert.deepEqual(r1.state.users, {});

  const r2 = awardMessageXp(null, { userId: 'x', now: 0, rng: () => 0 });
  assert.equal(r2.awarded, true);
  assert.equal(r2.state.users.x.xp, 15);

  // leaderboard on junk returns [].
  assert.deepEqual(leaderboard(null, {}), []);
  assert.deepEqual(leaderboard(undefined, {}), []);
});

test('soft-fail: out-of-range rng is clamped (treated as 0 -> min)', () => {
  const r = awardMessageXp({}, { userId: 'u', now: 0, min: 15, max: 25, rng: () => 5 });
  assert.equal(r.amount, 15);
});

test('esc escapes HTML and renderProgress uses it', () => {
  assert.equal(esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  const line = renderProgress('<x>', 50);
  assert.ok(line.includes('&lt;x&gt;'));
  assert.ok(line.includes('level 0'));
});
