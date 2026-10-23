/**
 * loop-e2e.test.mjs — END-TO-END proof that the MELEK/PRANA economic loop composes
 * on the MELEK-Engine side, driven through the REAL engine dispatcher (Engine.process),
 * not by calling the contracts directly. Each assertion below is a hop the operator
 * asked to be proven in code:
 *
 *   Hop 1 (MELEK -> wMELEK deposit) : bridge.mintWrapped credits wMELEK 1:1 against a
 *                                     finalized L1 deposit ref (the wmelek-relayer feeds
 *                                     this op). Idempotent per depositRef (replay-safe).
 *   Hop 2 (wMELEK -> APIS-Hash)     : workerbee.foreverLock mints soulbound APIS-Hash 1:1
 *                                     and the locker EARNS APIS on the fixed schedule.
 *                                     APIS-Hash is non-transferable (soulbound).
 *   Hop 5 (redeem wMELEK -> MELEK)  : bridge.burnWrapped burns the liquid (un-locked)
 *                                     wMELEK on a withdrawal, reducing supply so the
 *                                     engine invariant (wMELEK supply == MELEK locked in
 *                                     custody) holds. Idempotent per withdrawalRef.
 *
 * The KulaSwap swap hop (Hop 4) and the PRANA-ERC20 bridge legs (Hops 1/3/5 on the EVM
 * side) are proven by their own suites (kulaswap/*.test.mjs, integrations/bridge-*.test.mjs);
 * this file proves the engine-side loop that carries the APIS-Hash mechanism the operator
 * flagged as the key new mechanic.
 *
 * Fully offline; no network, no keys, no broadcasts.
 * Run: node --test engine/test/loop-e2e.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { Engine } from '../lib/engine.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { fromBaseUnits, toBaseUnits } from '../lib/decimal.mjs';
import { config, genesis } from '../config.mjs';
import { emissionForRange } from '../contracts/workerbee.mjs';

const WMELEK = config.workerbee.stakeToken.toUpperCase(); // 'WMELEK'
const BRIDGE = config.bridge.account;                     // 'hathor' on both nets by default
const APIS = genesis.feeToken;                            // 'APIS'
const BPD = config.workerbee.blocksPerDay;                // 28800

function fresh() {
  const s = new State(null);
  bootstrapGenesis(s);
  return s;
}

/** Build an engine op (custom_json shape already parsed) for a given contract action. */
function op(sender, contractName, contractAction, contractPayload, { authLevel = 'active', blockNum = 1, txId = 't' } = {}) {
  return {
    sender,
    authLevel,
    blockNum,
    blockId: 'b' + blockNum,
    txId,
    json: JSON.stringify({ contractName, contractAction, contractPayload }),
  };
}

function bal(state, account, symbol) {
  const row = state.findOne('balances', { account, symbol });
  return row ? BigInt(row.balance) : 0n;
}

test('LOOP e2e: deposit-mint -> forever-lock -> earn+claim APIS -> redeem-burn (engine invariant holds)', () => {
  const s = fresh();
  const e = new Engine(s);

  // ── Hop 1: MELEK -> wMELEK. The wmelek-relayer observed a finalized native
  // MELEK transfer to custody (depositRef = L1 tx id) and handed the engine this
  // bridge.mintWrapped. Mints 100 wMELEK to alice, 1:1 with the locked MELEK. ──
  const mint = e.process(op(BRIDGE, 'bridge', 'mintWrapped',
    { to: 'alice', amount: '100.000', depositRef: 'L1-deposit-tx-0001' },
    { authLevel: 'active', blockNum: 10, txId: 'mint1' }));
  assert.equal(mint.ok, true, 'mintWrapped should succeed for the bridge account');
  assert.equal(fromBaseUnits(bal(s, 'alice', WMELEK), 3), '100.000', 'alice holds 100 wMELEK after deposit');

  // Idempotency: replaying the SAME depositRef must not double-mint (relayer-safe).
  const replay = e.process(op(BRIDGE, 'bridge', 'mintWrapped',
    { to: 'alice', amount: '100.000', depositRef: 'L1-deposit-tx-0001' },
    { authLevel: 'active', blockNum: 10, txId: 'mint1-replay' }));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true, 'a replayed depositRef is an idempotent no-op');
  assert.equal(fromBaseUnits(bal(s, 'alice', WMELEK), 3), '100.000', 'no double-mint on replay');

  // A non-bridge account cannot mint wMELEK (supply-control boundary).
  const rogue = e.process(op('mallory', 'bridge', 'mintWrapped',
    { to: 'mallory', amount: '1000000.000', depositRef: 'fake' },
    { authLevel: 'active', blockNum: 10, txId: 'rogue' }));
  assert.equal(rogue.ok, false, 'only the bridge account may mint wMELEK');

  // ── Hop 2: wMELEK -> APIS-Hash. Alice FOREVER-locks 60 of her 100 wMELEK.
  // This mints soulbound APIS-Hash 1:1 and starts her APIS emission. The 60
  // locked wMELEK permanently backs the withdraw pool (never redeemable). ──
  const lock = e.process(op('alice', 'workerbee', 'foreverLock',
    { amount: '60.000' },
    { authLevel: 'active', blockNum: 11, txId: 'lock1' }));
  assert.equal(lock.ok, true, 'foreverLock should succeed');
  assert.equal(lock.apisHash, '60.000', 'APIS-Hash minted 1:1 with locked wMELEK');
  assert.equal(fromBaseUnits(bal(s, 'alice', WMELEK), 3), '40.000', 'locked wMELEK leaves liquid balance');

  const hashView = e.process(op('viewer', 'workerbee', 'apisHashOf', { account: 'alice' },
    { authLevel: 'posting', blockNum: 11, txId: 'v1' }));
  assert.equal(hashView.apisHash, '60.000', 'apisHashOf reflects the position');

  // foreverLock requires ACTIVE auth (value-moving). Posting must be rejected.
  const badAuth = e.process(op('alice', 'workerbee', 'foreverLock', { amount: '1.000' },
    { authLevel: 'posting', blockNum: 11, txId: 'badauth' }));
  assert.equal(badAuth.ok, false, 'foreverLock rejects posting auth');

  // ── Earn: advance one full day of blocks and CLAIM. Alice is the sole locker,
  // so she earns the whole day's scheduled emission (fixed pie, stake-independent). ──
  const claimBlock = 11 + BPD; // one day later
  const claim = e.process(op('alice', 'workerbee', 'claim', {},
    { authLevel: 'posting', blockNum: claimBlock, txId: 'claim1' }));
  assert.equal(claim.ok, true, 'claim should succeed');

  // Expected = the scheduled emission over [anchor, claimBlock) = [11, 11+BPD).
  // anchor was pinned at the foreverLock block (11), so the elapsed range is [0, BPD).
  const expectedBase = emissionForRange(0, BPD, 3); // APIS base units for one day
  const claimedBase = toBaseUnits(claim.claimed, 3);
  assert.ok(claimedBase > 0n, 'alice earned APIS by locking wMELEK');
  // Sole locker takes the whole pie (bar integer accumulator dust of a few base units).
  const diff = expectedBase > claimedBase ? expectedBase - claimedBase : claimedBase - expectedBase;
  assert.ok(diff <= 5n, `claimed (${claim.claimed}) ~= scheduled day emission (${fromBaseUnits(expectedBase, 3)}), dust ${diff}`);
  assert.equal(fromBaseUnits(bal(s, 'alice', APIS), 3), claim.claimed, 'claimed APIS credited to alice');

  // ── Soulbound: APIS-Hash can never be transferred. ──
  const xfer = e.process(op('alice', 'workerbee', 'transfer', { to: 'bob', amount: '1.000' },
    { authLevel: 'active', blockNum: claimBlock, txId: 'xfer' }));
  assert.equal(xfer.ok, false, 'APIS-Hash is soulbound (transfer rejected)');

  // ── Hop 5: redeem wMELEK -> native MELEK. Alice withdraws her 40 LIQUID
  // (un-locked) wMELEK. The bridge burns it; the withdrawal daemon then releases
  // native MELEK from custody (proven by integrations/bridge-withdrawal-*.test.mjs). ──
  const supplyBefore = BigInt(s.findOne('tokens', { symbol: WMELEK }).supply);
  const burn = e.process(op(BRIDGE, 'bridge', 'burnWrapped',
    { from: 'alice', amount: '40.000', withdrawalRef: 'L1-withdraw-tx-0001' },
    { authLevel: 'active', blockNum: claimBlock + 1, txId: 'burn1' }));
  assert.equal(burn.ok, true, 'burnWrapped should succeed for the liquid balance');
  assert.equal(fromBaseUnits(bal(s, 'alice', WMELEK), 3), '0.000', 'redeemed wMELEK left the balance');

  const supplyAfter = BigInt(s.findOne('tokens', { symbol: WMELEK }).supply);
  assert.equal(fromBaseUnits(supplyBefore - supplyAfter, 3), '40.000', 'supply fell by the burned amount');

  // Idempotency on the withdrawal ref (relayer-safe).
  const burnReplay = e.process(op(BRIDGE, 'bridge', 'burnWrapped',
    { from: 'alice', amount: '40.000', withdrawalRef: 'L1-withdraw-tx-0001' },
    { authLevel: 'active', blockNum: claimBlock + 1, txId: 'burn1-replay' }));
  assert.equal(burnReplay.idempotent, true, 'a replayed withdrawalRef is an idempotent no-op');

  // ── Invariant: wMELEK supply == MELEK that must stay locked in custody.
  // Deposited 100, redeemed 40 => 60 wMELEK still outstanding (the forever-locked
  // amount backing the withdraw pool). This is the on-engine solvency check. ──
  const locked = e.process(op('anyone', 'bridge', 'lockedSupply', {},
    { authLevel: 'posting', blockNum: claimBlock + 2, txId: 'v2' }));
  assert.equal(locked.supply, '60.000', 'wMELEK outstanding == deposits - withdrawals (forever-locked backs the pool)');
});

test('LOOP e2e: two lockers split the fixed emission pro-rata (pie does not inflate)', () => {
  const s = fresh();
  const e = new Engine(s);

  // Deposit-mint to two users.
  e.process(op(BRIDGE, 'bridge', 'mintWrapped', { to: 'alice', amount: '30.000', depositRef: 'd-a' },
    { authLevel: 'active', blockNum: 5, txId: 'ma' }));
  e.process(op(BRIDGE, 'bridge', 'mintWrapped', { to: 'bob', amount: '10.000', depositRef: 'd-b' },
    { authLevel: 'active', blockNum: 5, txId: 'mb' }));

  // Both forever-lock in the SAME block so their emission windows are identical.
  e.process(op('alice', 'workerbee', 'foreverLock', { amount: '30.000' },
    { authLevel: 'active', blockNum: 6, txId: 'la' }));
  e.process(op('bob', 'workerbee', 'foreverLock', { amount: '10.000' },
    { authLevel: 'active', blockNum: 6, txId: 'lb' }));

  const claimBlock = 6 + BPD;
  const ca = e.process(op('alice', 'workerbee', 'claim', {}, { authLevel: 'posting', blockNum: claimBlock, txId: 'ca' }));
  const cb = e.process(op('bob', 'workerbee', 'claim', {}, { authLevel: 'posting', blockNum: claimBlock, txId: 'cb' }));
  assert.equal(ca.ok, true);
  assert.equal(cb.ok, true);

  const aliceApis = toBaseUnits(ca.claimed, 3);
  const bobApis = toBaseUnits(cb.claimed, 3);

  // alice (30) : bob (10) share = 3:1. Ratio holds within integer-accumulator dust.
  assert.ok(bobApis > 0n && aliceApis > 0n, 'both lockers earned APIS');
  const ratioX100 = Number((aliceApis * 100n) / bobApis); // ~300
  assert.ok(ratioX100 >= 295 && ratioX100 <= 305, `3:1 stake => ~3:1 APIS (got ${ratioX100 / 100}:1)`);

  // The pie is fixed: total paid ~= the one-day schedule, NOT 2x because two locked.
  const scheduled = emissionForRange(0, BPD, 3);
  const paid = aliceApis + bobApis;
  const diff = scheduled > paid ? scheduled - paid : paid - scheduled;
  assert.ok(diff <= 5n, `combined payout (${fromBaseUnits(paid, 3)}) == one fixed day pie (${fromBaseUnits(scheduled, 3)}); more lockers do NOT inflate`);
});
