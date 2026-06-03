// lora-adapter.mjs — on-device LoRA/QLoRA swappable adapter registry + selection logic. Queue #94.
//
// WHAT THIS IS (and is NOT): this is PURE registry/selection logic. It records which adapters exist,
// who owns them, what domain + base model they target, and which one to load for a given request.
// It performs NO training and NO inference — the actual model layer (PEFT/LoRA load, forward pass)
// is out of scope here and lives elsewhere. This module just decides *what would be loaded*.
//
// WHY adapters matter (the design): a LoRA/QLoRA adapter is a small, swappable set of low-rank weight
// deltas applied ON TOP of a frozen base model. The base weights never change. That is exactly how
// Hathor "learns from them" — each person or domain gets their own adapter trained from their
// interaction, and the Witness loads it alongside the untouched base. Nothing the user contributes
// rewrites the shared base; it lives in a per-user adapter that can be swapped in, out, or revoked.
//
// This ties directly to Bio-NFT consent (bio-nft-mint.mjs / bio-consent.mjs): an adapter trained on a
// person's data is owned by that person. `owner` here is the consent/ownership anchor — selection and
// listing respect that ownership, so an adapter is a consented artifact, not absorbed base weights.
//
//   import { registerAdapter, selectAdapter, list, applyPlan } from './lora-adapter.mjs';
//   registerAdapter({ id: 'a1', owner: 'alice', domain: 'cryptology', baseModel: 'qwen2.5-coder:7b', path: '/adapters/a1' });
//   const best = selectAdapter({ user: 'alice', domain: 'cryptology', baseModel: 'qwen2.5-coder:7b' });
//   const plan = applyPlan('qwen2.5-coder:7b', best); // descriptor: frozen base + adapter overlay

// ── registry (process-local; persistence is a model-layer concern, out of scope) ─────────────────
const REGISTRY = new Map();

// Selection precedence tiers (higher wins). Per-user beats per-domain beats bare base.
export const TIER_USER = 3;   // adapter owned by this user (most specific → "learns from them")
export const TIER_DOMAIN = 2; // adapter for this domain, not user-scoped
export const TIER_BASE = 1;   // no adapter — frozen base model alone

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── registerAdapter ──────────────────────────────────────────────────────────────────────────────
// Records an adapter. `owner` is the consent/ownership anchor (Bio-NFT). A per-user adapter sets
// `owner` to that user; a shared per-domain adapter may omit owner (or set an org owner). Returns the
// stored record. Re-registering the same id overwrites (idempotent upsert).
export function registerAdapter({ id, owner = null, domain = null, baseModel, path } = {}) {
  if (!nonEmptyString(id)) throw new Error('registerAdapter: id is required');
  if (!nonEmptyString(baseModel)) throw new Error('registerAdapter: baseModel is required');
  if (!nonEmptyString(path)) throw new Error('registerAdapter: path is required');
  const record = {
    id: id.trim(),
    owner: nonEmptyString(owner) ? owner.trim() : null,
    domain: nonEmptyString(domain) ? domain.trim() : null,
    baseModel: baseModel.trim(),
    path: path.trim(),
    registeredAt: new Date().toISOString(),
  };
  REGISTRY.set(record.id, record);
  return { ...record };
}

// ── selectAdapter ──────────────────────────────────────────────────────────────────────────────
// Returns the best-matching adapter for a request, or null if only the bare frozen base applies.
// Hard requirement: an adapter only matches if its baseModel matches the request's baseModel — you
// can't overlay a Qwen adapter on a Llama base. Among baseModel-compatible candidates:
//   per-user (owner === user)  >  per-domain (domain === domain, no conflicting owner)  >  base.
// Within the same tier, the most recently registered wins (last-write freshness).
export function selectAdapter({ user = null, domain = null, baseModel } = {}) {
  if (!nonEmptyString(baseModel)) throw new Error('selectAdapter: baseModel is required');
  const wantUser = nonEmptyString(user) ? user.trim() : null;
  const wantDomain = nonEmptyString(domain) ? domain.trim() : null;

  let best = null;
  let bestTier = TIER_BASE; // floor: no adapter
  for (const a of REGISTRY.values()) {
    if (a.baseModel !== baseModel.trim()) continue; // base-model compatibility is mandatory

    let tier = 0;
    if (wantUser && a.owner === wantUser && (!wantDomain || !a.domain || a.domain === wantDomain)) {
      tier = TIER_USER;
    } else if (wantDomain && a.domain === wantDomain && !a.owner) {
      // a per-domain adapter is shared (no per-user owner); a user-owned adapter for another user
      // must NOT leak across users at the domain tier.
      tier = TIER_DOMAIN;
    } else {
      continue; // not a match for this request
    }

    if (tier > bestTier || (best && tier === bestTier && a.registeredAt >= best.registeredAt)) {
      best = a;
      bestTier = tier;
    }
  }
  return best ? { ...best, matchTier: bestTier } : null;
}

// ── list ──────────────────────────────────────────────────────────────────────────────────────
// Lists registered adapters, optionally filtered by { owner } and/or { domain }. No filter → all.
export function list({ owner = null, domain = null } = {}) {
  const wantOwner = nonEmptyString(owner) ? owner.trim() : null;
  const wantDomain = nonEmptyString(domain) ? domain.trim() : null;
  const out = [];
  for (const a of REGISTRY.values()) {
    if (wantOwner !== null && a.owner !== wantOwner) continue;
    if (wantDomain !== null && a.domain !== wantDomain) continue;
    out.push({ ...a });
  }
  return out;
}

// ── applyPlan ──────────────────────────────────────────────────────────────────────────────────
// Describes HOW a base + adapter would be loaded — a plan, not an action. The invariant this plan
// encodes: the base model is FROZEN (its weights are never modified); the adapter is overlaid as a
// swappable low-rank delta. If adapter is null, the plan is the bare frozen base.
export function applyPlan(baseModel, adapter = null) {
  if (!nonEmptyString(baseModel)) throw new Error('applyPlan: baseModel is required');
  const base = baseModel.trim();
  if (!adapter) {
    return {
      baseModel: base,
      baseFrozen: true,
      adapter: null,
      adapterOwner: null,
      mode: 'base-only',
      modifiesBaseWeights: false,
      description: `Load frozen base ${base} with no adapter overlay.`,
    };
  }
  if (adapter.baseModel && adapter.baseModel !== base) {
    throw new Error(`applyPlan: adapter baseModel "${adapter.baseModel}" does not match "${base}"`);
  }
  return {
    baseModel: base,
    baseFrozen: true,                 // base weights are never touched
    adapter: adapter.id,
    adapterPath: adapter.path,
    adapterOwner: adapter.owner,      // consent/ownership anchor (Bio-NFT)
    adapterDomain: adapter.domain,
    mode: 'frozen-base+adapter',
    modifiesBaseWeights: false,       // load-bearing invariant: learning lives in the adapter
    description:
      `Load frozen base ${base}, then overlay swappable adapter ${adapter.id} ` +
      `(${adapter.path}). Base weights unchanged; adapter can be swapped or revoked.`,
  };
}

// Test-only helper: clear the registry. Exposed for offline tests; harmless in prod (no I/O).
export function _resetRegistry() {
  REGISTRY.clear();
}

// ── CLI demo (offline) ──────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('lora-adapter.mjs')) {
  const BASE = 'qwen2.5-coder:7b';
  registerAdapter({ id: 'dom-cryptology', domain: 'cryptology', baseModel: BASE, path: '/adapters/dom-cryptology' });
  registerAdapter({ id: 'alice-cryptology', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/adapters/alice-cryptology' });

  console.log('all adapters:', list().map((a) => a.id).join(', '));
  console.log('alice-owned:', list({ owner: 'alice' }).map((a) => a.id).join(', '));

  const forAlice = selectAdapter({ user: 'alice', domain: 'cryptology', baseModel: BASE });
  console.log('select(alice) →', forAlice && forAlice.id, 'tier=', forAlice && forAlice.matchTier);

  const forBob = selectAdapter({ user: 'bob', domain: 'cryptology', baseModel: BASE });
  console.log('select(bob)   →', forBob && forBob.id, 'tier=', forBob && forBob.matchTier);

  const none = selectAdapter({ user: 'carol', domain: 'astronomy', baseModel: BASE });
  console.log('select(carol/astronomy) →', none, '(falls back to frozen base)');

  console.log('plan(alice):', JSON.stringify(applyPlan(BASE, forAlice)));
  console.log('plan(base) :', JSON.stringify(applyPlan(BASE, none)));
}
