import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, checkAuth } from './discord-tip-broadcast-server.mjs';
import { makeTipLedger } from './discord-chain-bridge.mjs';

// Minimal req/res fakes.
function mkReq({ method = 'POST', url = '/tip', auth, body } = {}) {
  const handlers = {};
  const req = {
    method, url, headers: auth ? { authorization: auth } : {},
    on(ev, cb) { handlers[ev] = cb; return req; },
    destroy() {},
    _fire() { if (body !== undefined) handlers.data?.(typeof body === 'string' ? body : JSON.stringify(body)); handlers.end?.(); },
  };
  return req;
}
function mkRes() {
  return { code: 0, body: '', headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
async function run(reqOpts, deps) {
  const req = mkReq(reqOpts); const res = mkRes();
  const p = handler(req, res, deps);
  req._fire();
  await p;
  return { code: res.code, json: (() => { try { return JSON.parse(res.body); } catch { return null; } })() };
}

const SECRET = 'test-secret-1234567890';

test('checkAuth is timing-safe and rejects empty/short/wrong secrets', () => {
  assert.equal(checkAuth('Bearer ' + SECRET, SECRET), true);
  assert.equal(checkAuth(SECRET, SECRET), true);
  assert.equal(checkAuth('Bearer wrong', SECRET), false);
  assert.equal(checkAuth('Bearer ' + SECRET, ''), false); // no configured secret => refuse
  assert.equal(checkAuth(undefined, SECRET), false);
});

test('rejects a request with no/!bad bearer secret (401)', async () => {
  const r = await run({ auth: 'Bearer nope', body: { from: 'bob', to: 'alice', amount: 5 } }, { secret: SECRET, broadcast: async () => ({ id: 'x' }) });
  assert.equal(r.code, 401);
  assert.equal(r.json.ok, false);
});

test('404 on the wrong path/method', async () => {
  const r = await run({ method: 'GET', url: '/tip', auth: 'Bearer ' + SECRET }, { secret: SECRET });
  assert.equal(r.code, 404);
});

test('400 on a malformed body', async () => {
  const r = await run({ auth: 'Bearer ' + SECRET, body: { from: 'bob' } }, { secret: SECRET, broadcast: async () => ({ id: 'x' }) });
  assert.equal(r.code, 400);
});

test('authorized tip broadcasts as hathor and returns the reply', async () => {
  const calls = [];
  const r = await run({ auth: 'Bearer ' + SECRET, body: { from: 'bob', to: 'alice', amount: 5, symbol: 'MANNA' } },
    { secret: SECRET, ledger: makeTipLedger(), broadcast: async (op) => { calls.push(op); return { id: 'trx-1' }; } });
  assert.equal(r.code, 200);
  assert.equal(r.json.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'custom_json');
  assert.match(r.json.reply, /tipped \*\*5 MANNA\*\* to @alice/);
});

test('the per-tip cap is enforced server-side (anti-drain at the trust boundary)', async () => {
  const r = await run({ auth: 'Bearer ' + SECRET, body: { from: 'bob', to: 'alice', amount: 9999 } },
    { secret: SECRET, ledger: makeTipLedger(), broadcast: async () => ({ id: 'x' }) });
  assert.equal(r.json.ok, false);
  assert.match(r.json.reply, /cap|max|limit/i);
});
