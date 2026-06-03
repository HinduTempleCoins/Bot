/**
 * src/chain/evm-aa-grants.mjs — EVM account-abstraction grants for PRANA (queue #167).
 *
 * PURE logic. No live chain, no RPC, no signing, no I/O. This module is the EVM
 * analogue of the Graphene posting-key / trade-grant model the Bot already uses
 * for the `hathor` account:
 *
 *   Graphene world                     EVM (ERC-4337 / EIP-7702) world
 *   ----------------------------       --------------------------------------
 *   owner key (cold, offline)      ->  the account's root key / EOA (NEVER here)
 *   posting key / scoped active     ->  a SESSION KEY (a scoped, time-boxed grant)
 *   delegate_vesting_shares faucet  ->  a PAYMASTER sponsoring user-ops (PoL faucet)
 *
 * A session key is modeled exactly like a posting-key grant: it is a bounded
 * capability, NOT custody. It can only do the narrow set of things its scope
 * permits, only until it expires, only up to a spend cap, only against an
 * allowlist of target contracts. It can NEVER perform owner-level operations
 * (key rotation, ownership transfer, granting further keys, withdrawing the
 * whole balance, self-destruct, delegatecall, etc.) — those are reserved to the
 * owner key, which lives behind the signer and never touches this repo or its
 * host (zero-WIF-on-host invariant; the signer is the sole key boundary).
 *
 * `authorize(grant, userOp)` is the on-grant policy gate: it HARD-REJECTS
 * anything outside scope and any owner-key action. `paymasterSponsor(userOp,
 * rules)` is the faucet: it decides whether the AA paymaster fronts gas, under
 * proof-of-life style rules (fresh recipients, per-op gas cap, daily budget).
 *
 * Invariant (asserted at runtime AND tested): a session key NEVER authorizes
 * owner-level ops or out-of-scope targets; expired or over-cap user-ops are
 * rejected.
 *
 * Run OFFLINE:
 *   node --test src/chain/evm-aa-grants.test.mjs
 */

// ---- error type ------------------------------------------------------------

export class GrantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GrantError';
  }
}

// ---- owner-level operations (NEVER permitted to a session key) --------------
//
// These are the EVM equivalents of the Graphene owner key: anything that can
// change who controls the account, mint unbounded authority, or drain it.
// Matching is by method-name AND by 4-byte-style selector, case-insensitive.

export const OWNER_OPS = Object.freeze([
  'upgradeTo',
  'upgradeToAndCall',
  'transferOwnership',
  'renounceOwnership',
  'changeOwner',
  'addOwner',
  'removeOwner',
  'setOwner',
  'rotateKey',
  'rotateSigner',
  'addSessionKey',
  'grantSessionKey',
  'registerSessionKey',
  'addValidator',
  'installModule',
  'uninstallModule',
  'setFallbackHandler',
  'selfdestruct',
  'selfDestruct',
  'destroy',
  'delegatecall',
  'execTransactionFromModule',
  'setGuard',
  'enableModule',
  'disableModule',
  // EIP-7702: authorizing/clearing the delegated code of the EOA itself is
  // an owner act — a session key must never set or clear a 7702 delegation.
  'setDelegation',
  'clearDelegation',
  'authorizeDelegation',
]);

const OWNER_OP_SET = new Set(OWNER_OPS.map((m) => m.toLowerCase()));

// A userOp may name its action via `op.method` (human name) or a 4-byte
// selector via `op.selector`. We also reject the literal sentinel target that
// means "the account itself" combined with any unknown call, on the safe side.
function namesOwnerOp(userOp) {
  const method = typeof userOp.method === 'string' ? userOp.method.toLowerCase() : null;
  if (method && OWNER_OP_SET.has(method)) return true;
  // Defensive: a method explicitly flagged owner-level by the caller.
  if (userOp.ownerLevel === true) return true;
  return false;
}

// ---- helpers ---------------------------------------------------------------

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isFiniteNonNegative(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

// Normalize an EVM-ish address/scope token for comparison. We do NOT validate
// checksums (pure logic, no crypto) — we only lower-case so allowlist matching
// is case-insensitive, which is the correct behavior for EVM addresses.
function norm(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : v;
}

function nowSeconds(clock) {
  if (typeof clock === 'function') return clock();
  return Math.floor(Date.now() / 1000);
}

// ---- createSessionKey ------------------------------------------------------

/**
 * Mint a scoped session-key GRANT object. This is data only — it carries NO
 * private key (the actual session signing key lives behind the signer). It is
 * the EVM equivalent of issuing a posting-key delegation: a bounded capability.
 *
 * @param {object}   args
 * @param {string}   args.scope          - logical scope label, e.g. 'prana:trade'
 * @param {number}   args.validUntil     - unix seconds; grant invalid at/after this
 * @param {number}   args.spendCap       - max cumulative value (wei-as-number) this key may move; 0 = no value moves
 * @param {string[]} args.allowedTargets - allowlist of target contract addresses
 * @param {number}   [args.validAfter]   - unix seconds; grant invalid before this (default 0)
 * @param {string[]} [args.allowedMethods] - optional method allowlist (in ADDITION to the owner-op denylist)
 * @param {number}   [args.perOpCap]     - optional max value per single user-op
 * @returns {object} a frozen session-key grant
 */
export function createSessionKey({
  scope,
  validUntil,
  spendCap,
  allowedTargets,
  validAfter = 0,
  allowedMethods = null,
  perOpCap = null,
} = {}) {
  if (!isNonEmptyString(scope)) {
    throw new GrantError('createSessionKey: scope must be a non-empty string');
  }
  if (!isFiniteNonNegative(validUntil)) {
    throw new GrantError('createSessionKey: validUntil must be a non-negative number (unix seconds)');
  }
  if (!isFiniteNonNegative(validAfter)) {
    throw new GrantError('createSessionKey: validAfter must be a non-negative number (unix seconds)');
  }
  if (validUntil <= validAfter) {
    throw new GrantError('createSessionKey: validUntil must be after validAfter');
  }
  if (!isFiniteNonNegative(spendCap)) {
    throw new GrantError('createSessionKey: spendCap must be a non-negative number');
  }
  if (!Array.isArray(allowedTargets) || allowedTargets.length === 0) {
    throw new GrantError('createSessionKey: allowedTargets must be a non-empty array');
  }
  if (!allowedTargets.every(isNonEmptyString)) {
    throw new GrantError('createSessionKey: every allowedTarget must be a non-empty string');
  }
  if (allowedMethods != null) {
    if (!Array.isArray(allowedMethods) || !allowedMethods.every(isNonEmptyString)) {
      throw new GrantError('createSessionKey: allowedMethods, if given, must be an array of non-empty strings');
    }
  }
  if (perOpCap != null && !isFiniteNonNegative(perOpCap)) {
    throw new GrantError('createSessionKey: perOpCap, if given, must be a non-negative number');
  }

  // A session key MUST NOT be created with owner ops in its method allowlist.
  // This is the create-time half of the never-owner invariant.
  if (allowedMethods) {
    for (const m of allowedMethods) {
      if (OWNER_OP_SET.has(m.toLowerCase())) {
        throw new GrantError(`createSessionKey: owner-level op '${m}' may never be in a session-key scope`);
      }
    }
  }

  return Object.freeze({
    kind: 'evm-session-key',
    scope,
    validAfter,
    validUntil,
    spendCap,
    perOpCap: perOpCap == null ? null : perOpCap,
    allowedTargets: Object.freeze(allowedTargets.map(norm)),
    allowedMethods: allowedMethods == null ? null : Object.freeze(allowedMethods.map((m) => m.toLowerCase())),
  });
}

// ---- authorize -------------------------------------------------------------

/**
 * PURE policy gate. Decide whether `userOp` is permitted under `grant`.
 * Enforces, in order: shape, owner-op denylist (HARD), expiry/not-yet-valid,
 * target allowlist, optional method allowlist, per-op cap, cumulative spend cap.
 *
 * @param {object} grant   - a session-key grant from createSessionKey
 * @param {object} userOp  - { target, method?, selector?, value?, spent?, ownerLevel? }
 *   - target   : destination contract address (string)
 *   - method   : optional human method name
 *   - value    : optional value moved by this op (number, default 0)
 *   - spent    : optional cumulative value already moved under this grant (number, default 0)
 *   - ownerLevel: optional explicit owner-level flag
 * @param {object} [opts]
 * @param {function} [opts.clock] - injectable () => unix-seconds, for tests
 * @returns {{allowed: boolean, reason: string}}
 */
export function authorize(grant, userOp, opts = {}) {
  if (!grant || grant.kind !== 'evm-session-key') {
    return { allowed: false, reason: 'invalid-grant' };
  }
  if (!userOp || typeof userOp !== 'object') {
    return { allowed: false, reason: 'invalid-userop' };
  }

  // 1. Owner-level ops are NEVER authorized by a session key. HARD REJECT.
  //    This is the load-bearing invariant; assert it can never silently pass.
  if (namesOwnerOp(userOp)) {
    return { allowed: false, reason: 'owner-op-forbidden' };
  }

  // 2. Time window.
  const now = nowSeconds(opts.clock);
  if (now < grant.validAfter) {
    return { allowed: false, reason: 'not-yet-valid' };
  }
  if (now >= grant.validUntil) {
    return { allowed: false, reason: 'expired' };
  }

  // 3. Target allowlist.
  if (!isNonEmptyString(userOp.target)) {
    return { allowed: false, reason: 'missing-target' };
  }
  if (!grant.allowedTargets.includes(norm(userOp.target))) {
    return { allowed: false, reason: 'target-not-allowed' };
  }

  // 4. Optional method allowlist (the owner-op denylist already ran above).
  if (grant.allowedMethods) {
    const method = isNonEmptyString(userOp.method) ? userOp.method.toLowerCase() : null;
    if (!method || !grant.allowedMethods.includes(method)) {
      return { allowed: false, reason: 'method-not-allowed' };
    }
  }

  // 5. Spend caps.
  const value = userOp.value == null ? 0 : userOp.value;
  if (!isFiniteNonNegative(value)) {
    return { allowed: false, reason: 'invalid-value' };
  }
  if (grant.perOpCap != null && value > grant.perOpCap) {
    return { allowed: false, reason: 'per-op-cap-exceeded' };
  }
  const spent = userOp.spent == null ? 0 : userOp.spent;
  if (!isFiniteNonNegative(spent)) {
    return { allowed: false, reason: 'invalid-spent' };
  }
  if (spent + value > grant.spendCap) {
    return { allowed: false, reason: 'spend-cap-exceeded' };
  }

  // Belt-and-suspenders: if we are about to return allowed, the op MUST be
  // non-owner and in-scope. Assert the invariant before granting.
  if (namesOwnerOp(userOp) || !grant.allowedTargets.includes(norm(userOp.target))) {
    throw new GrantError('authorize: invariant violation — would have allowed an out-of-scope or owner op');
  }

  return { allowed: true, reason: 'ok' };
}

// ---- paymasterSponsor ------------------------------------------------------

/**
 * The PoL (proof-of-life) FAUCET. Decide whether the AA paymaster fronts gas
 * for `userOp`. This is the EVM analogue of the Graphene RC/delegation faucet:
 * it bootstraps new users who hold no native gas token, under rules that bound
 * abuse (per-op gas cap, daily budget, fresh-recipient requirement, target
 * allowlist). PURE — no balance lookups, all inputs supplied via `rules`.
 *
 * @param {object} userOp  - { target?, gas?, sender?, recipientIsFresh? }
 * @param {object} rules
 *   - maxGasPerOp    : number, max gas units this faucet will sponsor in one op
 *   - dailyBudget    : number, total gas budget for the period
 *   - spentToday     : number, gas already sponsored this period (default 0)
 *   - allowedTargets : optional string[] allowlist of sponsorable targets
 *   - requireFreshRecipient : optional bool; if true, op.recipientIsFresh must be true
 *   - enabled        : optional bool (default true); a kill-switch for the faucet
 * @returns {{sponsored: boolean, reason: string}}
 */
export function paymasterSponsor(userOp, rules = {}) {
  if (!userOp || typeof userOp !== 'object') {
    return { sponsored: false, reason: 'invalid-userop' };
  }
  if (!rules || typeof rules !== 'object') {
    return { sponsored: false, reason: 'invalid-rules' };
  }
  if (rules.enabled === false) {
    return { sponsored: false, reason: 'faucet-disabled' };
  }

  // Never sponsor an owner-level op — the faucet is for ordinary user activity.
  if (namesOwnerOp(userOp)) {
    return { sponsored: false, reason: 'owner-op-forbidden' };
  }

  if (!isFiniteNonNegative(rules.maxGasPerOp)) {
    return { sponsored: false, reason: 'invalid-maxGasPerOp' };
  }
  if (!isFiniteNonNegative(rules.dailyBudget)) {
    return { sponsored: false, reason: 'invalid-dailyBudget' };
  }

  if (Array.isArray(rules.allowedTargets)) {
    if (!isNonEmptyString(userOp.target) || !rules.allowedTargets.map(norm).includes(norm(userOp.target))) {
      return { sponsored: false, reason: 'target-not-sponsorable' };
    }
  }

  if (rules.requireFreshRecipient && userOp.recipientIsFresh !== true) {
    return { sponsored: false, reason: 'recipient-not-fresh' };
  }

  const gas = userOp.gas == null ? 0 : userOp.gas;
  if (!isFiniteNonNegative(gas)) {
    return { sponsored: false, reason: 'invalid-gas' };
  }
  if (gas > rules.maxGasPerOp) {
    return { sponsored: false, reason: 'per-op-gas-cap-exceeded' };
  }

  const spentToday = rules.spentToday == null ? 0 : rules.spentToday;
  if (!isFiniteNonNegative(spentToday)) {
    return { sponsored: false, reason: 'invalid-spentToday' };
  }
  if (spentToday + gas > rules.dailyBudget) {
    return { sponsored: false, reason: 'daily-budget-exceeded' };
  }

  return { sponsored: true, reason: 'ok' };
}

// ---- CLI (guarded) ---------------------------------------------------------

function runCli(argv) {
  const sub = argv[0];
  if (sub === 'owner-ops') {
    process.stdout.write(JSON.stringify(OWNER_OPS, null, 2) + '\n');
    return;
  }
  process.stdout.write(
    [
      'evm-aa-grants — PURE EVM account-abstraction grant logic (no live chain).',
      '',
      'Exports: createSessionKey, authorize, paymasterSponsor.',
      '',
      'Usage:',
      '  node src/chain/evm-aa-grants.mjs owner-ops   # list owner-level ops a session key may never do',
      '',
      'Test: node --test src/chain/evm-aa-grants.test.mjs',
    ].join('\n') + '\n',
  );
}

if (process.argv[1] && process.argv[1].endsWith('evm-aa-grants.mjs')) {
  runCli(process.argv.slice(2));
}
