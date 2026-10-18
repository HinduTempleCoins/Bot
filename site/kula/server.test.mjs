// site/kula/server.test.mjs — OFFLINE. Fund accounting, join validation, the single op, the signer round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membersFrom, parseJoin, joinOp, vestsPerMelek, authorizeUrl, completeJoin, __pending, __setFetch, renderFund } from './server.mjs';

const row = (op) => [0, { op }];

test('members: last delegation wins, deposits add up, withdrawn members drop out', () => {
  const m = membersFrom([
    row(['delegate_vesting_shares', { delegator: 'alice', delegatee: 'kula', vesting_shares: '1000.000000 VESTS' }]),
    row(['delegate_vesting_shares', { delegator: 'alice', delegatee: 'kula', vesting_shares: '3000.000000 VESTS' }]),
    row(['delegate_vesting_shares', { delegator: 'bob', delegatee: 'kula', vesting_shares: '500.000000 VESTS' }]),
    row(['delegate_vesting_shares', { delegator: 'bob', delegatee: 'kula', vesting_shares: '0.000000 VESTS' }]),
    row(['transfer', { from: 'carol', to: 'kula', amount: '10.000 MELEK', memo: '' }]),
    row(['transfer', { from: 'carol', to: 'kula', amount: '5.500 MELEK', memo: '' }]),
    row(['transfer', { from: 'dave', to: 'kula', amount: '9.000 MBD', memo: '' }]),
    row(['delegate_vesting_shares', { delegator: 'eve', delegatee: 'someone-else', vesting_shares: '9.000000 VESTS' }]),
  ], 'kula');
  assert.deepEqual(m.map((x) => x.account).sort(), ['alice', 'carol']);
  assert.equal(m.find((x) => x.account === 'alice').vests, 3000);
  assert.equal(m.find((x) => x.account === 'carol').deposited, 15.5);
});

test('join validation', () => {
  assert.deepEqual(parseJoin({ kind: 'delegate', amount: '12.5' }), { ok: true, kind: 'delegate', amount: '12.500' });
  for (const bad of [{ kind: 'x', amount: '1' }, { kind: 'deposit', amount: '0' }, { kind: 'deposit', amount: '-3' }, { kind: 'deposit', amount: 'abc' }]) assert.equal(parseJoin(bad).ok, false);
});

test('the single operation each join performs', () => {
  assert.deepEqual(joinOp({ kind: 'deposit', amount: '2.000', account: 'alice' }), ['transfer', { from: 'alice', to: 'kula', amount: '2.000 MELEK', memo: 'KULA community fund deposit' }]);
  const d = joinOp({ kind: 'delegate', amount: '10', account: 'alice', vpm: 1900.5 });
  assert.deepEqual(d, ['delegate_vesting_shares', { delegator: 'alice', delegatee: 'kula', vesting_shares: '19005.000000 VESTS' }]);
  assert.equal(vestsPerMelek({ total_vesting_fund_steem: '100.000 MELEK', total_vesting_shares: '200000.000000 VESTS' }), 2000);
  assert.equal(vestsPerMelek({}), 0);
});

test('authorize asks for exactly one scope', () => {
  assert.equal(new URL(authorizeUrl('s1', 'delegate')).searchParams.get('scope'), 'delegate_vesting_shares');
  assert.equal(new URL(authorizeUrl('s1', 'deposit')).searchParams.get('scope'), 'transfer');
});

test('completeJoin: code → token → one broadcast → revoke', async () => {
  const calls = [];
  __setFetch(async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push([String(url).replace(/^https?:\/\/[^/]+/, ''), body]);
    const out = String(url).endsWith('/oauth2/token') ? { access_token: 't0k', account: 'alice' }
      : String(url).endsWith('/v1/broadcast') ? { ok: true, result: { id: 'abc123' } } : { revoked: true };
    return { json: async () => out };
  });
  __pending().set('st', { kind: 'deposit', amount: '3.000', at: Date.now() });
  const r = await completeJoin({ code: 'c', state: 'st' });
  assert.equal(r.ok, true); assert.equal(r.trx, 'abc123'); assert.equal(r.account, 'alice');
  const bc = calls.find((c) => c[0] === '/v1/broadcast');
  assert.deepEqual(bc[1].ops, [['transfer', { from: 'alice', to: 'kula', amount: '3.000 MELEK', memo: 'KULA community fund deposit' }]]);
  await new Promise((r2) => setTimeout(r2, 5));
  assert.ok(calls.some((c) => c[0] === '/oauth2/token/revoke'), 'token revoked');
  assert.equal((await completeJoin({ code: 'c', state: 'st' })).ok, false, 'a state is single-use');
  __setFetch(null);
});

test('fund page renders with the chain unreachable', async () => {
  __setFetch(async () => { throw new Error('offline'); });
  const html = await renderFund();
  assert.match(html, /KULA Community Fund/);
  assert.match(html, /No members yet/);
  __setFetch(null);
});
