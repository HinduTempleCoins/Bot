// account-create.mjs — email-verified account-creation-with-delegation (Task #41).
//
// AFTER email verification (Task #40, integrations/email-verify.mjs), this PREPARES a Graphene
// `account_create_with_delegation` op (the `create_account_with_keys_delegated`-style op the
// GrapheneAdapter already builds in src/chain/graphene.js) and hands the PREPARED op to the
// signer. It never holds a key.
//
// KEY CUSTODY (BRIEF.md §7 + repo HARD RULE):
//   - The USER's private keys are generated client-side in the browser and NEVER sent to the
//     server. This module accepts ONLY the user's PUBLIC keys. It actively REJECTS anything that
//     looks like a WIF / private key (rejectIfPrivateKey) — the custody guard.
//   - There is NO local WIF anywhere here. The Witness's own active key lives ONLY in MELEK-Signer.
//     This module BUILDS the op and (when live) hands it to an injected broadcaster (the signer);
//     it never signs, never imports keys.js, never touches a PrivateKey.
//   - DRY-RUN by default: submit() returns the prepared op unless explicitly live AND given a
//     broadcaster.
//
// Injectable: verifier (consumes the verified-email token), broadcaster (the signer), clock.
//
//   import { prepareAccountCreation, submit, validAccountName, rejectIfPrivateKey } from './account-create.mjs'
//   node signup/account-create.mjs --status   # booleans only, never secrets/keys

import { verifyToken as defaultVerifyToken } from '../integrations/email-verify.mjs';

// ── injectable clock (deterministic, offline tests) ─────────────────────────────
const defaultProviders = { now: () => Date.now() };
let providers = { ...defaultProviders };
export function __setProviders(p = {}) { providers = { ...providers, ...p }; }
export function __resetProviders() { providers = { ...defaultProviders }; }

// ── config (the Witness account + funding defaults) ─────────────────────────────
// creator is the Witness account `hathor` (lowercase, BRIEF.md / CLAUDE.md). Delegation and the
// small liquid grant are configurable per call; defaults sit in the BRIEF.md §7 5–15 MP band as a
// placeholder VESTS figure — the exact split algorithm is operator logic computed elsewhere.
export const WITNESS_ACCOUNT = 'hathor';
export const DEFAULTS = Object.freeze({
  fee: '0.000 MELEK',
  delegation: '0.000000 VESTS', // placeholder; real MP split computed by operator software
  jsonMetadata: '',
});

// ── key-shape guards ────────────────────────────────────────────────────────────
// A Graphene WIF private key is base58 starting with '5' (uncompressed mainnet WIF), ~51 chars.
// Some toolchains also emit a 'P5...'-style or a raw 64-hex private key. We reject ALL of those.
// A PUBLIC key is base58 prefixed with the chain address prefix (MEL/STM/GLS/BLT/TST…) — letters
// then base58. The guard is intentionally conservative: if it looks at all like a private key,
// throw. Better to reject a weird-but-valid pubkey than to ever accept a private key.

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; // no 0 O I l
function isBase58(s) {
  if (typeof s !== 'string' || s.length === 0) return false;
  for (const ch of s) if (!BASE58.includes(ch)) return false;
  return true;
}

/**
 * The custody guard. Throws if `key` looks like a WIF / private key; otherwise returns the key.
 * Enforces "public keys only" — the server must NEVER accept a user private key.
 */
export function rejectIfPrivateKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('rejectIfPrivateKey: key must be a non-empty string');
  }
  const k = key.trim();
  // Classic Graphene/Bitcoin WIF: base58, starts with '5', ~51 chars (allow 48–53 for variants).
  // No Graphene PUBLIC key begins with a bare digit '5', so a leading-5 base58 string of WIF
  // length can only be a private key.
  if (/^5[1-9A-HJ-NP-Za-km-z]{47,52}$/.test(k) && isBase58(k)) {
    throw new Error('refusing private key: value looks like a WIF — public keys only');
  }
  // 'P5...' style some libs emit, and the dhive-style "private key" wif fallback.
  if (/^P5[1-9A-HJ-NP-Za-km-z]{40,}$/.test(k)) {
    throw new Error('refusing private key: value looks like a WIF — public keys only');
  }
  // Raw 64-char hex private key.
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('refusing private key: value looks like a raw private key — public keys only');
  }
  return k;
}

/**
 * A well-formed Graphene PUBLIC key: an UPPERCASE letter address prefix (2–4 chars) immediately
 * followed by base58 payload. e.g. MEL6Mv... / STM7r... / TST5j...
 * We do NOT verify the checksum here (that belongs to the signer / chain) — this is a shape check
 * paired with rejectIfPrivateKey so a private key can never slip through.
 */
export function looksLikePublicKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.trim();
  const m = /^([A-Z]{2,4})([1-9A-HJ-NP-Za-km-z]{40,60})$/.exec(k);
  if (!m) return false;
  return isBase58(m[2]);
}

// ── account-name rules (Graphene) ───────────────────────────────────────────────
// lowercase a-z, digits, dashes; 3–16 chars total; dot-separated segments each 3–16 chars; each
// segment starts with a letter, ends with a letter or digit, no double-dash. Mirrors the
// steemd is_valid_account_name rules closely enough for signup validation.
const SEGMENT_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/;
export function validAccountName(name) {
  if (typeof name !== 'string') return false;
  const n = name;
  if (n.length < 3 || n.length > 16) return false;
  const segments = n.split('.');
  for (const seg of segments) {
    if (seg.length < 3 || seg.length > 16) return false;
    if (!SEGMENT_RE.test(seg)) return false;
    if (seg.includes('--')) return false;
  }
  return true;
}

// ── auth shape helper (matches GrapheneAdapter.createAccount) ────────────────────
function auth(pubKey) {
  return { weight_threshold: 1, account_auths: [], key_auths: [[pubKey, 1]] };
}

// ── prepare ──────────────────────────────────────────────────────────────────────
/**
 * Validate the verified-email token + the new account name + that all four keys are PUBLIC keys,
 * then build the account_create_with_delegation op. Returns { ok, op?, reason? }.
 * NEVER accepts or stores a private key — any private-key-shaped input is rejected hard.
 *
 * @param {{
 *   newAccountName: string,
 *   ownerPub: string, activePub: string, postingPub: string, memoPub: string,
 *   verifiedEmailToken: string,
 *   fee?: string, delegation?: string, jsonMetadata?: string,
 * }} input
 * @param {{ verifyFn?: function, now?: number }} deps
 */
export function prepareAccountCreation(input = {}, { verifyFn = defaultVerifyToken, now = providers.now() } = {}) {
  const {
    newAccountName, ownerPub, activePub, postingPub, memoPub,
    verifiedEmailToken,
    fee = DEFAULTS.fee, delegation = DEFAULTS.delegation, jsonMetadata = DEFAULTS.jsonMetadata,
  } = input;

  // 1) email must be verified (single-use token consumed by the injected verifier).
  let v;
  try {
    v = verifyFn(verifiedEmailToken, { now });
  } catch {
    return { ok: false, reason: 'verify-error' };
  }
  if (!v || !v.ok) return { ok: false, reason: `email-not-verified${v && v.reason ? ':' + v.reason : ''}` };

  // 2) account name must be valid Graphene.
  if (!validAccountName(newAccountName)) return { ok: false, reason: 'invalid-account-name' };

  // 3) all four keys must be PUBLIC keys. Reject private keys HARD (custody guard), then require
  //    public-key shape. Memo key included — the user supplies all four public keys.
  const keys = { ownerPub, activePub, postingPub, memoPub };
  for (const [label, key] of Object.entries(keys)) {
    try {
      rejectIfPrivateKey(key); // throws on any WIF / private-key shape
    } catch {
      return { ok: false, reason: `private-key-rejected:${label}` };
    }
    if (!looksLikePublicKey(key)) return { ok: false, reason: `invalid-public-key:${label}` };
  }

  // 4) build the op. creator = the Witness account `hathor`. Signed later by MELEK-Signer only.
  const op = ['account_create_with_delegation', {
    fee,
    delegation,
    creator: WITNESS_ACCOUNT,
    new_account_name: newAccountName,
    owner: auth(ownerPub),
    active: auth(activePub),
    posting: auth(postingPub),
    memo_key: memoPub,
    json_metadata: jsonMetadata || '',
    extensions: [],
  }];

  return { ok: true, op };
}

// ── submit (DRY-RUN by default; signer holds the key, not us) ────────────────────
/**
 * Hand a prepared op to the signer — ONLY when live AND a broadcaster is injected. Otherwise it is
 * a dry run: returns the op unbroadcast. This module never signs; the broadcaster (MELEK-Signer
 * behind a bearer token) holds the active key.
 *
 * @param {Array} op a prepared op from prepareAccountCreation
 * @param {{ broadcaster?: function, live?: boolean }} deps
 * @returns {Promise<{ ok, dryRun, op, result? , reason? }>}
 */
export async function submit(op, { broadcaster, live = false } = {}) {
  if (!Array.isArray(op) || op.length !== 2) {
    return { ok: false, reason: 'invalid-op' };
  }
  if (!live || typeof broadcaster !== 'function') {
    // DRY-RUN: do not call the signer; just return the prepared op.
    return { ok: true, dryRun: true, op };
  }
  try {
    const result = await broadcaster(op);
    return { ok: true, dryRun: false, op, result };
  } catch (err) {
    return { ok: false, dryRun: false, op, reason: `broadcast-failed:${err && err.message ? err.message : 'error'}` };
  }
}

// ── CLI (guarded; booleans only, never secrets/keys) ────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('account-create.mjs')) {
  const arg = process.argv[2] || '--status';
  if (arg === '--status') {
    console.log('account-create — email-verified account creation with delegation (Task #41):');
    console.log(`  creator (witness account): ${WITNESS_ACCOUNT}`);
    console.log('  custody: PUBLIC keys only; private keys rejected; NO local WIF; signer holds the key.');
    console.log('  default mode: DRY-RUN (submit broadcasts only when live AND a broadcaster is injected).');
    console.log(`  default fee/delegation: ${DEFAULTS.fee} / ${DEFAULTS.delegation}`);
  } else {
    console.log('usage: node signup/account-create.mjs [--status]');
  }
}
