// account-gate.mjs — pure, offline-testable logic for the signup delivery-guarantee gate.
// OPERATOR HARD REQUIREMENT (2026-06-07): a user must PROVABLY receive and save their
// password/keys before an account can be created. This module holds the gate state machine
// only — no DOM, no network, no key material. The "Create account" button is enabled iff:
//   (a) the user has downloaded OR copied their keys, AND
//   (b) the master password they re-type matches the generated one exactly.
// There is no skip path: both conditions are required. account-ui.mjs drives the DOM from this.

/** Fresh gate state for a newly generated credential set. */
export function newGateState() {
  return { delivered: false, confirmInput: '' };
}

/** Mark that the user obtained their keys (download click or copy success). */
export function markDelivered(state) {
  return { ...state, delivered: true };
}

/** Record the current value of the confirm-password field. */
export function setConfirmInput(state, value) {
  return { ...state, confirmInput: String(value ?? '') };
}

/**
 * The confirm field matches the real master password. Leading/trailing whitespace is forgiven: pasting
 * from the saved keys file or a password manager routinely carries a trailing space or newline, which
 * was making legitimate re-entries "not match" and blocking signup. The 52 real characters must still be
 * exactly right — only surrounding whitespace is trimmed.
 */
export function confirmMatches(state, password) {
  const typed = String(state.confirmInput ?? '').trim();
  const real = String(password ?? '').trim();
  return typed === real && real.length > 0;
}

/**
 * Is the Create-account button allowed to be enabled?
 * Requires BOTH delivery (download/copy) AND an exact password re-entry.
 */
export function canCreate(state, password) {
  return Boolean(state.delivered) && confirmMatches(state, password);
}

/** A short human reason the gate is still closed (for an inline hint). '' when open. */
export function gateReason(state, password) {
  if (!state.delivered) return 'Download or copy your keys first.';
  if (!confirmMatches(state, password)) {
    return state.confirmInput.length === 0
      ? 'Re-type your master password to confirm you have it.'
      : 'That does not match your master password yet.';
  }
  return '';
}
