// site/connect/connections.mjs — the glue between the "Connect your own API keys" surface and the
// capability vault. This is where a signed-in tenant's OWN third-party key (an AI provider key, a
// CourtListener token, an exchange key…) becomes a CAPABILITY and stops being a plaintext secret.
//
// THE INVARIANTS (all inherited from the layers below, wired together here):
//   • The raw key is written STRAIGHT into the credential vault (integrations/credential-store.mjs),
//     encrypted at rest immediately. It is never returned, never logged, never handed back to a page.
//   • Every connection is owned by exactly one tenant. Per-tenant isolation is enforced by
//     integrations/tenant-grants.mjs: one tenant can never read, use, or revoke another's — and any
//     attempt to reach across the boundary is LOUD (CrossTenantError), not a silent empty result.
//   • Using a key is a capability: useConnection() runs the caller's fn with the decrypted secret in
//     scope and returns fn's RESULT. The secret itself never leaves the vault.
//
// SHAPE. tenant-grants is the per-tenant index (which providers a tenant has connected + the vault
// NAME each references). credential-store holds the encrypted secret + cap/revoked. The vault name
// is tenant-scoped (`<tenant>::<provider>`) so two tenants' same-provider keys can never collide.
//
// Fully offline / injectable: the modules below are in-memory + injectable, so this whole file is
// unit-testable with no network and no real secret. Soft-fail on reads; loud on isolation violations.

import { store, grant, revoke as vaultRevoke, describe as vaultDescribe } from '../../integrations/credential-store.mjs';
import {
  connectCapability, listCapabilities, getCapability, assertTenantOwns,
  revokeTenant, CrossTenantError,
} from '../../integrations/tenant-grants.mjs';

const norm = (s) => String(s == null ? '' : s).trim();
// Provider ids stay to a tame charset so a name can never do anything odd in a vault key or the UI.
const normProvider = (s) => norm(s).toLowerCase().replace(/[^a-z0-9._-]/g, '');

// The vault credential NAME for a (tenant, provider). Tenant-scoped → no cross-tenant collision.
export const vaultName = (tenant, provider) => `${norm(tenant).toLowerCase()}::${normProvider(provider)}`;

// Accept a cap as an object ({ calls } / { spend }), a bare number/numeric string (→ { calls: n }),
// or nothing (→ {}). Anything else is dropped rather than trusted.
function normCap(cap) {
  if (cap == null || cap === '') return {};
  if (typeof cap === 'number' && Number.isFinite(cap)) return { calls: cap };
  if (typeof cap === 'string' && cap.trim() !== '' && Number.isFinite(Number(cap))) return { calls: Number(cap) };
  if (typeof cap === 'object') return cap;
  return {};
}

/**
 * connectProvider — a tenant connects THEIR OWN key for a provider. The raw key goes straight into
 * the encrypted vault; a tenant-scoped capability reference is recorded. Returns a redacted view —
 * NEVER the key. Overwrites a prior connection for the same (tenant, provider).
 *
 * @returns {{ ok:true, provider, scope, cap, revoked:false } | { ok:false, reason }}
 */
export function connectProvider(tenant, { provider, scope, key, cap } = {}) {
  const t = norm(tenant).toLowerCase();
  if (!t) return { ok: false, reason: 'not signed in' };
  const prov = normProvider(provider);
  if (!prov) return { ok: false, reason: 'provider is required' };
  if (key == null || key === '') return { ok: false, reason: 'key is required' };
  const sc = norm(scope) || `provider:${prov}`;
  const capObj = normCap(cap);
  const name = vaultName(t, prov);
  try {
    // Encrypted at rest immediately. store() returns { name, scope, cap } — never the secret.
    store({ name, secret: key, scope: sc, cap: capObj });
    // Record the per-tenant capability REFERENCE (a vault name, never the secret).
    connectCapability(t, { provider: prov, capability: name, scopes: [sc] });
    return { ok: true, provider: prov, scope: sc, cap: capObj, revoked: false };
  } catch (e) {
    return { ok: false, reason: e && e.message ? e.message : 'could not connect' };
  }
}

/**
 * listConnections — the tenant's connected providers, redacted. Shows ONLY
 * { provider, scope, cap, revoked, added } — never the key. Per-tenant: a tenant can never see
 * another's through this surface (tenant-grants scopes the lookup). Soft: unknown tenant → [].
 */
export function listConnections(tenant) {
  const t = norm(tenant).toLowerCase();
  if (!t) return [];
  const caps = listCapabilities(t); // per-tenant, already redacted (no secret, no ciphertext)
  return caps.map((c) => {
    const meta = vaultDescribe(c.capability) || {};
    return {
      provider: c.provider,
      scope: (c.scopes && c.scopes[0]) || meta.scope || '',
      cap: meta.cap || {},
      revoked: !!meta.revoked,
      added: c.connectedAt,
    };
  });
}

/**
 * revokeConnection — revoke ONE provider for a tenant. Flags the vault credential revoked (future
 * use() is blocked; the audit trail is kept) — the connection then shows revoked:true in the list.
 * Only ever touches the caller's OWN (getCapability is tenant-scoped); assertTenantOwns makes the
 * ownership check explicit and LOUD. Soft: nothing to revoke → false.
 */
export function revokeConnection(tenant, provider) {
  const t = norm(tenant).toLowerCase();
  const prov = normProvider(provider);
  if (!t || !prov) return false;
  const rec = getCapability(t, prov); // own only — another tenant's is invisible here (null)
  if (!rec) return false;
  assertTenantOwns(t, rec.id);        // loud isolation boundary — throws CrossTenantError if not ours
  vaultRevoke(rec.capability);        // flag revoked in the vault; use() is now blocked
  return true;
}

/**
 * disconnectTenant — drop ALL of a tenant's connections (account disconnect / GDPR delete). Removes
 * the per-tenant references and revokes each underlying vault credential. Returns the count.
 */
export function disconnectTenant(tenant) {
  const t = norm(tenant).toLowerCase();
  if (!t) return 0;
  for (const c of listCapabilities(t)) {
    try { vaultRevoke(c.capability); } catch { /* already gone */ }
  }
  return revokeTenant(t);
}

/**
 * useConnection — THE capability. Runs the caller's fn with the tenant's decrypted key in scope and
 * returns fn's RESULT. The secret is never returned to the caller and is dropped after fn runs. The
 * tenant boundary is enforced (getCapability + assertTenantOwns) before the key is ever decrypted.
 *
 * @param {string} tenant
 * @param {string} provider
 * @param {(secret:string)=>any} fn   the caller's action; receives the secret, returns a non-secret result
 * @param {number} [cost]             optional per-use cost for spend caps
 */
export async function useConnection(tenant, provider, fn, cost = 0) {
  const t = norm(tenant).toLowerCase();
  const prov = normProvider(provider);
  if (!t) throw new Error('not signed in');
  const rec = getCapability(t, prov);
  if (!rec) throw new Error(`no connection for provider '${prov}'`);
  assertTenantOwns(t, rec.id);        // loud isolation — never act on another tenant's capability
  return grant(rec.capability).use(fn, cost);
}

export { CrossTenantError };
