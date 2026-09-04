// server.test.mjs — OFFLINE tests for signup/server.mjs (task #295).
// No network, no port bound: routes are driven through a mock req/res, the condenser RPC fetch is
// injected (__setChainFetch) so the live testnet is never touched, and the email mailer is injected
// via email-verify's __setMailer so Resend is never called.
//
//   node --test signup/server.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  handler, ALLOWED_ORIGIN, validAccountName, stageCatalog,
  computeProgress, readAccountActivity, __setChainFetch, __setEmailLimiter,
  __setReportLimiter, __setModerationStore,
} from './server.mjs';
import { createModerationStore } from '../integrations/moderation-flags.mjs';
import {
  __setMailer, __resetMailer, __resetPending, __setProviders, __resetProviders,
} from '../integrations/email-verify.mjs';
import { Limiter } from '../integrations/rate-limit.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Default: a roomy, throwaway-file limiter so unrelated email tests aren't throttled by each other.
function freshEmailLimiter(opts = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'srv-rl-')), 'state.json');
  return new Limiter({ scope: 'signup-email', path, ipMax: 1000, fpMax: 1000, windowSec: 3600, ...opts });
}
__setEmailLimiter(freshEmailLimiter());

// ── mock req/res (same shape as site/witness/witness.test.mjs) ─────────────────────────────────────
function mockReq(path, { method = 'GET', origin, body } = {}) {
  const headers = origin ? { origin } : {};
  const req = { url: path, method, headers };
  // Make the req an async-iterable-ish event emitter for POST body reads.
  req._body = body;
  req.on = function on(ev, cb) {
    if (ev === 'data' && body != null) cb(Buffer.from(body));
    if (ev === 'end') cb();
    return req;
  };
  req.destroy = () => {};
  return req;
}
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, h) { this.statusCode = code; this.headers = h || {}; },
    end(s) { if (s != null) this.body += s; },
  };
}
async function route(path, opts) {
  const res = mockRes();
  await handler(mockReq(path, opts), res);
  return res;
}
function json(res) { return JSON.parse(res.body); }

// ── a fake condenser RPC for a fully-onboarded account "alice" ─────────────────────────────────────
// Returns activity that completes ALL TEN Tier-A spine stages (1-10). When a detector is added for a
// new criterion kind, this fixture has to grow with it or "fully onboarded" stops being true.
function fakeRpcFor(account, { withVotes = true } = {}) {
  return async (url, opts) => {
    const req = JSON.parse(opts.body);
    const m = req.method;
    if (m === 'condenser_api.get_account_history') {
      return { json: async () => ({ result: [
        [0, { op: ['comment', { author: account, permlink: 'c1', body: 'x'.repeat(120), parent_author: 'bob', parent_permlink: 'p' }] }],
        [1, { op: ['comment', { author: account, permlink: 'c2', body: 'y'.repeat(120), parent_author: 'carol', parent_permlink: 'p' }] }],
        [2, { op: ['comment', { author: account, permlink: 'c3', body: 'z'.repeat(120), parent_author: 'dave', parent_permlink: 'p' }] }],
        [3, { op: ['transfer_to_vesting', { from: account, to: account, amount: '5.000 MELEK' }] }],
        [4, { op: ['account_witness_vote', { account, witness: 'hathor', approve: true }] }],
        // stage 8 — three DISTINCT follows. The fourth entry is an unfollow (empty `what`) and an
        // unfollow of someone already followed, so it must not add to the count.
        [5, { op: ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: account, following: 'bob', what: ['blog'] }]) }] }],
        [6, { op: ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: account, following: 'carol', what: ['blog'] }]) }] }],
        [7, { op: ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: account, following: 'dave', what: ['blog'] }]) }] }],
        [8, { op: ['custom_json', { id: 'follow', json: JSON.stringify(['follow', { follower: account, following: 'mallory', what: [] }]) }] }],
        // stage 9 — a real outbound transfer to someone else (self-sends do not count)
        [9, { op: ['transfer', { from: account, to: 'bob', amount: '1.000 MELEK' }] }],
        // stage 10 — a delegation to someone else
        [10, { op: ['delegate_vesting_shares', { delegator: account, delegatee: 'bob', amount_mp: '5.000' }] }],
      ] }) };
    }
    if (m === 'condenser_api.get_discussions_by_blog') {
      return { json: async () => ({ result: [
        { author: account, permlink: 'intro', depth: 0, parent_author: '', title: 'Hi', body: 'i'.repeat(300), tags: ['introduceyourself'] },
        { author: account, permlink: 'howto', depth: 0, parent_author: '', title: 'How', body: 'h'.repeat(900), tags: ['tutorial'] },
      ] }) };
    }
    if (m === 'condenser_api.get_active_votes') {
      return { json: async () => ({ result: withVotes
        ? [{ voter: 'eve', rshares: 1000, time: '2026-06-06T00:00:00' }]
        : [] }) };
    }
    if (m === 'condenser_api.get_accounts') {
      return { json: async () => ({ result: [{
        name: account,
        witness_votes: ['hathor'],
        // stage 7 — profile lives in posting_json_metadata on a modern node
        posting_json_metadata: JSON.stringify({ profile: { name: 'Alice', about: 'new here' } }),
      }] }) };
    }
    if (m === 'condenser_api.get_account_votes') return { json: async () => ({ result: [] }) };
    return { json: async () => ({ result: null }) };
  };
}

// ===================================================================================================
// account-name guard
// ===================================================================================================
test('validAccountName accepts good names, rejects bad', () => {
  assert.ok(validAccountName('alice'));
  assert.ok(validAccountName('al-ice'));
  assert.ok(!validAccountName('Al'));        // too short + uppercase
  assert.ok(!validAccountName('a'));         // too short
  assert.ok(!validAccountName('UPPER'));     // uppercase
  assert.ok(!validAccountName('-bad'));      // leading dash
  assert.ok(!validAccountName('toolongaccountname123')); // >16
});

// ===================================================================================================
// /health
// ===================================================================================================
test('GET /health responds ok', async () => {
  const r = await route('/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, 'ok');
});

// ===================================================================================================
// /api/stages
// ===================================================================================================
test('GET /api/stages returns the stage catalog', async () => {
  const r = await route('/api/stages');
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.stages));
  assert.ok(j.stages.length >= 6, 'has at least the six spine stages');
  const intro = j.stages.find((s) => s.key === 'intro_post');
  assert.ok(intro, 'intro_post present');
  assert.equal(intro.id, 1);
  assert.equal(j.currency, 'MELEK');
});

test('stageCatalog trims to public fields only', () => {
  const c = stageCatalog();
  for (const s of c.stages) {
    assert.ok('key' in s && 'label' in s && 'tier' in s);
    assert.ok(!('completion_criteria' in s), 'internal completion_criteria not exposed');
    assert.ok(!('witness_response' in s), 'internal witness_response not exposed');
  }
});

// ===================================================================================================
// readAccountActivity + computeProgress (injected RPC)
// ===================================================================================================
test('readAccountActivity shapes condenser reads into detector activity', async () => {
  const activity = await readAccountActivity('alice', { rpc: async (method, params) => {
    const r = await fakeRpcFor('alice')(undefined, { body: JSON.stringify({ method, params }) });
    return (await r.json()).result;
  } });
  assert.ok(activity);
  assert.equal(activity.posts.length, 2);
  assert.equal(activity.comments.length, 3);
  assert.equal(activity.transfers_to_vesting.length, 1);
  assert.ok(activity.witness_votes.some((w) => w.witness === 'hathor'));
  assert.ok(activity.votes_received.some((v) => v.voter === 'eve'));
});

test('readAccountActivity rejects an invalid account name (no RPC call)', async () => {
  let called = false;
  const a = await readAccountActivity('BAD!', { rpc: async () => { called = true; return []; } });
  assert.equal(a, null);
  assert.equal(called, false);
});

test('computeProgress marks the full spine complete for a fully-onboarded account', async () => {
  const activity = await readAccountActivity('alice', { rpc: async (method, params) => {
    const r = await fakeRpcFor('alice')(undefined, { body: JSON.stringify({ method, params }) });
    return (await r.json()).result;
  } });
  const p = computeProgress('alice', activity);
  assert.equal(p.account, 'alice');
  assert.ok(p.trackable >= 10, `expected the full ten-stage spine, got ${p.trackable}`);
  assert.equal(p.completed, p.trackable, 'all trackable stages complete');
  assert.equal(p.allDetectableComplete, true);
  assert.equal(p.nextStageKey, null);
});

test('computeProgress on an empty account: nothing complete, next = intro_post', () => {
  const empty = { posts: [], comments: [], votes_received: [], transfers_to_vesting: [], witness_votes: [] };
  const p = computeProgress('newbie', empty);
  assert.equal(p.completed, 0);
  assert.equal(p.nextStageKey, 'intro_post');
  assert.equal(p.allDetectableComplete, false);
});

// ===================================================================================================
// /api/progress route (injected fetch)
// ===================================================================================================
test('GET /api/progress?account=alice returns full progress (injected RPC)', async () => {
  __setChainFetch(fakeRpcFor('alice'));
  const r = await route('/api/progress?account=alice');
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, true);
  assert.equal(j.account, 'alice');
  assert.equal(j.allDetectableComplete, true);
  __setChainFetch(null);
});

test('GET /api/progress rejects an invalid account', async () => {
  const r = await route('/api/progress?account=BAD!');
  assert.equal(r.statusCode, 400);
  assert.equal(json(r).reason, 'invalid-account');
});

test('GET /api/progress honest soft-fail when RPC is down', async () => {
  __setChainFetch(async () => { throw new Error('ECONNREFUSED'); });
  const r = await route('/api/progress?account=alice');
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, false);
  assert.equal(j.reason, 'chain-unavailable');
  __setChainFetch(null);
});

// ===================================================================================================
// /api/next route (injected fetch)
// ===================================================================================================
test('GET /api/next for an empty account composes the intro_post lesson (deterministic)', async () => {
  // RPC returns nothing for everything → empty activity → next is intro_post.
  __setChainFetch(async (url, opts) => {
    const m = JSON.parse(opts.body).method;
    if (m === 'condenser_api.get_accounts') return { json: async () => ({ result: [{ name: 'newbie', witness_votes: [] }] }) };
    return { json: async () => ({ result: [] }) };
  });
  const r = await route('/api/next?account=newbie');
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, true);
  assert.equal(j.done, false);
  assert.equal(j.stage.key, 'intro_post');
  assert.match(j.title, /Stage 1/);
  assert.match(j.body, /What counts:/);
  __setChainFetch(null);
});

test('GET /api/next is deterministic (same body twice)', async () => {
  __setChainFetch(async () => ({ json: async () => ({ result: [] }) }));
  const a = json(await route('/api/next?account=newbie'));
  const b = json(await route('/api/next?account=newbie'));
  assert.equal(a.body, b.body);
  __setChainFetch(null);
});

test('GET /api/next reports done for a fully-onboarded account', async () => {
  __setChainFetch(fakeRpcFor('alice'));
  const r = await route('/api/next?account=alice');
  const j = json(r);
  assert.equal(j.ok, true);
  assert.equal(j.done, true);
  __setChainFetch(null);
});

test('GET /api/next honest soft-fail when RPC down', async () => {
  __setChainFetch(async () => { throw new Error('down'); });
  const j = json(await route('/api/next?account=alice'));
  assert.equal(j.ok, false);
  assert.equal(j.reason, 'chain-unavailable');
  __setChainFetch(null);
});

// ===================================================================================================
// /api/verify-email (injected mailer; no Resend)
// ===================================================================================================
test('POST /api/verify-email sends when a mailer is configured', async () => {
  __resetPending();
  __setProviders({ now: () => 1_000_000, randomId: () => 'jti1' });
  let mailedTo = null;
  __setMailer(async ({ email }) => { mailedTo = email; return { ok: true }; });
  const r = await route('/api/verify-email', {
    method: 'POST', origin: ALLOWED_ORIGIN, body: JSON.stringify({ email: 'a@b.com' }),
  });
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, true);
  assert.equal(j.sent, true);
  assert.equal(j.email, 'a@b.com');
  assert.equal(mailedTo, 'a@b.com');
  __resetMailer(); __resetProviders();
});

test('POST /api/verify-email soft-fails honestly when no key/mailer (email-not-configured)', async () => {
  __resetPending();
  __setMailer(async () => ({ ok: false, error: 'no-resend-key' }));
  const r = await route('/api/verify-email', {
    method: 'POST', body: JSON.stringify({ email: 'a@b.com' }),
  });
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, false);
  assert.equal(j.reason, 'email-not-configured');
  __resetMailer();
});

test('POST /api/verify-email rejects an invalid email', async () => {
  const r = await route('/api/verify-email', { method: 'POST', body: JSON.stringify({ email: 'nope' }) });
  assert.equal(r.statusCode, 400);
  assert.equal(json(r).reason, 'invalid-email');
});

test('POST /api/verify-email rejects bad JSON', async () => {
  const r = await route('/api/verify-email', { method: 'POST', body: '{not json' });
  assert.equal(r.statusCode, 400);
  assert.equal(json(r).reason, 'bad-json');
});

test('POST /api/verify-email is rate-limited after the cap (429), then restores roomy limiter', async () => {
  // Tight limiter for this test only: ipMax=2 on the shared mock IP ('unknown').
  __setEmailLimiter(freshEmailLimiter({ ipMax: 2, fpMax: 1000 }));
  __setMailer(async () => ({ ok: true }));
  const send = (email) => route('/api/verify-email', { method: 'POST', body: JSON.stringify({ email }) });
  assert.equal((await send('a@b.com')).statusCode, 200);
  assert.equal((await send('c@d.com')).statusCode, 200);
  const blocked = await send('e@f.com');
  assert.equal(blocked.statusCode, 429, 'third request from same IP is throttled');
  assert.equal(json(blocked).reason, 'rate-limited');
  assert.ok(json(blocked).retryAfter > 0);
  __resetMailer();
  __setEmailLimiter(freshEmailLimiter()); // restore roomy default for any later tests
});

// ===================================================================================================
// CORS: only alpha.melek.salon
// ===================================================================================================
test('allowed origin gets the CORS grant', async () => {
  const r = await route('/api/stages', { origin: ALLOWED_ORIGIN });
  assert.equal(r.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
});

test('a disallowed origin gets NO CORS grant', async () => {
  const r = await route('/api/stages', { origin: 'https://evil.example' });
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal(r.headers.vary, 'Origin');
});

test('OPTIONS preflight from allowed origin returns 204 with CORS headers', async () => {
  const r = await route('/api/verify-email', { method: 'OPTIONS', origin: ALLOWED_ORIGIN });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
  assert.match(r.headers['access-control-allow-methods'], /POST/);
});

test('OPTIONS preflight from a disallowed origin gets 204 but no allow-origin', async () => {
  const r = await route('/api/stages', { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

// ===================================================================================================
// unknown route
// ===================================================================================================
test('unknown path 404s as JSON', async () => {
  const r = await route('/nope');
  assert.equal(r.statusCode, 404);
  assert.equal(json(r).reason, 'not-found');
});

test('trailing slashes are normalized (/api/stages/ === /api/stages)', async () => {
  const r = await route('/api/stages/');
  assert.equal(r.statusCode, 200);
  assert.equal(json(r).ok, true);
});

// ===================================================================================================
// POST /api/report — the condenser flag/report control writes to a REAL store (task #300)
// ===================================================================================================
function freshReportLimiter(opts = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'rep-rl-')), 'state.json');
  return new Limiter({ scope: 'signup-report', path, ipMax: 1000, fpMax: 1000, windowSec: 3600, ...opts });
}
function freshModStore() {
  const path = join(mkdtempSync(join(tmpdir(), 'rep-store-')), 'flags.jsonl');
  let n = 0;
  return createModerationStore({ storePath: path, clock: () => `2026-06-10T00:00:0${n}.000Z`, idGen: () => `mod_${n++}` });
}

test('POST /api/report files a flag into the store and returns its id + status', async () => {
  __setReportLimiter(freshReportLimiter());
  const store = freshModStore();
  __setModerationStore(store);
  const body = JSON.stringify({ target: '@alice/spammy', kind: 'spam', reason: 'bot post', reporter: 'bob' });
  const r = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body });
  assert.equal(r.statusCode, 200);
  const j = json(r);
  assert.equal(j.ok, true);
  assert.equal(j.deduped, false);
  assert.ok(j.id);
  assert.equal(j.status, 'open');
  assert.equal(j.kind, 'spam');
  // It actually landed in the store the moderation layer reads (not a console.log/alert).
  const q = store.queueForModeration();
  assert.equal(q.length, 1);
  assert.equal(q[0].target, '@alice/spammy');
});

test('POST /api/report is idempotent — a retry does not stack duplicates', async () => {
  __setReportLimiter(freshReportLimiter());
  const store = freshModStore();
  __setModerationStore(store);
  const body = JSON.stringify({ target: '@a/p', kind: 'spam', reporter: 'bob' });
  const r1 = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body });
  const r2 = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body });
  assert.equal(json(r1).deduped, false);
  assert.equal(json(r2).deduped, true);
  assert.equal(json(r1).id, json(r2).id);
  assert.equal(store.queueForModeration().length, 1);
});

test('POST /api/report rejects a missing target', async () => {
  __setReportLimiter(freshReportLimiter());
  __setModerationStore(freshModStore());
  const r = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body: JSON.stringify({ kind: 'spam' }) });
  assert.equal(r.statusCode, 400);
  assert.equal(json(r).reason, 'missing-target');
});

test('POST /api/report normalizes an unknown kind to "other"', async () => {
  __setReportLimiter(freshReportLimiter());
  const store = freshModStore();
  __setModerationStore(store);
  const r = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body: JSON.stringify({ target: '@a/p', kind: 'wat' }) });
  assert.equal(json(r).kind, 'other');
});

test('POST /api/report rejects bad JSON', async () => {
  __setReportLimiter(freshReportLimiter());
  __setModerationStore(freshModStore());
  const r = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body: '{not json' });
  assert.equal(r.statusCode, 400);
  assert.equal(json(r).reason, 'bad-json');
});

test('POST /api/report rate-limits a flood (anti-abuse, POLICY.md §1)', async () => {
  __setReportLimiter(freshReportLimiter({ ipMax: 2, fpMax: 100 }));
  __setModerationStore(freshModStore());
  const mk = (i) => JSON.stringify({ target: `@a/p${i}`, kind: 'spam', reporter: `r${i}` });
  const a = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body: mk(1) });
  const b = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body: mk(2) });
  const c = await route('/api/report', { method: 'POST', origin: ALLOWED_ORIGIN, body: mk(3) });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(c.statusCode, 429); // third distinct report from same IP is throttled
  assert.equal(json(c).reason, 'rate-limited');
});
