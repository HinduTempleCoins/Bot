// faucet.test.mjs — offline tests for the Hathor faucet test harness (signup/faucet.mjs).
// node --test signup/faucet.test.mjs
//
// Fully offline: no network. The broadcaster is injected with a fake that records ops; the RNG is
// injected for deterministic grant amounts. We assert the amount band, account-name + key
// validation, op shape, and the soft-fail behavior — never asserting it throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAccountOps, buildPlan, randomGrantAmount, runFaucet,
  __setRng, GRANT_MIN, GRANT_MAX, GRANT_SYMBOL, WITNESS_ACCOUNT, PREFIX,
} from './faucet.mjs';

const PUB = 'TST5jUQUS5Xdjp8RB5Wj2bWct8Gwf1mHzL3sQZ9k3kBm2Nq4Rtwwz'; // looks-like a TST public key
function acct(name, over = {}) {
  return { name, ownerPub: PUB, activePub: PUB, postingPub: PUB, memoPub: PUB, ...over };
}

test('randomGrantAmount stays in the 5–15 TESTS band, 3 dp, TESTS symbol', () => {
  for (const r of [0, 0.0001, 0.25, 0.5, 0.9999, 1 - 1e-12]) {
    __setRng(() => r);
    const a = randomGrantAmount();
    const [numStr, sym] = a.split(' ');
    const num = Number(numStr);
    assert.equal(sym, GRANT_SYMBOL, `symbol must be ${GRANT_SYMBOL}`);
    assert.ok(num >= GRANT_MIN && num <= GRANT_MAX, `${num} in [${GRANT_MIN},${GRANT_MAX}]`);
    assert.match(numStr, /^\d+\.\d{3}$/, '3 decimal places');
  }
  __setRng(null);
});

test('randomGrantAmount endpoints: rng=0 -> 5.000, rng~1 -> ~15.000', () => {
  __setRng(() => 0);
  assert.equal(randomGrantAmount(), `5.000 ${GRANT_SYMBOL}`);
  __setRng(() => 0.9999999);
  const hi = Number(randomGrantAmount().split(' ')[0]);
  assert.ok(hi <= GRANT_MAX && hi >= 14.99);
  __setRng(null);
});

test('buildAccountOps builds create + transfer for a valid account', () => {
  __setRng(() => 0.5); // -> 10.000 TESTS
  const r = buildAccountOps(acct('faucet-test-1'));
  __setRng(null);
  assert.equal(r.ok, true);
  assert.equal(r.amount, `10.000 ${GRANT_SYMBOL}`);
  assert.equal(r.ops.length, 2);

  const [create, transfer] = r.ops;
  assert.equal(create[0], 'account_create_with_delegation');
  assert.equal(create[1].creator, WITNESS_ACCOUNT);
  assert.equal(create[1].new_account_name, 'faucet-test-1');
  assert.deepEqual(create[1].owner.key_auths, [[PUB, 1]]);

  assert.equal(transfer[0], 'transfer');
  assert.equal(transfer[1].from, WITNESS_ACCOUNT);
  assert.equal(transfer[1].to, 'faucet-test-1');
  assert.equal(transfer[1].amount, `10.000 ${GRANT_SYMBOL}`);
});

test('rejects an invalid account name (soft-fail, no throw)', () => {
  const r = buildAccountOps(acct('A')); // too short + uppercase
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid-account-name');
});

test('rejects a private-key-shaped value HARD (custody guard)', () => {
  // Build a WIF-shaped string at runtime (no literal key in source): leading '5' + 50 base58 chars.
  const wif = '5' + 'K'.repeat(50); // matches the WIF shape the custody guard rejects
  const r = buildAccountOps(acct('faucet-test-2', { ownerPub: wif }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'private-key-rejected:ownerPub');
});

test('rejects a public key with the wrong prefix (not TST)', () => {
  const stmKey = 'STM5jUQUS5Xdjp8RB5Wj2bWct8Gwf1mHzL3sQZ9k3kBm2Nq4Rtwwz';
  const r = buildAccountOps(acct('faucet-test-3', { activePub: stmKey }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, `wrong-prefix:activePub`);
  assert.equal(PREFIX, 'TST');
});

test('buildPlan summarizes valid vs invalid', () => {
  const plan = buildPlan([acct('faucet-test-1'), acct('x'), acct('faucet-test-2')]);
  assert.equal(plan.valid, 2);
  assert.equal(plan.invalid, 1);
  assert.equal(plan.ok, false);
});

test('runFaucet is DRY-RUN by default (no broadcaster) — returns ops, no ids', async () => {
  __setRng(() => 0.5);
  const out = await runFaucet([acct('faucet-test-1')]);
  __setRng(null);
  assert.equal(out.dryRun, true);
  assert.equal(out.results[0].ok, true);
  assert.equal(out.results[0].dryRun, true);
  assert.ok(Array.isArray(out.results[0].ops));
  assert.equal(out.results[0].granted, undefined);
});

test('runFaucet live broadcasts create then transfer, in order, capturing ids', async () => {
  __setRng(() => 0.3); // -> 8.000 TESTS
  const calls = [];
  const broadcaster = async (op) => {
    calls.push(op[0]);
    return { id: op[0] === 'transfer' ? 'txTRANSFER' : 'txCREATE' };
  };
  const out = await runFaucet([acct('faucet-test-1')], { live: true, broadcaster });
  __setRng(null);

  assert.equal(out.dryRun, false);
  assert.equal(out.ok, true);
  assert.deepEqual(calls, ['account_create_with_delegation', 'transfer'], 'create before transfer');
  const r = out.results[0];
  assert.equal(r.created, 'txCREATE');
  assert.equal(r.granted, 'txTRANSFER');
  assert.equal(r.amount, `8.000 ${GRANT_SYMBOL}`);
});

test('runFaucet soft-fails one account, others still proceed', async () => {
  __setRng(() => 0.5);
  let n = 0;
  const broadcaster = async (op) => {
    n += 1;
    // fail the FIRST account's create only
    if (n === 1) throw new Error('boom');
    return { id: `tx${n}` };
  };
  const out = await runFaucet([acct('faucet-test-1'), acct('faucet-test-2')], { live: true, broadcaster });
  __setRng(null);

  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].ok, false);
  assert.match(out.results[0].reason, /create-failed:/);
  assert.equal(out.results[1].ok, true);
  assert.equal(out.ok, false); // overall ok only if every account ok
});

test('runFaucet reports grant-failed when the transfer fails after a good create', async () => {
  __setRng(() => 0.5);
  const broadcaster = async (op) => {
    if (op[0] === 'transfer') throw new Error('no funds');
    return { id: 'txCREATE' };
  };
  const out = await runFaucet([acct('faucet-test-1')], { live: true, broadcaster });
  __setRng(null);
  const r = out.results[0];
  assert.equal(r.ok, false);
  assert.equal(r.created, 'txCREATE');
  assert.match(r.reason, /grant-failed:/);
});
