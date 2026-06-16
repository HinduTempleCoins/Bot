/**
 * bridge.test.mjs — offline unit tests for the wMELEK bridge contract + the
 * bridge-only invariant in tokens.mjs.
 *
 * THE INVARIANT under test: wMELEK supply == MELEK locked in the bridge.
 * wMELEK mints ONLY on a bridge deposit, burns ONLY on a withdrawal; on
 * mainnet (allowTestnetFreeIssue=false) NO free issuance is possible.
 *
 * Fully offline + deterministic: real engine State + genesis bootstrap in
 * memory, no network/clock/randomness. Toggles config.bridge.allowTestnetFreeIssue
 * around each case and restores it (config is a mutable object).
 *
 * Run: node --test engine/contracts/bridge.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens, wrappedGuard } from '../contracts/tokens.mjs';
import { bridge } from '../contracts/bridge.mjs';
import { config } from '../config.mjs';

const BRIDGE = config.bridge.account; // 'hathor' by default
const WRAPPED = config.bridge.wrappedSymbol; // 'WMELEK'

function fresh() {
  const s = new State(null);
  bootstrapGenesis(s);
  return s;
}
function ctx(sender, blockNum = 1) {
  return { sender, blockNum, blockId: 'b', txId: `t${blockNum}`, authLevel: 'active' };
}
const supplyOf = (s, symbol) => {
  const t = s.findOne('tokens', { symbol });
  return t ? t.supply : null;
};
const balRaw = (s, account, symbol) => {
  const r = s.findOne('balances', { account, symbol });
  return r ? r.balance : '0';
};

/** Run `fn` with allowTestnetFreeIssue forced to `flag`, then restore. */
function withFreeIssue(flag, fn) {
  const prev = config.bridge.allowTestnetFreeIssue;
  config.bridge.allowTestnetFreeIssue = flag;
  try { return fn(); } finally { config.bridge.allowTestnetFreeIssue = prev; }
}

// ── the mainnet-flag guard (free issuance) ──────────────────────────────────

test('mainnet flag: free create/issue of WMELEK is rejected for a non-bridge sender', () => {
  const s = fresh();
  withFreeIssue(false, () => {
    // give mallory APIS so the fee burn is not what fails
    tokens.transfer(s, ctx(BRIDGE), { symbol: 'APIS', to: 'mallory', quantity: '500' });
    const create = tokens.create(s, ctx('mallory'), { symbol: WRAPPED, precision: 3, maxSupply: '1000000' });
    assert.equal(create.ok, false);
    assert.match(create.error, /bridge-only/);
    assert.equal(s.findOne('tokens', { symbol: WRAPPED }), null, 'no WMELEK token created');
  });
});

test('mainnet flag: even the WMELEK issuer cannot free-issue if not the bridge account', () => {
  const s = fresh();
  // bridge creates WMELEK with a DIFFERENT issuer to simulate a mis-set issuer
  withFreeIssue(true, () => {
    tokens.create(s, ctx(BRIDGE), { symbol: WRAPPED, precision: 3, maxSupply: '1000000' });
  });
  // re-point the issuer to a non-bridge account, then flip the mainnet flag
  s.findOne('tokens', { symbol: WRAPPED }).issuer = 'mallory';
  withFreeIssue(false, () => {
    const r = tokens.issue(s, ctx('mallory'), { symbol: WRAPPED, to: 'mallory', quantity: '5' });
    assert.equal(r.ok, false);
    assert.match(r.error, /bridge-only/);
  });
});

test('mainnet flag: the bridge account is always allowed to issue WMELEK', () => {
  const s = fresh();
  withFreeIssue(true, () => tokens.create(s, ctx(BRIDGE), { symbol: WRAPPED, precision: 3, maxSupply: '1000000' }));
  withFreeIssue(false, () => {
    const r = tokens.issue(s, ctx(BRIDGE), { symbol: WRAPPED, to: 'alice', quantity: '10' });
    assert.ok(r.ok, r.error);
  });
});

test('testnet flag: free issue convenience still works (allowTestnetFreeIssue=true)', () => {
  const s = fresh();
  withFreeIssue(true, () => {
    const create = tokens.create(s, ctx(BRIDGE), { symbol: WRAPPED, precision: 3, maxSupply: '1000000' });
    assert.ok(create.ok, create.error);
    const issue = tokens.issue(s, ctx(BRIDGE), { symbol: WRAPPED, to: 'alice', quantity: '7' });
    assert.ok(issue.ok, issue.error);
  });
});

test('wrappedGuard: non-wrapped symbols are never gated', () => {
  withFreeIssue(false, () => {
    assert.equal(wrappedGuard('APIS', 'mallory'), null);
    assert.equal(wrappedGuard('DRONE', 'mallory'), null);
  });
});

// ── bridge.mintWrapped / burnWrapped ────────────────────────────────────────

test('bridge.mintWrapped: bridge account mints WMELEK against a deposit ref', () => {
  const s = fresh();
  withFreeIssue(false, () => {
    const r = bridge.mintWrapped(s, ctx(BRIDGE), { to: 'alice', amount: '12.5', depositRef: 'dep-1' });
    assert.ok(r.ok, r.error);
    assert.equal(r.minted, '12.500');
    assert.equal(balRaw(s, 'alice', WRAPPED), '12500');
    assert.equal(supplyOf(s, WRAPPED), '12500');
    // ledger recorded
    assert.ok(s.findOne('bridgeLedger', { kind: 'mint', ref: 'dep-1' }));
  });
});

test('bridge.mintWrapped: non-bridge sender is rejected', () => {
  const s = fresh();
  const r = bridge.mintWrapped(s, ctx('mallory'), { to: 'mallory', amount: '5', depositRef: 'dep-x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /restricted to the bridge account/);
  assert.equal(s.findOne('tokens', { symbol: WRAPPED }), null, 'no WMELEK minted into existence');
});

test('bridge.mintWrapped: double-mint on the same depositRef is a no-op success', () => {
  const s = fresh();
  withFreeIssue(false, () => {
    const first = bridge.mintWrapped(s, ctx(BRIDGE), { to: 'alice', amount: '10', depositRef: 'dep-2' });
    assert.ok(first.ok, first.error);
    const dup = bridge.mintWrapped(s, ctx(BRIDGE), { to: 'alice', amount: '10', depositRef: 'dep-2' });
    assert.ok(dup.ok, dup.error);
    assert.equal(dup.idempotent, true);
    // supply did NOT double
    assert.equal(supplyOf(s, WRAPPED), '10000');
    assert.equal(balRaw(s, 'alice', WRAPPED), '10000');
    // exactly one ledger row for the ref
    assert.equal(s.find('bridgeLedger', { kind: 'mint', ref: 'dep-2' }).length, 1);
  });
});

test('bridge.mintWrapped: bad/missing args soft-fail', () => {
  const s = fresh();
  assert.equal(bridge.mintWrapped(s, ctx(BRIDGE), { amount: '1', depositRef: 'd' }).ok, false); // no to
  assert.equal(bridge.mintWrapped(s, ctx(BRIDGE), { to: 'a', amount: '1' }).ok, false);          // no ref
  assert.equal(bridge.mintWrapped(s, ctx(BRIDGE), { to: 'a', amount: '0', depositRef: 'd' }).ok, false); // zero
});

test('bridge.burnWrapped: burns on a withdrawal ref, idempotent, tracks supply', () => {
  const s = fresh();
  withFreeIssue(false, () => {
    bridge.mintWrapped(s, ctx(BRIDGE), { to: 'alice', amount: '20', depositRef: 'dep-3' });
    const burn = bridge.burnWrapped(s, ctx(BRIDGE), { from: 'alice', amount: '8', withdrawalRef: 'w-1' });
    assert.ok(burn.ok, burn.error);
    assert.equal(burn.burned, '8.000');
    assert.equal(balRaw(s, 'alice', WRAPPED), '12000');
    assert.equal(supplyOf(s, WRAPPED), '12000'); // 20 - 8

    // idempotent: same ref -> no-op success, supply unchanged
    const dup = bridge.burnWrapped(s, ctx(BRIDGE), { from: 'alice', amount: '8', withdrawalRef: 'w-1' });
    assert.ok(dup.ok, dup.error);
    assert.equal(dup.idempotent, true);
    assert.equal(supplyOf(s, WRAPPED), '12000');

    // non-bridge burn rejected
    const nope = bridge.burnWrapped(s, ctx('mallory'), { from: 'alice', amount: '1', withdrawalRef: 'w-2' });
    assert.equal(nope.ok, false);
    // over-burn soft-fails
    const over = bridge.burnWrapped(s, ctx(BRIDGE), { from: 'alice', amount: '1000', withdrawalRef: 'w-3' });
    assert.equal(over.ok, false);
    assert.match(over.error, /insufficient/);
  });
});

test('INVARIANT: wMELEK supply == sum(deposits) − sum(withdrawals)', () => {
  const s = fresh();
  withFreeIssue(false, () => {
    bridge.mintWrapped(s, ctx(BRIDGE, 1), { to: 'alice', amount: '100', depositRef: 'd1' });
    bridge.mintWrapped(s, ctx(BRIDGE, 2), { to: 'bob', amount: '50', depositRef: 'd2' });
    bridge.mintWrapped(s, ctx(BRIDGE, 3), { to: 'alice', amount: '100', depositRef: 'd1' }); // replay, no-op
    bridge.burnWrapped(s, ctx(BRIDGE, 4), { from: 'alice', amount: '30', withdrawalRef: 'w1' });
    bridge.burnWrapped(s, ctx(BRIDGE, 5), { from: 'alice', amount: '30', withdrawalRef: 'w1' }); // replay, no-op

    // deposits = 100 + 50 = 150 ; withdrawals = 30 ; locked = 120
    assert.equal(supplyOf(s, WRAPPED), '120000'); // @ precision 3
    const view = bridge.lockedSupply(s);
    assert.equal(view.supply, '120.000');
  });
});
