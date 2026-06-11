// welcome-grant.test.mjs — offline tests for the VISIBLE half of onboarding.
// Fully offline: fake deps (no chain, no keys, no network). node:test + node:assert/strict.
//   cd /workspaces/Bot && node --test signup/welcome-grant.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  welcomeGrant,
  describeWelcome,
  normalizeGrant,
  validAccountName,
  esc,
  WELCOME_SYMBOL,
} from './welcome-grant.mjs';

// ── fake deps ────────────────────────────────────────────────────────────────────────────────────
function makeDeps() {
  const calls = { transfer: [], pingWelcome: [] };
  return {
    calls,
    deps: {
      transfer: async (args) => { calls.transfer.push(args); return { id: 'tx-grant-1' }; },
      pingWelcome: async (args) => { calls.pingWelcome.push(args); return { id: 'tx-ping-1' }; },
    },
  };
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

test('validAccountName accepts/rejects per Graphene rules', () => {
  assert.equal(validAccountName('alice-tests'), true);
  assert.equal(validAccountName('foo.cool'), true);
  assert.equal(validAccountName('a.b'), false);       // segments too short
  assert.equal(validAccountName('ab'), false);        // too short
  assert.equal(validAccountName('Alice'), false);     // uppercase
  assert.equal(validAccountName('a--b-tests'), false); // double hyphen
  assert.equal(validAccountName(42), false);
});

test('normalizeGrant handles number, bare string, full asset, and bad input', () => {
  assert.equal(normalizeGrant(5).asset, `5.000 ${WELCOME_SYMBOL}`);
  assert.equal(normalizeGrant('7').asset, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(normalizeGrant('12.000 TESTS').asset, '12.000 TESTS');
  assert.ok(normalizeGrant(0).error);
  assert.ok(normalizeGrant(-3).error);
  assert.ok(normalizeGrant('not-a-number').error);
  assert.ok(normalizeGrant('5 TESTS').error); // wrong dp count in a full asset
});

test('esc strips control chars and neutralizes angle brackets', () => {
  assert.equal(esc('a<b>&c'), 'a&lt;b&gt;&amp;c');
  assert.equal(esc('xy'), 'xy');
  assert.equal(esc(null), '');
});

test('describeWelcome returns a plain step list', () => {
  const d = describeWelcome();
  assert.equal(typeof d.summary, 'string');
  assert.equal(d.steps.length, 2);
  assert.deepEqual(d.steps.map((s) => s.name), ['grant', 'ping']);
});

// ── HAPPY PATH ─────────────────────────────────────────────────────────────────────────────────

test('happy: grant then ping, both land, ok=true, deps called correctly', async () => {
  const { deps, calls } = makeDeps();
  const out = await welcomeGrant('newbie-tests', deps, { grant: 7 });

  assert.equal(out.ok, true);
  assert.equal(out.account, 'newbie-tests');
  assert.equal(out.amount, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(out.granted, 'tx-grant-1');
  assert.equal(out.pinged, 'tx-ping-1');
  assert.deepEqual(out.errors, []);

  // transfer got the right shape
  assert.equal(calls.transfer.length, 1);
  assert.equal(calls.transfer[0].to, 'newbie-tests');
  assert.equal(calls.transfer[0].amount, `7.000 ${WELCOME_SYMBOL}`);
  assert.equal(calls.transfer[0].from, 'hathor');
  // ping got the account
  assert.equal(calls.pingWelcome.length, 1);
  assert.equal(calls.pingWelcome[0].account, 'newbie-tests');
});

test('happy: default grant when none supplied', async () => {
  const { deps } = makeDeps();
  const out = await welcomeGrant('newbie-tests', deps);
  assert.equal(out.ok, true);
  assert.equal(out.amount, `5.000 ${WELCOME_SYMBOL}`);
});

test('happy: dep returning a bare string id is captured', async () => {
  const deps = {
    transfer: async () => 'raw-tx-id',
    pingWelcome: async () => ({ trx_id: 'ping-trx' }),
  };
  const out = await welcomeGrant('newbie-tests', deps, { grant: 5 });
  assert.equal(out.granted, 'raw-tx-id');
  assert.equal(out.pinged, 'ping-trx');
  assert.equal(out.ok, true);
});

// ── EDGE: GRANT FAILS ─────────────────────────────────────────────────────────────────────────

test('grant-fails: transfer throws, but ping STILL runs and lands', async () => {
  const calls = { ping: [] };
  const deps = {
    transfer: async () => { throw new Error('insufficient balance'); },
    pingWelcome: async (a) => { calls.ping.push(a); return { id: 'tx-ping-1' }; },
  };
  const out = await welcomeGrant('newbie-tests', deps, { grant: 9 });

  assert.equal(out.ok, false);          // grant did not land
  assert.equal(out.granted, null);
  assert.equal(out.pinged, 'tx-ping-1'); // ping STILL fired (grant failure must not skip the ping)
  assert.equal(calls.ping.length, 1);
  assert.ok(out.errors.some((e) => e.startsWith('grant:')));
  assert.ok(out.errors[0].includes('insufficient balance'));
});

test('grant-fails: bad grant amount → no transfer attempted, ping still runs', async () => {
  const calls = { transfer: 0, ping: 0 };
  const deps = {
    transfer: async () => { calls.transfer++; return { id: 'x' }; },
    pingWelcome: async () => { calls.ping++; return { id: 'tx-ping-1' }; },
  };
  const out = await welcomeGrant('newbie-tests', deps, { grant: -5 });

  assert.equal(out.ok, false);
  assert.equal(out.amount, null);
  assert.equal(calls.transfer, 0);     // garbage amount never sent
  assert.equal(calls.ping, 1);         // ping still fires
  assert.equal(out.pinged, 'tx-ping-1');
  assert.ok(out.errors.some((e) => e.includes('bad-grant')));
});

// ── EDGE: PING FAILS ──────────────────────────────────────────────────────────────────────────

test('ping-fails: ping throws, but grant is preserved and reported', async () => {
  const calls = { transfer: [] };
  const deps = {
    transfer: async (a) => { calls.transfer.push(a); return { id: 'tx-grant-1' }; },
    pingWelcome: async () => { throw new Error('rate limited'); },
  };
  const out = await welcomeGrant('newbie-tests', deps, { grant: 11 });

  assert.equal(out.ok, false);             // not fully ok (ping failed)
  assert.equal(out.granted, 'tx-grant-1'); // GRANT PRESERVED — a ping hiccup must not undo it
  assert.equal(out.pinged, null);
  assert.equal(calls.transfer.length, 1);  // grant did happen
  assert.ok(out.errors.some((e) => e.startsWith('ping:')));
  assert.ok(out.errors[0].includes('rate limited'));
});

// ── EDGE: MISSING DEPS / BAD ACCOUNT (soft-fail, never throw) ───────────────────────────────────

test('missing deps: no transfer/pingWelcome → errors recorded, never throws', async () => {
  const out = await welcomeGrant('newbie-tests', {}, { grant: 5 });
  assert.equal(out.ok, false);
  assert.equal(out.granted, null);
  assert.equal(out.pinged, null);
  assert.ok(out.errors.some((e) => e.includes('no-transfer-dep')));
  assert.ok(out.errors.some((e) => e.includes('no-pingWelcome-dep')));
});

test('bad account: invalid name → clean error report, deps never called', async () => {
  const { deps, calls } = makeDeps();
  const out = await welcomeGrant('Bad Name!', deps, { grant: 5 });
  assert.equal(out.ok, false);
  assert.deepEqual(out.errors, ['invalid-account-name']);
  assert.equal(calls.transfer.length, 0);
  assert.equal(calls.pingWelcome.length, 0);
});

test('memo is escaped before being handed to deps', async () => {
  const { deps, calls } = makeDeps();
  await welcomeGrant('newbie-tests', deps, { grant: 5, memo: 'hi <b>there</b>' });
  assert.equal(calls.transfer[0].memo, 'hi &lt;b&gt;there&lt;/b&gt;');
  assert.equal(calls.pingWelcome[0].memo, 'hi &lt;b&gt;there&lt;/b&gt;');
});
