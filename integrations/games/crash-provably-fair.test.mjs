import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TWO_52, MIN_CRASH, commit, crashPoint, survivalProbability, settleCrash, verifyCrash,
} from './crash-provably-fair.mjs';

const SEED = 'server-seed-under-test';
const CLIENT = 'player-chosen-seed';

test('crashPoint is deterministic for the same seeds and nonce', () => {
  const a = crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce: 5 });
  const b = crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce: 5 });
  assert.deepEqual(a, b);
  assert.ok(a.crash >= MIN_CRASH);
});

test('the 52-bit sample sits in range and drives a uniform u', () => {
  for (let nonce = 0; nonce < 50; nonce++) {
    const { h, u } = crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce });
    assert.ok(Number.isInteger(h) && h >= 0 && h < TWO_52, `h out of range: ${h}`);
    assert.ok(u > 0 && u <= 1, `u out of range: ${u}`);
  }
});

test('crash never resolves below 1.00 and carries two decimals', () => {
  for (let nonce = 0; nonce < 500; nonce++) {
    const { crash } = crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce });
    assert.ok(crash >= MIN_CRASH, `crash below floor: ${crash}`);
    assert.ok(Math.abs(crash * 100 - Math.round(crash * 100)) < 1e-6, `not a 2dp value: ${crash}`);
  }
});

test('survivalProbability is r/m and is certain at or below r', () => {
  assert.ok(Math.abs(survivalProbability(2, 100) - 0.99 / 2) < 1e-12);
  assert.ok(Math.abs(survivalProbability(10, 100) - 0.99 / 10) < 1e-12);
  assert.ok(Math.abs(survivalProbability(1.5, 0) - 1 / 1.5) < 1e-12);
  assert.equal(survivalProbability(1, 0), 1);      // with no edge, 1.00x always survives
  assert.equal(survivalProbability(0, 100), 0);
  assert.equal(survivalProbability(-3, 100), 0);
});

test('the empirical survival rate matches the stated survival function', () => {
  const N = 20000, edgeBps = 100, target = 2;
  let survived = 0;
  for (let nonce = 0; nonce < N; nonce++) {
    if (crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce, edgeBps }).crash >= target) survived++;
  }
  const observed = survived / N;
  const expected = survivalProbability(target, edgeBps);   // 0.495
  assert.ok(Math.abs(observed - expected) < 0.02, `observed ${observed} vs expected ${expected}`);
});

test('the house edge is the same at every cash-out target', () => {
  const N = 20000, edgeBps = 100, stake = 100;
  for (const target of [1.5, 2, 5]) {
    let paid = 0;
    for (let nonce = 0; nonce < N; nonce++) {
      const { crash } = crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce, edgeBps });
      paid += settleCrash({ crash, cashOutAt: target, betAmount: stake }).payout;
    }
    const rtp = paid / (N * stake);
    // EV = m x (r/m) = r = 0.99, independent of the target the player picks.
    assert.ok(Math.abs(rtp - 0.99) < 0.05, `target ${target}: rtp ${rtp}`);
  }
});

test('a bigger edge pushes crash points down', () => {
  const N = 2000;
  const mean = (edgeBps) => {
    let sum = 0;
    for (let nonce = 0; nonce < N; nonce++) {
      sum += Math.min(50, crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce, edgeBps }).crash);
    }
    return sum / N;
  };
  assert.ok(mean(1000) < mean(0), 'a 10% edge should crash earlier on average than a 0% edge');
});

test('settleCrash pays the chosen target, not the crash point', () => {
  const win = settleCrash({ crash: 7.5, cashOutAt: 2, betAmount: 100 });
  assert.equal(win.win, true);
  assert.equal(win.payout, 200);          // the player asked for 2x, not 7.5x
  assert.equal(win.multiplier, 2);

  const exact = settleCrash({ crash: 2, cashOutAt: 2, betAmount: 100 });
  assert.equal(exact.win, true, 'cashing out exactly at the crash point survives');

  const lose = settleCrash({ crash: 1.4, cashOutAt: 2, betAmount: 100 });
  assert.equal(lose.win, false);
  assert.equal(lose.payout, 0);
  assert.equal(lose.profit, -100);
});

test('settleCrash floors a nonsense target at 1.00 and rejects an invalid crash', () => {
  assert.equal(settleCrash({ crash: 3, cashOutAt: 0.1, betAmount: 10 }).cashOutAt, MIN_CRASH);
  assert.equal(settleCrash({ crash: 3, cashOutAt: 'x', betAmount: 10 }).cashOutAt, 2);
  assert.equal(settleCrash({ crash: 0.5, cashOutAt: 2, betAmount: 10 }).crash, null);
  assert.equal(settleCrash({ crash: 0.5, cashOutAt: 2, betAmount: 10 }).win, false);
});

test('verifyCrash proves a real round and rejects a tampered one', () => {
  const hash = commit(SEED);
  const { crash } = crashPoint({ serverSeed: SEED, clientSeed: CLIENT, nonce: 9 });
  assert.equal(verifyCrash({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 9, crash }), true);

  assert.equal(verifyCrash({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 9, crash: crash + 1 }), false);
  assert.equal(verifyCrash({ serverSeed: 'swapped', serverSeedHash: hash, clientSeed: CLIENT, nonce: 9, crash }), false);
  assert.equal(verifyCrash({ serverSeed: SEED, serverSeedHash: 'deadbeef', clientSeed: CLIENT, nonce: 9, crash }), false);
  // The edge is part of the computation, so verifying under a different edge must fail.
  assert.equal(verifyCrash({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 9, crash, edgeBps: 500 }), false);
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => crashPoint());
  assert.doesNotThrow(() => crashPoint({ serverSeed: {}, clientSeed: [], nonce: 'x', edgeBps: null }));
  assert.doesNotThrow(() => settleCrash());
  assert.doesNotThrow(() => survivalProbability({}, []));
  assert.doesNotThrow(() => verifyCrash());
  assert.equal(verifyCrash({}), false);
  assert.ok(crashPoint({}).crash >= MIN_CRASH);
});
