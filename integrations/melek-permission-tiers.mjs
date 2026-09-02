// melek-permission-tiers.mjs — the graded consent model for "distributing MELEK-Signer with minimal
// permission." Three tiers, and the whole point is that funds-moving CANNOT be asked for casually — and
// right now, not at all.
//
//   IDENTITY  (openid/profile/email)        → who you are. Auto-granted at login. The public OIDC surface
//                                              (melek-oidc-provider) only ever does this.
//   SOCIAL    (posting/comment/vote/follow)  → act socially as you (a post, a vote, a follow). ALLOWED, but
//                                              only behind the Signer's EXPLICIT approval screen — never
//                                              auto, never silent. This is "ask for more permission."
//   FUNDS     (active/transfer/withdraw/…)   → move value. HARD-DISABLED. Refused everywhere regardless of
//                                              consent (FUNDS_ENABLED is false), and even when a future
//                                              operator flips it on it is never auto and always requires the
//                                              strongest consent. Operator: "not just let people ask for it
//                                              casually, and not yet at all."
//
// Fail-closed: an unknown scope is denied, not waved through. Pure data + pure functions, offline-tested,
// holds no keys and mints no tokens — it only decides what MAY be granted; the Signer enforces it.
//
//   import * as tiers from './melek-permission-tiers.mjs'

export const TIER = Object.freeze({ IDENTITY: 'identity', SOCIAL: 'social', FUNDS: 'funds', UNKNOWN: 'unknown' });

// The master rank — higher tier = more dangerous. Used to pick the "overall" tier of a request.
const RANK = { identity: 1, social: 2, funds: 3, unknown: 99 };

// FUNDS is OFF. This is a code-level switch, default false. The env override exists only so a future,
// deliberate operator decision can enable it — it does NOT relax any of the other funds protections.
export const FUNDS_ENABLED = process.env.MELEK_FUNDS_SCOPE_ENABLED === '1';

// Canonical scope → tier map. (Aliases included so both OIDC-style and Graphene-op-style names classify.)
const SCOPE_TIER = {
  // identity
  openid: TIER.IDENTITY, profile: TIER.IDENTITY, email: TIER.IDENTITY, offline_access: TIER.IDENTITY,
  identity: TIER.IDENTITY,
  // social (posting-key actions — no money moves)
  posting: TIER.SOCIAL, comment: TIER.SOCIAL, post: TIER.SOCIAL, vote: TIER.SOCIAL, follow: TIER.SOCIAL,
  reblog: TIER.SOCIAL, custom_json: TIER.SOCIAL, social: TIER.SOCIAL,
  // funds (value moves / high-authority) — DISABLED
  active: TIER.FUNDS, owner: TIER.FUNDS, transfer: TIER.FUNDS, transfer_to_vesting: TIER.FUNDS,
  withdraw_vesting: TIER.FUNDS, delegate_vesting_shares: TIER.FUNDS, delegate: TIER.FUNDS,
  limit_order_create: TIER.FUNDS, limit_order_cancel: TIER.FUNDS, market: TIER.FUNDS,
  broadcast: TIER.FUNDS, escrow_transfer: TIER.FUNDS, convert: TIER.FUNDS, withdraw: TIER.FUNDS,
};

const LABELS = {
  openid: 'Confirm your MELEK identity', profile: 'Your public profile (name, avatar)', email: 'Your email address',
  offline_access: 'Stay signed in',
  posting: 'Post, comment, vote and follow as you', comment: 'Publish posts & comments as you',
  vote: 'Vote on posts as you', follow: 'Follow accounts as you', custom_json: 'Take app actions as you',
  active: 'Move funds & change account authority', transfer: 'Send MELEK/tokens from your account',
  withdraw_vesting: 'Power down / withdraw stake', delegate: 'Delegate your stake', owner: 'Full account control',
};

const norm = (s) => String(s || '').trim().toLowerCase();
export function asScopes(scope) {
  return (Array.isArray(scope) ? scope : String(scope || '').split(/[ ,+]+/)).map(norm).filter(Boolean);
}

/** The tier of one scope. Unknown scopes are UNKNOWN (and denied by policy). */
export function scopeTier(scope) { return SCOPE_TIER[norm(scope)] || TIER.UNKNOWN; }
/** A human label for a consent screen. */
export function scopeLabel(scope) { return LABELS[norm(scope)] || `“${norm(scope)}” (unrecognized — denied)`; }

/** Policy for a single scope: what the Signer may do with it. */
export function scopePolicy(scope) {
  const tier = scopeTier(scope);
  switch (tier) {
    case TIER.IDENTITY: return { tier, allowed: true, auto: true, requiresConsent: false };
    case TIER.SOCIAL:   return { tier, allowed: true, auto: false, requiresConsent: true };
    case TIER.FUNDS:    return { tier, allowed: FUNDS_ENABLED, auto: false, requiresConsent: true,
      reason: FUNDS_ENABLED ? 'funds-moving requires the strongest, explicit approval' : 'funds-moving is disabled — not available yet' };
    default:            return { tier: TIER.UNKNOWN, allowed: false, auto: false, requiresConsent: true, reason: 'unrecognized scope — denied' };
  }
}

/**
 * Classify a whole requested scope set. Returns per-scope policy plus the aggregate decision:
 *   tier              — the highest (most dangerous) tier requested
 *   grantable/blocked — scope names that may / may not be granted
 *   requiresConsent   — any non-identity scope present (an explicit approval screen is needed)
 *   fundsRequested    — a funds scope was asked for (so it must be shown as blocked)
 *   canProceed        — nothing in the request is blocked (all grantable)
 */
export function classifyScopes(scope) {
  const list = asScopes(scope);
  const rows = list.map((s) => ({ scope: s, label: scopeLabel(s), ...scopePolicy(s) }));
  const grantable = rows.filter((r) => r.allowed).map((r) => r.scope);
  const blocked = rows.filter((r) => !r.allowed).map((r) => r.scope);
  const tier = rows.reduce((hi, r) => (RANK[r.tier] > RANK[hi] ? r.tier : hi), TIER.IDENTITY);
  return {
    scopes: rows,
    tier,
    grantable,
    blocked,
    requiresConsent: rows.some((r) => r.requiresConsent),
    fundsRequested: rows.some((r) => r.tier === TIER.FUNDS),
    canProceed: blocked.length === 0 && rows.length > 0,
  };
}

/**
 * The structured model a Signer approval screen renders. Each row is state:
 *   'auto'    — granted by signing in (identity)
 *   'consent' — needs the user to explicitly approve (social)
 *   'blocked' — refused (funds while disabled, or unknown scope)
 */
export function consentModel(clientId, scope) {
  const c = classifyScopes(scope);
  const rows = c.scopes.map((r) => ({
    scope: r.scope, label: r.label, tier: r.tier,
    state: !r.allowed ? 'blocked' : (r.auto ? 'auto' : 'consent'),
    warning: r.reason || (r.tier === TIER.SOCIAL ? 'This lets the app act as you socially.' : ''),
  }));
  return {
    clientId: String(clientId || ''),
    rows,
    needsConsent: c.requiresConsent,
    fundsBlocked: c.fundsRequested && !FUNDS_ENABLED,
    canProceed: c.canProceed,
    note: c.fundsRequested && !FUNDS_ENABLED
      ? 'Funds-moving permission is turned off across MELEK right now — this request cannot move any value.'
      : '',
  };
}

/**
 * The enforcement hook the Signer's token minter calls before issuing a capability token. Returns the
 * scopes it MAY grant; THROWS if a funds/unknown scope is present (defense in depth — a capability token is
 * never minted for funds while disabled, no matter what the consent screen did).
 */
export function guardGrant(scope) {
  const c = classifyScopes(scope);
  if (c.blocked.length) {
    const funds = c.scopes.some((r) => r.tier === TIER.FUNDS);
    throw new Error(funds
      ? `melek-permission: funds-moving scope refused (disabled): ${c.blocked.join(', ')}`
      : `melek-permission: scope refused: ${c.blocked.join(', ')}`);
  }
  return c.grantable;
}
