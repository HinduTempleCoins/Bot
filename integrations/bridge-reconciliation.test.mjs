// bridge-reconciliation.test.mjs — offline tests for the solvency watchdog. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcile, reconcileToken, loadConfig, toBaseUnits, rescale,
  readWrapperSupply, readMelekBalance, readHiveEngineBalance,
  buildPauseCall, maybePause, summarize, __setFetch,
} from './bridge-reconciliation.mjs';

// A fake fetch keyed by (url, method, first-param shape). Returns { result } JSON-RPC envelopes.
function fakeFetch(router) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const out = router(url, body.method, body.params, body);
    if (out === '__throw__') throw new Error('network down');
    return { json: async () => (out && out.error ? out : { jsonrpc: '2.0', id: 1, result: out }) };
  };
}
// eth_call totalSupply -> hex; encode a BigInt as 32-byte hex.
const hex32 = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');

test.afterEach(() => __setFetch(null));

test('toBaseUnits parses decimals and tolerates a symbol suffix', () => {
  assert.equal(toBaseUnits('1.000 MELEK', 3), 1000n);
  assert.equal(toBaseUnits('23300.00000000', 8), 2330000000000n);
  assert.equal(toBaseUnits('5', 18), 5000000000000000000n);
  assert.equal(toBaseUnits('junk', 3), null);
});

test('rescale widens and narrows base units', () => {
  assert.equal(rescale(1000n, 3, 18), 1000000000000000000n); // 1.000 MELEK -> 18dp
  assert.equal(rescale(1500000000000000000n, 18, 3), 1500n); // narrow, floors dust
});

test('readWrapperSupply decodes eth_call totalSupply; null on bad read', async () => {
  __setFetch(fakeFetch((url, method) => (method === 'eth_call' ? hex32(5001n * 10n ** 18n) : null)));
  assert.equal(await readWrapperSupply('http://prana', '0xf6d9'), 5001n * 10n ** 18n);
  __setFetch(fakeFetch(() => '__throw__'));
  assert.equal(await readWrapperSupply('http://prana', '0xf6d9'), null);
  assert.equal(await readWrapperSupply('', '0xf6d9'), null); // no rpc -> null, no throw
});

test('readMelekBalance reads condenser balance; null when absent', async () => {
  __setFetch(fakeFetch(() => [{ balance: '1.000 MELEK' }]));
  const r = await readMelekBalance('http://melek', 'wmelek-bridge', 3);
  assert.equal(r.base, 1000n);
  __setFetch(fakeFetch(() => []));
  assert.equal(await readMelekBalance('http://melek', 'nobody', 3), null);
});

test('readHiveEngineBalance treats a missing row as real 0', async () => {
  __setFetch(fakeFetch(() => null)); // HE returns null for a zero balance
  const r = await readHiveEngineBalance('http://he', 'melek-bridge', 'VKBT', 8);
  assert.equal(r.base, 0n);
});

test('reconcileToken flags a SHORTFALL when minted > custodied (the wMELEK defect)', async () => {
  // 5001 wMELEK minted, only 1.000 MELEK custodied -> unbacked.
  __setFetch(fakeFetch((url, method) => {
    if (method === 'eth_call') return hex32(5001n * 10n ** 18n);
    if (method === 'condenser_api.get_accounts') return [{ balance: '1.000 MELEK' }];
    return null;
  }));
  const t = { symbol: 'wMELEK', wrapper: '0xf6d9', wrapperDecimals: 18,
    custody: { chain: 'melek', account: 'wmelek-bridge', symbol: 'MELEK', decimals: 3 } };
  const r = await reconcileToken(t, loadConfig({ PRANA_RPC_URL: 'http://p', MELEK_RPC_URL: 'http://m' }));
  assert.equal(r.ok, true);
  assert.equal(r.backed, false);
  assert.equal(r.status, 'SHORTFALL');
  assert.equal(r.minted, (5001n * 10n ** 18n).toString());
  assert.equal(r.custodied, (1n * 10n ** 18n).toString());
  assert.equal(BigInt(r.shortfall) > 0n, true);
});

test('reconcileToken reports backed when custodied >= minted', async () => {
  __setFetch(fakeFetch((url, method) => {
    if (method === 'eth_call') return hex32(1000n * 10n ** 18n); // 1000 wMELEK
    if (method === 'condenser_api.get_accounts') return [{ balance: '1000.000 MELEK' }];
    return null;
  }));
  const t = { symbol: 'wMELEK', wrapper: '0xf6d9', wrapperDecimals: 18,
    custody: { chain: 'melek', account: 'wmelek-bridge', symbol: 'MELEK', decimals: 3 } };
  const r = await reconcileToken(t, loadConfig({ PRANA_RPC_URL: 'http://p', MELEK_RPC_URL: 'http://m' }));
  assert.equal(r.backed, true);
  assert.equal(r.status, 'backed');
});

test('reconcileToken is INDETERMINATE (never a false backed) when custody read fails', async () => {
  __setFetch(fakeFetch((url, method) => {
    if (method === 'eth_call') return hex32(5001n * 10n ** 18n);
    if (method === 'condenser_api.get_accounts') return '__throw__';
    return null;
  }));
  const t = { symbol: 'wMELEK', wrapper: '0xf6d9', wrapperDecimals: 18,
    custody: { chain: 'melek', account: 'wmelek-bridge', symbol: 'MELEK', decimals: 3 } };
  const r = await reconcileToken(t, loadConfig({ PRANA_RPC_URL: 'http://p', MELEK_RPC_URL: 'http://m' }));
  assert.equal(r.ok, false);
  assert.equal(r.backed, null);
  assert.equal(r.status, 'indeterminate');
});

test('reconcile aggregates: alarm on any shortfall, all three default tokens present', async () => {
  __setFetch(fakeFetch((url, method, params) => {
    if (method === 'eth_call') return hex32(5001n * 10n ** 18n); // every wrapper over-minted vs 0 custody
    if (method === 'condenser_api.get_accounts') return [{ balance: '1.000 MELEK' }];
    if (method === 'findOne') return null; // HE zero
    return null;
  }));
  const report = await reconcile(loadConfig({ PRANA_RPC_URL: 'http://p', MELEK_RPC_URL: 'http://m' }));
  assert.equal(report.tokens.length, 3);
  assert.equal(report.alarm, true);
  assert.match(summarize(report), /RECON ALARM/);
});

test('maybePause is GUARDED: never pauses without alarm+autoPause+injected pauser', async () => {
  const alarmReport = { alarm: true };
  const okReport = { alarm: false };
  let called = 0;
  const pause = async () => { called++; return 'txhash'; };

  // no alarm -> never
  assert.equal((await maybePause(okReport, { autoPause: true, pause })).paused, false);
  // alarm but autoPause off (default) -> would pause, but does not
  const a = await maybePause(alarmReport, { pause });
  assert.equal(a.paused, false);
  assert.equal(a.wouldPause, true);
  assert.ok(a.call && a.call.method === 'pause');
  // alarm + autoPause but no pauser -> does not
  assert.equal((await maybePause(alarmReport, { autoPause: true })).paused, false);
  // alarm + autoPause + pauser -> pauses exactly once
  const p = await maybePause(alarmReport, { autoPause: true, pause });
  assert.equal(p.paused, true);
  assert.equal(called, 1);
});

test('buildPauseCall is an unsigned descriptor, no signing', () => {
  const call = buildPauseCall(loadConfig({}));
  assert.equal(call.method, 'pause');
  assert.equal(call.unsigned, true);
  assert.deepEqual(call.args, []);
});

test('loadConfig defaults autoPause OFF and carries the three canonical wrappers', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.autoPause, false);
  assert.deepEqual(cfg.tokens.map((t) => t.symbol), ['wMELEK', 'wVKBT', 'wCURE']);
  assert.equal(loadConfig({ BRIDGE_RECON_AUTOPAUSE: 'true' }).autoPause, true);
});
