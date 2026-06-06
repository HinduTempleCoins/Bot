// melek-chain.test.mjs — offline tests for the read-only MELEK chain reader.
// Injectable fetch, no network; soft-fail paths return null (never throw).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  networkLabel, network, configured, headBlock, witnessInfo, accountInfo, hathorStatus, __setFetch,
} from './melek-chain.mjs';

const RPC = 'http://example.invalid:8090';
let savedEnv;

beforeEach(() => {
  savedEnv = { rpc: process.env.MELEK_RPC_URL, net: process.env.MELEK_NETWORK };
  process.env.MELEK_RPC_URL = RPC;
  delete process.env.MELEK_NETWORK;
});
afterEach(() => {
  if (savedEnv.rpc === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = savedEnv.rpc;
  if (savedEnv.net === undefined) delete process.env.MELEK_NETWORK; else process.env.MELEK_NETWORK = savedEnv.net;
  __setFetch(null);
});

function fakeRpc(byMethod) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const result = byMethod[body.method];
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: typeof result === 'function' ? result(body.params) : result }),
    };
  };
}

test('networkLabel defaults to the permanent testnet label', () => {
  assert.equal(network(), 'testnet');
  assert.equal(networkLabel(), '[TestNet not MELEK]');
});

test('networkLabel flips for mainnet without losing the testnet path', () => {
  process.env.MELEK_NETWORK = 'mainnet';
  assert.equal(networkLabel(), '[MELEK]');
  process.env.MELEK_NETWORK = 'testnet';
  assert.equal(networkLabel(), '[TestNet not MELEK]');
});

test('headBlock maps dynamic global props and stamps the network', async () => {
  __setFetch(fakeRpc({
    'condenser_api.get_dynamic_global_properties': {
      head_block_number: 123456, time: '2026-06-06T12:00:00', current_witness: 'hathor',
    },
  }));
  const h = await headBlock();
  assert.equal(h.num, 123456);
  assert.equal(h.witness, 'hathor');
  assert.equal(h.label, '[TestNet not MELEK]');
  assert.equal(h.network, 'testnet');
});

test('witnessInfo maps the witness record (public signing key passes through)', async () => {
  __setFetch(fakeRpc({
    'condenser_api.get_witness_by_account': {
      owner: 'hathor', url: 'https://witness.melek.salon/hathor',
      signing_key: 'TST7abcPUBLICkey', total_missed: 2, last_confirmed_block_num: 123400,
      sbd_exchange_rate: { base: '1.000 TBD', quote: '1.000 TESTS' },
      last_sbd_exchange_update: '2026-06-06T11:00:00',
    },
  }));
  const w = await witnessInfo('hathor');
  assert.equal(w.owner, 'hathor');
  assert.equal(w.signingKey, 'TST7abcPUBLICkey');
  assert.equal(w.missed, 2);
  assert.equal(w.feed.base, '1.000 TBD');
  assert.equal(w.label, '[TestNet not MELEK]');
});

test('accountInfo maps public account facts', async () => {
  __setFetch(fakeRpc({
    'condenser_api.get_accounts': [{
      name: 'hathor', created: '2026-06-05T00:00:00', post_count: 3,
      balance: '100.000 TESTS', sbd_balance: '5.000 TBD', vesting_shares: '1000.000000 VESTS',
    }],
  }));
  const a = await accountInfo('Hathor'); // normalizes case
  assert.equal(a.name, 'hathor');
  assert.equal(a.balances.liquid, '100.000 TESTS');
  assert.equal(a.label, '[TestNet not MELEK]');
});

test('hathorStatus combines head + witness and derives producing', async () => {
  __setFetch(fakeRpc({
    'condenser_api.get_dynamic_global_properties': { head_block_number: 123456, time: 't', current_witness: 'x' },
    'condenser_api.get_witness_by_account': { owner: 'hathor', last_confirmed_block_num: 123450, total_missed: 0 },
  }));
  const s = await hathorStatus();
  assert.equal(s.account, 'hathor');
  assert.equal(s.blocksBehindHead, 6);
  assert.equal(s.producing, true);
  assert.equal(s.label, '[TestNet not MELEK]');
});

test('soft-fail: unconfigured RPC returns null, never throws', async () => {
  delete process.env.MELEK_RPC_URL;
  assert.equal(configured(), false);
  assert.equal(await headBlock(), null);
  assert.equal(await witnessInfo(), null);
  assert.equal(await accountInfo('hathor'), null);
  assert.equal(await hathorStatus(), null);
});

test('soft-fail: network/RPC errors return null, never throw', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  assert.equal(await headBlock(), null);
  __setFetch(async () => ({ ok: false }));
  assert.equal(await witnessInfo('hathor'), null);
  __setFetch(async () => ({ ok: true, json: async () => ({ error: { message: 'bad' } }) }));
  assert.equal(await accountInfo('hathor'), null);
});

test('accountInfo rejects empty names without a call', async () => {
  let called = 0;
  __setFetch(async () => { called++; return { ok: true, json: async () => ({ result: [] }) }; });
  assert.equal(await accountInfo(''), null);
  assert.equal(called, 0);
});
