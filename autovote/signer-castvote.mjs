// signer-castvote.mjs — the MELEK-Signer broadcast seam for the witness curation runners.
//
// This is the thin adapter that replaces the vault-JIT-WIF + dhive `castVote` used by the live autovote
// (zero-payout-runner.mjs) and the karma curation trail (karma-curation-runner.mjs). Instead of fetching
// @hathor's posting WIF from the vault and signing locally, it hands a single Graphene op to MELEK-Signer's
// `/v1/broadcast` with a SCOPED, revocable BEARER TOKEN. The Signer holds @hathor's keys (KMS-wrapped) and
// signs on the account's behalf — the autovote box never holds, reads, or signs with a key: it holds only
// the token, read JIT from the environment (never the repo).
//
// KEY CUSTODY: zero WIF here, zero WIF on the box. The token is a capability handle (no key material). It is
// scoped to posting-authority ops only (vote/comment) — it cannot transfer or change keys — and is revocable
// at the Signer at any time. The token is never logged or printed.
//
// House style: ESM, injectable fetch, soft-fail (throws on a failed broadcast so the runner's per-post
// try/catch skips that one and keeps curating), no top-level network, offline-testable.

const DEFAULT_SIGNER_URL = 'https://signer.melek.salon';
// Posting authority covers vote + comment; the IONOS mainnet signer defaults role to `active`, so we ALWAYS
// send an explicit role so a posting op is signed with the posting key.
const POSTING_OPS = new Set(['vote', 'comment', 'delete_comment', 'custom_json']);

/** Derive the Graphene authority a set of ops needs (posting for vote/comment, else active). */
export function roleForOps(ops) {
  return (Array.isArray(ops) && ops.every((op) => POSTING_OPS.has(op && op[0]))) ? 'posting' : 'active';
}

/**
 * Broadcast one or more ops through MELEK-Signer with a scoped bearer token.
 * @param {object} cfg
 * @param {string} cfg.token       scoped bearer token for the account (NEVER logged)
 * @param {Array}  cfg.ops         Graphene ops, e.g. [['vote',{voter,author,permlink,weight}]]
 * @param {string} [cfg.signerUrl] default https://signer.melek.salon
 * @param {string} [cfg.clientId]  client_ref label (default 'autovote')
 * @param {string} [cfg.role]      'posting'|'active' — defaults to roleForOps(ops)
 * @param {Function} [cfg.fetch]   injectable fetch
 * @returns {Promise<object>} the chain result ({ id, block_num, ... })
 */
export async function signerBroadcast({ token, ops, signerUrl = DEFAULT_SIGNER_URL, clientId = 'autovote', role, fetch: f = fetch } = {}) {
  if (!token) throw new Error('signer-castvote: no bearer token (token NOT logged)');
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('signer-castvote: no ops');
  const res = await f(`${signerUrl}/v1/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ops, client_ref: clientId, role: role || roleForOps(ops) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error((j && j.error) || `MELEK-Signer broadcast failed: ${res.status}`);
  return j.result;
}

/**
 * Build the `castVote` seam the curation runners inject, backed by MELEK-Signer.
 * Signature matches the dhive seam it replaces: castVote({voter,author,permlink,weight}) → result.
 * @param {object} cfg  { token, signerUrl?, clientId?, fetch? }
 * @returns {(v:{voter:string,author:string,permlink:string,weight:number})=>Promise<object>}
 */
export function makeSignerCastVote({ token, signerUrl = DEFAULT_SIGNER_URL, clientId = 'autovote', fetch: f = fetch } = {}) {
  if (!token) throw new Error('signer-castvote: no bearer token (token NOT logged)');
  return async ({ voter, author, permlink, weight }) => {
    const op = ['vote', { voter, author, permlink, weight }];
    return signerBroadcast({ token, ops: [op], signerUrl, clientId, role: 'posting', fetch: f });
  };
}

/**
 * Read the scoped token JIT from the environment (never the repo) and build the signer-backed castVote.
 * MELEK_SIGNER_TOKEN is the token; MELEK_SIGNER_URL / MELEK_SIGNER_CLIENT_ID configure the endpoint.
 * Returns null (not a throw) when no token is present, so a runner cleanly falls back to a DRY RUN
 * instead of crashing — and NEVER falls back to a local key.
 * @param {object} [opts] { env?, fetch? }
 * @returns {Function|null} castVote seam, or null if unconfigured
 */
export function signerCastVoteFromEnv({ env = process.env, fetch: f = fetch } = {}) {
  const token = env.MELEK_SIGNER_TOKEN;
  if (!token) return null;
  return makeSignerCastVote({
    token,
    signerUrl: env.MELEK_SIGNER_URL || DEFAULT_SIGNER_URL,
    clientId: env.MELEK_SIGNER_CLIENT_ID || 'autovote',
    fetch: f,
  });
}
