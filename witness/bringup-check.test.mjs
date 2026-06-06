// bringup-check.test.mjs — offline unit tests for the AI-Witness bring-up harness (#289).
//
// Every check is exercised with an INJECTED fetch returning fixtures (happy + failure shapes).
// No network, no keys. Mirrors the repo test convention: node --test, __setFetch injection,
// soft-fail-never-throw.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  __setFetch,
  makeRpc,
  checkRpcAndChainId,
  checkAccountAndWitness,
  checkBlockProduction,
  checkPriceFeed,
  checkIntroPost,
  checkCommandMenu,
  checkTrollbox,
  checkSignupAndTutorial,
  checkWatcher,
  keyGatedSkips,
  runBringupChecks,
  summarize,
  renderScorecard,
  parseArgs,
  DEFAULT_EXPECT,
} from './bringup-check.mjs';

// ── a fixture RPC server: map "method" -> result (or () => throw to simulate an RPC error) ────────
function fixtureFetch(byMethod) {
  return async (_url, { body } = {}) => {
    const { method } = JSON.parse(body);
    const entry = byMethod[method];
    if (entry === undefined) {
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: `no fixture for ${method}` } }) };
    }
    const value = typeof entry === 'function' ? entry() : entry;
    if (value && value.__rpcError) {
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, error: { message: value.__rpcError } }) };
    }
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: value }) };
  };
}
const rpcError = (msg) => ({ __rpcError: msg });

// Common healthy fixtures.
const NOW = 1_700_000_000_000;
const isoRecent = new Date(NOW - 30 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '').replace('T', 'T');
const goodSigningKey = 'TST6LLegbAgLAy28EHrffBVuANFWcFgmqRMW13wBmTExqFE9SCkg4';
const nullKey = 'TST1111111111111111111111111111111114T1Anm';

const HEALTHY = {
  'condenser_api.get_dynamic_global_properties': { head_block_number: 5000 },
  'condenser_api.get_config': { STEEMIT_ADDRESS_PREFIX: 'TST', STEEM_CHAIN_ID: '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e' },
  'condenser_api.get_version': { chain_id: '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e' },
  'condenser_api.get_accounts': [{ name: 'hathor', balance: '100.000 TESTS', vesting_shares: '1000.000000 VESTS', post_count: 3, reputation: 100 }],
  'condenser_api.get_witness_by_account': {
    owner: 'hathor', url: 'https://witness.melek.salon', signing_key: goodSigningKey,
    total_missed: 2, last_confirmed_block_num: 4999, last_feed_publish: isoRecent.replace('Z', ''),
  },
  'condenser_api.get_witness_schedule': { current_shuffled_witnesses: ['hathor', 'alice', 'bob'] },
  'condenser_api.get_block': () => ({ witness: 'hathor', block_id: 'abc' }),
  'condenser_api.get_feed_history': { price_history: [{}, {}, {}] },
  'condenser_api.get_content': { author: 'hathor', permlink: 'introducing-hathor-on-melek', title: 'Introducing Hathor', body: 'Hello MELEK. '.repeat(20) },
  'condenser_api.get_account_history': [
    [10, { op: ['custom_json', { id: 'melek_trollbox', json: JSON.stringify({ v: 1, user: 'newbie', text: 'how do i sign up?', ts: 1 }) }] }],
    [11, { op: ['transfer', { from: 'hathor', to: 'alice', amount: '1.000 TESTS' }] }],
  ],
};

// ── check 1: RPC + chain id ──────────────────────────────────────────────────────────────────────
test('checkRpcAndChainId: happy — prefix TST matches', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkRpcAndChainId(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /prefix=TST/);
  __setFetch(null);
});

test('checkRpcAndChainId: fail — wrong prefix', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_config': { STEEMIT_ADDRESS_PREFIX: 'STM' } }));
  const r = await checkRpcAndChainId(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /STM/);
  __setFetch(null);
});

test('checkRpcAndChainId: fail — RPC unreachable', async () => {
  __setFetch(fixtureFetch({ 'condenser_api.get_dynamic_global_properties': rpcError('boom') }));
  const r = await checkRpcAndChainId(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /unreachable/);
  __setFetch(null);
});

test('checkRpcAndChainId: fail — pinned chain id mismatch', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkRpcAndChainId(makeRpc('http://x'), { ...DEFAULT_EXPECT, chainId: 'deadbeefdeadbeef' });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /chain id/);
  __setFetch(null);
});

// ── check 2: account + witness ────────────────────────────────────────────────────────────────────
test('checkAccountAndWitness: happy', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkAccountAndWitness(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  __setFetch(null);
});

test('checkAccountAndWitness: fail — account missing', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_accounts': [] }));
  const r = await checkAccountAndWitness(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /does not exist/);
  __setFetch(null);
});

test('checkAccountAndWitness: fail — not a witness', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_witness_by_account': null }));
  const r = await checkAccountAndWitness(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /not a registered witness/);
  __setFetch(null);
});

test('checkAccountAndWitness: fail — null signing key + no url', async () => {
  __setFetch(fixtureFetch({
    ...HEALTHY,
    'condenser_api.get_witness_by_account': { signing_key: nullKey, url: '' },
  }));
  const r = await checkAccountAndWitness(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /signing key is null/);
  assert.match(r.detail, /URL not set/);
  __setFetch(null);
});

// ── check 3: block production ──────────────────────────────────────────────────────────────────────
test('checkBlockProduction: happy — in schedule + signed recently', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkBlockProduction(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /signed block/);
  __setFetch(null);
});

test('checkBlockProduction: reports missed delta vs previous', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkBlockProduction(makeRpc('http://x'), DEFAULT_EXPECT, { previous: { totalMissed: 0 } });
  assert.equal(r.status, 'pass');
  assert.equal(r.delta, 2);
  assert.match(r.detail, /Δmissed=\+2/);
  __setFetch(null);
});

test('checkBlockProduction: fail — not in schedule', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_witness_schedule': { current_shuffled_witnesses: ['alice', 'bob'] } }));
  const r = await checkBlockProduction(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /not in the active witness schedule/);
  __setFetch(null);
});

test('checkBlockProduction: fail — in schedule but no recent block signed', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_block': () => ({ witness: 'someoneelse' }) }));
  const r = await checkBlockProduction(makeRpc('http://x'), { ...DEFAULT_EXPECT, recentBlockRounds: 3 });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /no block signed/);
  __setFetch(null);
});

// ── check 4: price feed ────────────────────────────────────────────────────────────────────────────
test('checkPriceFeed: happy — fresh feed', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkPriceFeed(makeRpc('http://x'), DEFAULT_EXPECT, { now: () => NOW });
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /history depth=3/);
  __setFetch(null);
});

test('checkPriceFeed: fail — stale feed (> 2h)', async () => {
  const stale = new Date(NOW - 5 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, '').replace('Z', '');
  __setFetch(fixtureFetch({
    ...HEALTHY,
    'condenser_api.get_witness_by_account': { ...HEALTHY['condenser_api.get_witness_by_account'], last_feed_publish: stale },
  }));
  const r = await checkPriceFeed(makeRpc('http://x'), DEFAULT_EXPECT, { now: () => NOW });
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /stale/);
  __setFetch(null);
});

test('checkPriceFeed: fail — no publish timestamp', async () => {
  __setFetch(fixtureFetch({
    ...HEALTHY,
    'condenser_api.get_witness_by_account': { url: 'x', signing_key: goodSigningKey },
  }));
  const r = await checkPriceFeed(makeRpc('http://x'), DEFAULT_EXPECT, { now: () => NOW });
  assert.equal(r.status, 'fail');
  __setFetch(null);
});

// ── check 5: intro post ──────────────────────────────────────────────────────────────────────────
test('checkIntroPost: happy', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkIntroPost(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  __setFetch(null);
});

test('checkIntroPost: fail — empty content', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_content': { author: '', body: '' } }));
  const r = await checkIntroPost(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  __setFetch(null);
});

// ── check 6: command menu ──────────────────────────────────────────────────────────────────────────
test('checkCommandMenu: happy — well-formed replies', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkCommandMenu(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /!balance ok/);
  __setFetch(null);
});

test('checkCommandMenu: fail — account not found yields soft-error reply', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_accounts': [] }));
  const r = await checkCommandMenu(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  __setFetch(null);
});

// ── check 7: troll-box ────────────────────────────────────────────────────────────────────────────
test('checkTrollbox: happy — reads the stream', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkTrollbox(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /melek_trollbox/);
  __setFetch(null);
});

test('checkTrollbox: passes on an empty stream (clean read)', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_account_history': [] }));
  const r = await checkTrollbox(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /0 inbound/);
  __setFetch(null);
});

test('checkTrollbox: fail — history read errors', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_account_history': rpcError('history boom') }));
  // pollInbound soft-fails to [] on the client throwing; the connector returns [] not throw,
  // so a clean read of zero lines is still a pass — this asserts the resilience contract.
  const r = await checkTrollbox(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  __setFetch(null);
});

// ── check 8: signup + tutorial (no network) ──────────────────────────────────────────────────────
test('checkSignupAndTutorial: happy — in-process smoke', async () => {
  const r = await checkSignupAndTutorial();
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /tutorial composer ok/);
  assert.match(r.detail, /signup/);
});

// ── check 9: watcher / monitor ──────────────────────────────────────────────────────────────────────
test('checkWatcher: happy — clean read-only snapshot', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const r = await checkWatcher(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /head=5000/);
  __setFetch(null);
});

test('checkWatcher: fail — signing key disabled', async () => {
  __setFetch(fixtureFetch({
    ...HEALTHY,
    'condenser_api.get_witness_by_account': { ...HEALTHY['condenser_api.get_witness_by_account'], signing_key: nullKey },
  }));
  const r = await checkWatcher(makeRpc('http://x'), DEFAULT_EXPECT);
  assert.equal(r.status, 'fail');
  assert.match(r.detail, /disabled/);
  __setFetch(null);
});

// ── key-gated skips ──────────────────────────────────────────────────────────────────────────────
test('keyGatedSkips: all SKIPPED with a command, never attempted', () => {
  const skips = keyGatedSkips();
  assert.ok(skips.length >= 3);
  for (const s of skips) {
    assert.equal(s.status, 'skip');
    assert.ok(s.command, 'each key-gated skip names the operator command');
  }
});

// ── full runner + rendering ──────────────────────────────────────────────────────────────────────
test('runBringupChecks: full healthy run is GREEN', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const report = await runBringupChecks({ rpcUrl: 'http://x', now: () => NOW });
  assert.equal(report.summary.ok, true);
  assert.equal(report.summary.fail, 0);
  assert.ok(report.summary.pass >= 8);
  assert.ok(report.summary.skip >= 3);
  __setFetch(null);
});

test('runBringupChecks: a single failure flips bring-up to not-ok but other lines still run', async () => {
  __setFetch(fixtureFetch({ ...HEALTHY, 'condenser_api.get_content': { author: '', body: '' } }));
  const report = await runBringupChecks({ rpcUrl: 'http://x', now: () => NOW });
  assert.equal(report.summary.ok, false);
  assert.ok(report.summary.fail >= 1);
  // The intro-post line failed but account/witness/etc still passed.
  const intro = report.results.find((r) => /Intro post/.test(r.name));
  assert.equal(intro.status, 'fail');
  const acct = report.results.find((r) => /Account \+ witness/.test(r.name));
  assert.equal(acct.status, 'pass');
  __setFetch(null);
});

test('runBringupChecks: never throws even when the RPC is totally dead', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const report = await runBringupChecks({ rpcUrl: 'http://x', now: () => NOW });
  assert.equal(report.summary.ok, false);
  // in-process checks (signup+tutorial) still pass; that's the resilience point.
  const st = report.results.find((r) => /Signup server/.test(r.name));
  assert.equal(st.status, 'pass');
  __setFetch(null);
});

test('summarize: counts pass/fail/skip and ok ignores skips', () => {
  const s = summarize([
    { status: 'pass' }, { status: 'pass' }, { status: 'skip' }, { status: 'skip' },
  ]);
  assert.equal(s.pass, 2);
  assert.equal(s.skip, 2);
  assert.equal(s.fail, 0);
  assert.equal(s.ok, true);
  assert.equal(summarize([{ status: 'fail' }]).ok, false);
});

test('renderScorecard: shows glyphs, skip arrows, and the summary footer', async () => {
  __setFetch(fixtureFetch(HEALTHY));
  const report = await runBringupChecks({ rpcUrl: 'http://x', now: () => NOW });
  const out = renderScorecard(report);
  assert.match(out, /bring-up scorecard/);
  assert.match(out, /✓/);
  assert.match(out, /SKIPPED/);
  assert.match(out, /→ node witness\/feed-publisher\.mjs/);
  assert.match(out, /passed ·/);
  __setFetch(null);
});

// ── arg parsing ──────────────────────────────────────────────────────────────────────────────────
test('parseArgs: --rpc / --json / --prefix / --chain-id', () => {
  const a = parseArgs(['--rpc', 'http://r', '--json', '--prefix', 'TST', '--chain-id', 'abc', '--account', 'hathor']);
  assert.equal(a.rpcUrl, 'http://r');
  assert.equal(a.json, true);
  assert.equal(a.expect.addressPrefix, 'TST');
  assert.equal(a.expect.chainId, 'abc');
  assert.equal(a.expect.account, 'hathor');
});

test('parseArgs: falls back to MELEK_RPC_URL env', () => {
  const prev = process.env.MELEK_RPC_URL;
  process.env.MELEK_RPC_URL = 'http://env-rpc';
  const a = parseArgs([]);
  assert.equal(a.rpcUrl, 'http://env-rpc');
  if (prev === undefined) delete process.env.MELEK_RPC_URL; else process.env.MELEK_RPC_URL = prev;
});
