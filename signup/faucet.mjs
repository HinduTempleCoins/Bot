// faucet.mjs — Hathor account-creation FAUCET TEST harness for the MELEK TESTNET.
//
// PURPOSE
//   Operator's faucet test: given a list of NEW account names, this
//     1) creates each account on the testnet, and
//     2) has the Witness `hathor` transfer a RANDOM 5–15 TESTS grant to each new account.
//   The grant amount is random per account, in the BRIEF.md §7 5–15 band (TESTS on testnet; the
//   mainnet symbol would be MELEK).
//
// KEY CUSTODY (BRIEF.md §7 / repo HARD RULE "Zero WIF"):
//   - This module NEVER holds a key and NEVER signs. It only BUILDS standard Graphene ops
//     (account_create_with_delegation + transfer) and hands each batch to an INJECTED broadcaster.
//     The broadcaster alone holds the signing capability (MELEK-Signer behind a bearer token, OR —
//     on the testnet host only — a JIT-fetched testnet active key that is never written to disk and
//     never passes through this file).
//   - With NO broadcaster injected, the module can never broadcast, regardless of `live`. That is
//     the zero-WIF safety floor (same shape as witness/feed-publisher.mjs).
//   - It never accepts, requests, logs, or prints any private key (or any part of one). For test
//     accounts the caller supplies the four PUBLIC keys per account; private-key-shaped input is
//     rejected HARD by the custody guard.
//
// TESTNET SAFETY
//   The grant symbol must be TESTS and the address prefix TST. The module refuses to build a grant
//   in any other symbol — it must NEVER be pointed at mainnet.
//
// Everything is injectable so the tests run fully offline (no network):
//   import { runFaucet, buildPlan, randomGrantAmount, __setBroadcaster, __setRng } from './faucet.mjs'
//   node signup/faucet.mjs --status

import {
  rejectIfPrivateKey,
  looksLikePublicKey,
  validAccountName,
} from './account-create.mjs';

// ── config ───────────────────────────────────────────────────────────────────────
export const WITNESS_ACCOUNT = 'hathor'; // the funder + creator (lowercase, per CLAUDE.md)
export const GRANT_SYMBOL = 'TESTS'; // testnet liquid symbol (mainnet would be MELEK)
export const PREFIX = 'TST'; // testnet address prefix
export const GRANT_MIN = 5; // BRIEF.md §7 grant band (inclusive)
export const GRANT_MAX = 15; // inclusive
// The chain's account_creation_fee (read from get_chain_properties; on the live testnet this is
// "0.001 TESTS"). Env-overridable so the live driver can pass the exact required fee without
// touching logic; default matches the current testnet chain property.
export const CREATE_FEE = process.env.FAUCET_CREATE_FEE || '0.001 TESTS';
export const CREATE_DELEGATION = '0.000000 VESTS'; // placeholder; real split is operator logic

// ── injectable seams ──────────────────────────────────────────────────────────────
// Default broadcaster: NONE. Without one injected the module cannot broadcast (zero-WIF floor).
let _broadcaster = null;
/** Inject the broadcaster: async (op) => result. It alone holds the signing capability. */
export function __setBroadcaster(fn) { _broadcaster = typeof fn === 'function' ? fn : null; }

// Deterministic RNG seam for offline tests. Default: Math.random.
let _rng = () => Math.random();
/** Inject the RNG: () => number in [0,1). */
export function __setRng(fn) { _rng = typeof fn === 'function' ? fn : (() => Math.random()); }

// ── pure helpers ────────────────────────────────────────────────────────────────────

/**
 * A random grant amount in [GRANT_MIN, GRANT_MAX] TESTS, to 3 decimals (Graphene amount precision).
 * Returns a string like "7.421 TESTS" — the on-chain asset format.
 */
export function randomGrantAmount() {
  const span = GRANT_MAX - GRANT_MIN; // 10
  const raw = GRANT_MIN + _rng() * span;
  // clamp into band, round to 3 dp (TESTS precision)
  const v = Math.min(GRANT_MAX, Math.max(GRANT_MIN, Math.round(raw * 1000) / 1000));
  return `${v.toFixed(3)} ${GRANT_SYMBOL}`;
}

function auth(pubKey) {
  return { weight_threshold: 1, account_auths: [], key_auths: [[pubKey, 1]] };
}

/**
 * Validate one new-account spec and build its two ops:
 *   account_create_with_delegation (creator = hathor)  +  transfer (hathor -> new account).
 * Returns { ok, name, amount, ops? , reason? }. Never throws.
 *
 * @param {{ name, ownerPub, activePub, postingPub, memoPub, memo? }} acct
 */
export function buildAccountOps(acct = {}) {
  const { name, ownerPub, activePub, postingPub, memoPub, memo = '' } = acct;

  if (!validAccountName(name)) return { ok: false, name, reason: 'invalid-account-name' };

  const keys = { ownerPub, activePub, postingPub, memoPub };
  for (const [label, key] of Object.entries(keys)) {
    try { rejectIfPrivateKey(key); } // throws on any WIF / private-key shape
    catch { return { ok: false, name, reason: `private-key-rejected:${label}` }; }
    if (!looksLikePublicKey(key)) return { ok: false, name, reason: `invalid-public-key:${label}` };
    if (!key.startsWith(PREFIX)) return { ok: false, name, reason: `wrong-prefix:${label}` };
  }

  const amount = randomGrantAmount();
  // testnet-only safety: the grant must be in TESTS.
  if (!amount.endsWith(` ${GRANT_SYMBOL}`)) return { ok: false, name, reason: 'wrong-grant-symbol' };

  const createOp = ['account_create_with_delegation', {
    fee: CREATE_FEE,
    delegation: CREATE_DELEGATION,
    creator: WITNESS_ACCOUNT,
    new_account_name: name,
    owner: auth(ownerPub),
    active: auth(activePub),
    posting: auth(postingPub),
    memo_key: memoPub,
    json_metadata: '',
    extensions: [],
  }];

  const transferOp = ['transfer', {
    from: WITNESS_ACCOUNT,
    to: name,
    amount,
    memo: typeof memo === 'string' ? memo : '',
  }];

  return { ok: true, name, amount, ops: [createOp, transferOp] };
}

/**
 * Build a plan for a whole batch. Pure — no broadcast. Returns
 *   { ok, accounts: [ { name, amount, ops } | { name, reason } ], valid, invalid }.
 */
export function buildPlan(accounts = []) {
  const list = Array.isArray(accounts) ? accounts : [];
  const built = list.map(buildAccountOps);
  const valid = built.filter((b) => b.ok);
  const invalid = built.filter((b) => !b.ok);
  return { ok: invalid.length === 0, accounts: built, valid: valid.length, invalid: invalid.length };
}

// ── run (DRY-RUN by default; broadcaster holds the signing capability) ──────────────
/**
 * Create + grant each account. DRY-RUN unless `live` AND a broadcaster is injected.
 *
 *   - For each valid account: broadcast its [create, transfer] op pair (the transfer follows the
 *     create so the account exists before it is funded). On broadcast failure for one account, the
 *     others still proceed (soft-fail, per-account result).
 *   - Returns a per-account report. NEVER throws to the caller. NEVER logs/returns a key.
 *
 * @param {Array} accounts  list of { name, ownerPub, activePub, postingPub, memoPub, memo? }
 * @param {{ live?: boolean, broadcaster?: function }} opts
 * @returns {Promise<{ ok, dryRun, results: [...] }>}
 */
export async function runFaucet(accounts = [], { live = false, broadcaster } = {}) {
  const bc = typeof broadcaster === 'function' ? broadcaster : _broadcaster;
  const plan = buildPlan(accounts);
  const dryRun = !live || typeof bc !== 'function';

  const results = [];
  for (const a of plan.accounts) {
    if (!a.ok) { results.push({ name: a.name, ok: false, reason: a.reason }); continue; }
    if (dryRun) {
      results.push({ name: a.name, ok: true, dryRun: true, amount: a.amount, ops: a.ops });
      continue;
    }
    // Broadcast create then transfer. Keep ids; soft-fail per account.
    try {
      const createRes = await bc(a.ops[0]);
      let transferRes = null;
      try {
        transferRes = await bc(a.ops[1]);
      } catch (te) {
        results.push({
          name: a.name, ok: false, amount: a.amount,
          created: idOf(createRes), reason: `grant-failed:${msg(te)}`,
        });
        continue;
      }
      results.push({
        name: a.name, ok: true, dryRun: false, amount: a.amount,
        created: idOf(createRes), granted: idOf(transferRes),
      });
    } catch (ce) {
      results.push({ name: a.name, ok: false, amount: a.amount, reason: `create-failed:${msg(ce)}` });
    }
  }

  return { ok: results.every((r) => r.ok), dryRun, results };
}

function idOf(r) {
  if (!r) return null;
  return r.id || r.trx_id || r.tx_id || (typeof r === 'string' ? r : null);
}
function msg(e) { return String((e && e.message) || e || 'error').slice(0, 200); }

// ── CLI (guarded; booleans/plan only, NEVER secrets/keys) ──────────────────────────
if (process.argv[1] && process.argv[1].endsWith('faucet.mjs')) {
  const arg = process.argv[2] || '--status';
  if (arg === '--status') {
    console.log('faucet — Hathor account-creation + grant faucet (TESTNET):');
    console.log(`  funder/creator: ${WITNESS_ACCOUNT}`);
    console.log(`  grant band: ${GRANT_MIN}–${GRANT_MAX} ${GRANT_SYMBOL} (random per account)`);
    console.log('  custody: PUBLIC keys only; private keys rejected; NO local WIF; broadcaster signs.');
    console.log('  default mode: DRY-RUN (broadcasts only when live AND a broadcaster is injected).');
  } else if (arg === '--sample') {
    // Show a dry-run plan for two sample names with fixed pubkeys (no broadcast, no keys printed).
    const sample = ['faucet-test-1', 'faucet-test-2'].map((name) => ({
      name,
      ownerPub: 'TST5sample0000000000000000000000000000000000000',
      activePub: 'TST5sample0000000000000000000000000000000000000',
      postingPub: 'TST5sample0000000000000000000000000000000000000',
      memoPub: 'TST5sample0000000000000000000000000000000000000',
    }));
    const plan = buildPlan(sample);
    console.log(JSON.stringify({ valid: plan.valid, invalid: plan.invalid, accounts: plan.accounts.map((a) => ({ name: a.name, amount: a.amount, ok: a.ok, reason: a.reason })) }, null, 2));
  } else {
    console.log('usage: node signup/faucet.mjs [--status|--sample]');
  }
}
