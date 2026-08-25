// kula-gauge.test.mjs — offline tests for the gauge-vote + veKULA lock adapter. No network: an injected
// fetch feeds canned eth_call results. Asserts the reads parse, the builders emit the right to+selector,
// the projection reuses kula-farm, and everything soft-fails (never throws) on bad/empty RPC.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  veBalanceOf, gaugeWeights, buildLockTx, buildVoteTx, projectLock,
  voteEscrowAddr, gaugeControllerAddr, gaugeLive, isLiveAddr, isAddress, toBig,
  SEL, CHAIN_ID, WAD, esc, __setFetch, manifest,
} from './kula-gauge.mjs';
import { ADDR } from './kula-config-addresses.mjs';
import { veBoost, veVoteWeight } from './kula-farm.mjs';

// ── test helpers ────────────────────────────────────────────────────────────────────────────────────
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
// A live ve/gauge config (the map ships zero/DelegationMint; force real deploys for the read/build tests).
const LIVE = { ...ADDR, VoteEscrow: '0x' + 'ab'.repeat(20), GaugeController: '0x' + 'cd'.repeat(20) };
const GAUGE_A = '0x' + '11'.repeat(20);
const GAUGE_B = '0x' + '22'.repeat(20);

/** Build a fetch stub that returns canned eth_call `.result`s, keyed by the 4-byte selector in the data. */
function fetchStub(map) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const data = body.params[0].data;
    const sel = data.slice(0, 10);
    const result = typeof map === 'function' ? map(sel, data) : map[sel];
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result: result ?? null }) };
  };
}

// ── address resolution / config reading ───────────────────────────────────────────────────────────
test('resolves ve/gauge from config — no live keys → DelegationMint fallback, not zero', () => {
  // The real config map has NO VoteEscrow/GaugeController keys; it falls back to DelegationMint.
  assert.equal(voteEscrowAddr(), ADDR.DelegationMint);
  assert.equal(gaugeControllerAddr(), ADDR.DelegationMint);
  assert.equal(isLiveAddr(ADDR.DelegationMint), true, 'DelegationMint is a real non-zero address');
});

test('explicit VoteEscrow/GaugeController keys win over the fallback', () => {
  assert.equal(voteEscrowAddr(LIVE), LIVE.VoteEscrow);
  assert.equal(gaugeControllerAddr(LIVE), LIVE.GaugeController);
  assert.equal(gaugeLive(LIVE), true);
});

test('zero-addressed ve/gauge reads as not live', () => {
  const dead = { VoteEscrow: '0x' + '00'.repeat(20), GaugeController: '0x' + '00'.repeat(20) };
  assert.equal(gaugeLive(dead), false);
});

// ── veBalanceOf: parses an injected eth_call result ─────────────────────────────────────────────────
test('veBalanceOf parses balanceOf + locked from injected eth_call', async () => {
  __setFetch(fetchStub({
    [SEL.balanceOf]: '0x' + word(1500n * WAD),
    [SEL.locked]: '0x' + word(2000n * WAD) + word(1893456000n), // (amount, unlock end)
  }));
  const r = await veBalanceOf({ account: '0x' + '99'.repeat(20), rpcUrl: 'http://x', addr: LIVE });
  __setFetch(null);
  assert.equal(r.veKula, (1500n * WAD).toString());
  assert.equal(r.lockedAmount, (2000n * WAD).toString());
  assert.equal(r.unlockTime, 1893456000);
  assert.equal(r.veEscrow, LIVE.VoteEscrow);
});

test('veBalanceOf soft-fails to null on bad account and on empty RPC', async () => {
  assert.equal(await veBalanceOf({ account: 'not-an-address', addr: LIVE }), null);
  __setFetch(fetchStub({})); // every call → null result
  assert.equal(await veBalanceOf({ account: '0x' + '99'.repeat(20), rpcUrl: 'http://x', addr: LIVE }), null);
  __setFetch(null);
});

test('veBalanceOf returns null when the VoteEscrow is not deployed (zero addr)', async () => {
  const r = await veBalanceOf({ account: '0x' + '99'.repeat(20), addr: { VoteEscrow: '0x' + '00'.repeat(20) } });
  assert.equal(r, null);
});

// ── gaugeWeights: parses injected data ──────────────────────────────────────────────────────────────
test('gaugeWeights parses relative weights for an explicit gauge list', async () => {
  // 30% and 12.5% of 1e18.
  const wA = (WAD * 3000n) / 10000n;
  const wB = (WAD * 1250n) / 10000n;
  __setFetch(fetchStub((sel, data) => {
    if (sel !== SEL.gauge_relative_weight) return null;
    const g = '0x' + data.slice(10).slice(-40);
    if (g === GAUGE_A) return '0x' + word(wA);
    if (g === GAUGE_B) return '0x' + word(wB);
    return null;
  }));
  const rows = await gaugeWeights({ rpcUrl: 'http://x', gauges: [GAUGE_A, GAUGE_B], addr: LIVE });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].gauge, GAUGE_A);
  assert.equal(rows[0].bps, 3000);
  assert.equal(rows[0].pct, 30);
  assert.equal(rows[1].bps, 1250);
  assert.equal(rows[1].pct, 12.5);
});

test('gaugeWeights discovers gauges via n_gauges + gauges(i)', async () => {
  __setFetch(fetchStub((sel, data) => {
    if (sel === SEL.n_gauges) return '0x' + word(2n);
    if (sel === SEL.gauges) {
      const idx = BigInt('0x' + data.slice(10));
      return '0x' + addrWord(idx === 0n ? GAUGE_A : GAUGE_B);
    }
    if (sel === SEL.gauge_relative_weight) return '0x' + word((WAD * 5000n) / 10000n);
    return null;
  }));
  const rows = await gaugeWeights({ rpcUrl: 'http://x', addr: LIVE });
  __setFetch(null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].gauge, GAUGE_A);
  assert.equal(rows[0].bps, 5000);
});

test('gaugeWeights soft-fails to [] on empty RPC and when the controller is not live', async () => {
  __setFetch(fetchStub({}));
  assert.deepEqual(await gaugeWeights({ rpcUrl: 'http://x', gauges: [GAUGE_A], addr: LIVE }), []);
  __setFetch(null);
  assert.deepEqual(await gaugeWeights({ gauges: [GAUGE_A], addr: { GaugeController: '0x' + '00'.repeat(20) } }), []);
});

// ── buildLockTx / buildVoteTx: correct to + selector + calldata ─────────────────────────────────────
test('buildLockTx with unlockTime → create_lock(amount, unlockTime)', () => {
  const tx = buildLockTx({ amount: '1000000000000000000000', unlockTime: 1893456000, addr: LIVE });
  assert.equal(tx.to, LIVE.VoteEscrow);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.chainId, CHAIN_ID);
  assert.equal(tx.method, 'create_lock');
  assert.ok(tx.data.startsWith(SEL.create_lock));
  assert.equal(tx.data, SEL.create_lock + word(1000n * WAD) + word(1893456000n));
});

test('buildLockTx without unlockTime → increase_amount(amount)', () => {
  const tx = buildLockTx({ amount: 500n * WAD, addr: LIVE });
  assert.equal(tx.method, 'increase_amount');
  assert.equal(tx.data, SEL.increase_amount + word(500n * WAD));
});

test('buildLockTx soft-fails to null on zero amount and on undeployed ve', () => {
  assert.equal(buildLockTx({ amount: 0, addr: LIVE }), null);
  assert.equal(buildLockTx({ amount: '-5', addr: LIVE }), null);
  assert.equal(buildLockTx({ amount: 100, addr: { VoteEscrow: '0x' + '00'.repeat(20) } }), null);
});

test('buildVoteTx → vote_for_gauge_weights(gauge, weightBps), caps at 10000', () => {
  const tx = buildVoteTx({ gauge: GAUGE_A, weightBps: 2500, addr: LIVE });
  assert.equal(tx.to, LIVE.GaugeController);
  assert.equal(tx.method, 'vote_for_gauge_weights');
  assert.equal(tx.data, SEL.vote_for_gauge_weights + addrWord(GAUGE_A) + word(2500n));
  // cap
  const capped = buildVoteTx({ gauge: GAUGE_A, weightBps: 99999, addr: LIVE });
  assert.equal(capped.data, SEL.vote_for_gauge_weights + addrWord(GAUGE_A) + word(10000n));
});

test('buildVoteTx soft-fails to null on bad gauge / bad bps / undeployed controller', () => {
  assert.equal(buildVoteTx({ gauge: 'nope', weightBps: 100, addr: LIVE }), null);
  assert.equal(buildVoteTx({ gauge: GAUGE_A, weightBps: 'x', addr: LIVE }), null);
  assert.equal(buildVoteTx({ gauge: GAUGE_A, weightBps: 100, addr: { GaugeController: '0x' + '00'.repeat(20) } }), null);
});

// ── projectLock reuses kula-farm ────────────────────────────────────────────────────────────────────
test('projectLock reuses kula-farm veBoost/veVoteWeight', () => {
  const p = projectLock({ amount: 1000, lockWeeks: 208 });
  assert.equal(p.boost, veBoost({ lockWeeks: 208 }));
  assert.equal(p.voteWeight, veVoteWeight({ amount: 1000, lockWeeks: 208 }));
  assert.equal(p.boost, 2.5); // 4yr max lock → full 2.5x
});

test('projectLock with emission produces an emission split and a boosted APR', () => {
  const p = projectLock({ amount: 1000, lockWeeks: 104, emission: 1_000_000, poolTvlUsd: 120_000, kulaPriceUsd: 0.1 });
  assert.ok(p.emissionSplit && typeof p.emissionSplit.stakers === 'number');
  assert.ok(p.baseAprPct >= 0);
  assert.equal(p.boostedAprPct, +(p.baseAprPct * p.boost).toFixed(4));
  assert.ok(p.boostedAprPct >= p.baseAprPct);
});

test('projectLock with an explicit baseAprPct scales it by the boost', () => {
  const p = projectLock({ amount: 100, lockWeeks: 208, baseAprPct: 40 });
  assert.equal(p.boostedAprPct, +(40 * 2.5).toFixed(4)); // 100
});

// ── esc / utils / never-throws ──────────────────────────────────────────────────────────────────────
test('esc escapes XSS-significant characters', () => {
  assert.equal(esc(`<script>"&'`), '&lt;script&gt;&quot;&amp;&#39;');
  assert.equal(esc(null), '');
});

test('toBig parses hex + decimal, rejects junk/negatives', () => {
  assert.equal(toBig('0x1a751'), 108369n);
  assert.equal(toBig('42'), 42n);
  assert.equal(toBig(-1), null);
  assert.equal(toBig('0x'), null);
  assert.equal(toBig('nope'), null);
});

test('reads never throw even with a fetch that rejects', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  assert.equal(await veBalanceOf({ account: '0x' + '99'.repeat(20), rpcUrl: 'http://x', addr: LIVE }), null);
  assert.deepEqual(await gaugeWeights({ rpcUrl: 'http://x', gauges: [GAUGE_A], addr: LIVE }), []);
  __setFetch(null);
});

test('manifest reports resolved addresses + the never-holds-keys boundary', () => {
  const m = manifest(LIVE);
  assert.equal(m.voteEscrow, LIVE.VoteEscrow);
  assert.equal(m.gaugeController, LIVE.GaugeController);
  assert.equal(m.live, true);
  assert.match(m.boundary, /Never holds keys/);
});
