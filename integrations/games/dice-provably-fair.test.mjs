// dice-provably-fair.test.mjs — offline unit tests for the provably-fair dice engine.
// node --test, fully offline (pure module, no network/keys/clock). Verifies determinism, the
// commit-reveal verifier (accept correct / reject tampered), settleBet math, edge→EV, uniformity,
// XSS-escape, and soft-fail-never-throw on garbage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

import {
  commit, roll, settleBet, verify, esc, winChance, fairMultiplier, ROLL_MAX, DEFAULTS,
} from './dice-provably-fair.mjs';

const SEED = 'server-seed-abc123';
const CLIENT = 'player-client-seed';

test('commit() equals SHA256(serverSeed) — the published commitment', () => {
  const expected = createHash('sha256').update(SEED, 'utf8').digest('hex');
  assert.equal(commit(SEED), expected);
  assert.equal(commit(SEED).length, 64);
});

test('roll() is deterministic for fixed seeds+nonce', () => {
  const a = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 7 });
  const b = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 7 });
  assert.deepEqual(a, b);
  assert.ok(a.roll >= 0 && a.roll < ROLL_MAX);
  assert.ok(a.float >= 0 && a.float < 1);
  // Matches the documented HMAC construction (key=serverSeed, msg=`clientSeed:nonce`).
  const hex = createHmac('sha256', SEED).update(`${CLIENT}:7`, 'utf8').digest('hex');
  assert.equal(a.hmac, hex);
});

test('roll() changes with nonce and with client seed', () => {
  const r0 = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 0 }).roll;
  const r1 = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 1 }).roll;
  const rc = roll({ serverSeed: SEED, clientSeed: 'other', nonce: 0 }).roll;
  assert.notEqual(r0, r1);
  assert.notEqual(r0, rc);
});

test('verify() accepts a correct roll', () => {
  const hash = commit(SEED);
  const { roll: r } = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 42 });
  assert.equal(verify({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 42, roll: r }), true);
});

test('verify() rejects a tampered roll, seed, hash, or nonce', () => {
  const hash = commit(SEED);
  const { roll: r } = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 42 });
  // tampered roll value
  assert.equal(verify({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 42, roll: r === 0 ? 1 : r - 1 }), false);
  // tampered server seed (hash no longer matches → commitment broken)
  assert.equal(verify({ serverSeed: SEED + 'x', serverSeedHash: hash, clientSeed: CLIENT, nonce: 42, roll: r }), false);
  // tampered published hash
  assert.equal(verify({ serverSeed: SEED, serverSeedHash: 'deadbeef', clientSeed: CLIENT, nonce: 42, roll: r }), false);
  // wrong nonce
  assert.equal(verify({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 43, roll: r }), false);
});

test('settleBet() over/under win logic', () => {
  // roll 6000, target 5000, over → win
  const over = settleBet({ roll: 6000, target: 5000, over: true, betAmount: 100, edgeBps: 0 });
  assert.equal(over.win, true);
  // roll 6000, target 5000, under → lose
  const under = settleBet({ roll: 6000, target: 5000, over: false, betAmount: 100, edgeBps: 0 });
  assert.equal(under.win, false);
  // roll 4000, under 5000 → win
  const under2 = settleBet({ roll: 4000, target: 5000, over: false, betAmount: 100, edgeBps: 0 });
  assert.equal(under2.win, true);
});

test('settleBet() payout math with zero edge is exactly fair', () => {
  // over 5000 → 4999 winning outcomes (5001..9999). multiplier = 10000/4999.
  const s = settleBet({ roll: 9000, target: 5000, over: true, betAmount: 100, edgeBps: 0 });
  assert.equal(s.win, true);
  assert.equal(s.multiplier, ROLL_MAX / 4999);
  assert.ok(Math.abs(s.payout - 100 * (ROLL_MAX / 4999)) < 1e-9);
  // losing bet pays nothing
  const l = settleBet({ roll: 100, target: 5000, over: true, betAmount: 100, edgeBps: 0 });
  assert.equal(l.win, false);
  assert.equal(l.payout, 0);
  assert.equal(l.profit, -100);
});

test('winChance() counts outcomes correctly for over and under', () => {
  assert.equal(winChance(5000, true), 4999);   // 5001..9999
  assert.equal(winChance(5000, false), 5000);  // 0..4999
  assert.equal(winChance(0, false), 0);        // nothing is < 0-band
  assert.equal(winChance(9999, true), 0);      // nothing is > 9999
});

test('house edge reduces EV / multiplier as configured', () => {
  const w = winChance(5000, true);
  const fair = fairMultiplier(w, 0);
  const withEdge = fairMultiplier(w, 100); // 1%
  // 1% edge → multiplier is exactly 99% of fair.
  assert.ok(Math.abs(withEdge - fair * 0.99) < 1e-9);
  // EV per unit staked = winChance * multiplier < 1 with a positive edge.
  const p = w / ROLL_MAX;
  const evFair = p * fair;
  const evEdge = p * withEdge;
  assert.ok(Math.abs(evFair - 1) < 1e-9);      // zero-edge game is break-even EV
  assert.ok(evEdge < 1);                        // positive edge is house-favorable
  assert.ok(Math.abs(evEdge - 0.99) < 1e-9);
});

test('rolls are approximately uniform over the 0..9999 band (no modulo bias)', () => {
  const buckets = new Array(10).fill(0);
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const r = roll({ serverSeed: SEED, clientSeed: CLIENT, nonce: i }).roll;
    buckets[Math.floor(r / 1000)]++;
  }
  // Each decile should hold ~10% (500). Allow a generous band; just prove it's not degenerate.
  for (const b of buckets) assert.ok(b > 300 && b < 700, `bucket ${b} out of expected band`);
});

test('esc() escapes XSS-significant characters', () => {
  assert.equal(esc(`<script>"&'`), '&lt;script&gt;&quot;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('soft-fail: never throws on garbage input', () => {
  assert.doesNotThrow(() => commit(undefined));
  assert.doesNotThrow(() => commit({ a: 1 }));
  assert.doesNotThrow(() => roll());
  assert.doesNotThrow(() => roll({ serverSeed: null, clientSeed: undefined, nonce: 'NaN' }));
  assert.doesNotThrow(() => roll({ serverSeed: {}, clientSeed: [], nonce: {} }));
  assert.doesNotThrow(() => settleBet());
  assert.doesNotThrow(() => settleBet({ roll: 'x', target: 'y', betAmount: 'z', edgeBps: 'q' }));
  assert.doesNotThrow(() => verify());
  assert.doesNotThrow(() => verify({ serverSeed: {}, serverSeedHash: null }));
  // and they return well-formed values
  const r = roll({ serverSeed: null, clientSeed: null, nonce: null });
  assert.ok(r.roll >= 0 && r.roll < ROLL_MAX);
  assert.equal(verify({}), false);
  assert.equal(settleBet({}).win, false);
});

test('garbage/negative edge is clamped, never inverts EV', () => {
  const w = winChance(5000, true);
  assert.equal(fairMultiplier(w, -500), fairMultiplier(w, 0)); // negative edge clamped to 0
  assert.equal(fairMultiplier(0, 100), 0);                      // zero winning outcomes → 0 multiplier
  assert.ok(fairMultiplier(w, 99999) >= 0);                     // absurd edge clamped, stays finite
});

test('DEFAULTS are sane', () => {
  assert.equal(DEFAULTS.edgeBps, 100);
  assert.equal(ROLL_MAX, 10000);
});
