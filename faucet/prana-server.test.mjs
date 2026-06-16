// prana-server.test.mjs — offline tests for the PRANA faucet. Env is set BEFORE a dynamic import
// so the module's config consts pick it up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.FAUCET_ADDR = '0x' + 'a'.repeat(40);
process.env.FAUCET_PASSWORD = 'testpw';
process.env.DRIP_PRANA = '5';
process.env.RATE_HOURS = '24';

const m = await import('./prana-server.mjs');
const { dripPrana, handler, esc, ADDR_RE, __setFetch, _resetSeen } = m;

function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
function mockReq(method, url, payload) {
  const raw = payload == null ? '' : JSON.stringify(payload);
  return { method, url, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
}

test('esc neutralizes html', () => { assert.equal(esc('<b>"x"'), '&lt;b&gt;&quot;x&quot;'); });

test('rejects an invalid address without touching the node', async () => {
  _resetSeen();
  let called = false; __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  const r = await dripPrana('not-an-address');
  __setFetch();
  assert.equal(r.ok, false);
  assert.equal(called, false);
  assert.match(r.error, /valid/i);
});

test('valid address drips and records the cooldown', async () => {
  _resetSeen();
  let sent = null;
  __setFetch(async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ result: '0x' + 'f'.repeat(64) }) }; });
  const addr = '0x' + 'b'.repeat(40);
  const r = await dripPrana(addr, 1000);
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.amount, 5);
  assert.match(r.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(sent.method, 'personal_sendTransaction');
  assert.equal(sent.params[0].to, addr.toLowerCase());
  assert.equal(sent.params[0].value, '0x' + (5n * 10n ** 18n).toString(16)); // 5 PRANA in wei
  assert.equal(sent.params[1], 'testpw'); // passphrase
});

test('same address within cooldown is rejected (rate limit)', async () => {
  _resetSeen();
  __setFetch(async () => ({ ok: true, json: async () => ({ result: '0x' + 'c'.repeat(64) }) }));
  const addr = '0x' + 'd'.repeat(40);
  const first = await dripPrana(addr, 1000);
  const second = await dripPrana(addr, 1000 + 3600 * 1000); // +1h, still < 24h
  __setFetch();
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.ok(second.retryInHours > 0);
});

test('cooldown clears after RATE_HOURS', async () => {
  _resetSeen();
  __setFetch(async () => ({ ok: true, json: async () => ({ result: '0x' + 'e'.repeat(64) }) }));
  const addr = '0x' + '1'.repeat(40);
  await dripPrana(addr, 1000);
  const later = await dripPrana(addr, 1000 + 25 * 3600 * 1000); // +25h
  __setFetch();
  assert.equal(later.ok, true);
});

test('node error soft-fails (never throws)', async () => {
  _resetSeen();
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const r = await dripPrana('0x' + '2'.repeat(40), 1000);
  __setFetch();
  assert.equal(r.ok, false);
  assert.match(r.error, /unreachable/);
});

test('GET / serves the faucet page', async () => {
  const res = mockRes();
  await handler(mockReq('GET', '/'), res);
  assert.equal(res.code, 200);
  assert.match(res.body, /PRANA Faucet/);
  assert.match(res.body, /rpc\.prana\.melek\.salon/);
});

test('POST /api/drip with a bad address returns 400 ok:false', async () => {
  _resetSeen();
  const res = mockRes();
  await handler(mockReq('POST', '/api/drip', { address: 'nope' }), res);
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});
