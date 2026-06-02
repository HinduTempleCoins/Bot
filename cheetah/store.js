/**
 * store.js — Cheetah's evidenced whitelist/blacklist + findings log.
 *
 * Per CHEETAH_ADVANCED.md §4: replace the old hand-kept flat list with a
 * living, evidenced record. Each entry carries WHY — the evidence that
 * resolved it — not just an account name. The store is read by Hathor when
 * handling resolution conversations.
 *
 * BACKING STORE (migrated 2026-06-02): this module no longer keeps a private
 * cheetah/.store.json. It reads/writes the SHARED multi-bot store
 * (store/index.mjs), namespaced:
 *   - cheetah.findings   — every text/image finding
 *   - cheetah.whitelist  — evidenced authorship proofs (suppress crediting)
 *   - cheetah.blacklist  — confirmed repeat pass-off (human-added only)
 * so Hathor (and future siblings) read Cheetah's findings from one coordinated
 * substrate instead of a file private to this directory.
 *
 * API COMPAT: the public functions keep their previous signatures, including
 * the trailing `pathOrRoot` argument. That argument now selects the store
 * ROOT (a directory) rather than a single JSON file:
 *   - undefined            → the default shared store (store/.data via env)
 *   - a Store instance     → used directly
 *   - a directory path     → a Store rooted there
 *   - a legacy "*.json"    → a Store rooted at "<file>.nsdata/" (keeps each
 *                            caller's temp store isolated; back-compat for the
 *                            existing tests that pass a temp file path)
 *
 * Per-namespace record shapes (unchanged in spirit):
 *   findings:  { id, discovered_at, post, source, confidence, status, resolution? }
 *   whitelist: { id, account, material, reason, evidence, added_at, added_by }
 *   blacklist: { id, account, pattern, evidence, added_at, added_by }
 *
 * The blacklist is intentionally hard to add to — entries require the full
 * resolution process (Cheetah surfaces → person responds → Hathor resolves
 * → repeated pass-off after that → operator confirms). Cheetah itself
 * cannot auto-add to the blacklist; only after the human-in-loop trail.
 */

import { createHash } from 'node:crypto';
import { Store, store as defaultStore } from '../store/index.mjs';

export const NS = {
  findings: 'cheetah.findings',
  whitelist: 'cheetah.whitelist',
  blacklist: 'cheetah.blacklist',
};

// Resolve the trailing arg into a Store instance. Keeps the old call sites
// (which passed a STORE_PATH/temp file) working by deriving a root from them.
function resolveStore(pathOrRoot) {
  if (!pathOrRoot) return defaultStore;
  if (pathOrRoot instanceof Store) return pathOrRoot;
  if (typeof pathOrRoot === 'string') {
    const root = pathOrRoot.endsWith('.json') ? `${pathOrRoot}.nsdata` : pathOrRoot;
    return new Store(root);
  }
  return defaultStore;
}

function findingId(post, source) {
  return createHash('sha256')
    .update(`${post.author}::${post.permlink}::${source.url || source.kind}`)
    .digest('hex')
    .slice(0, 16);
}

// ---- public API -----------------------------------------------------------

/** Record a fresh finding from text-detection. Idempotent on (post, source). */
export async function recordFinding({ post, source, confidence }, pathOrRoot) {
  const s = resolveStore(pathOrRoot);
  const id = findingId(post, source);
  const existing = await s.get(NS.findings, id);
  if (existing) return { id, deduplicated: true };
  await s.append(NS.findings, {
    id,
    discovered_at: new Date().toISOString(),
    post,
    source,
    confidence,
    status: 'open',
  });
  return { id, deduplicated: false };
}

/** Mark a finding resolved by Hathor (or operator). */
export async function resolveFinding(id, resolution, pathOrRoot) {
  const s = resolveStore(pathOrRoot);
  const entry = await s.get(NS.findings, id);
  if (!entry) throw new Error(`finding not found: ${id}`);
  if (!resolution.status || !resolution.by || !resolution.reason) {
    throw new Error('resolution requires {status, by, reason}');
  }
  const updated = await s.update(NS.findings, id, {
    status: resolution.status,
    resolution: {
      by: resolution.by,
      at: new Date().toISOString(),
      reason: resolution.reason,
      evidence: resolution.evidence,
    },
  });
  return updated;
}

/**
 * Add an evidenced whitelist entry — used after Hathor confirms an author
 * proved authorship of material that also appears elsewhere (e.g. their own
 * blog post they're cross-posting).
 */
export async function addWhitelist({ account, material, reason, evidence, addedBy }, pathOrRoot) {
  if (!account || !reason || !evidence) {
    throw new Error('whitelist entry requires {account, reason, evidence}');
  }
  const s = resolveStore(pathOrRoot);
  await s.append(NS.whitelist, {
    account,
    material: material || null,
    reason,
    evidence,
    added_at: new Date().toISOString(),
    added_by: addedBy || 'cheetah-auto',
  });
}

/**
 * Add a blacklist entry — ONLY callable after a repeated-pass-off has been
 * resolved through the Hathor flow. Cheetah itself never calls this; the
 * resolution layer does, with operator confirmation.
 */
export async function addBlacklist({ account, pattern, evidence, addedBy }, pathOrRoot) {
  if (!account || !evidence || !addedBy) {
    throw new Error('blacklist entry requires {account, evidence, addedBy} — never auto-blacklist');
  }
  if (addedBy === 'cheetah-auto') {
    throw new Error('Cheetah cannot auto-blacklist — requires resolution flow + operator');
  }
  const s = resolveStore(pathOrRoot);
  await s.append(NS.blacklist, {
    account,
    pattern: pattern || null,
    evidence,
    added_at: new Date().toISOString(),
    added_by: addedBy,
  });
}

/**
 * Is this account whitelisted for this material? Used by Cheetah before
 * commenting — if a whitelist entry covers the material, suppress the comment.
 */
export async function isWhitelisted(account, material, pathOrRoot) {
  const s = resolveStore(pathOrRoot);
  const items = await s.all(NS.whitelist);
  return items.some((w) => w.account === account && (!material || w.material === material || w.material === null));
}

export async function isBlacklisted(account, pathOrRoot) {
  const s = resolveStore(pathOrRoot);
  const items = await s.all(NS.blacklist);
  return items.some((b) => b.account === account);
}

export async function listFindings({ status, limit = 50 } = {}, pathOrRoot) {
  const s = resolveStore(pathOrRoot);
  let out = await s.all(NS.findings);
  if (status) out = out.filter((f) => f.status === status);
  out = out.sort((a, b) => (a.discovered_at < b.discovered_at ? 1 : -1));
  return out.slice(0, limit);
}

// Back-compat shim for resolution.js + tests that read the whole store. Returns
// the same {findings, whitelist, blacklist} shape the file-backed store used to.
async function loadStore(pathOrRoot) {
  const s = resolveStore(pathOrRoot);
  const [findings, whitelist, blacklist] = await Promise.all([
    s.all(NS.findings),
    s.all(NS.whitelist),
    s.all(NS.blacklist),
  ]);
  return { findings, whitelist, blacklist };
}

export const _internal = { loadStore, resolveStore, findingId, NS };
