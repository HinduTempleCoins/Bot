// jit-signer.mjs — EPHEMERAL local signer for operator-timer one-shots on the TESTNET ONLY.
//
// The zero-WIF rule stands: the Bot repo/host never holds a chain private key AT REST, and
// MELEK-Signer is the broadcast path once it exists. But the signer service is deferred
// (build order: Mist Wallet → PRANA testnet → signer), and the witness has hourly duties NOW
// (the price feed). The operator's custody rule for those duties (2026-06-06): the key is
// fetched JIT from the vault by the timer script, handed to ONE short-lived process via env,
// and never written to disk or logged.
//
// This module is that one short-lived process's signer. It is HARD-SCOPED TO THE TESTNET and
// DISABLED unless ALL of these hold:
//   • MELEK_FEED_TESTNET_JIT_SIGN=1  (the explicit, default-OFF opt-in; the timer env sets it)
//   • the chain is the TESTNET — address prefix is TST (NEVER the MELEK mainnet prefix)
//   • a key is present in env (HATHOR_ACTIVE_KEY / HATHOR_POSTING_KEY)
//
// MAINNET REFUSE (load-bearing): on the MELEK mainnet prefix this signer NEVER engages and
// NEVER signs, under ANY flag. Mainnet stays signer-only, zero-WIF, with no local-key fallback
// by construction. The testnet path below cannot weaken that — it is gated on the TST prefix
// and re-checks at sign time.
//
// When MELEK_SIGNER_URL is configured, the real signer client wins and this never engages
// (see graphene.js — fromEnv() is consulted first).
//
// Key selection: active-authority ops (feed_publish, transfer, witness_update, …) sign with
// the active key; comment/vote sign with posting. The key strings are read at call time and
// NEVER logged, returned, or echoed (see feedback-never-print-any-part-of-a-key).

import { PrivateKey } from '@hiveio/dhive';

// ops that need the ACTIVE authority; everything else uses posting.
const ACTIVE_OPS = new Set([
  'feed_publish', 'transfer', 'transfer_to_vesting', 'delegate_vesting_shares',
  'witness_update', 'account_create', 'create_account_with_keys_delegated', 'account_update',
]);

// The TESTNET address prefix — JIT local signing is allowed ONLY on this prefix.
const TESTNET_PREFIX = 'TST';
// The MELEK MAINNET address prefix — JIT local signing is HARD-REFUSED on this prefix, always.
const MAINNET_PREFIX = 'MELEK';

// The default-OFF opt-in flag. With it unset, jitEnabled() is false and the adapter is
// signer-only exactly as before.
const FLAG = 'MELEK_FEED_TESTNET_JIT_SIGN';

function envKeyName(role) { return ['HATHOR', role.toUpperCase(), 'KEY'].join('_'); } // assembled

/** Pull the address prefix off the injected dhive client (a plain string like 'TST'). */
function prefixOf(client) {
  return client && typeof client.addressPrefix === 'string' ? client.addressPrefix : '';
}

/** True only when the chain is the TESTNET (TST prefix). */
function isTestnet(client) {
  return prefixOf(client) === TESTNET_PREFIX;
}

/** True when the chain is the MELEK mainnet — local signing is forbidden here, always. */
function isMainnet(client) {
  return prefixOf(client) === MAINNET_PREFIX;
}

/**
 * Whether the testnet-only JIT signer is enabled for this client + env. Requires ALL of:
 *   • the explicit default-OFF flag MELEK_FEED_TESTNET_JIT_SIGN=1
 *   • the TESTNET (TST) address prefix — NEVER engages on MELEK mainnet
 *   • a key in env
 * Returns false (not throw) when any condition is unmet, so the caller fails soft to read-only.
 *
 * @param {object} [env]               env source (tests inject; defaults to process.env)
 * @param {{ client?: object }} [deps] the dhive client (carries addressPrefix)
 */
export function jitEnabled(env = process.env, { client } = {}) {
  // Hard mainnet refuse: never enabled on the MELEK prefix, under any flag.
  if (isMainnet(client)) return false;
  // Testnet-only: must be the TST prefix.
  if (!isTestnet(client)) return false;
  return env[FLAG] === '1'
    && Boolean(env[envKeyName('active')] || env[envKeyName('posting')]);
}

/**
 * Build the ephemeral signer, or null when not enabled. Interface-compatible with the
 * MELEK-Signer client: { broadcast(ops, meta) -> Promise<result> }.
 *
 * HARD-SCOPED to the testnet: returns null on the MELEK mainnet prefix (and on any non-TST
 * prefix), so mainnet can never obtain a local-key signer from this module. As a last line of
 * defense, broadcast() re-checks the prefix at sign time and throws on mainnet — it never signs.
 *
 * @param {{ client: import('@hiveio/dhive').Client }} deps  dhive client (injected/testable)
 * @param {object} [env]  env source (tests inject; defaults to process.env)
 */
export function jitSignerFromEnv({ client }, env = process.env) {
  if (!client) return null;
  // Belt-and-suspenders mainnet refuse — never hand back a signer on the MELEK prefix.
  if (isMainnet(client)) return null;
  if (!jitEnabled(env, { client })) return null;
  return {
    kind: 'jit-ephemeral',
    async broadcast(ops) {
      // Re-assert the guard at sign time. If the client is mainnet (or not the testnet),
      // REFUSE — never sign. This is the last line of the mainnet-refuse defense.
      if (isMainnet(client)) {
        throw new Error('jit signer: refusing to sign on MELEK mainnet (testnet-only path)');
      }
      if (!isTestnet(client)) {
        throw new Error('jit signer: refusing to sign — not the testnet (TST) chain');
      }
      const needsActive = ops.some(([name]) => ACTIVE_OPS.has(name));
      const role = needsActive ? 'active' : 'posting';
      const wif = env[envKeyName(role)] || env[envKeyName('active')];
      if (!wif) throw new Error(`jit signer: no ${role} key in env for this op set`);
      const key = PrivateKey.fromString(wif);
      return client.broadcast.sendOperations(ops, key);
    },
  };
}
