// soapbox-staking.test.mjs — offline. PRANA reads via a fake fetch (__setFetch). Asserts the reward math
// mirrors the DelegationMint contract, the unsigned tx descriptors carry the right selectors + args, the
// live-state reader decodes eth_call results, and the handler serves the page + /api/state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, isAddress, toBig, accPerShareAt, pendingReward, aprAnnual,
  buildApproveTx, buildDelegateTx, buildUndelegateTx, buildClaimTx,
  loadConfig, fetchState, handler, ADDR, SEL, __setFetch,
} from './soapbox-staking.mjs';

const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const WAD = 10n ** 18n;

test('esc neutralizes html', () => { assert.equal(esc('<b>"x"'), '&lt;b&gt;&quot;x&quot;'); });

test('toBig parses dec/hex; rejects junk', () => {
  assert.equal(toBig('0x0a'), 10n); assert.equal(toBig('5'), 5n);
  assert.equal(toBig('zz'), null); assert.equal(toBig(-1), null);
});

test('accPerShareAt advances by blocks×emission×ACC/total (BigInt)', () => {
  // 10 blocks × 1e18 emission × 1e12 ACC / 100e18 total = 1e11
  const acc = accPerShareAt({ accRewardPerShare: '0', blocksElapsed: 10, emissionPerBlock: WAD.toString(), totalDelegated: (100n * WAD).toString() });
  assert.equal(acc, (10n * WAD * 10n ** 12n) / (100n * WAD));
  // no movement when nothing delegated
  assert.equal(accPerShareAt({ accRewardPerShare: '7', blocksElapsed: 10, emissionPerBlock: '1', totalDelegated: '0' }), 7n);
});

test('pendingReward mirrors the contract formula and floors at 0', () => {
  // amount 50e18, acc 1e11, ACC 1e12 -> 50e18*1e11/1e12 = 5e18, minus debt 1e18, plus pending 2e18 = 6e18
  const p = pendingReward({ amount: (50n * WAD).toString(), accRewardPerShare: '100000000000', rewardDebt: WAD.toString(), pending: (2n * WAD).toString() });
  assert.equal(p, (6n * WAD).toString());
  // negative gross floors to 0
  assert.equal(pendingReward({ amount: '0', accRewardPerShare: '0', rewardDebt: '999', pending: '0' }), '0');
});

test('aprAnnual = annualEmission/totalDelegated in bps', () => {
  // 1 ALTI/block × 10,512,000 blocks/yr / 100 dMP = 105,120x = huge; check the math is exact
  const a = aprAnnual({ emissionPerBlock: WAD.toString(), totalDelegated: (100n * WAD).toString(), blocksPerYear: 10512000 });
  assert.equal(a.bps, Number((WAD * 10512000n * 10000n * 1000000n) / (100n * WAD * 1000000n)));
  assert.equal(aprAnnual({ emissionPerBlock: '1', totalDelegated: '0' }), null);
});

test('tx builders carry the right selectors + abi-encoded args', () => {
  const amt = (5n * WAD);
  const ap = buildApproveTx(amt.toString());
  assert.equal(ap.to, ADDR.stakeToken);
  assert.ok(ap.data.startsWith(SEL.approve));
  assert.equal(ap.data.slice(10, 74), ADDR.delegationMint.toLowerCase().replace(/^0x/, '').padStart(64, '0')); // spender
  assert.equal(ap.data.slice(74), amt.toString(16).padStart(64, '0'));                                          // amount

  const del = buildDelegateTx(amt.toString());
  assert.equal(del.to, ADDR.delegationMint);
  assert.equal(del.data, SEL.delegate + amt.toString(16).padStart(64, '0'));
  assert.equal(buildUndelegateTx(amt.toString()).data, SEL.undelegate + amt.toString(16).padStart(64, '0'));
  assert.equal(buildClaimTx().data, SEL.claim);
  assert.equal(buildDelegateTx('not-a-number'), null);
});

function installFakeChain({ emission = WAD, total = 100n * WAD, delegated = 5n * WAD, pending = 3n * WAD } = {}) {
  const enc = (b) => '0x' + b.toString(16).padStart(64, '0');
  __setFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const data = body.params[0].data;
    let result = '0x' + '0'.repeat(64);
    if (data === SEL.emissionPerBlock) result = enc(emission);
    else if (data === SEL.totalDelegated) result = enc(total);
    else if (data.startsWith(SEL.delegatedOf)) result = enc(delegated);
    else if (data.startsWith(SEL.pendingReward)) result = enc(pending);
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  });
}

test('fetchState decodes pool + user position; computes apr', async () => {
  installFakeChain();
  const s = await fetchState(loadConfig({}), USER);
  assert.equal(s.ok, true);
  assert.equal(s.emissionPerBlock, WAD.toString());
  assert.equal(s.totalDelegated, (100n * WAD).toString());
  assert.equal(s.delegated, (5n * WAD).toString());
  assert.equal(s.pending, (3n * WAD).toString());
  assert.ok(s.apr && s.apr.pct > 0);
  __setFetch();
});

test('fetchState without a user returns pool stats only', async () => {
  installFakeChain();
  const s = await fetchState(loadConfig({}), null);
  assert.equal(s.ok, true);
  assert.equal(s.delegated, undefined);
  __setFetch();
});

test('fetchState soft-fails on a chain error', async () => {
  __setFetch(async () => { throw new Error('rpc down'); });
  const s = await fetchState(loadConfig({}), USER);
  assert.equal(s.ok, false);
  assert.match(s.reason, /rpc down/);
  __setFetch();
});

function mockRes() { return { code: 0, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } }; }
function mockReq(method, url) { return { method, url }; }

test('GET / serves the staking page', async () => {
  const res = mockRes();
  await handler(mockReq('GET', '/'), res, {});
  assert.equal(res.code, 200);
  assert.match(res.body, /SoapBox Staking/);
  assert.match(res.body, /similar to NutBox/);
});

test('GET /api/state returns pool stats + human amounts', async () => {
  installFakeChain();
  const res = mockRes();
  await handler(mockReq('GET', `/api/state?user=${USER}`), res, {});
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.totalDelegatedHuman, '100.0000');
  assert.equal(j.delegatedHuman, '5.0000');
  __setFetch();
});

test('cleanup', () => { __setFetch(); });
