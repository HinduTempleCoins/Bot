// sprana-staking.test.mjs — offline. eth_call via a fake fetch (__setFetch). Asserts tx descriptors carry
// the right selectors/args, the Hathor-floor math + guards mirror the contract, and the reader decodes state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, toBig, buildStakeTx, buildRequestWithdrawTx, buildClaimTx, buildSetHathorShareTx,
  previewHathorSplit, isValidHathorShare, cooldownRemaining, loadConfig, fetchState, manifest,
  SEL, MIN_HATHOR_BPS, BPS, __setFetch,
} from './sprana-staking.mjs';

const ADDR = { sPRANA: '0x' + '11'.repeat(20), hathorDistributor: '0x' + '22'.repeat(20) };
const USER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const WAD = 10n ** 18n;

test('esc', () => { assert.equal(esc('<b>'), '&lt;b&gt;'); });

test('buildStakeTx is payable with value = amount, stake() selector', () => {
  const tx = buildStakeTx((5n * WAD).toString(), ADDR);
  assert.equal(tx.to, ADDR.sPRANA);
  assert.equal(tx.data, SEL.stake);
  assert.equal(tx.value, '0x' + (5n * WAD).toString(16));
  assert.equal(buildStakeTx('0', ADDR), null);
});

test('requestWithdraw / claim descriptors', () => {
  const w = buildRequestWithdrawTx((2n * WAD).toString(), ADDR);
  assert.equal(w.data, SEL.requestWithdraw + (2n * WAD).toString(16).padStart(64, '0'));
  assert.equal(w.value, '0x0');
  assert.equal(buildClaimTx(ADDR).data, SEL.claim);
});

test('setHathorShare refuses below the 3% floor and above 100% (mirrors on-chain guard)', () => {
  assert.equal(buildSetHathorShareTx(299, ADDR), null);        // below floor
  assert.equal(buildSetHathorShareTx(10001, ADDR), null);      // above 100%
  const ok = buildSetHathorShareTx(500, ADDR);
  assert.equal(ok.data, SEL.setHathorShare + (500).toString(16).padStart(64, '0'));
  assert.equal(buildSetHathorShareTx(10000, ADDR).data.endsWith((10000).toString(16).padStart(64, '0')), true);
});

test('previewHathorSplit = amount×bps/10000; never undercuts the 3% floor', () => {
  assert.deepEqual(previewHathorSplit((100n * WAD).toString(), 300), { toHathor: (3n * WAD).toString(), toDao: (97n * WAD).toString(), hathorBps: 300 });
  // a sub-floor bps is clamped UP to 300 (the floor can never be undercut)
  assert.equal(previewHathorSplit((100n * WAD).toString(), 0).hathorBps, 300);
  // 100% → all to Hathor
  assert.deepEqual(previewHathorSplit((50n * WAD).toString(), 10000), { toHathor: (50n * WAD).toString(), toDao: '0', hathorBps: 10000 });
});

test('isValidHathorShare enforces [300,10000]', () => {
  assert.equal(isValidHathorShare(300), true);
  assert.equal(isValidHathorShare(10000), true);
  assert.equal(isValidHathorShare(299), false);
  assert.equal(isValidHathorShare(10001), false);
});

test('cooldownRemaining', () => {
  assert.equal(cooldownRemaining(1000, 400), 600);
  assert.equal(cooldownRemaining(1000, 1000), 0);
  assert.equal(cooldownRemaining(1000, 2000), 0);
});

function installFake({ staked = 6n * WAD, votes = 6n * WAD, claimable = 4n * WAD, hathorBps = 300n } = {}) {
  const enc = (b) => '0x' + b.toString(16).padStart(64, '0');
  __setFetch(async (_url, opts) => {
    const data = JSON.parse(opts.body).params[0].data;
    let r = '0x' + '0'.repeat(64);
    if (data.startsWith(SEL.balanceOf)) r = enc(staked);
    else if (data.startsWith(SEL.getVotes)) r = enc(votes);
    else if (data.startsWith(SEL.claimableOf)) r = enc(claimable);
    else if (data === SEL.hathorBps) r = enc(hathorBps);
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result: r }) };
  });
}

test('fetchState decodes position + hathor share', async () => {
  installFake();
  const s = await fetchState(loadConfig({ SPRANA_ADDRESS: ADDR.sPRANA, HATHOR_DISTRIBUTOR_ADDRESS: ADDR.hathorDistributor }), USER);
  assert.equal(s.ok, true);
  assert.equal(s.staked, (6n * WAD).toString());
  assert.equal(s.votes, (6n * WAD).toString());
  assert.equal(s.claimable, (4n * WAD).toString());
  assert.equal(s.hathorBps, 300);
  __setFetch();
});

test('fetchState soft-fails before deployment + on chain error', async () => {
  assert.equal((await fetchState(loadConfig({}), USER)).reason, 'sprana-not-deployed');
  __setFetch(async () => { throw new Error('down'); });
  const s = await fetchState(loadConfig({ SPRANA_ADDRESS: ADDR.sPRANA }), USER);
  assert.equal(s.ok, false);
  __setFetch();
});

test('manifest exposes floor + cooldown, no keys', () => {
  const m = manifest();
  assert.equal(m.cooldownDays, 30);
  assert.equal(m.hathorFloorBps, 300);
  assert.match(m.boundary, /SIGNS/);
});

test('cleanup', () => { __setFetch(); });
