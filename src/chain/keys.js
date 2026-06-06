/**
 * Hathor account loading.
 *
 * getAccount() — the on-chain account name — is the live, supported export.
 *
 * DEPRECATED (key getters below): the Bot no longer signs locally. As of the
 * PRE-SIGNER 2 refactor, ALL broadcasting is delegated to MELEK-Signer (a scoped
 * bearer token over HTTP — see src/chain/melek-signer-client.mjs and
 * MELEK_SIGNER.md §6). The Bot host holds NO chain private key by construction
 * (BRIEF.md §7, zero-WIF rule). The key getters/checkers below are retained only
 * as deprecated shims for any lingering reference and are NOT used by any
 * broadcast path. Do not reintroduce local key signing. The owner key is never
 * loaded here — it stays offline.
 */

const ACCOUNT = process.env.HATHOR_ACCOUNT || 'hathor';
const POSTING = process.env.HATHOR_POSTING_KEY || null;
const ACTIVE = process.env.HATHOR_ACTIVE_KEY || null;

export function getAccount() {
  return ACCOUNT;
}

/** @deprecated zero-WIF host: signing is delegated to MELEK-Signer; do not use for broadcast. */
export function getPostingKey() {
  if (!POSTING) {
    throw new Error('HATHOR_POSTING_KEY not configured');
  }
  return POSTING;
}

/** @deprecated zero-WIF host: signing is delegated to MELEK-Signer; do not use for broadcast. */
export function getActiveKey() {
  if (!ACTIVE) {
    throw new Error('HATHOR_ACTIVE_KEY not configured');
  }
  return ACTIVE;
}

/** @deprecated broadcast readiness is now "signer env configured", not "posting key present". */
export function hasPostingKey() {
  return Boolean(POSTING);
}

/** @deprecated broadcast readiness is now "signer env configured", not "active key present". */
export function hasActiveKey() {
  return Boolean(ACTIVE);
}
