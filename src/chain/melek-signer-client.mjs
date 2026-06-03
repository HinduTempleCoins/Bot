// melek-signer-client.mjs — the Bot-side client for MELEK-Signer (PRE-SIGNER 1).
//
// MELEK_SIGNER.md §3a/§6/§8-step-4: the Bot NEVER holds a chain private key.
// Every broadcast goes to the MELEK-Signer service:
//
//   POST <url>/v1/broadcast
//   Authorization: Bearer <opaque-token-issued-at-setup>
//   { "ops": [["transfer", {...}]], "client_ref": "signup-grant-alice-2026-05-27" }
//
// This module is the small HTTP wrapper that replaces
// Client.broadcast.sendOperations(ops, wif) across src/chain/, witness/,
// signup/, welcomer/ (the PRE-SIGNER 2 refactor). It is buildable and fully
// testable NOW — before the private melek-signer repo exists — because the
// transport is injectable and createMockSigner() below implements the same
// endpoint in-process.
//
// Key-custody invariants (BRIEF.md §7, SECURITY.md, adapter.mjs):
//   • The token is a scoped, revocable bearer credential — never a key. We
//     REFUSE tokens that look like a raw WIF / hex key (looksLikeRawKey).
//   • The token never appears in errors, logs, or thrown messages.
//   • Read-only modules don't need this client at all (MELEK_SIGNER.md §6).
//
//   import { createSignerClient, fromEnv, createMockSigner } from './melek-signer-client.mjs'
//   const signer = createSignerClient({ url, token });
//   const r = await signer.broadcast([['comment', {...}]], { clientRef: 'intro-post' });
//
//   node src/chain/melek-signer-client.mjs   # offline demo against the mock

import { looksLikeRawKey } from './adapter.mjs';

// ── client ────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Create a MELEK-Signer client.
 *  url    — base URL of the signer service (e.g. https://signer.internal:8443).
 *  token  — opaque scoped bearer token (MELEK_SIGNER.md §5 step 5). NEVER a key.
 *  fetch  — injectable transport (defaults to global fetch). Tests/mocks inject.
 *  timeoutMs — per-request timeout.
 */
export function createSignerClient({ url, token, fetch: fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!url || typeof url !== 'string') throw new Error('melek-signer client: url required');
  if (!token || typeof token !== 'string') throw new Error('melek-signer client: token required (scoped bearer, never a key)');
  if (looksLikeRawKey(token)) {
    // The whole point of the signer is zero WIF on this host. Refuse loudly,
    // without echoing the value.
    throw new Error('melek-signer client: token looks like a raw private key — refused (zero-WIF rule)');
  }
  const base = url.replace(/\/+$/, '');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('melek-signer client: no fetch transport available');

  /**
   * Broadcast operations through the signer.
   *  ops       — Graphene-style op list: [["transfer", {...}], ...]
   *  clientRef — human-auditable reference string, lands in the signer audit log.
   * Returns the signer's JSON result on success.
   * Throws SignerError (status + reason, NEVER the token) on any failure.
   */
  async function broadcast(ops, { clientRef = '' } = {}) {
    if (!Array.isArray(ops) || ops.length === 0) throw new SignerError(400, 'ops must be a non-empty array');
    for (const op of ops) {
      if (!Array.isArray(op) || typeof op[0] !== 'string' || !op[1] || typeof op[1] !== 'object') {
        throw new SignerError(400, 'each op must be ["kind", {payload}]');
      }
    }
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await doFetch(`${base}/v1/broadcast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ops, client_ref: String(clientRef || '') }),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } catch (e) {
      // network/timeout — sanitize: never include the token (it lives only in
      // the request header, but be defensive about transport error strings).
      throw new SignerError(0, `signer unreachable: ${sanitize(String(e && e.message || e), token)}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const reason = body && (body.error || body.reason) ? String(body.error || body.reason) : `HTTP ${res.status}`;
      throw new SignerError(res.status, sanitize(reason, token), body);
    }
    return body;
  }

  return Object.freeze({ broadcast, url: base });
}

/** Build a client from MELEK_SIGNER_URL / MELEK_SIGNER_TOKEN env (or return null when unset). */
export function fromEnv(env = process.env, opts = {}) {
  const url = env.MELEK_SIGNER_URL;
  const token = env.MELEK_SIGNER_TOKEN;
  if (!url || !token) return null; // not configured — callers stay read-only / dry-run
  return createSignerClient({ url, token, ...opts });
}

export class SignerError extends Error {
  constructor(status, reason, body = null) {
    super(`melek-signer: ${reason}`);
    this.name = 'SignerError';
    this.status = status;   // 0 = transport failure, else HTTP status
    this.reason = reason;
    this.body = body;
  }
}

function sanitize(s, token) {
  // Belt-and-braces: strip the token if any layer ever echoes it back.
  return token ? s.split(token).join('[redacted]') : s;
}

// ── in-process mock signer (the fixture the real repo will conform to) ───────
//
// Implements the same POST /v1/broadcast contract as a fetch-compatible
// function, so tests wire it straight into createSignerClient({ fetch }).
// Semantics mirrored from MELEK_SIGNER.md §3a/§3c:
//   • Bearer auth: unknown token → 401.
//   • Token scoping: each token carries an op-kind allowlist → 403 on violation.
//   • Optional policy hook: (ops, tokenInfo) → { ok, reason } — the PRE-SIGNER 4
//     policy engine plugs in here; default allows.
//   • Audit: every accepted AND rejected request is recorded (§3c audit rule).
//
//   const mock = createMockSigner({ tokens: { 'tok-posting': { scopes: ['comment', 'vote', 'custom_json'] } } });
//   const signer = createSignerClient({ url: 'http://mock', token: 'tok-posting', fetch: mock.fetch });

export function createMockSigner({ tokens = {}, policy = null, chainId = 'mock-melek' } = {}) {
  const audit = []; // { at: 'accepted'|'rejected', reason?, ops, clientRef, token: '<name only>' }
  let seq = 0;

  async function fetch(reqUrl, init = {}) {
    const respond = (status, obj) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => obj,
    });
    if (!/\/v1\/broadcast$/.test(String(reqUrl)) || (init.method || 'GET') !== 'POST') {
      return respond(404, { error: 'not found' });
    }
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    const m = /^Bearer (.+)$/.exec(auth);
    const tokenInfo = m ? tokens[m[1]] : undefined;
    let parsed = null;
    try { parsed = JSON.parse(init.body || '{}'); } catch { /* fallthrough */ }
    const ops = parsed && Array.isArray(parsed.ops) ? parsed.ops : [];
    const clientRef = parsed ? String(parsed.client_ref || '') : '';
    const reject = (status, reason) => {
      audit.push({ at: 'rejected', reason, ops, clientRef });
      return respond(status, { error: reason });
    };
    if (!tokenInfo) return reject(401, 'unknown or missing bearer token');
    if (!ops.length) return reject(400, 'ops must be a non-empty array');
    // op-kind scope check (§3a: "Token is scoped")
    const scopes = tokenInfo.scopes || [];
    for (const [kind] of ops) {
      if (!scopes.includes(kind)) return reject(403, `op '${kind}' outside token scope`);
    }
    // policy hook (§3c — PRE-SIGNER 4 plugs in here)
    if (typeof policy === 'function') {
      const verdict = await policy(ops, tokenInfo);
      if (!verdict || verdict.ok !== true) {
        return reject(403, (verdict && verdict.reason) || 'rejected by policy');
      }
    }
    seq += 1;
    const result = {
      ok: true,
      id: `mock-tx-${String(seq).padStart(6, '0')}`,
      block_num: 1000 + seq,
      chain_id: chainId,
      ops: ops.length,
      client_ref: clientRef,
    };
    audit.push({ at: 'accepted', ops, clientRef, txId: result.id });
    return respond(200, result);
  }

  return Object.freeze({
    fetch,
    audit: () => audit.slice(),
  });
}

// ── CLI demo (offline, against the mock) ─────────────────────────────────────
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mock = createMockSigner({
    tokens: {
      'tok-posting-demo': { scopes: ['comment', 'vote', 'custom_json'] },
      'tok-signup-demo': { scopes: ['transfer'] },
    },
  });
  const posting = createSignerClient({ url: 'http://mock', token: 'tok-posting-demo', fetch: mock.fetch });
  const r = await posting.broadcast([['comment', { author: 'hathor', body: 'hello' }]], { clientRef: 'demo' });
  console.log('accepted:', r);
  try {
    await posting.broadcast([['transfer', { from: 'hathor', to: 'alice', amount: '10.000 MELEK' }]]);
  } catch (e) {
    console.log('correctly refused out-of-scope transfer:', e.reason);
  }
  console.log('audit log:', JSON.stringify(mock.audit(), null, 2));
}
