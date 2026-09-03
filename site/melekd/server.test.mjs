import test from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc } from './server.mjs';
import * as x from '../../integrations/chain-explorer.mjs';

// Fully offline: chain-explorer exposes __setFetch, so no request leaves the process.
const CHAIN = {
  head_block_number: 943480, last_irreversible_block_num: 943460, current_witness: 'thoth',
  current_supply: '1248178.290 MELEK', time: '2026-09-03T17:29:36',
};
const ACCOUNT = {
  name: 'hathor', created: '2026-07-12T00:00:00', balance: '10.000 MELEK', savings_balance: '0.000 MELEK',
  hbd_balance: '0.000 MBD', vesting_shares: '100.000000 VESTS', post_count: 4,
  witness_votes: ['maat', 'seshat'], proxy: '', recovery_account: 'initminer', last_vote_time: '2026-09-01T00:00:00',
};
const HISTORY = [[7, { timestamp: '2026-09-02T10:00:00', op: ['transfer', { from: 'hathor', to: 'maat', amount: '1.000 MELEK', memo: 'thanks' }] }]];
const WITNESS = {
  owner: 'hathor', url: 'https://witness.melek.salon', running_version: '0.24.0', total_missed: 3,
  last_confirmed_block_num: 943470, signing_key: 'MELEK7abc', votes: '123',
  hbd_exchange_rate: { base: '0.100 MBD', quote: '1.000 MELEK' }, props: { account_creation_fee: '0.000 MELEK', maximum_block_size: 65536 },
};
const BLOCK = {
  timestamp: '2026-09-03T17:00:00', witness: 'seshat',
  transactions: [{ operations: [['transfer', {}], ['vote', {}]] }, { operations: [['vote', {}]] }],
};

function stub(map) {
  x.__setFetch(async (_url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    const method = body.method;
    if (!(method in map)) return { ok: false, status: 500, json: async () => ({}) };
    const v = map[method];
    if (v instanceof Error) throw v;
    return { ok: true, status: 200, json: async () => ({ result: v }) };
  });
}
const ALL = {
  'condenser_api.get_dynamic_global_properties': CHAIN,
  'condenser_api.get_accounts': [ACCOUNT],
  'condenser_api.get_account_history': HISTORY,
  'condenser_api.get_witness_by_account': WITNESS,
  'condenser_api.get_block': BLOCK,
};

function mockRes() {
  return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = b == null ? '' : String(b); } };
}
const get = async (p) => { const r = mockRes(); await handler({ url: p, method: 'GET' }, r); return r; };

test.beforeEach(() => stub(ALL));
test.after(() => x.__setFetch(undefined));

test('health answers', async () => {
  const r = await get('/health');
  assert.equal(r.code, 200);
  assert.equal(r.body, 'ok');
});

test('the chain view renders and explains irreversibility', async () => {
  const r = await get('/');
  assert.equal(r.code, 200);
  assert.match(r.body, /943480/);
  assert.match(r.body, /thoth/);
  assert.match(r.body, /1248178\.290 MELEK/);
  assert.match(r.body, /20 blocks behind head/);   // 943480 - 943460
  assert.match(r.body, /can never be reversed/);
});

test('every view offers the raw record as json', async () => {
  const c = JSON.parse((await get('/?format=json')).body);
  assert.equal(c.headBlock, 943480);
  const a = JSON.parse((await get('/@hathor?format=json')).body);
  assert.equal(a.account.name, 'hathor');
  assert.equal(a.transfers.length, 1);
  const w = JSON.parse((await get('/w/hathor?format=json')).body);
  assert.equal(w.totalMissed, 3);
  const b = JSON.parse((await get('/b/943480?format=json')).body);
  assert.equal(b.txCount, 2);
});

test('the account view states what a raw field means', async () => {
  const r = await get('/@hathor');
  assert.equal(r.code, 200);
  assert.match(r.body, /100\.000000 VESTS/);
  assert.match(r.body, /cannot be moved without unstaking/);
  assert.match(r.body, /recovery account/);
  assert.match(r.body, /1\.000 MELEK/);           // the transfer row
  assert.match(r.body, /votes for itself/);        // empty proxy explained
});

test('the witness view leads with the three numbers that decide a vote', async () => {
  const r = await get('/w/hathor');
  assert.equal(r.code, 200);
  const missed = r.body.indexOf('missed blocks');
  const version = r.body.indexOf('running version');
  const feed = r.body.indexOf('price feed');
  const signing = r.body.indexOf('signing key');
  assert.ok(missed > 0 && version > missed && feed > version, 'order: missed, version, feed');
  assert.ok(feed < signing, 'the deciding numbers come before the raw fields');
  assert.match(r.body, /fork itself off/);
});

test('a witness with no missed blocks is described differently', async () => {
  stub({ ...ALL, 'condenser_api.get_witness_by_account': { ...WITNESS, total_missed: 0 } });
  assert.match((await get('/w/hathor')).body, /never missed a scheduled block/);
});

test('the block view counts operations by type', async () => {
  const r = await get('/b/943480');
  assert.equal(r.code, 200);
  assert.match(r.body, /transfer/);
  assert.match(r.body, /vote/);
});

test('an empty block says so rather than showing a blank table', async () => {
  stub({ ...ALL, 'condenser_api.get_block': { timestamp: 't', witness: 'w', transactions: [] } });
  assert.match((await get('/b/1')).body, /scheduled, produced, no transactions/);
});

test('the search box routes accounts and block numbers', async () => {
  let r = await get('/go?q=hathor');
  assert.equal(r.code, 302); assert.equal(r.headers.location, '/@hathor');
  r = await get('/go?q=%40Hathor');                 // @ prefix and caps
  assert.equal(r.headers.location, '/@hathor');
  r = await get('/go?q=943480');
  assert.equal(r.headers.location, '/b/943480');
  assert.equal((await get('/go?q=!!!')).code, 400);
});

test('a missing account is a 404, not an error page', async () => {
  stub({ ...ALL, 'condenser_api.get_accounts': [] });
  const r = await get('/@nobody');
  assert.equal(r.code, 404);
  assert.match(r.body, /No account/);
  assert.equal(JSON.parse((await get('/@nobody?format=json')).body).error, 'no such account');
});

test('a non-witness is a 404', async () => {
  stub({ ...ALL, 'condenser_api.get_witness_by_account': null });
  assert.equal((await get('/w/nobody')).code, 404);
});

test('an RPC failure renders an honest card, never a stack trace', async () => {
  stub({});                                          // every method 500s
  const r = await get('/');
  assert.equal(r.code, 200);
  assert.match(r.body, /Could not read the chain/);
  assert.equal(/at Object|Error:\s+at/.test(r.body), false, 'no stack trace leaked');
  assert.equal(JSON.parse((await get('/?format=json')).body).error !== undefined, true);
});

test('a failing transfer lookup still renders the account', async () => {
  stub({ ...ALL, 'condenser_api.get_account_history': new Error('boom') });
  const r = await get('/@hathor');
  assert.equal(r.code, 200);
  assert.match(r.body, /100\.000000 VESTS/);
  assert.match(r.body, /No transfers/);
});

test('unknown paths redirect home', async () => {
  const r = await get('/nope');
  assert.equal(r.code, 302);
  assert.equal(r.headers.location, '/');
});

test('account names in output are escaped', async () => {
  stub({ ...ALL, 'condenser_api.get_accounts': [{ ...ACCOUNT, recovery_account: '<script>x</script>' }] });
  const r = await get('/@hathor');
  assert.equal(/<script>x<\/script>/.test(r.body), false);
  assert.match(r.body, /&lt;script&gt;/);
});

test('esc handles every dangerous character', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
