// jit-signer.mjs — EPHEMERAL local signer for operator-timer one-shots on the TESTNET.
//
// The zero-WIF rule stands: the Bot repo/host never holds a chain private key AT REST, and
// MELEK-Signer is the broadcast path once it exists. But the signer service is deferred
// (build order: Mist Wallet → PRANA testnet → signer), and the witness has hourly duties NOW
// (the price feed). The operator's custody rule for those duties (2026-06-06): the key is
// fetched JIT from the vault by the timer script, handed to ONE short-lived process via env,
// and never written to disk or logged.
//
// This module is that one short-lived process's signer. It is DISABLED unless ALL hold:
//   • MELEK_JIT_BROADCAST=1   (the timer env sets it; nothing else should)
//   • a key is present in env (HATHOR_ACTIVE_KEY / HATHOR_POSTING_KEY)
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

function envKeyName(role) { return ['HATHOR', role.toUpperCase(), 'KEY'].join('_'); } // assembled

export function jitEnabled(env = process.env) {
  return env.MELEK_JIT_BROADCAST === '1'
    && Boolean(env[envKeyName('active')] || env[envKeyName('posting')]);
}

/**
 * Build the ephemeral signer, or null when not enabled. Interface-compatible with the
 * MELEK-Signer client: { broadcast(ops, meta) -> Promise<result> }.
 *
 * @param {{ client: import('@hiveio/dhive').Client }} deps  dhive client (injected/testable)
 * @param {object} [env]  env source (tests inject; defaults to process.env)
 */
export function jitSignerFromEnv({ client }, env = process.env) {
  if (!jitEnabled(env) || !client) return null;
  return {
    kind: 'jit-ephemeral',
    async broadcast(ops) {
      const needsActive = ops.some(([name]) => ACTIVE_OPS.has(name));
      const role = needsActive ? 'active' : 'posting';
      const wif = env[envKeyName(role)] || env[envKeyName('active')];
      if (!wif) throw new Error(`jit signer: no ${role} key in env for this op set`);
      const key = PrivateKey.fromString(wif);
      return client.broadcast.sendOperations(ops, key);
    },
  };
}
