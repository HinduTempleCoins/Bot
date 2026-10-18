// dues-verify.test.mjs — OFFLINE tests for the MELEK dues rail and the check-dues route (fake chain).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuesPayment, parseAsset, duesMemo, periodMs } from './dues-verify.mjs';
import { handler } from './server.mjs';

const tx = (from, to, amount, memo, ts, trx = 'abc') => [1, { trx_id: trx, timestamp: ts, op: ['transfer', { from, to, amount, memo }] }];
const chain = (rows) => async () => ({ json: async () => ({ result: rows }) });

test('asset parsing is integer minor units', () => {
  assert.deepEqual(parseAsset('12.500 MELEK'), { units: 12500, symbol: 'MELEK' });
  assert.deepEqual(parseAsset('3 MELEK'), { units: 3000, symbol: 'MELEK' });
  assert.equal(parseAsset('junk'), null);
  assert.equal(duesMemo('abc'), 'pact:abc');
  assert.equal(periodMs('once'), Infinity);
});

test('finds the newest matching transfer; ignores wrong memo, payer, symbol, too-small and too-old', async () => {
  const rows = [
    tx('bob', 'club', '5.000 MELEK', 'pact:g1', '2026-10-01T00:00:00', 'old'),
    tx('bob', 'club', '5.000 MELEK', 'pact:g1', '2026-10-10T00:00:00', 'new'),
    tx('bob', 'club', '5.000 MELEK', 'pact:other', '2026-10-11T00:00:00'),
    tx('eve', 'club', '5.000 MELEK', 'pact:g1', '2026-10-11T00:00:00'),
    tx('bob', 'club', '1.000 MELEK', 'pact:g1', '2026-10-12T00:00:00'),
    tx('bob', 'club', '5.000 TESTS', 'pact:g1', '2026-10-12T00:00:00'),
  ];
  const r = await findDuesPayment({ payer: 'bob', payee: 'club', groupId: 'g1', minUnits: 5000, fetch: chain(rows) });
  assert.equal(r.ok, true); assert.equal(r.trx_id, 'new');
  const none = await findDuesPayment({ payer: 'bob', payee: 'club', groupId: 'g1', minUnits: 5000,
    since: Date.parse('2026-10-11T00:00:00Z'), fetch: chain(rows) });
  assert.equal(none.ok, false); assert.match(none.reason, /memo "pact:g1"/);
});

test('a dead RPC soft-fails with a retry message', async () => {
  const r = await findDuesPayment({ payer: 'bob', payee: 'club', groupId: 'g1', fetch: async () => { throw new Error('down'); } });
  assert.equal(r.ok, false); assert.match(r.reason, /try again/);
});

// ── the route ────────────────────────────────────────────────────────────────────────────────────
function memOpts() { let buf = null; return { fs: { read: () => buf, write: (_p, s) => { buf = s; } }, file: 'mem.json' }; }
const call = async (who, method, url, body, opts, fetch) => {
  const o = { code: 0, body: '' };
  await handler({ method, url, body }, { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, { whoami: () => who, opts, fetch });
  try { return JSON.parse(o.body); } catch { return {}; }
};

test('check-dues admits a member only when the chain shows the payment, and records until when', async () => {
  const opts = memOpts();
  const g = (await call('alice', 'POST', '/groups', { name: 'Auto Club', joinPolicy: 'dues',
    dues: { amount: 5000, currency: 'MELEK', period: 'monthly', rail: 'wallet', payee: 'alice' } }, opts)).group;
  assert.equal((await call('bob', 'POST', `/groups/${g.id}/join`, {}, opts)).status, 'dues-required');
  const unpaid = await call('bob', 'POST', `/groups/${g.id}/check-dues`, {}, opts, chain([]));
  assert.equal(unpaid.ok, false); assert.equal(unpaid.memo, `pact:${g.id}`);
  const ts = new Date(Date.now() + 60000).toISOString().slice(0, 19); // paid just after the club was created
  const paid = await call('bob', 'POST', `/groups/${g.id}/check-dues`, {}, opts, chain([tx('bob', 'alice', '5.000 MELEK', `pact:${g.id}`, ts)]));
  assert.equal(paid.ok, true); assert.equal(paid.status, 'member');
  assert.ok(paid.paid.until > Date.now());
  assert.ok(paid.group.members.some((m) => m.account === 'bob'));
});

test('an expired payment does not admit, and off-chain clubs say so', async () => {
  const opts = memOpts();
  const g = (await call('alice', 'POST', '/groups', { name: 'Old Club', joinPolicy: 'dues',
    dues: { amount: 1000, currency: 'MELEK', period: 'monthly', rail: 'wallet' } }, opts)).group;
  const longAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 19);
  // the club was created now, so a 60-day-old transfer is also before the club existed — not found
  const r = await call('bob', 'POST', `/groups/${g.id}/check-dues`, {}, opts, chain([tx('bob', 'alice', '1.000 MELEK', `pact:${g.id}`, longAgo)]));
  assert.equal(r.ok, false);
  const usd = (await call('alice', 'POST', '/groups', { name: 'Card Club', joinPolicy: 'dues', dues: { amount: 500, currency: 'USD' } }, opts)).group;
  assert.match((await call('bob', 'POST', `/groups/${usd.id}/check-dues`, {}, opts, chain([]))).reason, /outside MELEK/);
});
