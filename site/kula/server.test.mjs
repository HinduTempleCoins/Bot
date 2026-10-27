// site/kula/server.test.mjs — OFFLINE. Fund accounting, join validation, the single op, the signer round-trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membersFrom, parseJoin, joinOp, vestsPerMelek, authorizeUrl, completeJoin, __pending, __setFetch, renderFund, fetchMemberHistory, memberHistory, __clearHistoryCache } from './server.mjs';

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
    row(['delegate_vesting_shares', { delegator: 'onboarder', delegatee: 'kula', vesting_shares: '0.050000 VESTS' }]),
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

// ── the producer_reward flood ───────────────────────────────────────────────────────────────────────────
// @kula is a witness, so ~99.9% of its history is producer_reward and one page of 1000 reaches back only a
// few hours. A member's delegation must still be found after it has fallen out of that first page.

const pr = (i) => [i, { op: ['producer_reward', { producer: 'kula', vesting_shares: '0.000000 VESTS' }] }];
const del = (i, who, v) => [i, { op: ['delegate_vesting_shares', { delegator: who, delegatee: 'kula', vesting_shares: `${v} VESTS` }] }];

/** A fake chain: `total` ops, with the named delegations planted at given indexes. Pages like the real node. */
function fakeChain(total, planted) {
  return async (method, params) => {
    if (method !== 'condenser_api.get_account_history') return null;
    const [, start, limit] = params;
    const newest = start === -1 ? total - 1 : start;
    const oldest = Math.max(0, newest - limit + 1);
    const out = [];
    for (let i = oldest; i <= newest; i += 1) out.push(planted[i] ? del(i, planted[i][0], planted[i][1]) : pr(i));
    return out;
  };
}

test('member history pages past the producer_reward flood and finds a buried delegation', async () => {
  __clearHistoryCache();
  // 25,405 ops like the real account; the only delegation sits 20k entries deep — far outside one page.
  const call = fakeChain(25405, { 5000: ['udabeu', '0.028176'] });
  const rows = await fetchMemberHistory(call, 'kula');
  assert.equal(rows.length, 1, 'the single delegation survives the walk');
  const m = membersFrom(rows, 'kula');
  assert.deepEqual(m.map((x) => x.account), ['udabeu']);
});

test('a single page would have missed it — this is the regression being guarded', async () => {
  const call = fakeChain(25405, { 5000: ['udabeu', '0.028176'] });
  const onePage = await call('condenser_api.get_account_history', ['kula', -1, 1000]);
  assert.equal(membersFrom(onePage, 'kula').length, 0, 'one page sees no members, which was the bug');
});

test('member history keeps chronological order so the last delegation wins', async () => {
  __clearHistoryCache();
  const call = fakeChain(4000, { 100: ['alice', '1000.000000'], 3900: ['alice', '0.000000'] });
  const rows = await fetchMemberHistory(call, 'kula');
  assert.deepEqual(rows.map((r) => r[0]), [100, 3900], 'oldest first');
  assert.equal(membersFrom(rows, 'kula').length, 0, 'the later zero withdraws alice');
});

test('member history is cached, and soft-fails to empty rather than throwing', async () => {
  __clearHistoryCache();
  let calls = 0;
  const call = async (...a) => { calls += 1; return fakeChain(2000, { 50: ['bob', '7.000000'] })(...a); };
  await memberHistory(call, 'kula');
  const after = calls;
  await memberHistory(call, 'kula');
  assert.equal(calls, after, 'second read is served from cache');
  __clearHistoryCache();
  const dead = async () => null;
  assert.deepEqual(await fetchMemberHistory(dead, 'kula'), [], 'a dead node yields no members, no throw');
});
