// signer-broadcast.test.mjs — OFFLINE. No network, no real token, nothing signed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSignerBroadcaster, signerConfigured, handler } from './signer-broadcast.mjs';

const OP = { parent_author: '', parent_permlink: 'melek', author: 'hathor', permlink: 'p1', title: 'T', body: 'B', json_metadata: '{}' };
const cap = () => { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; };

test('⚠️ no token means no request at all — fails closed, never open', async () => {
  let called = false;
  const b = makeSignerBroadcaster({ token: '', fetch: async () => { called = true; return { status: 200, json: async () => ({ ok: true }) }; } });
  const r = await b('melek', OP);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not configured/);
  assert.equal(called, false, 'an unconfigured box must not call the signer at all');
});

test('a successful broadcast returns the txid and sends a scoped comment op', async () => {
  let seen = null;
  const b = makeSignerBroadcaster({ token: 'tok', fetch: async (u, o) => { seen = { u, o }; return { status: 200, json: async () => ({ ok: true, txid: 'abc123' }) }; } });
  const r = await b('melek', OP);
  assert.deepEqual(r, { ok: true, txid: 'abc123' });
  assert.match(seen.u, /\/v1\/broadcast$/);
  assert.equal(seen.o.headers.authorization, 'Bearer tok');
  const body = JSON.parse(seen.o.body);
  assert.equal(body.ops.length, 1);
  assert.equal(body.ops[0][0], 'comment', 'only a comment op is ever sent from here');
  assert.equal(body.chain, 'melek');
});

test('⚠️ a 401/403 never echoes the signer body — that is where a token leaks', async () => {
  for (const status of [401, 403]) {
    const b = makeSignerBroadcaster({ token: 'super-secret-token', fetch: async () => ({ status, json: async () => ({ error: 'bad token super-secret-token' }) }) });
    const r = await b('melek', OP);
    assert.equal(r.ok, false);
    assert.ok(!/super-secret-token/.test(JSON.stringify(r)), 'the token must never appear in a result');
    assert.match(r.reason, /token missing or out of scope/);
  }
});

test('transport failures are shaped, never thrown', async () => {
  const boom = makeSignerBroadcaster({ token: 't', fetch: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(await boom('melek', OP), { ok: false, reason: 'signer unreachable' });

  const abort = makeSignerBroadcaster({ token: 't', fetch: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } });
  assert.deepEqual(await abort('melek', OP), { ok: false, reason: 'signer timeout' });

  const five = makeSignerBroadcaster({ token: 't', fetch: async () => ({ status: 502, json: async () => ({}) }) });
  assert.match((await five('melek', OP)).reason, /signer error \(502\)/);

  const declined = makeSignerBroadcaster({ token: 't', fetch: async () => ({ status: 200, json: async () => ({ ok: false }) }) });
  assert.match((await declined('melek', OP)).reason, /declined/);

  assert.equal((await makeSignerBroadcaster({ token: 't' })('melek', null)).ok, false);
});

test('readiness reports configured-or-not and NEVER the token', () => {
  const before = process.env.MELEK_SIGNER_TOKEN;
  process.env.MELEK_SIGNER_TOKEN = 'do-not-leak-me';
  const c = signerConfigured();
  assert.equal(c.ok, true);
  assert.ok(!JSON.stringify(c).includes('do-not-leak-me'));
  const { res, o } = cap(); handler({}, res);
  assert.equal(o.code, 200);
  assert.ok(!o.body.includes('do-not-leak-me'), 'the readiness endpoint must not expose the token');
  if (before === undefined) delete process.env.MELEK_SIGNER_TOKEN; else process.env.MELEK_SIGNER_TOKEN = before;
});
