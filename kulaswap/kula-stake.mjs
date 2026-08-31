// kula-stake.mjs — the STAKE tab: lock KULA → veKULA (VoteEscrow) for boost + gauge votes.
//
// The Stake surface of KulaSwap. VoteEscrow is the veCRV-style lock the Farm tab already boosts against
// (kula-farm.mjs veBoost). This module is the OFF-CHAIN math + UNSIGNED tx-descriptor builder for the
// on-chain VoteEscrow at MAINNET_ADDR.veKULA (verified 2026-08-31: token()==KULA, maxLock()==4y):
//   1. lock(amount, duration)   — first lock: pull KULA, set an end = now + duration (<= maxLock)
//   2. increaseAmount(amount)    — add KULA to an existing active lock (same end)
//   3. extendLock(newDuration)   — push the end further out (only extend)
//   4. withdraw()                — after the lock end, pull the principal back
// plus the ERC20 approve of the veKULA contract to pull KULA before lock/increaseAmount.
//
// House style: pure arithmetic, soft-fail to safe shapes, NEVER throws. No network, no deps. Mirrors
// kula-cdp.mjs exactly (same descriptor shape, same offline hand-encoding). We NEVER sign or broadcast —
// Akasha/MetaMask signs the descriptor. Selectors are the real keccak256 4-byte selectors of the
// VoteEscrow ABI (verified via ethers id() against the deployed source).

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

// VoteEscrow.maxLock() on mainnet = 126144000s = 1460 days = 4 years (veCRV-style ceiling).
export const VE_MAX_LOCK_SECONDS = 126144000;
export const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;

/** Current decaying voting weight, mirroring VoteEscrow.balanceOf: amount * timeRemaining / maxLock.
 *  Soft-fails to 0 (expired / no lock / bad input). `secondsRemaining` is end - now. */
export function veWeight({ amount, secondsRemaining, maxLockSeconds = VE_MAX_LOCK_SECONDS } = {}) {
  const a = nn(amount), rem = nn(secondsRemaining), max = nn(maxLockSeconds) || VE_MAX_LOCK_SECONDS;
  if (a <= 0 || rem <= 0) return 0;
  return round((a * Math.min(rem, max)) / max, 8);
}

/** Clamp a requested lock duration (seconds) to (0, maxLock]. Soft-fails to 0 (which the UI treats as
 *  "invalid — pick a duration"); the on-chain lock() reverts on 0 or > maxLock, so we mirror that. */
export function clampDuration(seconds, maxLockSeconds = VE_MAX_LOCK_SECONDS) {
  const s = nn(seconds), max = nn(maxLockSeconds) || VE_MAX_LOCK_SECONDS;
  if (s <= 0) return 0;
  return Math.min(s, max);
}

// ── ABI encoding (minimal, offline) — identical scheme to kula-cdp.mjs ────────────────────────────────
const SELECTORS = Object.freeze({
  lock:           '0x1338736f', // lock(uint256 amount, uint256 duration)
  increaseAmount: '0x15456eba', // increaseAmount(uint256 amount)
  extendLock:     '0x44ee3a1c', // extendLock(uint256 newDuration)
  withdraw:       '0x3ccfd60b', // withdraw()
  approve:        '0x095ea7b3', // approve(address,uint256) (ERC20 — approve veKULA to pull KULA)
});

function encUint(amount) {
  let v;
  try { v = BigInt(typeof amount === 'number' ? Math.trunc(amount) : (amount ?? 0)); }
  catch { v = 0n; }
  if (v < 0n) v = 0n;
  return v.toString(16).padStart(64, '0');
}

function encAddress(addr) {
  const s = String(addr || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(s)) return '0'.repeat(64);
  return s.padStart(64, '0');
}

/** Assemble a tx descriptor. value defaults to '0x0' — staking moves ERC20 KULA, never native PRANA.
 *  chainId defaults to PRANA mainnet (712217); pass another to target the testnet. */
function descriptor(to, selector, dataWords, label, chainId = 712217) {
  return {
    to: String(to || ''),
    data: selector + dataWords.join(''),
    value: '0x0',
    method: label,
    chainId,
  };
}

/** UNSIGNED first-lock: VoteEscrow.lock(amount, duration). `amount` is KULA in BASE UNITS; `duration`
 *  is seconds (clamped to maxLock). Requires a prior approve of veKULA to pull KULA (buildStakeApproveTx). */
export function buildLockTx({ veKula, amountBaseUnits, durationSeconds, maxLockSeconds = VE_MAX_LOCK_SECONDS, chainId } = {}) {
  const dur = clampDuration(durationSeconds, maxLockSeconds);
  return descriptor(veKula, SELECTORS.lock, [encUint(amountBaseUnits), encUint(dur)], 'lock', chainId);
}

/** UNSIGNED add-to-lock: VoteEscrow.increaseAmount(amount). Requires an active lock + a prior approve. */
export function buildIncreaseAmountTx({ veKula, amountBaseUnits, chainId } = {}) {
  return descriptor(veKula, SELECTORS.increaseAmount, [encUint(amountBaseUnits)], 'increaseAmount', chainId);
}

/** UNSIGNED extend: VoteEscrow.extendLock(newDuration). Only extends (on-chain requires newEnd > end). */
export function buildExtendLockTx({ veKula, newDurationSeconds, maxLockSeconds = VE_MAX_LOCK_SECONDS, chainId } = {}) {
  const dur = clampDuration(newDurationSeconds, maxLockSeconds);
  return descriptor(veKula, SELECTORS.extendLock, [encUint(dur)], 'extendLock', chainId);
}

/** UNSIGNED withdraw: VoteEscrow.withdraw() — pulls the principal back after the lock end. No args. */
export function buildWithdrawTx({ veKula, chainId } = {}) {
  return descriptor(veKula, SELECTORS.withdraw, [], 'withdraw', chainId);
}

/** UNSIGNED ERC20 approve so veKULA can pull the user's KULA: KULA.approve(veKula, amount). The `to` is
 *  the KULA token; the spender encoded in the data is the veKULA (VoteEscrow) contract. */
export function buildStakeApproveTx({ kula, veKula, amountBaseUnits, chainId } = {}) {
  return descriptor(kula, SELECTORS.approve, [encAddress(veKula), encUint(amountBaseUnits)], 'approve', chainId);
}

export const STAKE_SELECTORS = SELECTORS;

// CLI demo (guarded) — a worked lock example.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('kula-stake.mjs')) {
  const veKula = '0x2a9da080BB38C9cfc4B9c8D7cFd4699fF57a5438';
  const kula = '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631';
  const oneKula = '1000000000000000000';
  console.log('approve:', buildStakeApproveTx({ kula, veKula, amountBaseUnits: oneKula }));
  console.log('lock 1y:', buildLockTx({ veKula, amountBaseUnits: oneKula, durationSeconds: 365 * 86400 }));
  console.log('weight @ 1y of 4y max:', veWeight({ amount: 1, secondsRemaining: 365 * 86400 }));
}
