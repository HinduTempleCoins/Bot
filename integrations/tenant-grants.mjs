// tenant-grants.mjs — multi-tenant, per-MEMBER capability isolation (task #77).
//
// Each MEMBER (tenant) connects THEIR OWN external accounts/APIs. The system records that
// tenant T holds a CAPABILITY for provider P — a *reference* to a vault capability name
// (integrations/credential-store.mjs) — and NEVER the raw secret. This module sits ON TOP of
// the single-grant runner (integrations/grant-runner.mjs): grant-runner mints/checks one
// capability grant; this module owns the per-tenant registry and the isolation boundary that
// keeps one member's capabilities invisible and unreachable from another's.
//
// THE load-bearing invariant: cross-tenant access is LOUD. Normal operations soft-fail (return
// null / empty), but any attempt by tenant A to reach a capability owned by tenant B THROWS a
// CrossTenantError. No raw secret is ever returned, logged, or embedded in a record.
//
//   import {
//     connectCapability, listCapabilities, getCapability, assertTenantOwns,
//     revokeTenant, revokeCapability, tenantSummary, CrossTenantError,
//     __setClock, __reset,
//   } from './integrations/tenant-grants.mjs'
//
//   connectCapability('memberA', { provider: 'gemini', capability: 'A_GEMINI_KEY', scopes: ['llm'], ttlMs: 3600_000 })
//   listCapabilities('memberA')          // [{ id, tenantId, provider, capability, scopes, ... }] — A's only, NO secrets
//   getCapability('memberA', 'gemini')   // that record, or null
//   assertTenantOwns('memberA', capId)   // true, or THROWS CrossTenantError if capId is B's
//   revokeCapability('memberA', 'gemini')// drop one provider for A
//   revokeTenant('memberA')              // GDPR delete — drop all of A's, returns count
//   tenantSummary()                      // { tenants, capabilities } — aggregate counts only
//
//   node integrations/tenant-grants.mjs  # prints aggregate counts only (never per-tenant detail)

import crypto from 'node:crypto';

// ---- injectable clock (tests advance time without real waiting) ----
let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); }

// ---- loud error for the one thing that must never be silent ----
export class CrossTenantError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CrossTenantError';
  }
}

const norm = (s) => String(s == null ? '' : s).trim();

// ---- registry: capabilityId -> record ----
// record: { id, tenantId, provider, capability, scopes, connectedAt, expiresAt }
// `capability` is a vault capability NAME (a reference); there is no field that can carry a secret.
const _caps = new Map();

// index: tenantId -> Set<capabilityId> (fast per-tenant lookup + isolation checks)
const _byTenant = new Map();

function isExpired(record) {
  return Number.isFinite(record.expiresAt) && _now() > record.expiresAt;
}

// A safe-to-return view of a record. By construction there is no secret here; this also strips
// any stray field so callers never get more than the redacted shape.
function redact(record) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    provider: record.provider,
    capability: record.capability, // a NAME (vault reference), never the secret
    scopes: record.scopes.slice(),
    connectedAt: record.connectedAt,
    expiresAt: record.expiresAt,
  };
}

// connectCapability — a member connects their own external account. Records that this tenant holds
// a capability for the provider, referencing a vault capability by name. Overwrites a prior
// capability for the same (tenant, provider) — one connection per provider per tenant. Bad input
// throws (input validation), but this is a normal op otherwise.
export function connectCapability(tenantId, { provider, capability, scopes = [], ttlMs } = {}) {
  const tid = norm(tenantId);
  if (!tid) throw new Error('connectCapability: tenantId is required');
  const prov = norm(provider);
  if (!prov) throw new Error('connectCapability: provider is required');
  const cap = norm(capability);
  if (!cap) throw new Error('connectCapability: capability (vault name) is required');
  if (!Array.isArray(scopes)) throw new Error('connectCapability: scopes must be an array');
  let expiresAt = Infinity;
  if (ttlMs != null) {
    const ttl = Number(ttlMs);
    if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('connectCapability: ttlMs must be a positive number');
    expiresAt = _now() + ttl;
  }

  // Drop any existing connection for this (tenant, provider) so it stays one-per-provider.
  const existing = getCapability(tid, prov);
  if (existing) _drop(existing.id);

  const record = {
    id: crypto.randomUUID(),
    tenantId: tid,
    provider: prov,
    capability: cap,
    scopes: scopes.map((s) => norm(s)).filter(Boolean),
    connectedAt: _now(),
    expiresAt,
  };
  _caps.set(record.id, record);
  if (!_byTenant.has(tid)) _byTenant.set(tid, new Set());
  _byTenant.get(tid).add(record.id);
  return redact(record);
}

// listCapabilities — that tenant's NON-expired capabilities ONLY, redacted (no secrets). A tenant
// can never see another tenant's capabilities through this surface. Soft: unknown tenant → [].
export function listCapabilities(tenantId) {
  const tid = norm(tenantId);
  const ids = _byTenant.get(tid);
  if (!ids) return [];
  const out = [];
  for (const id of ids) {
    const record = _caps.get(id);
    if (!record || isExpired(record)) continue;
    out.push(redact(record));
  }
  return out;
}

// getCapability — this tenant's NON-expired capability for the provider, or null. Returns only the
// caller's own; another tenant's connection for the same provider is invisible here (returns null).
export function getCapability(tenantId, provider) {
  const tid = norm(tenantId);
  const prov = norm(provider);
  const ids = _byTenant.get(tid);
  if (!ids) return null;
  for (const id of ids) {
    const record = _caps.get(id);
    if (!record || isExpired(record)) continue;
    if (record.provider === prov) return redact(record);
  }
  return null;
}

// assertTenantOwns — THE core isolation guarantee. Verifies that `capabilityId` belongs to
// `tenantId`. Returns true if so; THROWS CrossTenantError if the capability is owned by a
// different tenant. An unknown / expired capability also throws CrossTenantError — a caller
// must never be told an id it cannot legitimately own "exists but isn't yours" vs "is gone";
// either way it is not theirs to touch, and the denial is loud.
export function assertTenantOwns(tenantId, capabilityId) {
  const tid = norm(tenantId);
  const cid = norm(capabilityId);
  if (!tid) throw new Error('assertTenantOwns: tenantId is required');
  if (!cid) throw new Error('assertTenantOwns: capabilityId is required');
  const record = _caps.get(cid);
  if (!record) {
    throw new CrossTenantError(`tenant '${tid}' does not own capability '${cid}' (no such capability)`);
  }
  if (record.tenantId !== tid) {
    // Do NOT name the true owner — that itself would leak cross-tenant information.
    throw new CrossTenantError(`tenant '${tid}' may not access capability '${cid}' — it belongs to a different tenant`);
  }
  if (isExpired(record)) {
    throw new CrossTenantError(`tenant '${tid}' capability '${cid}' is expired`);
  }
  return true;
}

// internal: remove one capability by id from both indexes.
function _drop(capabilityId) {
  const record = _caps.get(capabilityId);
  if (!record) return false;
  _caps.delete(capabilityId);
  const ids = _byTenant.get(record.tenantId);
  if (ids) {
    ids.delete(capabilityId);
    if (ids.size === 0) _byTenant.delete(record.tenantId);
  }
  return true;
}

// revokeCapability — drop ONE provider connection for a tenant (scoped). Soft: returns true if a
// connection was removed, false if there was nothing to remove. Only ever touches the caller's own.
export function revokeCapability(tenantId, provider) {
  const existing = getCapability(tenantId, provider);
  if (!existing) return false;
  return _drop(existing.id);
}

// revokeTenant — drop ALL of one tenant's capabilities (account disconnect / GDPR delete). Returns
// the count removed. Never touches another tenant's records. Soft: unknown tenant → 0.
export function revokeTenant(tenantId) {
  const tid = norm(tenantId);
  const ids = _byTenant.get(tid);
  if (!ids) return 0;
  let count = 0;
  for (const id of Array.from(ids)) {
    if (_caps.delete(id)) count += 1;
  }
  _byTenant.delete(tid);
  return count;
}

// tenantSummary — aggregate counts ONLY (no per-tenant, no per-secret detail). Expired
// capabilities are not counted. Safe to log / expose on an admin status surface.
export function tenantSummary() {
  let capabilities = 0;
  const tenants = new Set();
  for (const record of _caps.values()) {
    if (isExpired(record)) continue;
    capabilities += 1;
    tenants.add(record.tenantId);
  }
  return { tenants: tenants.size, capabilities };
}

// Test-only: clear all state and reset injected seams.
export function __reset() {
  _caps.clear();
  _byTenant.clear();
  __setClock(null);
}

// ---- CLI (aggregate counts only, never per-tenant or secret detail) ----
if (process.argv[1] && process.argv[1].endsWith('tenant-grants.mjs')) {
  const s = tenantSummary();
  // eslint-disable-next-line no-console
  console.log('tenant-grants — multi-tenant capability registry (aggregate only, never secrets):');
  // eslint-disable-next-line no-console
  console.log(`  tenants=${s.tenants}  capabilities=${s.capabilities}`);
}
