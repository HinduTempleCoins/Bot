import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  redeemBond, isMember,
  lockStake, votingPower, earningMultiplier,
  clearState, DEFAULT_TERM_DAYS, MAX_LOCK_DAYS,
} from './access-bond-dao.mjs';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_750_000_000_000;

beforeEach(() => clearState());

// ---- BOND ----

test('redeemBond burns the bond and grants a membership term', () => {
  const bond = { id: 'B1' };
  const res = redeemBond(bond, 'alice', { now: T0 });
  assert.equal(res.burned, true);
  assert.equal(bond.burned, true); // the token itself is consumed
  assert.equal(res.membershipUntil, T0 + DEFAULT_TERM_DAYS * DAY);
  assert.equal(isMember('alice', { now: T0 }), true);
});

test('a burned bond cannot be redeemed again (irreversible)', () => {
  const bond = { id: 'B1' };
  redeemBond(bond, 'alice', { now: T0 });
  assert.throws(() => redeemBond(bond, 'bob', { now: T0 }), /already burned/);
});

test('membership expires after the term', () => {
  redeemBond({ id: 'B1', termDays: 30 }, 'alice', { now: T0 });
  assert.equal(isMember('alice', { now: T0 + 29 * DAY }), true);
  assert.equal(isMember('alice', { now: T0 + 31 * DAY }), false);
});

test('redeeming again stacks the term onto remaining time (no reset)', () => {
  redeemBond({ id: 'B1', termDays: 30 }, 'alice', { now: T0 });
  const res = redeemBond({ id: 'B2', termDays: 30 }, 'alice', { now: T0 + 10 * DAY });
  // extends from the existing expiry (T0+30d), not from now (T0+10d)
  assert.equal(res.membershipUntil, T0 + 60 * DAY);
});

test('who-pays decouples from who-uses: redeemer gets the term', () => {
  // bob holds/transfers the bond; alice redeems it
  const bond = { id: 'B1' };
  redeemBond(bond, 'alice', { now: T0 });
  assert.equal(isMember('alice', { now: T0 }), true);
  assert.equal(isMember('bob', { now: T0 }), false);
});

// ---- DAO ----

test('longer lock yields more voting power', () => {
  lockStake('long', 1000, T0 + MAX_LOCK_DAYS * DAY, { now: T0 });
  lockStake('short', 1000, T0 + 30 * DAY, { now: T0 });
  const pLong = votingPower('long', { now: T0 });
  const pShort = votingPower('short', { now: T0 });
  assert.ok(pLong > pShort, `${pLong} should exceed ${pShort}`);
});

test('voting power decays to zero once the lock expires', () => {
  lockStake('alice', 1000, T0 + 30 * DAY, { now: T0 });
  assert.ok(votingPower('alice', { now: T0 }) > 0);
  assert.equal(votingPower('alice', { now: T0 + 31 * DAY }), 0);
});

test('no stake means no voting power and no earning boost', () => {
  assert.equal(votingPower('nobody', { now: T0 }), 0);
  assert.equal(earningMultiplier('nobody', { now: T0 }), 1);
});

test('earning multiplier rises with stake lock (activity boost, not yield)', () => {
  lockStake('long', 1000, T0 + MAX_LOCK_DAYS * DAY, { now: T0 });
  lockStake('short', 1000, T0 + 30 * DAY, { now: T0 });
  const mLong = earningMultiplier('long', { now: T0 });
  const mShort = earningMultiplier('short', { now: T0 });
  assert.ok(mLong > mShort);
  assert.ok(mLong > 1); // staking boosts activity earning
  assert.ok(mShort >= 1);
});

test('lockStake rejects non-future unlock and non-positive amount', () => {
  assert.throws(() => lockStake('a', 1000, T0 - DAY, { now: T0 }), /future/);
  assert.throws(() => lockStake('a', 0, T0 + DAY, { now: T0 }), /amount/);
});
