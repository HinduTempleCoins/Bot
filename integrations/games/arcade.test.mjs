import { test } from 'node:test';
import assert from 'node:assert';
import {
  startSession, submitScore, leaderboard, reward, plausible, payoutFor,
  __setNow, __reset, RULES,
} from './arcade.mjs';

test('session lifecycle: start -> submit plausible score -> single-use', () => {
  __reset();
  let t = 1_000_000;
  __setNow(() => t);
  try {
    const token = startSession('alice');
    assert.ok(typeof token === 'string' && token.length > 0, 'returns a token');

    t += 10_000; // 10s of play, 50 events, 1500 pts — well within ceilings
    const first = submitScore({ sessionToken: token, score: 1500, events: 50 });
    assert.equal(first.accepted, true, 'plausible score accepted');
    assert.equal(first.score, 1500);

    const second = submitScore({ sessionToken: token, score: 1500, events: 50 });
    assert.equal(second.accepted, false, 'session is single-use');
    assert.match(second.reason, /already submitted/);

    const bogus = submitScore({ sessionToken: 'not-a-real-token', score: 10, events: 1 });
    assert.equal(bogus.accepted, false, 'unknown session rejected');
    assert.match(bogus.reason, /unknown|invalid/);
  } finally {
    __setNow(null);
  }
});

test('startSession requires a user', () => {
  __reset();
  assert.throws(() => startSession(''), /user required/);
  assert.throws(() => startSession('   '), /user required/);
});

test('implausible scores are rejected (anti-cheat)', () => {
  __reset();
  let t = 5_000_000;
  __setNow(() => t);
  try {
    // too many points for the reported events
    const tok1 = startSession('cheater1');
    t += 10_000;
    const r1 = submitScore({ sessionToken: tok1, score: 999999, events: 3 });
    assert.equal(r1.accepted, false);
    assert.match(r1.reason, /events/);

    // too many points for the elapsed time (rate ceiling), even with many events
    const tok2 = startSession('cheater2');
    t += 1_000; // only 1 second elapsed
    const overRate = RULES.maxPointsPerSecond * 1 + 1000;
    const r2 = submitScore({ sessionToken: tok2, score: overRate, events: 10_000 });
    assert.equal(r2.accepted, false);
    assert.match(r2.reason, /rate|time/);

    // instant submission (session too short)
    const tok3 = startSession('cheater3');
    const r3 = submitScore({ sessionToken: tok3, score: 10, events: 1 });
    assert.equal(r3.accepted, false);
    assert.match(r3.reason, /too short/);

    // non-integer / negative score
    assert.equal(plausible({ score: -5, events: 10, elapsedMs: 5000 }).ok, false);
    assert.equal(plausible({ score: 1.5, events: 10, elapsedMs: 5000 }).ok, false);
    // accepts events as array length too
    assert.equal(plausible({ score: 50, events: [1, 2, 3], elapsedMs: 5000 }).ok, true);
  } finally {
    __setNow(null);
  }
});

test('expired session is rejected', () => {
  __reset();
  let t = 9_000_000;
  __setNow(() => t);
  try {
    const tok = startSession('slowpoke');
    t += RULES.maxSessionMs + 1;
    const r = submitScore({ sessionToken: tok, score: 100, events: 10 });
    assert.equal(r.accepted, false);
    assert.match(r.reason, /expired/);
  } finally {
    __setNow(null);
  }
});

test('leaderboard ordering: highest score first, ties by earliest', () => {
  __reset();
  let t = 2_000_000;
  __setNow(() => t);
  try {
    const play = (user, score, events) => {
      const tok = startSession(user);
      t += 30_000; // generous window
      return submitScore({ sessionToken: tok, score, events });
    };
    play('low', 500, 50);
    play('high', 5000, 100);
    play('mid', 2000, 100);
    // tie: 'tieA' submitted before 'tieB'
    play('tieA', 3000, 100);
    play('tieB', 3000, 100);

    const lb = leaderboard({ limit: 10 });
    assert.equal(lb[0].user, 'high', 'highest first');
    assert.equal(lb[0].rank, 1);
    assert.deepEqual(lb.map((e) => e.user), ['high', 'tieA', 'tieB', 'mid', 'low']);

    const top2 = leaderboard({ limit: 2 });
    assert.equal(top2.length, 2, 'limit honored');
  } finally {
    __setNow(null);
  }
});

test('reward is gated by injected faucet (no faucet -> no payout)', () => {
  // payout schedule
  assert.equal(payoutFor(500), 0, 'below threshold');
  assert.equal(payoutFor(2500), 2);
  assert.equal(payoutFor(99_999), 10, 'capped');

  // no faucet at all -> dry-run, nothing paid
  const none = reward(5000);
  assert.equal(none.funded, false);
  assert.equal(none.amount, 0);
  assert.match(none.reason, /no faucet|dry-run/);
  assert.equal(none.intent.source, 'offerwall-faucet', 'reward sourced from advertiser faucet, not emission');

  // dry-run faucet -> still nothing paid
  const dryFaucet = { dryRun: true, fund: () => { throw new Error('should not fund in dry-run'); } };
  const dry = reward(5000, { faucet: dryFaucet });
  assert.equal(dry.funded, false);
  assert.equal(dry.amount, 0);

  // live faucet -> funds, and the faucet (not this module) performs the transfer
  let funded = null;
  const liveFaucet = { dryRun: false, fund: (intent) => { funded = intent; return { tx: 'abc123' }; } };
  const live = reward(5000, { faucet: liveFaucet });
  assert.equal(live.funded, true);
  assert.equal(live.amount, 5);
  assert.equal(live.receipt.tx, 'abc123');
  assert.ok(funded && funded.amount === 5, 'faucet.fund called with the intent');

  // live faucet but score below threshold -> no payout
  const lowLive = reward(100, { faucet: liveFaucet });
  assert.equal(lowLive.funded, false);
  assert.match(lowLive.reason, /threshold/);
});
