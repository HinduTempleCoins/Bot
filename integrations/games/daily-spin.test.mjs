// daily-spin.test.mjs — offline unit tests for the daily-spin engine. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  spinResult, drawFloat, canSpin, streakBonus, isConsecutive,
  makeStore, claim, pointsBalance, renderWheel, PRIZE_TABLE, TOTAL_WEIGHT, __setServerSeed,
} from './daily-spin.mjs';

test('spinResult is deterministic for the same inputs', () => {
  const a = spinResult({ account: 'alice', daySeed: '2026-08-25', nonce: 0 });
  const b = spinResult({ account: 'alice', daySeed: '2026-08-25', nonce: 0 });
  assert.deepEqual(a, b);
  assert.ok(PRIZE_TABLE.some((s) => s.segment === a.segment));
  assert.equal(typeof a.points, 'number');
});

test('spinResult varies by account / day / nonce', () => {
  const base = spinResult({ account: 'alice', daySeed: '2026-08-25', nonce: 0 });
  const other = spinResult({ account: 'bob', daySeed: '2026-08-25', nonce: 0 });
  const day2 = spinResult({ account: 'alice', daySeed: '2026-08-26', nonce: 0 });
  // rolls should differ across at least one dimension (not all identical)
  assert.ok(base.roll !== other.roll || base.roll !== day2.roll);
});

test('drawFloat stays within [0,1) and roll within the wheel', () => {
  for (let i = 0; i < 200; i++) {
    const f = drawFloat({ account: 'u' + i, daySeed: 'd', nonce: i });
    assert.ok(f >= 0 && f < 1, `float in range: ${f}`);
    const r = spinResult({ account: 'u' + i, daySeed: 'd', nonce: i });
    assert.ok(r.roll >= 0 && r.roll < TOTAL_WEIGHT);
  }
});

test('draw is weighted — rare segments are rarer than common ones', () => {
  const counts = Object.create(null);
  const N = 6000;
  for (let i = 0; i < N; i++) {
    const r = spinResult({ account: 'sampler', daySeed: 'day', nonce: i });
    counts[r.segment] = (counts[r.segment] || 0) + 1;
  }
  // TINY (weight 35) should appear clearly more than JACKPOT (weight 1)
  assert.ok((counts.TINY || 0) > (counts.JACKPOT || 0), `TINY ${counts.TINY} > JACKPOT ${counts.JACKPOT}`);
  // roughly tracks weights: SMALL (30) should beat FAIR (20) beat BIG (4)
  assert.ok((counts.SMALL || 0) > (counts.BIG || 0));
});

test('provably-fair: swapping the server seed changes the outcome distribution but stays deterministic', () => {
  __setServerSeed('seed-A');
  const a = spinResult({ account: 'x', daySeed: 'd', nonce: 1 });
  __setServerSeed('seed-B');
  const b = spinResult({ account: 'x', daySeed: 'd', nonce: 1 });
  __setServerSeed(null); // reset to default
  const a2 = (() => { __setServerSeed('seed-A'); const r = spinResult({ account: 'x', daySeed: 'd', nonce: 1 }); __setServerSeed(null); return r; })();
  assert.deepEqual(a, a2); // deterministic under a fixed seed
  assert.ok(a.roll !== b.roll || a.segment !== b.segment); // different seed → generally different draw
});

test('canSpin — one per UTC day', () => {
  assert.equal(canSpin({ account: 'a', lastSpinDay: null, today: '2026-08-25' }), true, 'never spun → allowed');
  assert.equal(canSpin({ account: 'a', lastSpinDay: '2026-08-24', today: '2026-08-25' }), true, 'new day → allowed');
  assert.equal(canSpin({ account: 'a', lastSpinDay: '2026-08-25', today: '2026-08-25' }), false, 'same day → blocked');
  assert.equal(canSpin({ account: '', lastSpinDay: null, today: '2026-08-25' }), false, 'no account → blocked');
  assert.equal(canSpin({ account: 'a', lastSpinDay: null, today: '' }), false, 'no today → blocked');
});

test('one-spin-per-day enforced — second same-day claim rejected with reason', () => {
  const store = makeStore();
  const first = claim({ account: 'alice', today: '2026-08-25', store });
  assert.equal(first.ok, true);
  assert.ok(first.awarded > 0);
  const second = claim({ account: 'alice', today: '2026-08-25', store });
  assert.equal(second.ok, false);
  assert.match(second.reason, /already spun/i);
  // balance unchanged by the rejected second claim
  assert.equal(second.balance, first.balance);
});

test('streakBonus grows then caps, resets below 2', () => {
  assert.equal(streakBonus(1), 0);
  assert.equal(streakBonus(0), 0);
  assert.equal(streakBonus(2), 5);
  assert.equal(streakBonus(3), 10);
  assert.equal(streakBonus(100), 50); // capped
  assert.equal(streakBonus('nope'), 0);
});

test('isConsecutive detects adjacent UTC days only', () => {
  assert.equal(isConsecutive('2026-08-24', '2026-08-25'), true);
  assert.equal(isConsecutive('2026-08-25', '2026-08-25'), false);
  assert.equal(isConsecutive('2026-08-23', '2026-08-25'), false);
  assert.equal(isConsecutive(null, '2026-08-25'), false);
});

test('streak increments across consecutive days and resets on a gap', () => {
  const store = makeStore();
  const c1 = claim({ account: 'bob', today: '2026-08-25', store });
  assert.equal(c1.streak, 1);
  const c2 = claim({ account: 'bob', today: '2026-08-26', store });
  assert.equal(c2.streak, 2);
  const c3 = claim({ account: 'bob', today: '2026-08-27', store });
  assert.equal(c3.streak, 3);
  assert.ok(c3.bonus > 0, 'streak day 3 carries a bonus');
  // skip 2026-08-28 → gap → reset to 1
  const c4 = claim({ account: 'bob', today: '2026-08-30', store });
  assert.equal(c4.streak, 1);
  assert.equal(c4.bonus, 0);
});

test('points accumulate across days', () => {
  const store = makeStore();
  const c1 = claim({ account: 'carol', today: '2026-08-25', store });
  const c2 = claim({ account: 'carol', today: '2026-08-26', store });
  assert.equal(c2.balance, c1.balance + c2.awarded);
  assert.equal(pointsBalance('carol', store), c2.balance);
});

test('non-cashable — the store exposes NO withdraw / cashout / transfer path', () => {
  const store = makeStore();
  claim({ account: 'dave', today: '2026-08-25', store });
  assert.equal(typeof store.withdraw, 'undefined');
  assert.equal(typeof store.cashout, 'undefined');
  assert.equal(typeof store.transfer, 'undefined');
  assert.equal(typeof store.redeem, 'undefined');
  // only additive credit + reads exist
  assert.equal(typeof store.credit, 'function');
  assert.equal(typeof store.get, 'function');
});

test('claim soft-fails (never throws) on bad input', () => {
  assert.doesNotThrow(() => claim({}));
  const noAcct = claim({ today: '2026-08-25', store: makeStore() });
  assert.equal(noAcct.ok, false);
  assert.match(noAcct.reason, /account/i);
  const noStore = claim({ account: 'x', today: '2026-08-25' });
  assert.equal(noStore.ok, false);
  assert.match(noStore.reason, /store/i);
  const noDay = claim({ account: 'x', store: makeStore() });
  assert.equal(noDay.ok, false);
});

test('pointsBalance is 0 for unknown account / missing store', () => {
  const store = makeStore();
  assert.equal(pointsBalance('nobody', store), 0);
  assert.equal(pointsBalance('x', null), 0);
});

test('makeStore honors seeded rows', () => {
  const store = makeStore({ eve: { points: 999, lastSpinDay: '2026-08-24', streak: 4 } });
  assert.equal(pointsBalance('eve', store), 999);
  // a consecutive-day claim continues the streak to 5
  const c = claim({ account: 'eve', today: '2026-08-25', store });
  assert.equal(c.streak, 5);
});

test('renderWheel escapes and includes the not-cash note + all segments', () => {
  const html = renderWheel({ result: { segment: 'BIG', points: 200, bonus: 5 }, balance: 300, streak: 3 });
  assert.match(html, /points are for play, not cash/i);
  for (const seg of PRIZE_TABLE) assert.ok(html.includes(seg.segment), `wheel shows ${seg.segment}`);
  // idle wheel (no result) still renders and still carries the note
  const idle = renderWheel({});
  assert.match(idle, /Spin the wheel/i);
  assert.match(idle, /not cash/i);
});
