// recovery.mjs — Steem-style ACCOUNT RECOVERY (Option A) for the MELEK TESTNET, with `hathor`
// as the recovery helper for signup-created accounts.
//
// PURPOSE
//   Builds the three standard Graphene account-recovery ops so a user who has lost (or had stolen)
//   their owner key can regain control of an account whose `recovery_account` is `hathor`:
//
//     1) request_account_recovery  — signed by the RECOVERY ACCOUNT (`hathor`). Names the
//        account_to_recover and the NEW owner authority the user wants to install. Opens the
//        recovery window (the chain's STEEM_OWNER_AUTH_RECOVERY_PERIOD).
//     2) recover_account           — signed by BOTH the new owner key AND a *recent* owner key
//        from the account's owner-auth history (the "recent_owner_authority"). This is what proves
//        the requester is the legitimate owner: hathor can only *propose* a new authority, it can
//        never seize the account, because recover_account requires a key the real owner once held.
//     3) change_recovery_account   — for an account that wants a DIFFERENT helper than the one it
//        was created with (e.g. a self-created account setting hathor, or moving away from hathor).
//        Takes effect only after STEEM_OWNER_AUTH_RECOVERY_PERIOD (the same 30-day mainnet window),
//        so a thief who steals the active key cannot instantly swap the recovery partner.
//
// KEY CUSTODY (BRIEF.md §7 / repo HARD RULE "Zero WIF"):
//   - This module NEVER holds a key and NEVER signs. It only BUILDS standard Graphene ops and hands
//     them to an INJECTED broadcaster. The broadcaster alone holds the signing capability:
//       * request_account_recovery / change_recovery_account → hathor's key, via MELEK-Signer OR,
//         on the testnet host only, a JIT-fetched testnet active key never written to disk and
//         never passing through this file (same precedent as the faucet / feed-publisher).
//       * recover_account → the USER's old+new owner keys, supplied by the user's client (signed
//         in the browser); the server never sees them.
//   - With NO broadcaster injected, the module can never broadcast, regardless of `live`. That is
//     the zero-WIF safety floor.
//   - It never accepts, requests, logs, or prints any private key. Authorities carry PUBLIC keys
//     only; private-key-shaped input is rejected HARD by the custody guard.
//
// TESTNET SAFETY
//   Authority public keys must carry the testnet prefix TST. The module refuses to build an op
//   whose authority keys are not TST-prefixed — it must NEVER be pointed at mainnet.
//
// Everything is injectable so the tests run fully offline (no network):
//   import {
//     buildRecoveryRequest, buildRecoverAccount, buildChangeRecoveryAccount,
//     runRecovery, RECOVERY_ACCOUNT, __setBroadcaster,
//   } from './recovery.mjs'
//   node signup/recovery.mjs --status

import {
  rejectIfPrivateKey,
  looksLikePublicKey,
  validAccountName,
} from './account-create.mjs';

// ── config ───────────────────────────────────────────────────────────────────────
export const RECOVERY_ACCOUNT = 'hathor'; // the recovery helper for signup-created accounts
export const PREFIX = 'TST'; // testnet address prefix; mainnet would be MEL

// Chain recovery timings. On THIS testnet the chain reports (get_config, microseconds):
//   STEEM_OWNER_AUTH_RECOVERY_PERIOD                 = 60_000_000 µs = 60 s  (testnet, compressed)
//   STEEM_ACCOUNT_RECOVERY_REQUEST_EXPIRATION_PERIOD = 12_000_000 µs = 12 s  (testnet, compressed)
// Mainnet Steem defaults (for documentation): RECOVERY_PERIOD = 30 days, REQUEST_EXPIRATION = 24 h.
// These are informational constants only — the chain enforces the real values; we never gate on them.
export const TESTNET_RECOVERY_PERIOD_S = 60;
export const TESTNET_REQUEST_EXPIRATION_S = 12;

// ── injectable broadcaster seam ─────────────────────────────────────────────────
// Default broadcaster: NONE. Without one injected the module cannot broadcast (zero-WIF floor).
let _broadcaster = null;
/** Inject the broadcaster: async (op) => result. It alone holds the signing capability. */
export function __setBroadcaster(fn) { _broadcaster = typeof fn === 'function' ? fn : null; }

// ── authority validation ─────────────────────────────────────────────────────────
// A Graphene authority is { weight_threshold, account_auths: [[name,w]...], key_auths: [[pub,w]...] }.
// For recovery we require a simple single-key owner authority shape (the common signup case): exactly
// one PUBLIC key, weight covering the threshold, no account_auths. Private-key-shaped input is
// rejected HARD. Returns { ok } or { ok:false, reason }.
export function validateOwnerAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    return { ok: false, reason: 'authority-not-object' };
  }
  const { weight_threshold, account_auths, key_auths } = authority;
  if (!Number.isInteger(weight_threshold) || weight_threshold < 1) {
    return { ok: false, reason: 'bad-weight-threshold' };
  }
  if (!Array.isArray(account_auths) || account_auths.length !== 0) {
    return { ok: false, reason: 'account-auths-not-supported' };
  }
  if (!Array.isArray(key_auths) || key_auths.length < 1) {
    return { ok: false, reason: 'no-key-auths' };
  }
  let totalWeight = 0;
  for (const entry of key_auths) {
    if (!Array.isArray(entry) || entry.length !== 2) return { ok: false, reason: 'bad-key-auth-entry' };
    const [pub, weight] = entry;
    // custody guard: reject anything private-key-shaped HARD.
    try { rejectIfPrivateKey(pub); }
    catch { return { ok: false, reason: 'private-key-rejected' }; }
    if (!looksLikePublicKey(pub)) return { ok: false, reason: 'invalid-public-key' };
    if (!pub.startsWith(PREFIX)) return { ok: false, reason: 'wrong-prefix' };
    if (!Number.isInteger(weight) || weight < 1) return { ok: false, reason: 'bad-key-weight' };
    totalWeight += weight;
  }
  if (totalWeight < weight_threshold) return { ok: false, reason: 'weights-below-threshold' };
  return { ok: true };
}

/** Convenience: build a single-key owner authority from one PUBLIC key. Throws on a private key. */
export function ownerAuthorityFromKey(pub) {
  rejectIfPrivateKey(pub); // hard reject on any WIF / private-key shape
  if (!looksLikePublicKey(pub)) throw new Error('ownerAuthorityFromKey: not a public key');
  if (!pub.startsWith(PREFIX)) throw new Error('ownerAuthorityFromKey: wrong prefix (testnet TST only)');
  return { weight_threshold: 1, account_auths: [], key_auths: [[pub, 1]] };
}

// ── op builders (pure; never broadcast, never sign) ──────────────────────────────

/**
 * request_account_recovery — signed later by the RECOVERY ACCOUNT (hathor).
 * Opens the recovery window with the user's desired NEW owner authority.
 * Returns { ok, op? , reason? }. Never throws.
 *
 * @param {string} accountToRecover  the account whose owner key was lost/stolen
 * @param {object} newOwnerAuthority a Graphene owner authority (PUBLIC keys only)
 * @param {{ recoveryAccount?: string }} opts
 */
export function buildRecoveryRequest(accountToRecover, newOwnerAuthority, { recoveryAccount = RECOVERY_ACCOUNT } = {}) {
  if (!validAccountName(accountToRecover)) return { ok: false, reason: 'invalid-account-name' };
  if (!validAccountName(recoveryAccount)) return { ok: false, reason: 'invalid-recovery-account' };
  const v = validateOwnerAuthority(newOwnerAuthority);
  if (!v.ok) return { ok: false, reason: `bad-new-owner:${v.reason}` };

  const op = ['request_account_recovery', {
    recovery_account: recoveryAccount,
    account_to_recover: accountToRecover,
    new_owner_authority: newOwnerAuthority,
    extensions: [],
  }];
  return { ok: true, op };
}

/**
 * recover_account — signed later by BOTH the new owner key AND a recent owner key.
 * Must match an open request_account_recovery for the same new_owner_authority.
 * Returns { ok, op? , reason? }. Never throws.
 *
 * @param {string} accountToRecover
 * @param {object} newOwnerAuthority    must equal the authority named in the open request
 * @param {object} recentOwnerAuthority a recent (e.g. pre-theft) owner authority from history
 */
export function buildRecoverAccount(accountToRecover, newOwnerAuthority, recentOwnerAuthority) {
  if (!validAccountName(accountToRecover)) return { ok: false, reason: 'invalid-account-name' };
  const nv = validateOwnerAuthority(newOwnerAuthority);
  if (!nv.ok) return { ok: false, reason: `bad-new-owner:${nv.reason}` };
  const rv = validateOwnerAuthority(recentOwnerAuthority);
  if (!rv.ok) return { ok: false, reason: `bad-recent-owner:${rv.reason}` };

  const op = ['recover_account', {
    account_to_recover: accountToRecover,
    new_owner_authority: newOwnerAuthority,
    recent_owner_authority: recentOwnerAuthority,
    extensions: [],
  }];
  return { ok: true, op };
}

/**
 * change_recovery_account — for an account choosing a different recovery helper. Takes effect only
 * after STEEM_OWNER_AUTH_RECOVERY_PERIOD. Signed by the account's OWNER key.
 * Returns { ok, op? , reason? }. Never throws.
 *
 * @param {string} accountToRecover  the account whose recovery partner is changing
 * @param {string} newRecoveryAccount the new helper account name
 */
export function buildChangeRecoveryAccount(accountToRecover, newRecoveryAccount) {
  if (!validAccountName(accountToRecover)) return { ok: false, reason: 'invalid-account-name' };
  if (!validAccountName(newRecoveryAccount)) return { ok: false, reason: 'invalid-new-recovery-account' };
  if (accountToRecover === newRecoveryAccount) return { ok: false, reason: 'recovery-account-equals-self' };

  const op = ['change_recovery_account', {
    account_to_recover: accountToRecover,
    new_recovery_account: newRecoveryAccount,
    extensions: [],
  }];
  return { ok: true, op };
}

// ── broadcast wrapper (DRY-RUN by default; broadcaster holds the signing capability) ──
/**
 * Hand a built op to the injected broadcaster — ONLY when live AND a broadcaster is present.
 * Otherwise DRY-RUN: returns the op unbroadcast. Never throws; never logs/returns a key.
 *
 * @param {Array} op  a built op from one of the builders above (or { ok, op } / { ok:false, reason })
 * @param {{ live?: boolean, broadcaster?: function }} opts
 */
export async function runRecovery(op, { live = false, broadcaster } = {}) {
  // accept either a raw op array or a builder result { ok, op?, reason? }
  let theOp = op;
  if (op && !Array.isArray(op) && typeof op === 'object') {
    if (op.ok === false) return { ok: false, reason: op.reason || 'build-failed' };
    theOp = op.op;
  }
  if (!Array.isArray(theOp) || theOp.length !== 2) return { ok: false, reason: 'invalid-op' };

  const bc = typeof broadcaster === 'function' ? broadcaster : _broadcaster;
  const dryRun = !live || typeof bc !== 'function';
  if (dryRun) return { ok: true, dryRun: true, op: theOp };

  try {
    const result = await bc(theOp);
    return { ok: true, dryRun: false, op: theOp, id: idOf(result), result };
  } catch (err) {
    return { ok: false, dryRun: false, op: theOp, reason: `broadcast-failed:${msg(err)}` };
  }
}

function idOf(r) {
  if (!r) return null;
  return r.id || r.trx_id || r.tx_id || (typeof r === 'string' ? r : null);
}
function msg(e) { return String((e && e.message) || e || 'error').slice(0, 200); }

// ── CLI (guarded; booleans/shape only, NEVER secrets/keys) ──────────────────────────
if (process.argv[1] && process.argv[1].endsWith('recovery.mjs')) {
  const arg = process.argv[2] || '--status';
  if (arg === '--status') {
    console.log('recovery — Steem-style account recovery (Option A) for the MELEK TESTNET:');
    console.log(`  recovery helper: ${RECOVERY_ACCOUNT} (for signup-created accounts)`);
    console.log('  ops: request_account_recovery / recover_account / change_recovery_account (standard Graphene)');
    console.log(`  testnet recovery window: ${TESTNET_RECOVERY_PERIOD_S}s (mainnet default: 30 days)`);
    console.log(`  testnet request expiry:  ${TESTNET_REQUEST_EXPIRATION_S}s (mainnet default: 24 h)`);
    console.log('  custody: PUBLIC keys only; private keys rejected; NO local WIF; broadcaster signs.');
    console.log('  default mode: DRY-RUN (broadcasts only when live AND a broadcaster is injected).');
  } else if (arg === '--sample') {
    const newOwner = { weight_threshold: 1, account_auths: [], key_auths: [['TST5sample0000000000000000000000000000000000000', 1]] };
    const recentOwner = { weight_threshold: 1, account_auths: [], key_auths: [['TST6old00000000000000000000000000000000000000000', 1]] };
    const req = buildRecoveryRequest('faucet-test-1', newOwner);
    const rec = buildRecoverAccount('faucet-test-1', newOwner, recentOwner);
    const chg = buildChangeRecoveryAccount('faucet-test-1', 'hathor');
    console.log(JSON.stringify({ request: req, recover: rec, change: chg }, null, 2));
  } else {
    console.log('usage: node signup/recovery.mjs [--status|--sample]');
  }
}
