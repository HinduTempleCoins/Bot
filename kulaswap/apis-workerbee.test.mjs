// apis-workerbee.test.mjs — offline node:test suite for the WorkerBee APIS-mining mechanics.
// No network, no Math.random (rng injected), soft-fail shapes asserted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  apisRate, apisAccrued, expectedMine, lotteryDraw,
  claimable, canUnstake, checkpoint, renderMineFragment,
  DEFAULT_WORKERBEE,
} from './apis-workerbee.mjs';

const DAY_MS = 86400 * 1000;

// ── apisRate: share math ─────────────────────────────────────────────────────────────────────────
test('apisRate = emission × stake/total', () => {
  assert.equal(apisRate({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000 }), 100);
  assert.equal(apisRate({ stakedWmelek: 5000, totalStaked: 10000, emissionPerDay: 1000 }), 500);
});

test('apisRate: sole miner gets the whole emission', () => {
  assert.equal(apisRate({ stakedWmelek: 500, totalStaked: 500, emissionPerDay: 1000 }), 1000);
});

test('apisRate: share is capped at 1 even if stake > total', () => {
  assert.equal(apisRate({ stakedWmelek: 20000, totalStaked: 10000, emissionPerDay: 1000 }), 1000);
});

// ── apisAccrued: over time ──────────────────────────────────────────────────────────────────────
test('apisAccrued is linear in days when no halving', () => {
  const r = apisRate({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000 }); // 100/day
  assert.equal(apisAccrued({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, days: 30 }), r * 30);
  assert.equal(apisAccrued({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, days: 0.5 }), r * 0.5);
});

test('apisAccrued with halving < linear and matches the piecewise sum', () => {
  // 100/day, halve every 10 days, 30 days => 10d@100 + 10d@50 + 10d@25 = 1750 (linear would be 3000)
  const got = apisAccrued({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, days: 30, halvingDays: 10 });
  assert.equal(got, 1750);
  assert.ok(got < 3000);
});

// ── two stakers split the emission by share ──────────────────────────────────────────────────────
test('two stakers split a fixed emission by share, summing to the emission', () => {
  const total = 4000, emissionPerDay = 800;
  const a = apisRate({ stakedWmelek: 1000, totalStaked: total, emissionPerDay }); // 25% → 200
  const b = apisRate({ stakedWmelek: 3000, totalStaked: total, emissionPerDay }); // 75% → 600
  assert.equal(a, 200);
  assert.equal(b, 600);
  assert.equal(a + b, emissionPerDay);
});

// ── expectedMine ─────────────────────────────────────────────────────────────────────────────────
test('expectedMine = emissionPerTick × share', () => {
  assert.equal(expectedMine({ stake: 1000, totalStake: 10000, emissionPerTick: 1 }), 0.1);
  assert.equal(expectedMine({ stake: 2500, totalStake: 5000, emissionPerTick: 4 }), 2);
});

// ── lotteryDraw: deterministic & fair over many injected draws ─────────────────────────────────────
test('lotteryDraw wins iff rng < share, takes the whole tick', () => {
  // share = 0.1
  assert.equal(lotteryDraw(1000, 10000, 5, 0.05), 5); // win
  assert.equal(lotteryDraw(1000, 10000, 5, 0.5), 0);  // lose
  assert.equal(lotteryDraw(1000, 10000, 5, 0.0999), 5);
  assert.equal(lotteryDraw(1000, 10000, 5, 0.1001), 0);
});

test('lottery expected value over many seeded draws ≈ fair share (within 2%)', () => {
  // deterministic mulberry32 PRNG — NO Math.random (well-mixed bits → unbiased uniform)
  let a = 0x9e3779b9 >>> 0;
  const rng = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const stake = 1500, total = 10000, emissionPerTick = 1, ticks = 300000;
  let won = 0;
  for (let i = 0; i < ticks; i++) won += lotteryDraw(stake, total, emissionPerTick, rng());
  const avg = won / ticks;
  const expected = expectedMine({ stake, totalStake: total, emissionPerTick }); // 0.15
  const drift = Math.abs(avg - expected) / expected;
  assert.ok(drift < 0.02, `lottery avg ${avg} vs expected ${expected} drift ${(drift * 100).toFixed(2)}% should be < 2%`);
});

// ── claimable / accrual checkpoints ────────────────────────────────────────────────────────────────
test('claimable accrues from lastClaim to now', () => {
  const now = 10 * DAY_MS;
  const st = { stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, lastClaim: 0 };
  const c = claimable(st, now); // 100/day × 10 days
  assert.equal(c.apis, 1000);
  assert.equal(c.days, 10);
  assert.equal(c.ratePerDay, 100);
});

test('claimable never goes negative if now < lastClaim', () => {
  const c = claimable({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, lastClaim: 5 * DAY_MS }, 1 * DAY_MS);
  assert.equal(c.apis, 0);
  assert.equal(c.days, 0);
});

test('checkpoint crystallizes accrued APIS and resets lastClaim', () => {
  const now = 10 * DAY_MS;
  const st = { stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, lastClaim: 0 };
  const next = checkpoint(st, { deltaStake: 500, now });
  assert.equal(next.claimed, 1000);          // 10 days of accrual harvested
  assert.equal(next.stakedWmelek, 1500);     // stake increased
  assert.equal(next.lastClaim, now);         // accrual clock reset
  // immediately after, nothing more is claimable
  assert.equal(claimable(next, now).apis, 0);
});

// ── lock period enforcement ─────────────────────────────────────────────────────────────────────
test('canUnstake honours lockUntil', () => {
  const st = { lockUntil: 30 * DAY_MS };
  assert.equal(canUnstake(st, 10 * DAY_MS), false);
  assert.equal(canUnstake(st, 30 * DAY_MS), true);
  assert.equal(canUnstake(st, 40 * DAY_MS), true);
  assert.equal(canUnstake({}, 0), true); // no lock
});

test('canUnstake: Infinity lockUntil = locked forever', () => {
  assert.equal(canUnstake({ lockUntil: Infinity }, 1e15), false);
});

test('checkpoint refuses an unstake before the lock elapses, keeps state', () => {
  const st = { stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, lastClaim: 0, lockUntil: 30 * DAY_MS };
  const r = checkpoint(st, { deltaStake: -500, now: 10 * DAY_MS });
  assert.equal(r.error, 'lock period not elapsed');
  assert.equal(r.stakedWmelek, 1000); // unchanged
});

test('checkpoint allows unstake after the lock elapses', () => {
  const st = { stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, lastClaim: 0, lockUntil: 30 * DAY_MS };
  const r = checkpoint(st, { deltaStake: -400, now: 31 * DAY_MS });
  assert.equal(r.error, undefined);
  assert.equal(r.stakedWmelek, 600);
});

test('checkpoint refuses unstaking more than locked', () => {
  const st = { stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, lastClaim: 0 };
  const r = checkpoint(st, { deltaStake: -5000, now: DAY_MS });
  assert.equal(r.error, 'unstake exceeds locked amount');
  assert.equal(r.stakedWmelek, 1000);
});

// ── failure paths return safe shapes ──────────────────────────────────────────────────────────────
test('rate/accrued/expected soft-fail to 0 on bad inputs', () => {
  assert.equal(apisRate({}), 0);
  assert.equal(apisRate({ stakedWmelek: 0, totalStaked: 0, emissionPerDay: 0 }), 0);
  assert.equal(apisRate({ stakedWmelek: -5, totalStaked: 100, emissionPerDay: 10 }), 0);
  assert.equal(apisAccrued({ days: 30 }), 0);
  assert.equal(apisAccrued({ stakedWmelek: 100, totalStaked: 1000, emissionPerDay: 10, days: -1 }), 0);
  assert.equal(expectedMine({}), 0);
});

test('lotteryDraw soft-fails to 0 on bad rng / bad inputs', () => {
  assert.equal(lotteryDraw(1000, 10000, 5, NaN), 0);
  assert.equal(lotteryDraw(1000, 10000, 5, undefined), 0);
  assert.equal(lotteryDraw(0, 10000, 5, 0.01), 0);
  assert.equal(lotteryDraw(1000, 0, 5, 0.01), 0);
  assert.equal(lotteryDraw(1000, 10000, 0, 0.01), 0);
  // rng clamped: negative treated as 0 (a sure win at any positive share)
  assert.equal(lotteryDraw(1000, 10000, 5, -1), 5);
  // rng >= 1 clamped below 1 → only wins at share 1
  assert.equal(lotteryDraw(10000, 10000, 5, 2), 5);
  assert.equal(lotteryDraw(1000, 10000, 5, 2), 0);
});

test('claimable returns a safe shape on empty state', () => {
  const c = claimable({}, 1000);
  assert.equal(c.apis, 0);
  assert.equal(c.ratePerDay, 0);
  assert.equal(typeof c.asOf, 'number');
});

// ── UI fragment: esc'd, shows the figures ─────────────────────────────────────────────────────────
test('renderMineFragment is a string with computed figures and is HTML-escaped', () => {
  const html = renderMineFragment({ stakedWmelek: 1000, totalStaked: 10000, emissionPerDay: 1000, projectDays: 30 });
  assert.equal(typeof html, 'string');
  assert.ok(html.includes('Mine APIS'));
  assert.ok(html.includes('100 APIS'));   // APIS/day
  assert.ok(html.includes('3000 APIS'));  // 30-day projection (no halving)
  assert.ok(html.includes('data-apis-workerbee'));
});

test('renderMineFragment escapes a hostile onMine handler name', () => {
  const html = renderMineFragment({ stakedWmelek: 1, totalStaked: 1, onMine: '"><script>x' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('renderMineFragment previews a fresh hive (totalStaked 0) using the user stake', () => {
  const html = renderMineFragment({ stakedWmelek: 100, totalStaked: 0, emissionPerDay: 1000 });
  assert.ok(html.includes('100%'));        // sole miner = 100% share
  assert.ok(html.includes('1000 APIS'));   // gets the whole emission/day
});

test('DEFAULT_WORKERBEE is frozen with the documented shape', () => {
  assert.ok(Object.isFrozen(DEFAULT_WORKERBEE));
  assert.equal(DEFAULT_WORKERBEE.emissionPerDay, 1000);
  assert.equal(DEFAULT_WORKERBEE.lockDays, 0);
  assert.equal(DEFAULT_WORKERBEE.halvingDays, 0);
});

import { apisHash, foreverLock, FOREVER } from './apis-workerbee.mjs';
test('apisHash: 1:1 mining power, soft-fails to 0', () => {
  assert.equal(apisHash(1000), 1000);
  assert.equal(apisHash(0), 0);
  assert.equal(apisHash(-5), 0);
  assert.equal(apisHash('x'), 0);
});
test('foreverLock: locks wMELEK forever (never unstakable)', () => {
  const s = foreverLock(500);
  assert.equal(s.stakedWmelek, 500);
  assert.equal(s.lockUntil, FOREVER);
  assert.equal(canUnstake(s, Date.now()), false);          // forever = can't unstake now
  assert.equal(canUnstake(s, Date.now() + 1e15), false);   // ...or ever
});
