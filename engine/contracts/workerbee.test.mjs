/**
 * workerbee.test.mjs — the WorkerBee issuance lottery contract.
 *
 * Offline, deterministic. Verifies:
 *   - forever-lock mints soulbound APIS-Hash 1:1 with the locked stake token;
 *   - APIS-Hash transfer is REJECTED (soulbound);
 *   - two lockers split a period's emission by share, summing to the scheduled amount;
 *   - halving reduces emission after the cadence;
 *   - emission is FIXED — more lockers != more total APIS (same period total
 *     regardless of total stake);
 *   - claim pays accrued APIS via the cap-respecting tokens.issue path;
 *   - determinism (same blockId/range => same result);
 *   - soft-fails-never-throw on bad input.
 *
 * Run: node --test engine/contracts/workerbee.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens } from './tokens.mjs';
import { workerbee, emissionForRange, ACC_SCALE } from './workerbee.mjs';
import { config, genesis } from '../config.mjs';
import { toBaseUnits } from '../lib/decimal.mjs';

const STAKE = config.workerbee.stakeToken.toUpperCase(); // WMELEK
const PREC = 3;

function ctx(sender, blockNum = 1) {
  return { sender, blockNum, blockId: `b${blockNum}`, txId: `t${blockNum}`, authLevel: 'active' };
}

// Fresh engine state with APIS/DRONE bootstrapped + the WMELEK stake token
// registered and distributed to some lockers.
function fresh() {
  const s = new State(null);
  bootstrapGenesis(s);
  // register the configured stake token (wMELEK) and hand it out
  const r = tokens.create(s, { ...ctx('hathor'), genesis: true }, {
    symbol: STAKE, name: 'Wrapped MELEK', precision: PREC, maxSupply: '100000000',
  });
  assert.ok(r.ok, r.error);
  tokens.issue(s, ctx('hathor'), { symbol: STAKE, to: 'alice', quantity: '1000' });
  tokens.issue(s, ctx('hathor'), { symbol: STAKE, to: 'bob', quantity: '3000' });
  tokens.issue(s, ctx('hathor'), { symbol: STAKE, to: 'carol', quantity: '6000' });
  return s;
}

function apisBalance(s, account) {
  const row = s.findOne('balances', { account, symbol: genesis.feeToken });
  return row ? BigInt(row.balance) : 0n;
}

test('foreverLock mints soulbound APIS-Hash 1:1 and pulls the stake token', () => {
  const s = fresh();
  const r = workerbee.foreverLock(s, ctx('alice', 10), { amount: '1000' });
  assert.ok(r.ok, r.error);
  assert.equal(r.apisHash, '1000.000');
  // liquid WMELEK is gone (locked forever)
  const bal = s.findOne('balances', { account: 'alice', symbol: STAKE });
  assert.equal(bal.balance, '0');
  // APIS-Hash view reflects it
  assert.equal(workerbee.apisHashOf(s, ctx('alice', 10)).apisHash, '1000.000');
  assert.equal(workerbee.totalApisHash(s).totalApisHash, '1000.000');
  // permanent-lock audit record written
  assert.equal(s.collection('workerbeeLocks').length, 1);
});

test('foreverLock soft-fails on bad input, never throws', () => {
  const s = fresh();
  assert.equal(workerbee.foreverLock(s, ctx('alice'), { amount: '0' }).ok, false);
  assert.equal(workerbee.foreverLock(s, ctx('alice'), { amount: 'abc' }).ok, false);
  assert.equal(workerbee.foreverLock(s, ctx('alice'), { amount: '999999' }).ok, false); // > balance
  assert.equal(workerbee.foreverLock(s, ctx('nobody'), { amount: '1' }).ok, false); // no balance
});

test('APIS-Hash transfer is rejected (soulbound)', () => {
  const s = fresh();
  workerbee.foreverLock(s, ctx('alice', 10), { amount: '1000' });
  const r = workerbee.transfer(s, ctx('alice', 11), { to: 'bob', amount: '500' });
  assert.equal(r.ok, false);
  assert.match(r.error, /soulbound/i);
  // alice still holds all her APIS-Hash; bob has none
  assert.equal(workerbee.apisHashOf(s, ctx('alice', 11)).apisHash, '1000.000');
  assert.equal(workerbee.apisHashOf(s, ctx('bob', 11)).apisHash, '0.000');
  // and APIS-HASH can never be created as a tokens-token (hyphen rejected)
  assert.equal(tokens.create(s, ctx('alice'), { symbol: 'APIS-HASH', name: 'x', precision: 3, maxSupply: '1' }).ok, false);
});

test('emissionForRange: fixed flat schedule + exact halving', () => {
  // basePerBlock = 1000 APIS/day / 28800 blocks = 0.034722.. APIS -> base units
  const perDay = toBaseUnits('1000', PREC); // 1_000_000 base
  const bpd = BigInt(config.workerbee.blocksPerDay);
  const basePerBlock = perDay / bpd; // floor
  // no-halving window: range emission = basePerBlock * span (flat)
  assert.equal(emissionForRange(0, 10, PREC), basePerBlock * 10n);
  // across one full halving boundary the second epoch is halved
  const hb = Number(config.workerbee.halvingDays) * Number(config.workerbee.blocksPerDay);
  const oneBlockBeforeAndAfter = emissionForRange(hb - 1, hb + 1, PREC);
  assert.equal(oneBlockBeforeAndAfter, basePerBlock + (basePerBlock >> 1n));
  // empty range => 0
  assert.equal(emissionForRange(5, 5, PREC), 0n);
  assert.equal(emissionForRange(10, 5, PREC), 0n);
});

test('two lockers split a tick emission by share, summing to the scheduled amount', () => {
  const s = fresh();
  // alice 1000, bob 3000 -> shares 25% / 75%. Anchor at block 100.
  workerbee.foreverLock(s, ctx('alice', 100), { amount: '1000' });
  workerbee.foreverLock(s, ctx('bob', 100), { amount: '3000' });

  // advance the lottery to block 100 + 28800 (= one day) and claim both
  const day = 100 + Number(config.workerbee.blocksPerDay);
  workerbee.tick(s, ctx('engine', day));
  const aBefore = apisBalance(s, 'alice');
  const bBefore = apisBalance(s, 'bob');
  workerbee.claim(s, ctx('alice', day));
  workerbee.claim(s, ctx('bob', day));
  const aGot = apisBalance(s, 'alice') - aBefore;
  const bGot = apisBalance(s, 'bob') - bBefore;

  // scheduled emission for the 28800-block range (no halving crossed)
  const scheduled = emissionForRange(0, Number(config.workerbee.blocksPerDay), PREC);
  // shares: alice 1/4, bob 3/4 (allow 1 base-unit rounding dust total)
  assert.ok(aGot > 0n && bGot > 0n);
  const total = aGot + bGot;
  assert.ok(scheduled - total <= 2n && total <= scheduled, `total ${total} vs scheduled ${scheduled}`);
  // bob ~ 3x alice
  assert.ok(bGot >= aGot * 3n - 2n && bGot <= aGot * 3n + 2n, `bob ${bGot} alice ${aGot}`);
});

test('emission is FIXED: more lockers != more total APIS (same period total)', () => {
  function totalMintedOverDay(extraLockers) {
    const s = fresh();
    workerbee.foreverLock(s, ctx('alice', 100), { amount: '1000' });
    if (extraLockers) {
      workerbee.foreverLock(s, ctx('bob', 100), { amount: '3000' });
      workerbee.foreverLock(s, ctx('carol', 100), { amount: '6000' });
    }
    const day = 100 + Number(config.workerbee.blocksPerDay);
    workerbee.tick(s, ctx('engine', day));
    for (const a of ['alice', 'bob', 'carol']) workerbee.claim(s, ctx(a, day));
    return apisBalance(s, 'alice') + apisBalance(s, 'bob') + apisBalance(s, 'carol');
  }
  const solo = totalMintedOverDay(false); // alice alone
  const crowd = totalMintedOverDay(true); // alice + bob + carol
  const scheduled = emissionForRange(0, Number(config.workerbee.blocksPerDay), PREC);
  // The TOTAL minted is the scheduled pie either way (within rounding dust).
  assert.ok(scheduled - solo <= 2n, `solo ${solo} vs ${scheduled}`);
  assert.ok(scheduled - crowd <= 3n, `crowd ${crowd} vs ${scheduled}`);
  // more lockers does NOT increase total emission
  assert.ok(crowd <= solo + 3n, `crowd ${crowd} should ~= solo ${solo}`);
});

test('halving reduces emission after the cadence', () => {
  const s = fresh();
  workerbee.foreverLock(s, ctx('alice', 0), { amount: '1000' });
  // first day (epoch 0)
  const d1 = Number(config.workerbee.blocksPerDay);
  workerbee.tick(s, ctx('engine', d1));
  workerbee.claim(s, ctx('alice', d1));
  const got1 = apisBalance(s, 'alice');

  // one day exactly AFTER the first halving boundary (epoch 1)
  const hb = Number(config.workerbee.halvingDays) * Number(config.workerbee.blocksPerDay);
  workerbee.tick(s, ctx('engine', hb));
  workerbee.claim(s, ctx('alice', hb)); // drain everything up to the boundary
  const atBoundary = apisBalance(s, 'alice');
  workerbee.tick(s, ctx('engine', hb + d1));
  workerbee.claim(s, ctx('alice', hb + d1));
  const got2 = apisBalance(s, 'alice') - atBoundary; // a full day in epoch 1

  // epoch-1 day emission is half of epoch-0 day emission (sole locker => all of it)
  assert.ok(got2 > 0n);
  assert.equal(got2, got1 >> 1n);
});

test('claim pays accrued, then pays 0 until more accrues; pending view matches', () => {
  const s = fresh();
  workerbee.foreverLock(s, ctx('alice', 10), { amount: '1000' });
  const day = 10 + Number(config.workerbee.blocksPerDay);
  // pending view (read-only) before claim
  const pending = workerbee.apisHashPending(s, ctx('alice', day));
  assert.ok(parseFloat(pending.pending) > 0);
  const first = workerbee.claim(s, ctx('alice', day));
  assert.ok(first.ok);
  assert.ok(parseFloat(first.claimed) > 0);
  // immediate re-claim at the same block pays 0
  const second = workerbee.claim(s, ctx('alice', day));
  assert.equal(second.claimed, '0.000');
});

test('determinism: same block range from a fresh state => identical state hash', () => {
  function run() {
    const s = fresh();
    workerbee.foreverLock(s, ctx('alice', 100), { amount: '1000' });
    workerbee.foreverLock(s, ctx('bob', 100), { amount: '3000' });
    const day = 100 + Number(config.workerbee.blocksPerDay);
    workerbee.tick(s, ctx('engine', day));
    workerbee.claim(s, ctx('alice', day));
    workerbee.claim(s, ctx('bob', day));
    return s.hash();
  }
  assert.equal(run(), run());
});

test('view helpers soft-fail to safe shapes; no APIS-Hash position', () => {
  const s = fresh();
  assert.equal(workerbee.apisHashOf(s, ctx('ghost')).apisHash, '0.000');
  assert.equal(workerbee.totalApisHash(s).totalApisHash, '0.000');
  assert.equal(workerbee.apisHashPending(s, ctx('ghost', 5)).pending, '0.000');
  assert.equal(workerbee.claim(s, ctx('ghost', 5)).ok, false);
  const info = workerbee.emissionInfo(s, ctx('view', 5));
  assert.equal(info.emissionToken, genesis.feeToken);
  assert.equal(info.stakeToken, STAKE);
  assert.ok(ACC_SCALE > 0n);
});
