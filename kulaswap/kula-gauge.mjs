// kula-gauge.mjs — LIVE wiring for the KULA gauge-vote + veKULA lock UI. This is the on-chain adapter
// that the off-chain farm MODEL (kula-farm.mjs) has been missing: it reads the deployed VoteEscrow
// (veKULA voting power) + GaugeController (per-gauge emission weights) via eth_call, and builds the
// UNSIGNED lock / vote tx descriptors the wallet (Akasha / MELEK-Signer) signs. We NEVER sign or hold
// keys — we only describe the call, exactly like kula-cdp.mjs / sprana-staking.mjs.
//
//   reads:   veBalanceOf (VoteEscrow.balanceOf + locked)  ·  gaugeWeights (GaugeController weights)
//   builds:  buildLockTx (create_lock / increase_amount)  ·  buildVoteTx (vote_for_gauge_weights)
//   preview: projectLock — reuses kula-farm veBoost/veVoteWeight/emissionSplit for the projected boost/APR
//
// House style: ESM .mjs, injectable fetch (__setFetch), soft-fail-never-throw (reads → null/[]), esc()
// all interpolation, no network in tests, no deps. Selectors are precomputed keccak256(sig)[:4] of the
// canonical Curve VotingEscrow / GaugeController ABI (balanceOf = 0x70a08231 confirms the derivation).
//
// ── Addresses (read from config, NEVER hardcoded here) ────────────────────────────────────────────
// The shared map kula-config-addresses.mjs ships NO dedicated VoteEscrow / GaugeController keys yet —
// like `marketAltiVault`, the ve-lock + gauge contracts are not deployed under those names. The NutBox
// `DelegationMint` contract (0x1429859428C0aBc9C2C47C8Ee9FBaf82cFA0F20f) is the deployed stake-lock +
// emission-direction contract that plays the ve + gauge role on the current PRANA testnet, so we resolve
// explicit keys FIRST (VoteEscrow / GaugeController — an operator wires the real deploys via
// window.__KULA_ADDR__), then fall back to DelegationMint, then the zero address. A zero/undeployed
// address = "not live": the reads soft-fail to null/[] and the builders return null (mirrors altiMarketLive).

import { ADDR } from './kula-config-addresses.mjs';
import { veBoost, veVoteWeight, emissionSplit, poolApr, DEFAULT_SPLIT } from './kula-farm.mjs';

// ── injectable fetch (offline tests) ──────────────────────────────────────────────────────────────
let _fetch = (typeof fetch !== 'undefined') ? fetch : null;
export function __setFetch(fn) { _fetch = fn || ((typeof fetch !== 'undefined') ? fetch : null); }

// ── esc / small utils ─────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const Z = '0x0000000000000000000000000000000000000000';
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
export const CHAIN_ID = 108369; // PRANA testnet
export const WAD = 10n ** 18n;  // Curve gauge weights are 1e18-scaled fractions (1e18 = 100%)

export function isAddress(a) { return typeof a === 'string' && ADDR_RE.test(a); }
/** Real, deployed address: well-formed AND non-zero (the zero default = "not deployed yet"). */
export function isLiveAddr(a) { return isAddress(a) && a.toLowerCase() !== Z; }

/** Parse hex ('0x…') or decimal string / number / BigInt → BigInt, or null on bad input. */
export function toBig(v) {
  if (typeof v === 'bigint') return v >= 0n ? v : null;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^0x[0-9a-fA-F]*$/.test(s)) { const h = s.slice(2); if (!h) return null; try { return BigInt(s); } catch { return null; } }
  if (/^\d+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  return null;
}
const pad32 = (b) => b.toString(16).padStart(64, '0');
const padAddr = (a) => String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0');

// ── function selectors — precomputed keccak256(signature)[:4] (Curve VotingEscrow / GaugeController) ──
export const SEL = Object.freeze({
  // VoteEscrow (veKULA)
  balanceOf: '0x70a08231',            // balanceOf(address)                 — current (decaying) voting power
  locked: '0xcbf9fe5f',               // locked(address)                    — (int128 amount, uint256 end)
  create_lock: '0x65fc3873',          // create_lock(uint256,uint256)       — lock amount until unlockTime
  increase_amount: '0x4957677c',      // increase_amount(uint256)           — add to an existing lock
  increase_unlock_time: '0xeff7a612', // increase_unlock_time(uint256)
  // GaugeController
  gauge_relative_weight: '0x6207d866', // gauge_relative_weight(address)     — 1e18-scaled fraction
  gauges: '0xb0539187',                // gauges(uint256)                    — enumerate gauge addresses
  n_gauges: '0xe93841d0',              // n_gauges()                         — gauge count
  vote_for_gauge_weights: '0xd7136328',// vote_for_gauge_weights(address,uint256) — user weight in bps
});

// ── address resolution (from config; overridable; zero = not live) ──────────────────────────────────
export function voteEscrowAddr(addr = ADDR) {
  return addr.VoteEscrow || addr.veKULA || addr.veEscrow || addr.DelegationMint || Z;
}
export function gaugeControllerAddr(addr = ADDR) {
  return addr.GaugeController || addr.gaugeController || addr.DelegationMint || Z;
}
/** True only once a real, non-zero VoteEscrow + GaugeController are wired in (mirrors altiMarketLive). */
export function gaugeLive(addr = ADDR) {
  return isLiveAddr(voteEscrowAddr(addr)) && isLiveAddr(gaugeControllerAddr(addr));
}

const DEFAULT_RPC = (typeof process !== 'undefined' && process.env && process.env.PRANA_RPC_URL)
  || 'https://rpc.prana.alpha.melek.salon';

/** Single eth_call. Soft-fails to null (never throws) on any network/RPC/JSON error. */
async function ethCall(rpcUrl, to, data) {
  if (!_fetch || !isAddress(to)) return null;
  try {
    const res = await _fetch(rpcUrl || DEFAULT_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
    });
    if (!res || typeof res.json !== 'function') return null;
    const j = await res.json();
    if (!j || j.error || j.result == null) return null;
    return j.result;
  } catch { return null; }
}

// ── READS ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Read a user's veKULA voting power from the VoteEscrow: balanceOf (current decaying power) + locked
 * (amount + unlock end). Soft-fails to null when the account is bad, the contract isn't live, or the RPC
 * returns nothing. Returns { account, veEscrow, veKula, lockedAmount, unlockTime }.
 */
export async function veBalanceOf({ account, rpcUrl, addr = ADDR } = {}) {
  if (!isAddress(account)) return null;
  const ve = voteEscrowAddr(addr);
  if (!isLiveAddr(ve)) return null;
  const balRaw = await ethCall(rpcUrl, ve, SEL.balanceOf + padAddr(account));
  const bal = toBig(balRaw);
  if (bal == null) return null;

  let lockedAmount = null; let unlockTime = null;
  const lockedRaw = await ethCall(rpcUrl, ve, SEL.locked + padAddr(account));
  if (typeof lockedRaw === 'string') {
    const body = lockedRaw.replace(/^0x/, '');
    if (body.length >= 128) {
      lockedAmount = toBig('0x' + body.slice(0, 64));   // int128 amount (positive → clean uint word)
      const end = toBig('0x' + body.slice(64, 128));    // uint256 unlock end (unix seconds)
      unlockTime = end == null ? null : Number(end);
    }
  }
  return {
    account, veEscrow: ve,
    veKula: bal.toString(),
    lockedAmount: lockedAmount == null ? null : lockedAmount.toString(),
    unlockTime,
  };
}

/**
 * Read GaugeController per-gauge relative weights. Pass an explicit `gauges` address list, or omit it to
 * discover them on-chain via n_gauges() + gauges(i) (capped at 100). Each weight is the Curve 1e18-scaled
 * fraction; we also surface bps (0..10000) + pct for the UI. Soft-fails to [] on any bad/empty read.
 */
export async function gaugeWeights({ rpcUrl, gauges, addr = ADDR } = {}) {
  const gc = gaugeControllerAddr(addr);
  if (!isLiveAddr(gc)) return [];

  let list = Array.isArray(gauges) ? gauges.filter(isAddress) : null;
  if (!list) {
    const n = toBig(await ethCall(rpcUrl, gc, SEL.n_gauges));
    if (n == null || n <= 0n) return [];
    const count = Number(n > 100n ? 100n : n);
    list = [];
    for (let i = 0; i < count; i++) {
      const raw = await ethCall(rpcUrl, gc, SEL.gauges + pad32(BigInt(i)));
      if (typeof raw === 'string') {
        const g = '0x' + raw.replace(/^0x/, '').slice(-40);
        if (isAddress(g) && isLiveAddr(g)) list.push(g);
      }
    }
  }

  const out = [];
  for (const g of list) {
    const w = toBig(await ethCall(rpcUrl, gc, SEL.gauge_relative_weight + padAddr(g)));
    if (w == null) continue;
    const bps = Number((w * 10000n) / WAD);
    out.push({ gauge: g, weight: w.toString(), bps, pct: +(bps / 100).toFixed(2) });
  }
  return out;
}

// ── BUILDERS (UNSIGNED — the wallet signs; we never hold keys) ────────────────────────────────────────

/** Assemble a tx descriptor. value defaults to '0x0' — ve/gauge ops move no native PRANA. */
function descriptor(to, selector, body, method) {
  return { to: String(to || ''), data: selector + body, value: '0x0', method, chainId: CHAIN_ID };
}

/**
 * UNSIGNED tx to lock KULA for veKULA. With `unlockTime` (unix seconds) → VoteEscrow.create_lock(amount,
 * unlockTime) (a NEW lock). Without it → increase_amount(amount) (top up an existing lock). `amount` is
 * KULA in BASE UNITS (wei-scale) — the wallet/caller scales human → base. Requires a prior ERC20 approve of
 * the VoteEscrow to pull KULA (buildApproveTx in kula-cdp.mjs). Returns null on bad input / undeployed ve.
 */
export function buildLockTx({ amount, unlockTime, addr = ADDR } = {}) {
  const ve = voteEscrowAddr(addr);
  const amt = toBig(amount);
  if (!isLiveAddr(ve) || amt == null || amt <= 0n) return null;
  const ut = toBig(unlockTime);
  if (ut != null && ut > 0n) {
    return descriptor(ve, SEL.create_lock, pad32(amt) + pad32(ut), 'create_lock');
  }
  return descriptor(ve, SEL.increase_amount, pad32(amt), 'increase_amount');
}

/**
 * UNSIGNED tx to vote your veKULA weight onto a gauge: GaugeController.vote_for_gauge_weights(gauge,
 * weightBps). `weightBps` is the user power fraction in bps (0..10000; Curve caps a user's total at 10000
 * across gauges). Returns null on a bad gauge / undeployed controller.
 */
export function buildVoteTx({ gauge, weightBps, addr = ADDR } = {}) {
  const gc = gaugeControllerAddr(addr);
  if (!isLiveAddr(gc) || !isAddress(gauge)) return null;
  let bps = toBig(weightBps);
  if (bps == null) return null;
  if (bps > 10000n) bps = 10000n; // mirror the on-chain per-user cap
  return descriptor(gc, SEL.vote_for_gauge_weights, padAddr(gauge) + pad32(bps), 'vote_for_gauge_weights');
}

// ── PREVIEW — reuse the kula-farm MODEL so the UI's projection matches the chain ──────────────────────

/**
 * Project what a given lock yields, reusing the kula-farm model: veBoost (reward multiplier), veVoteWeight
 * (gauge vote power), and — when an epoch `emission` (± base pool APR) is supplied — the emissionSplit +
 * the boosted staker APR. Pure; soft-fails to safe numbers. This is the same math the on-chain
 * VoteEscrow/GaugeController enforce, so the preview and the settled result agree.
 */
export function projectLock({
  amount = 0, lockWeeks = 0, maxWeeks = 208, maxBoost = 2.5,
  emission, split, baseAprPct, poolTvlUsd, kulaPriceUsd,
} = {}) {
  const boost = veBoost({ lockWeeks, maxWeeks, maxBoost });
  const voteWeight = veVoteWeight({ amount, lockWeeks, maxWeeks });
  const out = {
    amount: +amount || 0, lockWeeks: +lockWeeks || 0, maxWeeks, boost, voteWeight,
  };
  if (emission != null) {
    const per = emissionSplit({ emission, split: split || DEFAULT_SPLIT });
    out.emissionSplit = per;
    // Boosted staker APR: the staker-surface emission to this TVL × the lock boost (illustrative preview).
    if (poolTvlUsd != null && kulaPriceUsd != null) {
      const base = poolApr({ yearlyEmissionToPool: per.stakers || 0, kulaPriceUsd, poolTvlUsd });
      out.baseAprPct = base;
      out.boostedAprPct = +(base * boost).toFixed(4);
    }
  }
  if (baseAprPct != null) {
    out.baseAprPct = +baseAprPct || 0;
    out.boostedAprPct = +((+baseAprPct || 0) * boost).toFixed(4);
  }
  return out;
}

/** Manifest for callers/health surfaces — what this adapter is + the addresses it resolved. */
export function manifest(addr = ADDR) {
  return {
    role: 'KULA gauge-vote + veKULA lock adapter (reads VoteEscrow/GaugeController, builds unsigned tx)',
    chainId: CHAIN_ID,
    voteEscrow: voteEscrowAddr(addr),
    gaugeController: gaugeControllerAddr(addr),
    live: gaugeLive(addr),
    boundary: 'builds UNSIGNED tx descriptors; the wallet (Akasha / MELEK-Signer) SIGNS. Never holds keys.',
    note: 'VoteEscrow/GaugeController resolve from kula-config-addresses.mjs (explicit key → DelegationMint → zero). Zero = not live.',
  };
}

// CLI demo (guarded) — worked lock + vote descriptors + a projection from the model.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('kula-gauge.mjs')) {
  console.log('resolved addresses:', manifest());
  const oneYear = Math.floor(Date.now() / 1000) + 52 * 7 * 86400;
  console.log('lock tx (create_lock 1000 KULA, 1yr):',
    buildLockTx({ amount: '1000000000000000000000', unlockTime: oneYear }));
  console.log('vote tx (5000 bps to a gauge):',
    buildVoteTx({ gauge: '0x' + '11'.repeat(20), weightBps: 5000 }));
  console.log('projection (1000 KULA, 4yr lock):',
    projectLock({ amount: 1000, lockWeeks: 208, emission: 1_000_000, poolTvlUsd: 120_000, kulaPriceUsd: 0.1 }));
}
