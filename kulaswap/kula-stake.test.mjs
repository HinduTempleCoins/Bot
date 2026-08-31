// kula-stake.test.mjs — offline tests for the veKULA (VoteEscrow) stake descriptors + weight math.
// House style: node --test, no network, pure, soft-fail. Mirrors kula-cdp.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  veWeight, clampDuration, VE_MAX_LOCK_SECONDS,
  buildLockTx, buildIncreaseAmountTx, buildExtendLockTx, buildWithdrawTx, buildStakeApproveTx,
  STAKE_SELECTORS,
} from './kula-stake.mjs';

const VE = '0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438';
const KULA = '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631';
const ONE_E18 = '1000000000000000000';
const ONE_E18_WORD = '0000000000000000000000000000000000000000000000000de0b6b3a7640000';

test('VE_MAX_LOCK_SECONDS is the on-chain 4-year ceiling', () => {
  assert.equal(VE_MAX_LOCK_SECONDS, 126144000);
});

test('veWeight decays linearly to maxLock; full lock ~= amount', () => {
  assert.equal(veWeight({ amount: 100, secondsRemaining: VE_MAX_LOCK_SECONDS }), 100);
  assert.equal(veWeight({ amount: 100, secondsRemaining: VE_MAX_LOCK_SECONDS / 2 }), 50);
  assert.equal(veWeight({ amount: 100, secondsRemaining: 0 }), 0);      // expired
  assert.equal(veWeight({ amount: 0, secondsRemaining: 100 }), 0);       // no amount
  assert.equal(veWeight({ amount: -5, secondsRemaining: 100 }), 0);      // soft-fail
});

test('clampDuration bounds to (0, maxLock]', () => {
  assert.equal(clampDuration(0), 0);
  assert.equal(clampDuration(-1), 0);
  assert.equal(clampDuration(1000), 1000);
  assert.equal(clampDuration(VE_MAX_LOCK_SECONDS + 1), VE_MAX_LOCK_SECONDS);
});

test('buildLockTx encodes VoteEscrow.lock(uint256,uint256) with clamped duration, chainId 712217', () => {
  const tx = buildLockTx({ veKula: VE, amountBaseUnits: ONE_E18, durationSeconds: VE_MAX_LOCK_SECONDS });
  assert.equal(tx.to, VE);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.chainId, 712217);           // mainnet default
  assert.equal(tx.method, 'lock');
  const durWord = BigInt(VE_MAX_LOCK_SECONDS).toString(16).padStart(64, '0');
  assert.equal(tx.data, STAKE_SELECTORS.lock + ONE_E18_WORD + durWord);
  assert.ok(tx.data.startsWith('0x1338736f'));
});

test('buildIncreaseAmountTx / buildExtendLockTx / buildWithdrawTx shapes', () => {
  assert.equal(buildIncreaseAmountTx({ veKula: VE, amountBaseUnits: ONE_E18 }).data,
    '0x15456eba' + ONE_E18_WORD);
  const ext = buildExtendLockTx({ veKula: VE, newDurationSeconds: 1000 });
  assert.equal(ext.data, '0x44ee3a1c' + BigInt(1000).toString(16).padStart(64, '0'));
  const w = buildWithdrawTx({ veKula: VE });
  assert.equal(w.data, '0x3ccfd60b');          // no args
  assert.equal(w.method, 'withdraw');
});

test('buildStakeApproveTx approves veKULA to pull KULA (spender = veKULA, to = KULA)', () => {
  const tx = buildStakeApproveTx({ kula: KULA, veKula: VE, amountBaseUnits: ONE_E18 });
  assert.equal(tx.to, KULA);
  const spenderWord = VE.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  assert.equal(tx.data, '0x095ea7b3' + spenderWord + ONE_E18_WORD);
});

test('chainId is overridable to the testnet', () => {
  assert.equal(buildLockTx({ veKula: VE, amountBaseUnits: ONE_E18, durationSeconds: 1000, chainId: 108369 }).chainId, 108369);
});

test('descriptors soft-fail on garbage instead of throwing', () => {
  assert.doesNotThrow(() => buildLockTx({}));
  assert.doesNotThrow(() => buildStakeApproveTx({ kula: 'nope', veKula: 'nope', amountBaseUnits: 'x' }));
});
