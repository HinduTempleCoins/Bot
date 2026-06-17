// sprana-staking.mjs — off-chain helper for the PRANA DAO vote token sPRANA (StakedPRANA.sol) and the
// HathorFloorDistributor. Stake native PRANA 1:1 → sPRANA (the ERC20Votes weight); unstake = requestWithdraw
// (burns vote weight NOW) → claim after a 30-DAY cooldown. The Hathor pool-emission floor is 3% and the DAO
// can only RAISE it (never cut). Operator spec 2026-06-17.
//
// PURE tx-descriptor builders (Akasha/MetaMask SIGNS) + a live eth_call reader + the Hathor-split preview
// math (mirrors the contract). House style: ESM .mjs, BigInt, soft-fail-never-throw, injectable fetch, esc().

let _fetch = (typeof fetch !== 'undefined') ? fetch : null;
export function __setFetch(fn) { _fetch = fn || ((typeof fetch !== 'undefined') ? fetch : null); }

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const WITHDRAW_COOLDOWN_DAYS = 30;
export const BPS = 10000n;
export const MIN_HATHOR_BPS = 300n; // the immutable 3% floor

// PRANA addresses — DEPLOYED 2026-06-17 (PR #1 merged → deployed live on PRANA alpha). Overridable via env/host.
export const ADDR = Object.freeze({
  sPRANA: '0xD5ac451B0c50B9476107823Af206eD814a2e2580',
  hathorDistributor: '0xc96304e3c037f81dA488ed9dEa1D8F2a48278a75',
  governor: '0xF8e31cb472bc70500f08Cd84917E5A1912Ec8397',
  timelock: '0xc0F115A19107322cFBf1cDBC7ea011C19EbDB4F8',
});

export const SEL = Object.freeze({
  stake: '0x3a4b66f1',           // stake()  (payable)
  requestWithdraw: '0x745400c9', // requestWithdraw(uint256)
  claim: '0x4e71d92d',           // claim()
  balanceOf: '0x70a08231',
  getVotes: '0x9ab24eb0',
  delegates: '0x587cde1e',
  claimableOf: '0x8903ab9d',
  hathorBps: '0x52e794c5',
  previewSplit: '0x13a6c05f',
  setHathorShare: '0xb09f2873',
});

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';
export function isAddress(a) { return typeof a === 'string' && ADDR_RE.test(a); }
/** A real, deployed address: well-formed AND non-zero (the zero default = "not deployed yet"). */
export function isLiveAddr(a) { return isAddress(a) && a.toLowerCase() !== ZERO; }
export function toBig(v) {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? BigInt(v) : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^0x[0-9a-fA-F]+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  if (/^\d+$/.test(s)) { try { return BigInt(s); } catch { return null; } }
  return null;
}
const pad32 = (b) => b.toString(16).padStart(64, '0');
const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
function uintArg(v) { const b = toBig(v); return b == null ? null : pad32(b); }

// ── unsigned tx descriptors (the wallet signs) ──────────────────────────────────────────────────────────
/** Stake native PRANA → mint sPRANA 1:1. value = the PRANA (wei) to stake. */
export function buildStakeTx(amountWei, addr = ADDR) {
  const b = toBig(amountWei); if (b == null || b <= 0n) return null;
  return { to: addr.sPRANA, data: SEL.stake, value: '0x' + b.toString(16) };
}
/** Begin unstaking `amount` sPRANA (burns vote weight now; claim after the cooldown). */
export function buildRequestWithdrawTx(amount, addr = ADDR) {
  const a = uintArg(amount); if (a == null) return null;
  return { to: addr.sPRANA, data: SEL.requestWithdraw + a, value: '0x0' };
}
/** Claim all matured unbondings (native PRANA back). */
export function buildClaimTx(addr = ADDR) {
  return { to: addr.sPRANA, data: SEL.claim, value: '0x0' };
}
/** DAO-only: set Hathor's pool-emission share (bps). Refuses < 300 (the floor) or > 10000 client-side. */
export function buildSetHathorShareTx(bps, addr = ADDR) {
  const b = toBig(bps);
  if (b == null || b < MIN_HATHOR_BPS || b > BPS) return null; // mirror the on-chain guard
  return { to: addr.hathorDistributor, data: SEL.setHathorShare + pad32(b), value: '0x0' };
}

// ── pure math (mirror the contracts) ────────────────────────────────────────────────────────────────────
/** previewSplit: toHathor = amount × bps / 10000, toDao = remainder. Clamps bps to [300, 10000]. */
export function previewHathorSplit(amount, hathorBps) {
  const amt = toBig(amount); let bps = toBig(hathorBps);
  if (amt == null || bps == null) return null;
  if (bps < MIN_HATHOR_BPS) bps = MIN_HATHOR_BPS; // the floor can never be undercut
  if (bps > BPS) bps = BPS;
  const toHathor = (amt * bps) / BPS;
  return { toHathor: toHathor.toString(), toDao: (amt - toHathor).toString(), hathorBps: Number(bps) };
}

/** Whether a proposed Hathor share is valid under the immutable floor (DAO can only set within [3%,100%]). */
export function isValidHathorShare(bps) {
  const b = toBig(bps);
  return b != null && b >= MIN_HATHOR_BPS && b <= BPS;
}

/** Seconds left on an unbonding given its releaseAt (sec) and now (sec). 0 = claimable. */
export function cooldownRemaining(releaseAt, nowSec) {
  const r = toBig(releaseAt), n = toBig(nowSec);
  if (r == null || n == null) return null;
  return r > n ? Number(r - n) : 0;
}

// ── live state reader ───────────────────────────────────────────────────────────────────────────────────
export function loadConfig(env = (typeof process !== 'undefined' ? process.env : {})) {
  return Object.freeze({
    pranaRpc: env.PRANA_RPC_URL || 'https://rpc.prana.alpha.melek.salon',
    addr: Object.freeze({
      sPRANA: env.SPRANA_ADDRESS || ADDR.sPRANA,
      hathorDistributor: env.HATHOR_DISTRIBUTOR_ADDRESS || ADDR.hathorDistributor,
    }),
  });
}

async function ethCall(rpc, to, data) {
  if (!_fetch) throw new Error('no-fetch');
  const res = await _fetch(rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'eth_call-error');
  return j.result;
}

/** Read a user's sPRANA position (staked balance, votes, claimable) + the live Hathor share. Soft-fails. */
export async function fetchState(cfg, user) {
  const { addr } = cfg;
  if (!isLiveAddr(addr.sPRANA)) return { ok: false, reason: 'sprana-not-deployed' };
  try {
    const out = { ok: true };
    if (isAddress(user)) {
      const [bal, votes, claimable] = await Promise.all([
        ethCall(cfg.pranaRpc, addr.sPRANA, SEL.balanceOf + padAddr(user)),
        ethCall(cfg.pranaRpc, addr.sPRANA, SEL.getVotes + padAddr(user)),
        ethCall(cfg.pranaRpc, addr.sPRANA, SEL.claimableOf + padAddr(user)),
      ]);
      out.staked = (toBig(bal) ?? 0n).toString();
      out.votes = (toBig(votes) ?? 0n).toString();
      out.claimable = (toBig(claimable) ?? 0n).toString();
    }
    if (isLiveAddr(addr.hathorDistributor)) {
      const bps = await ethCall(cfg.pranaRpc, addr.hathorDistributor, SEL.hathorBps);
      out.hathorBps = Number(toBig(bps) ?? MIN_HATHOR_BPS);
    }
    return out;
  } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
}

export function manifest() {
  return {
    role: 'PRANA DAO vote token (sPRANA) + Hathor-floor distributor helper',
    cooldownDays: WITHDRAW_COOLDOWN_DAYS,
    hathorFloorBps: Number(MIN_HATHOR_BPS),
    boundary: 'builds UNSIGNED tx descriptors; Akasha/MetaMask SIGNS. Never holds keys.',
    env: { sPRANA: 'SPRANA_ADDRESS', hathorDistributor: 'HATHOR_DISTRIBUTOR_ADDRESS', rpc: 'PRANA_RPC_URL' },
  };
}
