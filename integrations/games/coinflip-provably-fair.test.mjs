import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDES, HEADS_BAND, ROLL_MAX, commit, flip, fairMultiplier, settleFlip, verifyFlip, normalizeSide,
} from './coinflip-provably-fair.mjs';
import { roll as diceRoll } from './dice-provably-fair.mjs';

const SEED = 'server-seed-under-test';
const CLIENT = 'player-chosen-seed';

test('flip is deterministic for the same seeds and nonce', () => {
  const a = flip({ serverSeed: SEED, clientSeed: CLIENT, nonce: 7 });
  const b = flip({ serverSeed: SEED, clientSeed: CLIENT, nonce: 7 });
  assert.deepEqual(a, b);
  assert.ok(SIDES.includes(a.side));
});

test('flip reuses the dice roll so one revealed seed audits both tables', () => {
  const f = flip({ serverSeed: SEED, clientSeed: CLIENT, nonce: 3 });
  const d = diceRoll({ serverSeed: SEED, clientSeed: CLIENT, nonce: 3 });
  assert.equal(f.roll, d.roll);
  assert.equal(f.hmac, d.hmac);
});

test('the side is decided by the half of the roll space', () => {
  for (let nonce = 0; nonce < 200; nonce++) {
    const f = flip({ serverSeed: SEED, clientSeed: CLIENT, nonce });
    assert.equal(f.side, f.roll < HEADS_BAND ? 'heads' : 'tails');
  }
});

test('both sides come up over many nonces and neither dominates', () => {
  let heads = 0;
  const N = 2000;
  for (let nonce = 0; nonce < N; nonce++) {
    if (flip({ serverSeed: SEED, clientSeed: CLIENT, nonce }).side === 'heads') heads++;
  }
  // A true 50/50 over 2000 draws: allow a generous band so the test is not flaky.
  assert.ok(heads > N * 0.42 && heads < N * 0.58, `heads=${heads} of ${N}`);
});

test('fairMultiplier is 2 x (1 - edge) and clamps a garbage edge', () => {
  assert.equal(fairMultiplier(0), 2);
  assert.ok(Math.abs(fairMultiplier(100) - 1.98) < 1e-12);
  assert.ok(Math.abs(fairMultiplier(250) - 1.95) < 1e-12);
  assert.equal(fairMultiplier(-50), 2);          // negative edge cannot pay more than fair
  assert.equal(fairMultiplier(999999), 0);       // clamped at a 100% edge
  assert.equal(fairMultiplier('nonsense'), 1.98); // falls back to the default edge
});

test('settleFlip pays the multiplier on a correct call and nothing otherwise', () => {
  const win = settleFlip({ side: 'heads', pick: 'heads', betAmount: 100, edgeBps: 100 });
  assert.equal(win.win, true);
  assert.ok(Math.abs(win.payout - 198) < 1e-9);
  assert.ok(Math.abs(win.profit - 98) < 1e-9);

  const lose = settleFlip({ side: 'tails', pick: 'heads', betAmount: 100, edgeBps: 100 });
  assert.equal(lose.win, false);
  assert.equal(lose.payout, 0);
  assert.equal(lose.profit, -100);
});

test('the house edge is exactly the stated edge over both outcomes', () => {
  const stake = 100, edgeBps = 100;
  const w = settleFlip({ side: 'heads', pick: 'heads', betAmount: stake, edgeBps }).payout;
  const l = settleFlip({ side: 'tails', pick: 'heads', betAmount: stake, edgeBps }).payout;
  const ev = 0.5 * w + 0.5 * l;                   // each side is exactly half the roll space
  assert.ok(Math.abs(ev - stake * (1 - edgeBps / ROLL_MAX)) < 1e-9);
});

test('normalizeSide accepts the forms a query string will produce', () => {
  for (const v of ['heads', 'HEADS', ' Heads ', 'h', '0']) assert.equal(normalizeSide(v), 'heads');
  for (const v of ['tails', 'T', '1']) assert.equal(normalizeSide(v), 'tails');
  for (const v of ['', null, undefined, 'edge', {}, []]) assert.equal(normalizeSide(v), null);
});

test('verifyFlip proves a real flip and rejects a tampered one', () => {
  const hash = commit(SEED);
  const f = flip({ serverSeed: SEED, clientSeed: CLIENT, nonce: 11 });
  assert.equal(verifyFlip({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 11, side: f.side }), true);

  const other = f.side === 'heads' ? 'tails' : 'heads';
  assert.equal(verifyFlip({ serverSeed: SEED, serverSeedHash: hash, clientSeed: CLIENT, nonce: 11, side: other }), false);
  assert.equal(verifyFlip({ serverSeed: 'swapped', serverSeedHash: hash, clientSeed: CLIENT, nonce: 11, side: f.side }), false);
  assert.equal(verifyFlip({ serverSeed: SEED, serverSeedHash: 'deadbeef', clientSeed: CLIENT, nonce: 11, side: f.side }), false);
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => flip());
  assert.doesNotThrow(() => flip({ serverSeed: {}, clientSeed: [], nonce: 'x' }));
  assert.doesNotThrow(() => settleFlip());
  assert.doesNotThrow(() => settleFlip({ side: {}, pick: [], betAmount: 'x', edgeBps: null }));
  assert.doesNotThrow(() => verifyFlip());
  assert.equal(verifyFlip({}), false);
  assert.equal(settleFlip({ betAmount: -5 }).stake, 0);
});
