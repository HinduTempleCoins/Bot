// integrations/hivesigner-auth.test.mjs — fully offline (injectable fetch, no network).
// Proves the module is INERT without env credentials (soft-fail, never a key, never a throw)
// and well-formed once mocked credentials are present.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isConfigured,
  hsConfig,
  authorizeUrl,
  exchangeCode,
  broadcastWithToken,
  handler,
} from './hivesigner-auth.mjs';

// ---- env helpers -----------------------------------------------------------
const HS_ENV = ['HIVESIGNER_APP', 'HIVESIGNER_SECRET', 'HIVESIGNER_CALLBACK', 'HIVESIGNER_SCOPE', 'HIVESIGNER_BASE'];
function clearEnv() { for (const k of HS_ENV) delete process.env[k]; }
function setConfigured(extra = {}) {
  process.env.HIVESIGNER_APP = 'autovote.app';
  process.env.HIVESIGNER_SECRET = 'shh-secret';
  process.env.HIVESIGNER_CALLBACK = 'https://auto.alpha.melek.salon/hivesigner/callback';
  for (const [k, v] of Object.entries(extra)) process.env[k] = v;
}

const NOT_CONFIGURED = { ok: false, reason: 'hivesigner-not-configured' };

// A fetch that MUST NOT be called (guards "no network when inert").
function failFetch() {
  return async () => { throw new Error('fetch must not be called when not configured'); };
}

// A mock res that records writeHead/end.
function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; },
    end(chunk) { if (chunk) this.body += chunk; this.ended = true; },
  };
}

// =====================================================================
// INERT: no env -> every action returns the not-configured shape, no throw, no key, no fetch.
// =====================================================================
test('isConfigured is false without env', () => {
  clearEnv();
  assert.equal(isConfigured(), false);
});

test('authorizeUrl returns not-configured shape when inert (no throw, no fetch)', () => {
  clearEnv();
  assert.deepEqual(authorizeUrl({ scope: 'vote' }), NOT_CONFIGURED);
});

test('exchangeCode returns not-configured shape when inert (does not call fetch)', async () => {
  clearEnv();
  const out = await exchangeCode('any-code', failFetch());
  assert.deepEqual(out, NOT_CONFIGURED);
});

test('broadcastWithToken returns not-configured shape when inert (does not call fetch)', async () => {
  clearEnv();
  const out = await broadcastWithToken('tok', [['vote', {}]], failFetch());
  assert.deepEqual(out, NOT_CONFIGURED);
});

test('inert config never exposes a private key field', () => {
  clearEnv();
  const c = hsConfig();
  assert.equal(c.app, null);
  assert.equal(c.secret, null);
  assert.ok(!('wif' in c) && !('privateKey' in c) && !('key' in c));
});

// =====================================================================
// CONFIGURED (mocked env + fetch): well-formed flow.
// =====================================================================
test('isConfigured requires BOTH app and secret', () => {
  clearEnv();
  process.env.HIVESIGNER_APP = 'autovote.app';
  assert.equal(isConfigured(), false, 'app alone is not enough');
  process.env.HIVESIGNER_SECRET = 'shh';
  assert.equal(isConfigured(), true);
  clearEnv();
});

test('authorizeUrl is well-formed with the right scope', () => {
  setConfigured();
  const out = authorizeUrl({ scope: 'vote', state: 'st-123' });
  assert.equal(out.ok, true);
  const u = new URL(out.url);
  assert.equal(u.origin + u.pathname, 'https://hivesigner.com/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'autovote.app');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://auto.alpha.melek.salon/hivesigner/callback');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'vote');
  assert.equal(u.searchParams.get('state'), 'st-123');
  clearEnv();
});

test('authorizeUrl supports the trade scope (market,transfer)', () => {
  setConfigured();
  const out = authorizeUrl({ scope: ['market', 'transfer'] });
  assert.equal(out.ok, true);
  assert.equal(new URL(out.url).searchParams.get('scope'), 'market,transfer');
  clearEnv();
});

test('exchangeCode parses a token from a mocked response', async () => {
  setConfigured();
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ access_token: 'opaque-bearer', username: 'alice', expires_in: 604800 }) };
  };
  const out = await exchangeCode('the-code', fakeFetch);
  assert.equal(out.ok, true);
  assert.equal(out.token, 'opaque-bearer');
  assert.equal(out.username, 'alice');
  assert.equal(out.expiresIn, 604800);
  assert.equal(captured.url, 'https://hivesigner.com/api/oauth2/token');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.code, 'the-code');
  assert.equal(body.client_secret, 'shh-secret');
  clearEnv();
});

test('exchangeCode soft-fails on a non-ok response (no throw)', async () => {
  setConfigured();
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  const out = await exchangeCode('bad', fakeFetch);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'hivesigner-token-exchange-failed');
  assert.equal(out.status, 401);
  clearEnv();
});

test('exchangeCode soft-fails when fetch throws (garbage)', async () => {
  setConfigured();
  const out = await exchangeCode('x', async () => { throw new Error('boom'); });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'hivesigner-token-exchange-error');
  clearEnv();
});

test('broadcastWithToken posts ops with the bearer Authorization header', async () => {
  setConfigured();
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ id: 'tx123', block_num: 42 }) };
  };
  const ops = [['vote', { voter: 'alice', author: 'bob', permlink: 'p', weight: 10000 }]];
  const out = await broadcastWithToken('opaque-bearer', ops, fakeFetch);
  assert.equal(out.ok, true);
  assert.deepEqual(out.result, { id: 'tx123', block_num: 42 });
  assert.equal(captured.url, 'https://hivesigner.com/api/broadcast');
  assert.equal(captured.opts.headers.Authorization, 'opaque-bearer');
  assert.deepEqual(JSON.parse(captured.opts.body), { operations: ops });
  clearEnv();
});

test('broadcastWithToken soft-fails on missing token / empty ops', async () => {
  setConfigured();
  const noTok = await broadcastWithToken('', [['vote', {}]], failFetch());
  assert.deepEqual(noTok, { ok: false, reason: 'hivesigner-no-token' });
  const noOps = await broadcastWithToken('tok', [], failFetch());
  assert.deepEqual(noOps, { ok: false, reason: 'hivesigner-no-ops' });
  clearEnv();
});

test('broadcastWithToken soft-fails on a broadcast error (no throw)', async () => {
  setConfigured();
  const fakeFetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
  const out = await broadcastWithToken('tok', [['vote', {}]], fakeFetch);
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'hivesigner-broadcast-failed');
  assert.equal(out.status, 500);
  clearEnv();
});

// =====================================================================
// HANDLER
// =====================================================================
test('handler /hivesigner/login -> 503 when inert', async () => {
  clearEnv();
  const res = mockRes();
  await handler({ method: 'GET', url: '/hivesigner/login?scope=vote' }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(JSON.parse(res.body), NOT_CONFIGURED);
});

test('handler /hivesigner/login -> 302 to authorize URL when configured', async () => {
  setConfigured();
  const res = mockRes();
  await handler({ method: 'GET', url: '/hivesigner/login?scope=vote&state=abc' }, res);
  assert.equal(res.statusCode, 302);
  const loc = res.headers.Location;
  assert.ok(loc.startsWith('https://hivesigner.com/oauth2/authorize'));
  assert.equal(new URL(loc).searchParams.get('scope'), 'vote');
  assert.equal(new URL(loc).searchParams.get('state'), 'abc');
  clearEnv();
});

test('handler /hivesigner/callback exchanges and returns the token', async () => {
  setConfigured();
  // handler uses the module-level default fetch; stub global fetch for this one test.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'bearer-xyz', username: 'carol' }) });
  try {
    const res = mockRes();
    await handler({ method: 'GET', url: '/hivesigner/callback?code=c1' }, res);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.token, 'bearer-xyz');
    assert.equal(body.username, 'carol');
  } finally {
    globalThis.fetch = realFetch;
    clearEnv();
  }
});

test('handler /hivesigner/callback -> 503 when inert (never throws, never a key)', async () => {
  clearEnv();
  const res = mockRes();
  await handler({ method: 'GET', url: '/hivesigner/callback?code=c1' }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(JSON.parse(res.body), NOT_CONFIGURED);
});

test('handler unknown route -> 404 soft-fail', async () => {
  clearEnv();
  const res = mockRes();
  await handler({ method: 'GET', url: '/nope' }, res);
  assert.equal(res.statusCode, 404);
});

test('handler tolerates garbage request without throwing', async () => {
  clearEnv();
  const res = mockRes();
  await handler({}, res); // no method, no url
  assert.ok(res.ended);
  assert.ok([404, 500].includes(res.statusCode));
});
