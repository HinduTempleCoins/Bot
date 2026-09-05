/**
 * tutorial/payout.test.mjs — OFFLINE tests for the tutorial reward broadcast path.
 *
 * No network. Every broadcast goes through createMockSigner() from
 * src/chain/melek-signer-client.mjs, which implements the real signer's
 * POST /v1/broadcast contract in-process (bearer auth, op-kind scoping, audit).
 *
 *   node --test tutorial/payout.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  POSTING_OPS,
  ACTIVE_OPS,
  STATUS,
  authorityFor,
  classifyOps,
  slugPermlink,
  rewardPermlink,
  rewardClientRef,
  opsFromReward,
  payout,
  payoutReward,
} from './payout.mjs';
import { composeReward } from './reward.mjs';
import { createSignerClient, createMockSigner } from '../src/chain/melek-signer-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- fixtures ---------------------------------------------------------------

const VOTE = ['vote', { voter: 'hathor', author: 'alice', permlink: 'p1', weight: 10000 }];
const COMMENT = ['comment', { parent_author: 'alice', parent_permlink: 'p1', author: 'hathor', permlink: 're-p1', title: '', body: 'well done' }];
const TRANSFER = ['transfer', { from: 'hathor', to: 'alice', amount: '1.000 MELEK', memo: 'stage complete' }];

const FIXED_NOW = () => '2026-09-04T00:00:00.000Z';

/** Posting-scoped signer: can vote + comment, CANNOT transfer (mirrors a real scoped token). */
function postingSigner() {
  const mock = createMockSigner({ tokens: { 'tok-posting': { scopes: ['vote', 'comment'] } } });
  const client = createSignerClient({ url: 'http://mock', token: 'tok-posting', fetch: mock.fetch });
  return { client, mock };
}

/** Active-scoped signer: can transfer. */
function activeSigner() {
  const mock = createMockSigner({ tokens: { 'tok-active': { scopes: ['transfer'] } } });
  const client = createSignerClient({ url: 'http://mock', token: 'tok-active', fetch: mock.fetch });
  return { client, mock };
}

/** Minimal in-memory idempotency store with the {has,put} shape reward.mjs uses. */
function memStore() {
  const m = new Map();
  return {
    map: m,
    async has(k) { return m.get(k) || null; },
    async put(k, v) { m.set(k, v); },
  };
}

// ============================================================================
// 1. THE AUTHORITY SPLIT — the whole point of this module
// ============================================================================

test('authorityFor: vote and comment are POSTING, transfer is ACTIVE', () => {
  assert.equal(authorityFor(VOTE), 'posting');
  assert.equal(authorityFor(COMMENT), 'posting');
  assert.equal(authorityFor(TRANSFER), 'active');
});

test('authorityFor: custom_json is payload-sensitive (required_auths ⇒ active)', () => {
  assert.equal(authorityFor(['custom_json', { required_posting_auths: ['hathor'], id: 'x', json: '{}' }]), 'posting');
  assert.equal(authorityFor(['custom_json', { required_auths: ['hathor'], id: 'x', json: '{}' }]), 'active');
});

test('authorityFor: an unlisted op is "unknown", never assumed posting', () => {
  assert.equal(authorityFor(['some_future_op', {}]), 'unknown');
  assert.equal(authorityFor(null), 'unknown');
  assert.equal(authorityFor('vote'), 'unknown');
});

test('the two authority lists are disjoint', () => {
  const overlap = POSTING_OPS.filter((k) => ACTIVE_OPS.includes(k));
  assert.deepEqual(overlap, [], 'no op may be in both authority sets');
});

test('classifyOps splits an upvote+comment+transfer reward into posting/active', () => {
  const c = classifyOps([VOTE, COMMENT, TRANSFER]);
  assert.deepEqual(c.posting, [VOTE, COMMENT]);
  assert.deepEqual(c.active, [TRANSFER]);
  assert.deepEqual(c.unknown, []);
});

test('classifyOps preserves order inside each bucket and never throws on junk', () => {
  const c = classifyOps([TRANSFER, VOTE, 'nope', ['bad'], null, COMMENT]);
  assert.deepEqual(c.posting, [VOTE, COMMENT]);
  assert.deepEqual(c.active, [TRANSFER]);
  assert.equal(c.unknown.length, 3);
  assert.deepEqual(classifyOps(undefined), { posting: [], active: [], unknown: [] });
});

// ============================================================================
// 2. reward.mjs plan → Graphene ops
// ============================================================================

test('opsFromReward: an upvote stage yields vote + comment, both POSTING', () => {
  const plan = composeReward('intro_post', 'alice');
  const built = opsFromReward(plan, { parentPermlink: 'my-intro' });
  assert.equal(built.ok, true);
  const c = classifyOps(built.ops);
  assert.equal(c.posting.length, 2);
  assert.equal(c.active.length, 0);
  const [kind, vote] = c.posting[0];
  assert.equal(kind, 'vote');
  assert.equal(vote.voter, 'hathor');
  assert.equal(vote.author, 'alice');
  assert.equal(vote.permlink, 'my-intro');
  assert.equal(vote.weight, 10000);
});

test('opsFromReward: a transfer stage yields comment (posting) + transfer (active)', () => {
  const plan = composeReward('first_organic_upvote', 'bob');
  const built = opsFromReward(plan, { parentPermlink: 'bobs-post' });
  assert.equal(built.ok, true);
  const c = classifyOps(built.ops);
  assert.equal(c.posting.length, 1, 'comment only — a transfer stage carries no upvote');
  assert.equal(c.posting[0][0], 'comment');
  assert.equal(c.active.length, 1);
  const [, xfer] = c.active[0];
  assert.equal(xfer.from, 'hathor');
  assert.equal(xfer.to, 'bob');
  assert.equal(xfer.amount, '1.000 MELEK');
});

test('opsFromReward: soft-fails on a not-ok plan, never throws', () => {
  const bad = opsFromReward(composeReward('no_such_stage', 'alice'), { parentPermlink: 'x' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown stage/);
  assert.deepEqual(opsFromReward(null).ops, []);
  assert.equal(opsFromReward(undefined).ok, false);
});

test('opsFromReward: no parentPermlink ⇒ warnings, not a crash', () => {
  const built = opsFromReward(composeReward('intro_post', 'alice'), {});
  assert.equal(built.ok, false);
  assert.ok(built.warnings.length >= 2, 'both legs report why they were skipped');
});

test('reply permlink is deterministic and chain-legal (chain-level comment idempotency)', () => {
  const a = rewardPermlink({ stageKey: 'intro_post', parentPermlink: 'My_Intro Post!' });
  const b = rewardPermlink({ stageKey: 'intro_post', parentPermlink: 'My_Intro Post!' });
  assert.equal(a, b);
  assert.match(a, /^[a-z0-9-]+$/);
  assert.ok(a.length <= 200);
  assert.equal(slugPermlink('---'), 'reward');
});

// ============================================================================
// 3. THE STAGING BOUNDARY — posting ships now, active defers
// ============================================================================

test('posting subset ships while the +MELEK transfer DEFERS (no active signer)', async () => {
  const { client, mock } = postingSigner();
  const plan = composeReward('first_organic_upvote', 'bob');
  const res = await payoutReward(plan, { signer: client, parentPermlink: 'bobs-post', now: FIXED_NOW });

  assert.equal(res.posting.status, STATUS.SENT);
  assert.ok(res.posting.txId, 'posting leg has a tx id');
  assert.equal(res.active.status, STATUS.DEFERRED);
  assert.match(res.active.reason, /active authority not enabled/);
  assert.equal(res.ok, true, 'a deferral is a designed outcome, not a failure');
  assert.equal(res.complete, false, 'but the payout is not complete');

  // The transfer op was never handed to the posting signer.
  const sentKinds = mock.audit().flatMap((e) => e.ops.map((o) => o[0]));
  assert.ok(!sentKinds.includes('transfer'), 'transfer must never ride the posting token');
});

test('an active signer alone is not enough — allowActive:true is required', async () => {
  const { client: posting } = postingSigner();
  const { client: active, mock: activeMock } = activeSigner();
  const plan = composeReward('first_organic_upvote', 'bob');
  const res = await payoutReward(plan, {
    signer: posting, activeSigner: active, parentPermlink: 'bobs-post', now: FIXED_NOW,
  });
  assert.equal(res.active.status, STATUS.DEFERRED);
  assert.equal(activeMock.audit().length, 0, 'the active signer was never called');
});

test('with allowActive:true AND an active signer, the transfer ships too', async () => {
  const { client: posting } = postingSigner();
  const { client: active, mock: activeMock } = activeSigner();
  const plan = composeReward('first_organic_upvote', 'bob');
  const res = await payoutReward(plan, {
    signer: posting, activeSigner: active, allowActive: true,
    parentPermlink: 'bobs-post', now: FIXED_NOW,
  });
  assert.equal(res.posting.status, STATUS.SENT);
  assert.equal(res.active.status, STATUS.SENT);
  assert.equal(res.ok, true);
  assert.equal(res.complete, true);
  assert.equal(activeMock.audit()[0].ops[0][0], 'transfer');
});

test('the two authority buckets get DISTINCT client_refs in the signer audit', async () => {
  const { client: posting, mock: pm } = postingSigner();
  const { client: active, mock: am } = activeSigner();
  await payoutReward(composeReward('first_organic_upvote', 'bob'), {
    signer: posting, activeSigner: active, allowActive: true,
    parentPermlink: 'bobs-post', now: FIXED_NOW,
  });
  assert.equal(pm.audit()[0].clientRef, 'tutorial-payout::first_organic_upvote::bob::posting');
  assert.equal(am.audit()[0].clientRef, 'tutorial-payout::first_organic_upvote::bob::active');
});

test('unknown-authority ops are deferred, never auto-broadcast', async () => {
  const { client, mock } = postingSigner();
  const res = await payout([VOTE, ['mystery_op', { x: 1 }]], {
    signer: client, clientRef: 'ref-unknown', now: FIXED_NOW,
  });
  assert.equal(res.posting.status, STATUS.SENT);
  assert.equal(res.unknown.status, STATUS.DEFERRED);
  assert.equal(res.complete, false);
  const kinds = mock.audit().flatMap((e) => e.ops.map((o) => o[0]));
  assert.ok(!kinds.includes('mystery_op'));
});

// ============================================================================
// 4. NO SIGNER / BROKEN SIGNER — defer or report, never throw, never drop
// ============================================================================

test('no signer at all ⇒ everything deferred with the ops intact for a queue', async () => {
  const res = await payout([VOTE, COMMENT, TRANSFER], { clientRef: 'ref-nosigner', now: FIXED_NOW });
  assert.equal(res.posting.status, STATUS.DEFERRED);
  assert.match(res.posting.reason, /no posting-authority signer/);
  assert.equal(res.active.status, STATUS.DEFERRED);
  assert.equal(res.posting.ops.length, 2, 'the deferred ops are returned so nothing is lost');
  assert.equal(res.active.ops.length, 1);
  assert.equal(res.ok, true);
  assert.equal(res.complete, false);
});

test('no clientRef ⇒ refuses to broadcast (idempotency discipline)', async () => {
  const { client, mock } = postingSigner();
  const res = await payout([VOTE], { signer: client, now: FIXED_NOW });
  assert.equal(res.posting.status, STATUS.DEFERRED);
  assert.match(res.posting.reason, /clientRef/);
  assert.equal(mock.audit().length, 0);
});

test('signer refusal (out-of-scope token) ⇒ FAILED result, no throw, no token echoed', async () => {
  const { client } = postingSigner(); // scoped to vote/comment only
  const res = await payout([TRANSFER], {
    signer: client, activeSigner: client, allowActive: true,
    clientRef: 'ref-scope', now: FIXED_NOW,
  });
  assert.equal(res.active.status, STATUS.FAILED);
  assert.match(res.active.error, /outside token scope/);
  assert.equal(res.ok, false);
  assert.ok(!JSON.stringify(res).includes('tok-posting'), 'the bearer token never appears in the result');
});

test('a signer that throws a plain error is reported, not propagated', async () => {
  const boom = { broadcast: async () => { throw new Error('kaboom'); } };
  const res = await payout([VOTE], { signer: boom, clientRef: 'ref-boom', now: FIXED_NOW });
  assert.equal(res.posting.status, STATUS.FAILED);
  assert.equal(res.posting.error, 'kaboom');
  assert.equal(res.ok, false);
});

test('payout never throws on garbage input', async () => {
  for (const bad of [undefined, null, 'nope', 42, {}, [null], [['x']]]) {
    const res = await payout(bad, { clientRef: 'ref-junk', now: FIXED_NOW });
    assert.equal(typeof res.ok, 'boolean');
  }
  const r = await payoutReward({ ok: false, error: 'nope' }, {});
  assert.equal(r.ok, false);
});

// ============================================================================
// 5. IDEMPOTENCY — a user must not be paid twice for one stage
// ============================================================================

test('a second payout for the same stage is SKIPPED, and the signer is not called', async () => {
  const store = memStore();
  const { client, mock } = activeSigner();
  const plan = composeReward('first_organic_upvote', 'bob');
  const deps = {
    activeSigner: client, allowActive: true, store,
    parentPermlink: 'bobs-post', now: FIXED_NOW,
  };
  const first = await payoutReward(plan, deps);
  assert.equal(first.active.status, STATUS.SENT);
  assert.equal(mock.audit().length, 1);

  const second = await payoutReward(plan, deps);
  assert.equal(second.active.status, STATUS.SKIPPED);
  assert.equal(second.active.reason, 'already claimed');
  assert.equal(mock.audit().length, 1, 'the transfer was broadcast exactly once');
});

test('reserve-then-send: the store holds "pending" BEFORE the signer is called', async () => {
  const store = memStore();
  const ref = 'ref-reserve::posting';
  let stateAtBroadcast = null;
  const spy = { broadcast: async () => { stateAtBroadcast = store.map.get(ref); return { id: 'tx-1' }; } };
  const res = await payout([VOTE], { signer: spy, store, clientRef: 'ref-reserve', now: FIXED_NOW });
  assert.equal(stateAtBroadcast.state, 'pending', 'reserved before the broadcast');
  assert.equal(store.map.get(ref).state, 'sent');
  assert.equal(store.map.get(ref).txId, 'tx-1');
  assert.equal(res.posting.txId, 'tx-1');
});

test('a crash-shaped failure leaves a record that BLOCKS a re-send (at-most-once)', async () => {
  const store = memStore();
  const boom = { broadcast: async () => { throw new Error('signer died mid-flight'); } };
  const first = await payout([TRANSFER], {
    activeSigner: boom, allowActive: true, store, clientRef: 'ref-crash', now: FIXED_NOW,
  });
  assert.equal(first.active.status, STATUS.FAILED);
  assert.equal(store.map.get('ref-crash::active').state, 'failed');

  const { client, mock } = activeSigner();
  const retry = await payout([TRANSFER], {
    activeSigner: client, allowActive: true, store, clientRef: 'ref-crash', now: FIXED_NOW,
  });
  assert.equal(retry.active.status, STATUS.SKIPPED, 'an ambiguous outcome is never blindly retried');
  assert.equal(mock.audit().length, 0);
});

test('an unreadable store defers rather than risking a double payment', async () => {
  const store = { has: async () => { throw new Error('disk gone'); }, put: async () => {} };
  const { client, mock } = activeSigner();
  const res = await payout([TRANSFER], {
    activeSigner: client, allowActive: true, store, clientRef: 'ref-unreadable', now: FIXED_NOW,
  });
  assert.equal(res.active.status, STATUS.DEFERRED);
  assert.match(res.active.reason, /unreadable/);
  assert.equal(mock.audit().length, 0);
});

test('a store that cannot reserve defers rather than broadcasting unguarded', async () => {
  const store = { has: async () => null, put: async () => { throw new Error('read-only fs'); } };
  const { client, mock } = activeSigner();
  const res = await payout([TRANSFER], {
    activeSigner: client, allowActive: true, store, clientRef: 'ref-noreserve', now: FIXED_NOW,
  });
  assert.equal(res.active.status, STATUS.DEFERRED);
  assert.match(res.active.reason, /reserve/);
  assert.equal(mock.audit().length, 0);
});

test('client_ref is stable across runs for the same (stage, account, authority)', () => {
  assert.equal(rewardClientRef({ stageKey: 's', account: 'a', authority: 'posting' }),
    rewardClientRef({ stageKey: 's', account: 'a', authority: 'posting' }));
  assert.notEqual(rewardClientRef({ stageKey: 's', account: 'a', authority: 'posting' }),
    rewardClientRef({ stageKey: 's', account: 'a', authority: 'active' }));
});

test('the posting bucket can succeed while the active bucket is independently deferred', async () => {
  const store = memStore();
  const { client } = postingSigner();
  const plan = composeReward('first_organic_upvote', 'bob');
  const res = await payoutReward(plan, { signer: client, store, parentPermlink: 'bobs-post', now: FIXED_NOW });
  assert.equal(store.map.get('tutorial-payout::first_organic_upvote::bob::posting').state, 'sent');
  assert.equal(store.map.has('tutorial-payout::first_organic_upvote::bob::active'), false,
    'a deferred bucket reserves nothing, so it can still be paid when the active route exists');
  assert.equal(res.active.status, STATUS.DEFERRED);
});

// ============================================================================
// 6. ZERO-WIF — enforced on the source itself
// ============================================================================

test('payout.mjs imports no signing library and contains no key handling', () => {
  const src = readFileSync(path.join(__dirname, 'payout.mjs'), 'utf8');
  assert.ok(!/from ['"]@hiveio\/dhive['"]/.test(src), 'must not import dhive');
  assert.ok(!/PrivateKey|sendOperations|fromString\(/.test(src), 'must not touch key/signing APIs');
  assert.ok(!/process\.env\.[A-Z_]*KEY/.test(src), 'must not read a key from env');
  // "WIF" appears in the prose (the zero-WIF rule) but must never appear in CODE.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/wif/i.test(code), 'no WIF identifier, string, or value anywhere in executable code');
  // The only "key" in this module is an idempotency key. No credential material.
  assert.ok(!/(private|posting|active|owner|secret|memo)_?key/i.test(code), 'no credential material in code');
});

test('the module reads no environment for credentials — signers are injected only', () => {
  const src = readFileSync(path.join(__dirname, 'payout.mjs'), 'utf8');
  // process.argv[1] (the CLI guard) is the only process.* the module body uses.
  const uses = src.match(/process\.[a-zA-Z]+/g) || [];
  for (const u of uses) assert.ok(['process.argv', 'process.stdout'].includes(u), `unexpected ${u}`);
});
