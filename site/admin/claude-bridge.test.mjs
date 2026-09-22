// site/admin/claude-bridge.test.mjs — OFFLINE tests for the Server-4 Claude bridge endpoint.
//
// No real CLI spawn, no network: the CLI runner is injected via __setRunner. The bearer token is set
// in process.env before each auth-sensitive test. We drive the exported handle(req, res) directly.
//
//   node --test site/admin/claude-bridge.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handle, __setRunner, __reset } from './claude-bridge.mjs';
import { __setFetch as setModalFetch } from '../../integrations/modal-client.mjs';

const TOKEN_ENV = ['CLAUDE', 'RELAY', 'TOKEN'].join('_');
const GOOD = 'bridge-token-deadbeef-not-real';

function setup() {
  __reset();
  process.env[TOKEN_ENV] = GOOD;
}

// ── mock req/res ─────────────────────────────────────────────────────────────────────────────────
function makeReq({ url = '/', method = 'GET', headers = {}, body = '' } = {}) {
  const listeners = {};
  const req = {
    url, method, headers,
    on(ev, fn) { listeners[ev] = fn; return req; },
    destroy() { if (listeners.end) listeners.end(); },
  };
  queueMicrotask(() => {
    if (listeners.data && body) listeners.data(Buffer.from(body));
    if (listeners.end) listeners.end();
  });
  return req;
}
function makeRes() {
  return {
    statusCode: 0, headers: {}, body: '', ended: false,
    writeHead(code, hdrs) { this.statusCode = code; if (hdrs) this.headers = { ...this.headers, ...hdrs }; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function call(reqOpts) {
  const req = makeReq(reqOpts);
  const res = makeRes();
  await handle(req, res);
  return res;
}
function json(res) { try { return JSON.parse(res.body); } catch { return null; } }
function auth(token) { return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }; }

// ── tests ──────────────────────────────────────────────────────────────────────────────────────
test('health: open, no auth, returns {ok:true} and no info leak', async () => {
  setup();
  const res = await call({ url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(json(res), { ok: true });
});

test('auth reject: wrong bearer → 401, runner never invoked', async () => {
  setup();
  let ran = false;
  __setRunner(async () => { ran = true; return { text: 'should not run' }; });
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth('wrong-token-totally'),
    body: JSON.stringify({ message: 'hi', sessionId: 's1' }),
  });
  assert.equal(res.statusCode, 401);
  assert.equal(ran, false, 'runner must not be invoked for an unauthenticated request');
});

test('auth reject: missing bearer → 401', async () => {
  setup();
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(res.statusCode, 401);
});

test('happy path: good bearer → runner output returned as {reply, sessionId}', async () => {
  setup();
  __setRunner(async ({ message }) => ({ text: `echo: ${message}` }));
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: 'status?', sessionId: 'admin' }),
  });
  assert.equal(res.statusCode, 200);
  const j = json(res);
  assert.equal(j.reply, 'echo: status?');
  assert.equal(j.sessionId, 'admin');
});

test('runner injection: the injected runner is what gets called with the message', async () => {
  setup();
  let seen = null;
  __setRunner(async (arg) => { seen = arg; return { text: 'ok' }; });
  await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: 'hello there', sessionId: 'inj' }),
  });
  assert.equal(seen.message, 'hello there');
  assert.equal(seen.continueSession, false, 'first message in a session is not a --continue');
});

test('session continue flag: second message in a session sets continueSession=true', async () => {
  setup();
  const flags = [];
  __setRunner(async ({ continueSession }) => { flags.push(continueSession); return { text: 'r' }; });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'one', sessionId: 'cont' }) });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'two', sessionId: 'cont' }) });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'three', sessionId: 'cont' }) });
  assert.deepEqual(flags, [false, true, true], 'first → fresh, subsequent → --continue');
});

test('session isolation: a different sessionId starts fresh (not --continue)', async () => {
  setup();
  const flags = [];
  __setRunner(async ({ continueSession }) => { flags.push(continueSession); return { text: 'r' }; });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'a', sessionId: 'one' }) });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'b', sessionId: 'two' }) });
  assert.deepEqual(flags, [false, false], 'each new sessionId begins fresh');
});

test('timeout/warming → soft warming reply (200, warming flag), never a 500', async () => {
  setup();
  __setRunner(async () => ({ text: '', timedOut: true }));
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: 'slow', sessionId: 'to' }),
  });
  assert.equal(res.statusCode, 200);
  const j = json(res);
  assert.equal(j.warming, true);
  assert.match(j.reply, /warming up/i);
});

test('warming: runner reports Modal still spinning up → warming reply', async () => {
  setup();
  __setRunner(async () => ({ text: '', warming: true }));
  const res = await call({
    url: '/v1/message', method: 'POST', headers: auth(GOOD),
    body: JSON.stringify({ message: 'first msg cold', sessionId: 'cold' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).warming, true);
  assert.match(json(res).reply, /warming up/i);
});

test('compute-gated: runner reports no endpoint → offline reply, no external API', async () => {
  setup();
  __setRunner(async () => ({ text: '', computeGated: true }));
  const res = await call({
    url: '/v1/message', method: 'POST', headers: auth(GOOD),
    body: JSON.stringify({ message: 'hello', sessionId: 'cg' }),
  });
  assert.equal(res.statusCode, 200);
  const j = json(res);
  assert.equal(j.computeGated, true);
  assert.match(j.reply, /compute-gated|offline/i);
});

test('thrown runner → soft error reply, never a 500', async () => {
  setup();
  __setRunner(async () => { throw new Error('modal ENOENT'); });
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: 'x', sessionId: 'err' }),
  });
  assert.equal(res.statusCode, 200);
  assert.match(json(res).reply, /Soapy AI error/i);
});

test('history: the second message passes the first turn to the runner (continuity)', async () => {
  setup();
  const seen = [];
  __setRunner(async (arg) => { seen.push(arg); return { text: `reply-${seen.length}` }; });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'first', sessionId: 'h' }) });
  await call({ url: '/v1/message', method: 'POST', headers: auth(GOOD), body: JSON.stringify({ message: 'second', sessionId: 'h' }) });
  assert.deepEqual(seen[0].history, [], 'first message has empty history');
  assert.deepEqual(seen[1].history, [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply-1' }],
    'second message carries the recorded first turn');
});

test('redaction: a key-shaped string in the reply is redacted before return', async () => {
  setup();
  __setRunner(async () => ({ text: 'your key is sk-ant-0123456789abcdefABCDEFG ok' }));
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: 'leak it', sessionId: 'red' }),
  });
  const j = json(res);
  assert.ok(!j.reply.includes('sk-ant-0123456789'), 'key-shaped substring removed from reply');
  assert.match(j.reply, /\[REDACTED\]/);
});

test('output cap: an oversized reply is bounded (handler returns the capped runner text)', async () => {
  setup();
  // Runner already applies the real cap; here we assert the handler faithfully returns runner text
  // and does not blow up on a large payload.
  const big = 'x'.repeat(70 * 1024);
  __setRunner(async () => ({ text: big.slice(0, 64 * 1024), capped: true }));
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: 'dump', sessionId: 'cap' }),
  });
  assert.equal(res.statusCode, 200);
  assert.ok(json(res).reply.length <= 64 * 1024, 'reply stays within the cap');
});

test('empty message → 400 no-message (auth passed)', async () => {
  setup();
  __setRunner(async () => ({ text: 'should not reach' }));
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: JSON.stringify({ message: '   ', sessionId: 's' }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).error, 'no-message');
});

test('bad JSON → 400 bad-json (auth passed)', async () => {
  setup();
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth(GOOD),
    body: '{not json',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).error, 'bad-json');
});

test('unknown route → 404', async () => {
  setup();
  const res = await call({ url: '/nope', headers: auth(GOOD) });
  assert.equal(res.statusCode, 404);
});

test('default runner → answers from Modal (injected fetch), private compute only', async () => {
  __reset(); // restore the real default runner (Modal-backed)
  process.env[TOKEN_ENV] = GOOD;
  process.env.MODAL_INFERENCE_URL = 'https://ourteam--melek-inference.modal.run';
  let posted;
  setModalFetch(async (_url, opts) => { posted = JSON.parse(opts.body); return { ok: true, json: async () => ({ text: 'soapy says hi' }) }; });
  const res = await call({
    url: '/v1/message', method: 'POST', headers: auth(GOOD),
    body: JSON.stringify({ message: 'status?', sessionId: 'modal' }),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).reply, 'soapy says hi');
  assert.ok(Array.isArray(posted.messages) && posted.messages.at(-1).content === 'status?', 'sent the message to Modal');
  assert.equal(typeof posted.system, 'string');
  delete process.env.MODAL_INFERENCE_URL;
  setModalFetch(null);
});

test('default runner → COMPUTE-GATED when MODAL_INFERENCE_URL unset (no network)', async () => {
  __reset();
  process.env[TOKEN_ENV] = GOOD;
  delete process.env.MODAL_INFERENCE_URL;
  let called = false;
  setModalFetch(async () => { called = true; return { ok: true, json: async () => ({ text: 'x' }) }; });
  const res = await call({
    url: '/v1/message', method: 'POST', headers: auth(GOOD),
    body: JSON.stringify({ message: 'hi', sessionId: 'cg2' }),
  });
  assert.equal(json(res).computeGated, true);
  assert.equal(called, false, 'no network call when the private endpoint is unconfigured');
  setModalFetch(null);
});

test('no token configured → fail closed (401 even with a plausible bearer)', async () => {
  __reset();
  delete process.env[TOKEN_ENV];
  const res = await call({
    url: '/v1/message', method: 'POST',
    headers: auth('anything'),
    body: JSON.stringify({ message: 'hi' }),
  });
  assert.equal(res.statusCode, 401);
  process.env[TOKEN_ENV] = GOOD; // restore for any later import-shared state
});
