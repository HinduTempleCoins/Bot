// melek-fish-tiers.test.mjs — offline, no network (mock fetch via __setFetch). node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, CLUBS, esc, num, assetAmount, vestsToMp, classify, clubsFor, rankAccounts, getRichList, __setFetch,
} from './melek-fish-tiers.mjs';

test('assetAmount parses graphene asset strings / numbers / garbage', () => {
  assert.equal(assetAmount('123.456789 VESTS'), 123.456789);
  assert.equal(assetAmount('0.000 MELEK'), 0);
  assert.equal(assetAmount(5), 5);
  assert.equal(assetAmount(null), 0);
  assert.equal(assetAmount('nope'), 0);
});

test('esc escapes html; num coerces', () => {
  assert.equal(esc('<a&b>"\''), '&lt;a&amp;b&gt;&quot;&#39;');
  assert.equal(num('x', 7), 7);
});

test('vestsToMp converts via the vesting fund ratio; zero fund/shares → 0', () => {
  const dgp = { total_vesting_fund_melek: '1000.000 MELEK', total_vesting_shares: '2000.000000 VESTS' };
  assert.equal(vestsToMp('2000.000000 VESTS', dgp), 1000); // whole fund
  assert.equal(vestsToMp('200.000000 VESTS', dgp), 100);
  assert.equal(vestsToMp('200 VESTS', {}), 0);             // no dgp
  assert.equal(vestsToMp('200 VESTS', { total_vesting_fund_melek: '0', total_vesting_shares: '0' }), 0);
});

test('classify walks tiers by MELEK Power floor (inclusive)', () => {
  assert.equal(classify(0).key, 'plankton');
  assert.equal(classify(99).key, 'plankton');
  assert.equal(classify(100).key, 'minnow');   // boundary inclusive
  assert.equal(classify(999).key, 'minnow');
  assert.equal(classify(1000).key, 'dolphin');
  assert.equal(classify(10000).key, 'orca');
  assert.equal(classify(100000).key, 'whale');
  assert.equal(classify(5_000_000).key, 'whale');
  assert.equal(classify('bad').key, 'plankton'); // never throws
});

test('clubsFor returns crossed thresholds', () => {
  assert.deepEqual(clubsFor(500), []);
  assert.deepEqual(clubsFor(1500), [1000]);
  assert.deepEqual(clubsFor(150000), [1000, 10000, 100000]);
  assert.deepEqual(clubsFor(250000), CLUBS.slice());
});

test('rankAccounts uses effective MP (own+received-delegated), sorts desc, tags tier+clubs', () => {
  const dgp = { total_vesting_fund_melek: '1000000.0 MELEK', total_vesting_shares: '1000000.000000 VESTS' }; // 1 VEST = 1 MP
  const accts = [
    { name: 'whaley', vesting_shares: '100000.0 VESTS' },
    { name: 'delegator', vesting_shares: '5000.0 VESTS', delegated_vesting_shares: '4500.0 VESTS' }, // effective 500 → minnow
    { name: 'receiver', vesting_shares: '100.0 VESTS', received_vesting_shares: '1200.0 VESTS' },     // effective 1300 → dolphin
    { name: null, vesting_shares: '9.0 VESTS' }, // dropped
  ];
  const r = rankAccounts(accts, dgp);
  assert.deepEqual(r.map((x) => x.name), ['whaley', 'receiver', 'delegator']);
  assert.equal(r[0].tier, 'whale');
  assert.ok(r[0].clubs.includes(100000));
  assert.equal(r[1].tier, 'dolphin');
  assert.equal(r[2].tier, 'minnow'); // 500 MP ≥ minnow floor (100)
  assert.deepEqual(r[2].clubs, []);
});

test('TIERS + CLUBS are well-formed and ordered', () => {
  assert.equal(TIERS.length, 5);
  for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].minMp > TIERS[i - 1].minMp);
  for (let i = 1; i < CLUBS.length; i++) assert.ok(CLUBS[i] > CLUBS[i - 1]);
});

test('getRichList assembles from mocked RPC and ranks; soft-fails to empty on error', async () => {
  const dgp = { total_vesting_fund_melek: '1000000.0 MELEK', total_vesting_shares: '1000000.000000 VESTS' };
  const accounts = {
    alice: { name: 'alice', vesting_shares: '50000.0 VESTS' },
    bob: { name: 'bob', vesting_shares: '2000.0 VESTS' },
    cara: { name: 'cara', vesting_shares: '30.0 VESTS' },
  };
  __setFetch(async (_url, opts) => {
    const { method, params } = JSON.parse(opts.body);
    let result = null;
    if (method === 'condenser_api.get_dynamic_global_properties') result = dgp;
    else if (method === 'condenser_api.lookup_accounts') result = params[0] === '' ? ['alice', 'bob', 'cara'] : [];
    else if (method === 'condenser_api.get_accounts') result = params[0].map((n) => accounts[n]).filter(Boolean);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  const { accounts: ranked, count } = await getRichList({ limit: 2 });
  assert.equal(count, 3);
  assert.equal(ranked.length, 2);            // limit applied
  assert.deepEqual(ranked.map((x) => x.name), ['alice', 'bob']);
  assert.equal(ranked[0].tier, 'orca');      // 50000 MP
  assert.equal(ranked[1].tier, 'dolphin');   // 2000 MP

  __setFetch(async () => { throw new Error('network down'); });
  const empty = await getRichList({});
  assert.deepEqual(empty.accounts, []);
  assert.equal(empty.count, 0);
  __setFetch(null); // restore
});
