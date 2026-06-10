// welcomer.test.mjs — offline tests for Hathor's new-user welcome loop (Task #310).
// node --test witness/welcomer.test.mjs
//
// Fully offline: no network, no real chain client, no key. The broadcaster, RNG, and sleep are all
// injected. Asserts op shapes, the 5-15 grant range, env-driven symbol, ping spacing, and soft-fail
// on broadcast error.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  welcomeAccount,
  welcomeBatch,
  buildDelegateOp,
  buildGrantOp,
  buildWelcomePingComment,
  pickGrantAmount,
  findNewAccounts,
  validAccountName,
  esc,
  __setBroadcast,
  __setRandom,
  __setSleep,
} from './welcomer.mjs';

function reset() {
  __setBroadcast(null);
  __setRandom(null);
  __setSleep(null);
}

// A permlink env isn't set in the test process, so pass postPermlink explicitly where a real ping
// is needed. The module default is empty (a real ping requires WELCOME_POST_PERMLINK on the host).
const POST = 'introducing-hathor-on-melek';

// ── op builders: shapes ───────────────────────────────────────────────────────────────────────

test('buildDelegateOp shape is a standard delegate_vesting_shares', () => {
  const op = buildDelegateOp({ to: 'alice-tests' });
  assert.equal(Array.isArray(op), true);
  assert.equal(op[0], 'delegate_vesting_shares');
  assert.equal(op[1].delegator, 'hathor');
  assert.equal(op[1].delegatee, 'alice-tests');
  assert.match(op[1].vesting_shares, /^\d+\.\d{6} VESTS$/);
});

test('buildDelegateOp rejects an invalid delegatee', () => {
  assert.throws(() => buildDelegateOp({ to: 'A!' }), /invalid delegatee/);
});

test('buildGrantOp shape is a standard transfer with a 3-decimal asset', () => {
  const op = buildGrantOp({ to: 'bob-tests', asset: '10.000 TESTS' });
  assert.equal(op[0], 'transfer');
  assert.equal(op[1].from, 'hathor');
  assert.equal(op[1].to, 'bob-tests');
  assert.equal(op[1].amount, '10.000 TESTS');
  assert.equal(typeof op[1].memo, 'string');
});

test('buildGrantOp rejects a malformed asset string', () => {
  assert.throws(() => buildGrantOp({ to: 'bob-tests', asset: '10 TESTS' }), /asset must be/);
});

test('buildWelcomePingComment is a comment reply that @-mentions the account', () => {
  const op = buildWelcomePingComment({ account: 'carol-tests', postPermlink: POST });
  assert.equal(op[0], 'comment');
  assert.equal(op[1].parent_author, 'hathor');
  assert.equal(op[1].parent_permlink, POST);
  assert.equal(op[1].author, 'hathor');
  assert.ok(op[1].body.includes('@carol-tests'), 'body must @-mention the new account');
  // permlink: lowercase, hyphen-safe, bounded
  assert.match(op[1].permlink, /^[a-z0-9-]+$/);
  assert.ok(op[1].permlink.length <= 255);
  // json_metadata is valid JSON tagging the welcomer app
  const meta = JSON.parse(op[1].json_metadata);
  assert.ok(meta.app.startsWith('hathor-welcomer'));
  assert.deepEqual(meta.tags, ['welcome']);
});

test('buildWelcomePingComment requires a welcome post permlink', () => {
  assert.throws(() => buildWelcomePingComment({ account: 'carol-tests', postPermlink: '' }),
    /permlink required/);
});

test('buildWelcomePingComment variant is deterministic per account', () => {
  const a = buildWelcomePingComment({ account: 'dave-tests', postPermlink: POST });
  const b = buildWelcomePingComment({ account: 'dave-tests', postPermlink: POST });
  assert.equal(a[1].body, b[1].body, 'same account → same variant every time');
});

// ── grant amount: 5-15 range + env symbol ─────────────────────────────────────────────────────

test('pickGrantAmount stays within the 5-15 range over many draws', () => {
  reset();
  for (let i = 0; i < 500; i++) {
    const { amount } = pickGrantAmount();
    assert.ok(amount >= 5 && amount <= 15, `grant ${amount} out of [5,15]`);
  }
});

test('pickGrantAmount hits both endpoints (inclusive)', () => {
  __setRandom(() => 0);            // floor → min
  assert.equal(pickGrantAmount().amount, 5);
  __setRandom(() => 0.9999999);    // ceil → max (inclusive)
  assert.equal(pickGrantAmount().amount, 15);
  reset();
});

test('pickGrantAmount uses the configured symbol and 3-decimal asset format', () => {
  __setRandom(() => 0.5);
  const { asset } = pickGrantAmount({ symbol: 'MELEK' });
  assert.match(asset, /^\d+\.\d{3} MELEK$/);
  const t = pickGrantAmount({ symbol: 'TESTS' });
  assert.match(t.asset, /^\d+\.\d{3} TESTS$/);
  reset();
});

// ── welcomeAccount: dry-run + live broadcast paths ────────────────────────────────────────────

test('welcomeAccount DRY-RUN (no broadcaster) prepares all three ops, never broadcasts', async () => {
  reset();
  let called = 0;
  // Even with a broadcaster injected, live defaults to false → dry-run.
  __setBroadcast(() => { called++; });
  const r = await welcomeAccount({ account: 'erin-tests', postPermlink: POST });
  assert.equal(called, 0, 'broadcaster not called in dry-run');
  assert.equal(r.dryRun, true);
  assert.equal(r.delegate.op[0], 'delegate_vesting_shares');
  assert.equal(r.grant.op[0], 'transfer');
  assert.equal(r.ping.op[0], 'comment');
  assert.match(r.grantAsset, /^\d+\.\d{3} TESTS$/);
  reset();
});

test('welcomeAccount live WITH broadcaster fires delegate(active) + grant(active) + ping(posting)', async () => {
  reset();
  const seen = [];
  __setBroadcast((op, { keyType }) => { seen.push([op[0], keyType]); return { id: 'tx-' + op[0] }; });
  // process env has no WELCOME_POST_PERMLINK, so pass it explicitly for the ping to build.
  const r = await welcomeAccount({ account: 'frank-tests', live: true, postPermlink: POST });
  assert.equal(r.dryRun, false);
  assert.deepEqual(seen, [
    ['delegate_vesting_shares', 'active'],
    ['transfer', 'active'],
    ['comment', 'posting'],
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.delegate.id, 'tx-delegate_vesting_shares');
  assert.equal(r.ping.id, 'tx-comment');
  reset();
});

test('welcomeAccount live but NO broadcaster stays dry-run (zero-WIF safety floor)', async () => {
  reset();
  const r = await welcomeAccount({ account: 'grace-tests', live: true, postPermlink: POST });
  assert.equal(r.dryRun, true, 'no broadcaster → cannot broadcast even when live');
  assert.equal(r.delegate.op[0], 'delegate_vesting_shares');
  reset();
});

test('welcomeAccount soft-fails on a broadcast error and does not throw', async () => {
  reset();
  __setBroadcast(() => { throw new Error('signer 503'); });
  const r = await welcomeAccount({ account: 'heidi-tests', live: true, postPermlink: POST });
  assert.equal(r.ok, false, 'overall not-ok when steps fail');
  assert.equal(r.delegate.ok, false);
  assert.match(r.delegate.error, /signer 503/);
  assert.equal(r.grant.ok, false);
  assert.equal(r.ping.ok, false);
  reset();
});

test('welcomeAccount continues past a single failing step (grant still attempted after delegate fails)', async () => {
  reset();
  const calls = [];
  __setBroadcast((op) => {
    calls.push(op[0]);
    if (op[0] === 'delegate_vesting_shares') throw new Error('delegate boom');
    return { id: 'ok' };
  });
  const r = await welcomeAccount({ account: 'ivan-tests', live: true, postPermlink: POST });
  assert.deepEqual(calls, ['delegate_vesting_shares', 'transfer', 'comment'],
    'all three steps attempted even though the first failed');
  assert.equal(r.delegate.ok, false);
  assert.equal(r.grant.ok, true);
  assert.equal(r.ping.ok, true);
  reset();
});

test('welcomeAccount rejects an invalid account without touching the chain', async () => {
  reset();
  let called = 0;
  __setBroadcast(() => { called++; });
  const r = await welcomeAccount({ account: 'BAD!', live: true, postPermlink: POST });
  assert.equal(called, 0);
  assert.equal(r.ok, false);
  assert.equal(r.delegate.error, 'invalid-account-name');
  reset();
});

// ── welcomeBatch: ping spacing ────────────────────────────────────────────────────────────────

test('welcomeBatch spaces pings: sleeps between accounts (N-1 sleeps), each >= 3.5s floor', async () => {
  reset();
  const sleeps = [];
  __setSleep((ms) => { sleeps.push(ms); return Promise.resolve(); });
  __setBroadcast(() => ({ id: 'x' }));
  await welcomeBatch(['ann-tests', 'ben-tests', 'cara-tests'], { live: true, spacingMs: 7000 });
  assert.equal(sleeps.length, 2, 'N-1 = 2 sleeps for 3 accounts (no sleep before the first)');
  for (const ms of sleeps) assert.ok(ms >= 3500, `spacing ${ms} below the 3.5s floor`);
  assert.deepEqual(sleeps, [7000, 7000]);
  reset();
});

test('welcomeBatch floors a too-small requested spacing at 3.5s', async () => {
  reset();
  const sleeps = [];
  __setSleep((ms) => { sleeps.push(ms); return Promise.resolve(); });
  __setBroadcast(() => ({ id: 'x' }));
  await welcomeBatch(['ann-tests', 'ben-tests'], { live: true, spacingMs: 100 });
  assert.deepEqual(sleeps, [3500], 'requested 100ms floored to the 3500ms rate-limit floor');
  reset();
});

test('welcomeBatch with a single account does not sleep at all', async () => {
  reset();
  let slept = 0;
  __setSleep(() => { slept++; return Promise.resolve(); });
  __setBroadcast(() => ({ id: 'x' }));
  const out = await welcomeBatch(['solo-tests'], { live: true });
  assert.equal(slept, 0);
  assert.equal(out.length, 1);
  reset();
});

// ── findNewAccounts: validate / dedupe / skip ─────────────────────────────────────────────────

test('findNewAccounts validates, de-duplicates, and skips', async () => {
  const out = await findNewAccounts({
    candidates: ['alice-tests', 'alice-tests', 'BAD!', '  bob-tests  ', 'sys-acct'],
    skip: ['sys-acct'],
  });
  assert.deepEqual(out, ['alice-tests', 'bob-tests'],
    'dupes collapsed, invalid dropped, trimmed, skip honored');
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

test('validAccountName mirrors the faucet rules', () => {
  assert.equal(validAccountName('alice-tests'), true);
  assert.equal(validAccountName('ab'), false);          // too short
  assert.equal(validAccountName('Alice'), false);       // uppercase
  assert.equal(validAccountName('a--b-tests'), false);  // double hyphen
});

test('esc neutralizes angle brackets and strips control chars', () => {
  assert.equal(esc('<b>hi</b>'), '&lt;b&gt;hi&lt;/b&gt;');
  assert.equal(esc('a\x00b\x1fc'), 'abc'); // control chars removed
});
