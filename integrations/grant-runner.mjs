// grant-runner.mjs — the capability-grant RUNNER (queue #76).
//
// A grant here is a CAPABILITY, not a secret. Bots pull a SCOPED, time-limited, use-capped grant
// to *act* — and they never see the underlying key. This is the runtime that sits on top of the
// credential vault (integrations/credential-store.mjs) and the capability layer
// (integrations/secrets.mjs): the grant record references a vault capability *by name* and never
// embeds the secret. The privileged op is performed by an INJECTED action runner — the one piece
// that alone can reach the vault — which receives only { capability, scope }. The bot calls
// useGrant() and gets the action's RESULT back; the key never enters the bot's address space.
//
// Same safety posture as trade-grant.mjs: scope + caps + a hard boundary, loud on violations.
// Policy violations (expired / over-scope / capability mismatch / max_uses / revoked) THROW —
// they must be loud. The happy path is soft (no throws beyond bad input).
//
// Export:
//   issueGrant({ subject, capability, scopes, ttlMs, max_uses }) -> grant record (no secret)
//   checkGrant(grant, { capability, scope }) -> true | THROWS on any policy violation
//   useGrant(grant, { capability, scope, action }) -> result of the injected action runner
//   revoke(grantId) / isRevoked(grantId) -> in-memory revocation set
//   redactGrant(grant) -> safe-to-log view (no secret material; there is none anyway)
//   __setClock(fn) / __setActionRunner(fn) / __reset() -> test seams
//
//   node integrations/grant-runner.mjs   # prints a tiny demo of the policy decisions

import crypto from 'node:crypto';

// ---- injectable clock (tests advance time without real waiting) ----
let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); }

// ---- injectable action runner ----
// The runner is the ONLY thing that may reach the vault to perform the privileged op. It is given
// ONLY { capability, scope } — never a secret. Default is an inert no-op so the module is offline-
// safe and the bot path never touches a real key by accident.
let _actionRunner = async ({ capability, scope }) => ({ ok: true, ran: true, capability, scope });
export function __setActionRunner(fn) {
  _actionRunner = typeof fn === 'function'
    ? fn
    : async ({ capability, scope }) => ({ ok: true, ran: true, capability, scope });
}

const norm = (s) => String(s == null ? '' : s).trim();

// ---- in-memory revocation set (grant id -> revoked) ----
const _revoked = new Set();
export function revoke(grantId) {
  const id = norm(grantId);
  if (!id) throw new Error('revoke: grantId is required');
  _revoked.add(id);
  return true;
}
export function isRevoked(grantId) {
  return _revoked.has(norm(grantId));
}

// issueGrant — mint an opaque, scoped, time-limited, use-capped grant record. The record
// REFERENCES a vault capability by name (grant.capability); it does NOT and CANNOT embed the
// secret. There is no field on a grant that could carry key material.
export function issueGrant({ subject, capability, scopes = [], ttlMs, max_uses } = {}) {
  if (!subject || typeof subject !== 'string') throw new Error('issueGrant: subject (string) is required');
  if (!capability || typeof capability !== 'string') throw new Error('issueGrant: capability (string) is required');
  if (!Array.isArray(scopes)) throw new Error('issueGrant: scopes must be an array');
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error('issueGrant: ttlMs must be a positive number');
  const uses = Number(max_uses);
  if (!Number.isFinite(uses) || uses <= 0) throw new Error('issueGrant: max_uses must be a positive number');
  const now = _now();
  return {
    kind: 'grant',
    id: crypto.randomUUID(),
    subject,
    capability,           // vault capability NAME — a reference, never the secret
    scopes: scopes.map((s) => norm(s)).filter(Boolean),
    issuedAt: now,
    expiresAt: now + ttl,
    uses: 0,
    max_uses: uses,
  };
}

// checkGrant — verify a grant authorizes { capability, scope } RIGHT NOW. Returns true, or THROWS
// loudly on the first policy violation. Order: shape → revoked → expired → capability → scope →
// uses. Pure: does not mutate the grant.
export function checkGrant(grant, { capability, scope } = {}) {
  if (!grant || grant.kind !== 'grant' || !grant.id) throw new Error('checkGrant: invalid grant');
  if (isRevoked(grant.id)) throw new Error(`checkGrant: grant ${grant.id} is revoked`);
  if (_now() > grant.expiresAt) throw new Error(`checkGrant: grant ${grant.id} is expired`);
  if (norm(capability) !== norm(grant.capability)) {
    throw new Error(`checkGrant: capability mismatch (grant is scoped to '${grant.capability}')`);
  }
  if (!grant.scopes.includes(norm(scope))) {
    throw new Error(`checkGrant: scope '${norm(scope)}' not in grant scopes [${grant.scopes.join(', ')}]`);
  }
  if (grant.uses >= grant.max_uses) {
    throw new Error(`checkGrant: grant ${grant.id} exhausted (${grant.uses}/${grant.max_uses} uses)`);
  }
  return true;
}

// useGrant — the bot's entry point. checkGrant (throws on violation), then count the use and run
// the privileged op via the injected action runner. The runner is handed ONLY { capability, scope }
// — never a secret — and its result is returned to the bot. The bot never holds the key.
export async function useGrant(grant, { capability, scope, action } = {}) {
  checkGrant(grant, { capability, scope });
  // Reserve the use BEFORE running so the cap holds even if the action throws.
  grant.uses += 1;
  // Hand the runner ONLY the capability NAME and the scope. By construction there is no path here
  // by which a secret could be passed — the runner alone reaches the vault.
  return _actionRunner({ capability: norm(grant.capability), scope: norm(scope), action: action ?? null });
}

// redactGrant — a safe-to-log view. There is no secret material on a grant; this also strips any
// stray field so logs stay clean and stable.
export function redactGrant(grant) {
  if (!grant || typeof grant !== 'object') return null;
  return {
    kind: 'grant',
    id: grant.id,
    subject: grant.subject,
    capability: grant.capability, // a NAME, not a secret
    scopes: Array.isArray(grant.scopes) ? grant.scopes.slice() : [],
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
    uses: grant.uses,
    max_uses: grant.max_uses,
    revoked: isRevoked(grant.id),
  };
}

// Test-only: clear revocation state and reset injected seams.
export function __reset() {
  _revoked.clear();
  __setClock(null);
  __setActionRunner(null);
}

// ---- CLI (policy decisions only, never secrets) ----
if (process.argv[1] && process.argv[1].endsWith('grant-runner.mjs')) {
  (async () => {
    const g = issueGrant({ subject: 'hathor', capability: 'GEMINI_KEY', scopes: ['llm:compose'], ttlMs: 60_000, max_uses: 2 });
    // eslint-disable-next-line no-console
    console.log('grant:', redactGrant(g));
    // eslint-disable-next-line no-console
    console.log('in-scope use ->', await useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose', action: 'compose' }));
    try {
      await useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:withdraw' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('over-scope ->', e.message);
    }
    revoke(g.id);
    try {
      checkGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log('after revoke ->', e.message);
    }
  })();
}
