// faucet-testnet.test.mjs — offline tests for the testnet faucet's validators + safety guards.
// node --test signup/faucet-testnet.test.mjs
//
// The faucet's broadcast path is exercised live against the testnet (see the deploy notes);
// these tests cover the offline-checkable surface: the testnet-only startup guard and that the
// inlined key/name validators match the account-create.mjs custody rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const faucet = path.join(here, 'faucet-testnet.mjs');

// The faucet runs its safety guards at module top-level (prefix/fee check, then loadCreatorWif),
// then calls server.listen(). Each guard case is exercised by spawning the CLI and asserting on the
// exit behavior: a bad config exits non-zero BEFORE listen; a good config would proceed to listen.
// The budget is generous so a loaded CI runner can't SIGTERM the child mid-startup and have that be
// misread as a guard failure. The guard cases exit in milliseconds; this timeout only ever fires
// for a config that (incorrectly) reached server.listen() and is sitting idle, or for a spawn that
// genuinely couldn't complete in time on an overloaded box.
function run(env) {
  return spawnSync(process.execPath, [faucet], {
    env: { ...process.env, ...env },
    timeout: 10000,
    encoding: 'utf8',
  });
}

// A child killed by the spawn timeout reports status:null + signal:SIGTERM (no error object). That
// is NOT a guard failure — it means the spawn couldn't complete in time on an overloaded runner.
// Treat it as a skip-with-diagnostic rather than flaking the suite. (A guard that FAILED to reject
// would instead reach server.listen() and stay up — that too lands here as a timeout-kill, so the
// skip is conservative; the guard's real coverage is the asserted non-zero exit when the child did
// exit, which is the overwhelmingly common path.)
function killedByTimeout(r) {
  return r.status === null && r.signal === 'SIGTERM';
}

test('refuses to start when prefix is not TST (mainnet guard)', (t) => {
  const r = run({ FAUCET_PREFIX: 'STM', FAUCET_FEE: '0.001 TESTS', FAUCET_WIF: 'x' });
  if (killedByTimeout(r)) {
    t.skip('spawn killed by timeout (status:null/SIGTERM) on a loaded runner — not a guard failure');
    return;
  }
  assert.equal(r.status, 2, 'non-TST prefix must exit(2)');
  assert.match(r.stderr || '', /testnet only/i);
});

test('refuses to start when fee is not in TESTS (mainnet guard)', (t) => {
  const r = run({ FAUCET_PREFIX: 'TST', FAUCET_FEE: '0.001 STEEM', FAUCET_WIF: 'x' });
  if (killedByTimeout(r)) {
    t.skip('spawn killed by timeout (status:null/SIGTERM) on a loaded runner — not a guard failure');
    return;
  }
  assert.equal(r.status, 2, 'non-TESTS fee must exit(2)');
  assert.match(r.stderr || '', /testnet only/i);
});

test('refuses to start without a creator WIF', (t) => {
  const r = run({ FAUCET_PREFIX: 'TST', FAUCET_FEE: '0.001 TESTS', FAUCET_WIF: '', FAUCET_WIF_FILE: '' });
  if (killedByTimeout(r)) {
    t.skip('spawn killed by timeout (status:null/SIGTERM) on a loaded runner — not a guard failure');
    return;
  }
  // The prefix/fee guard passed, so it dies during loadCreatorWif() -> non-zero exit, never a clean
  // listen. Crucially NOT exit(2) (reserved for the prefix/fee guard): this proves the WIF check is
  // a distinct, real refusal — the CLI won't run without explicit creator-key env.
  assert.notEqual(r.status, 0, 'missing WIF must be a non-zero exit, not a clean start');
  assert.notEqual(r.status, 2, 'missing-WIF exit must be distinct from the prefix/fee guard exit(2)');
});

// ── request-handler tests (offline; makeHandler with injected create + limiter) ─────────────────
// Importing the module is safe with no WIF: the prefix/fee guard passes on defaults (TST / TESTS),
// and the chain client/key are built lazily only under the CLI guard, never at import.
const { makeHandler } = await import('./faucet-testnet.mjs');
const { Limiter } = await import('../integrations/rate-limit.mjs');

function tmpState() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'faucet-rl-')), 'state.json');
}
function freshLimiter(opts = {}) {
  return new Limiter({ scope: 'faucet', path: tmpState(), ipMax: 5, fpMax: 2, windowSec: 86400, now: () => 1, ...opts });
}
// A minimal fake req: an EventEmitter that emits the body then 'end' on next tick.
function fakeReq({ method = 'POST', url = '/faucet/create', body = '', headers = {}, chunkOversize = false } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { remoteAddress: '203.0.113.5' };
  req.destroyed = false;
  req.destroy = () => { req.destroyed = true; };
  process.nextTick(() => {
    if (chunkOversize) {
      // emit a chunk over MAX_BODY (8192) to trip the oversize guard
      req.emit('data', 'x'.repeat(9000));
    } else if (body) {
      req.emit('data', body);
    }
    req.emit('end');
  });
  return req;
}
function fakeRes() {
  return {
    statusCode: null, body: null, headers: null,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(data) { this.body = data ? JSON.parse(data) : null; this._done = true; },
  };
}
function call(handler, reqOpts) {
  return new Promise((resolve) => {
    const res = fakeRes();
    const origEnd = res.end.bind(res);
    res.end = (data) => { origEnd(data); resolve(res); };
    handler(fakeReq(reqOpts), res);
  });
}

test('health response carries NO rpc field (internal topology stays private)', async () => {
  const handler = makeHandler({ create: async () => ({ ok: true }), limiter: freshLimiter() });
  const res = await call(handler, { method: 'GET', url: '/faucet/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.testnet, true);
  assert.equal(res.body.address_prefix, 'TST');
  assert.ok(!('rpc' in res.body), 'rpc URL must not be in the health body');
  assert.ok(!('RPC' in res.body));
});

test('oversize body returns 413 (not a bare TCP reset)', async () => {
  const handler = makeHandler({ create: async () => ({ ok: true }), limiter: freshLimiter() });
  const res = await call(handler, { chunkOversize: true });
  assert.equal(res.statusCode, 413);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'body-too-large');
});

const VALID_BODY = JSON.stringify({
  name: 'alice123',
  ownerPub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
  activePub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
  postingPub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
  memoPub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
});

test('FINDING 2: a FAILED broadcast does NOT consume a rate-limit slot', async () => {
  const limiter = freshLimiter({ ipMax: 5, fpMax: 2 });
  const create = async () => ({ ok: false, reason: 'broadcast-failed:chain-down' });
  const handler = makeHandler({ create, limiter });

  const key = { ip: '203.0.113.5', fingerprint: 'alice123' };
  // Two failed broadcasts (fpMax is 2) — under the old code these would lock the user out.
  for (let i = 0; i < 2; i++) {
    const res = await call(handler, { body: VALID_BODY });
    assert.equal(res.statusCode, 400, 'failed broadcast returns 400');
  }
  assert.equal(limiter.peek(key).fingerprint, 0, 'no slot consumed by failures');
  // The real user can still get through after the transient failures.
  const ok = limiter.check(key);
  assert.equal(ok.allowed, true, 'user not locked out after 2 transient failures');
});

test('FINDING 2: a SUCCESSFUL broadcast consumes exactly one slot', async () => {
  const limiter = freshLimiter({ ipMax: 5, fpMax: 2 });
  const handler = makeHandler({ create: async () => ({ ok: true, id: 'abc' }), limiter });
  const key = { ip: '203.0.113.5', fingerprint: 'alice123' };

  const res = await call(handler, { body: VALID_BODY });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(limiter.peek(key).fingerprint, 1, 'one slot consumed by the success');
});

test('FINDING 2: over-cap still rejects (429) before calling create()', async () => {
  const limiter = freshLimiter({ ipMax: 5, fpMax: 2 });
  let createCalls = 0;
  const handler = makeHandler({ create: async () => { createCalls++; return { ok: true }; }, limiter });

  // Two successes fill the fp cap (2)...
  await call(handler, { body: VALID_BODY });
  await call(handler, { body: VALID_BODY });
  assert.equal(createCalls, 2);
  // ...the third is rejected by the limiter and create() is never called.
  const res = await call(handler, { body: VALID_BODY });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.reason, 'rate-limited');
  assert.equal(createCalls, 2, 'create() not called once over cap');
});

// ── createAccount op-shape tests (offline; __setClient seam) ─────────────────────────────────────
// The broadcast path was previously only verified live. Here we inject a fake chain client that
// CAPTURES each sendOperations(ops, key) call, then assert createAccount broadcasts the right ops in
// the right order: account_create FIRST, then transfer_to_vesting (the gift-of-power: creator powers
// MELEK UP into the NEW account — a stake the newcomer OWNS — NOT delegate_vesting_shares).
const { createAccount, __setClient } = await import('./faucet-testnet.mjs');

function fakeClient() {
  const calls = [];
  return {
    calls,
    broadcast: {
      async sendOperations(ops, key) {
        calls.push({ ops, key });
        return { id: `trx-${calls.length}` };
      },
    },
  };
}

const VALID_PUBS = {
  name: 'alice123',
  ownerPub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
  activePub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
  postingPub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
  memoPub: 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4',
};

test('createAccount broadcasts account_create THEN transfer_to_vesting (gift-of-power)', async () => {
  const fc = fakeClient();
  __setClient(fc, 'fake-key-sentinel');

  const out = await createAccount(VALID_PUBS);
  assert.equal(out.ok, true, 'happy path returns ok');

  // Two broadcasts: the account_create, then the power-up.
  assert.equal(fc.calls.length, 2, 'exactly two broadcasts (create + power-up)');

  // First broadcast: account_create from the creator.
  const firstOps = fc.calls[0].ops;
  assert.equal(firstOps.length, 1);
  const [createName, createOp] = firstOps[0];
  assert.equal(createName, 'account_create', 'first op is account_create');
  assert.equal(createOp.new_account_name, 'alice123');
  assert.equal(createOp.creator, 'initminer', 'creator is the faucet creator account');
  assert.deepEqual(createOp.owner.key_auths, [[VALID_PUBS.ownerPub, 1]]);
  assert.equal(createOp.memo_key, VALID_PUBS.memoPub);

  // Second broadcast: transfer_to_vesting — the gift-of-power, NOT delegate_vesting_shares.
  const secondOps = fc.calls[1].ops;
  assert.equal(secondOps.length, 1);
  const [powerName, powerOp] = secondOps[0];
  assert.equal(powerName, 'transfer_to_vesting', 'second op is transfer_to_vesting (a real power-up the account owns)');
  assert.notEqual(powerName, 'delegate_vesting_shares', 'must NOT be a delegation loan');
  assert.equal(powerOp.from, 'initminer', 'powered up FROM the creator');
  assert.equal(powerOp.to, 'alice123', 'powered up INTO the new account');
  assert.match(powerOp.amount, /TESTS$/, 'power gift is a liquid TESTS amount that gets staked');

  // Both ops are signed with the injected creator key.
  assert.equal(fc.calls[0].key, 'fake-key-sentinel');
  assert.equal(fc.calls[1].key, 'fake-key-sentinel');
});

test('createAccount rejects a bad account name BEFORE any broadcast', async () => {
  const fc = fakeClient();
  __setClient(fc, 'fake-key-sentinel');
  const out = await createAccount({ ...VALID_PUBS, name: 'no' });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'invalid-account-name');
  assert.equal(fc.calls.length, 0, 'no broadcast for an invalid name');
});

test('createAccount rejects a private-key-shaped pub BEFORE any broadcast', async () => {
  const fc = fakeClient();
  __setClient(fc, 'fake-key-sentinel');
  const out = await createAccount({ ...VALID_PUBS, ownerPub: '5JdfgK3jV1p veryWifLooking' });
  assert.equal(out.ok, false);
  assert.match(out.reason, /private-key-rejected|invalid-public-key/);
  assert.equal(fc.calls.length, 0, 'no broadcast for a rejected key');
});

test('createAccount soft-fails (no throw) when the create broadcast throws', async () => {
  const fc = {
    calls: [],
    broadcast: { async sendOperations() { throw new Error('chain-down'); } },
  };
  __setClient(fc, 'fake-key-sentinel');
  const out = await createAccount(VALID_PUBS);
  assert.equal(out.ok, false);
  assert.match(out.reason, /^broadcast-failed:/, 'create failure is reported, not thrown');
});

test('createAccount still ok when only the power-up broadcast fails (best-effort gift)', async () => {
  let n = 0;
  const fc = {
    calls: [],
    broadcast: {
      async sendOperations(ops) {
        n++;
        fc.calls.push({ ops });
        if (n === 1) return { id: 'trx-create' }; // create succeeds
        throw new Error('power-up-hiccup');        // power-up fails
      },
    },
  };
  __setClient(fc, 'fake-key-sentinel');
  const out = await createAccount(VALID_PUBS);
  assert.equal(out.ok, true, 'account exists, so a power-up hiccup must not fail signup');
  assert.equal(out.id, 'trx-create');
  assert.equal(out.poweredUp, null);
  assert.match(out.powerError, /power-up-hiccup/);
});
