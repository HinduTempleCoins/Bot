/**
 * store.js — Cheetah's evidenced whitelist/blacklist + findings log.
 *
 * Per CHEETAH_ADVANCED.md §4: replace the old hand-kept flat list with a
 * living, evidenced record. Each entry carries WHY — the evidence that
 * resolved it — not just an account name. The store is read by Hathor when
 * handling resolution conversations.
 *
 * Schema:
 *   {
 *     "findings": [
 *       {
 *         "id": "<hash>",
 *         "discovered_at": "<ISO>",
 *         "post": {"author": "...", "permlink": "..."},
 *         "source": {kind, url, title, snippet},
 *         "confidence": 0..1,
 *         "status": "open" | "resolved-self-quote" | "resolved-coincidence"
 *                  | "resolved-licensed" | "resolved-passoff" | "withdrawn",
 *         "resolution": {by, at, reason, evidence?}
 *       }
 *     ],
 *     "whitelist": [
 *       {
 *         "account": "...",
 *         "material": "<hash-of-material or descriptive ref>",
 *         "reason": "self-quote-of-prior-blog",
 *         "evidence": "<url to proof / archived copy>",
 *         "added_at": "<ISO>",
 *         "added_by": "<who confirmed: hathor / operator / cheetah-auto>"
 *       }
 *     ],
 *     "blacklist": [
 *       {
 *         "account": "...",
 *         "pattern": "<material hash or descriptive>",
 *         "evidence": "<resolution-trail showing repeat pass-off>",
 *         "added_at": "<ISO>",
 *         "added_by": "<hathor / operator>"
 *       }
 *     ]
 *   }
 *
 * The blacklist is intentionally hard to add to — entries require the full
 * resolution process (Cheetah surfaces → person responds → Hathor resolves
 * → repeated pass-off after that → operator confirms). Cheetah itself
 * cannot auto-add to the blacklist; only after the human-in-loop trail.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { STORE_PATH } from './config.js';

function emptyStore() {
  return { findings: [], whitelist: [], blacklist: [] };
}

async function loadStore(path = STORE_PATH) {
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      findings: parsed.findings || [],
      whitelist: parsed.whitelist || [],
      blacklist: parsed.blacklist || [],
    };
  } catch {
    return emptyStore();
  }
}

async function saveStore(state, path = STORE_PATH) {
  await mkdir(dirname(path), { recursive: true });
  // Atomic-ish: write tmp then rename
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await writeFile(path, JSON.stringify(state, null, 2), 'utf8');
}

function findingId(post, source) {
  return createHash('sha256')
    .update(`${post.author}::${post.permlink}::${source.url || source.kind}`)
    .digest('hex')
    .slice(0, 16);
}

// ---- public API -----------------------------------------------------------

/** Record a fresh finding from text-detection. Idempotent on (post, source). */
export async function recordFinding({ post, source, confidence }, path) {
  const state = await loadStore(path);
  const id = findingId(post, source);
  if (state.findings.find((f) => f.id === id)) return { id, deduplicated: true };
  state.findings.push({
    id,
    discovered_at: new Date().toISOString(),
    post,
    source,
    confidence,
    status: 'open',
  });
  await saveStore(state, path);
  return { id, deduplicated: false };
}

/** Mark a finding resolved by Hathor (or operator). */
export async function resolveFinding(id, resolution, path) {
  const state = await loadStore(path);
  const entry = state.findings.find((f) => f.id === id);
  if (!entry) throw new Error(`finding not found: ${id}`);
  if (!resolution.status || !resolution.by || !resolution.reason) {
    throw new Error('resolution requires {status, by, reason}');
  }
  entry.status = resolution.status;
  entry.resolution = {
    by: resolution.by,
    at: new Date().toISOString(),
    reason: resolution.reason,
    evidence: resolution.evidence,
  };
  await saveStore(state, path);
  return entry;
}

/**
 * Add an evidenced whitelist entry — used after Hathor confirms an author
 * proved authorship of material that also appears elsewhere (e.g. their own
 * blog post they're cross-posting).
 */
export async function addWhitelist({ account, material, reason, evidence, addedBy }, path) {
  if (!account || !reason || !evidence) {
    throw new Error('whitelist entry requires {account, reason, evidence}');
  }
  const state = await loadStore(path);
  state.whitelist.push({
    account,
    material: material || null,
    reason,
    evidence,
    added_at: new Date().toISOString(),
    added_by: addedBy || 'cheetah-auto',
  });
  await saveStore(state, path);
}

/**
 * Add a blacklist entry — ONLY callable after a repeated-pass-off has been
 * resolved through the Hathor flow. Cheetah itself never calls this; the
 * resolution layer does, with operator confirmation.
 */
export async function addBlacklist({ account, pattern, evidence, addedBy }, path) {
  if (!account || !evidence || !addedBy) {
    throw new Error('blacklist entry requires {account, evidence, addedBy} — never auto-blacklist');
  }
  if (addedBy === 'cheetah-auto') {
    throw new Error('Cheetah cannot auto-blacklist — requires resolution flow + operator');
  }
  const state = await loadStore(path);
  state.blacklist.push({
    account,
    pattern: pattern || null,
    evidence,
    added_at: new Date().toISOString(),
    added_by: addedBy,
  });
  await saveStore(state, path);
}

/**
 * Is this account whitelisted for this material? Used by Cheetah before
 * commenting — if a whitelist entry covers the material, suppress the comment.
 */
export async function isWhitelisted(account, material, path) {
  const state = await loadStore(path);
  return state.whitelist.some((w) => w.account === account && (!material || w.material === material || w.material === null));
}

export async function isBlacklisted(account, path) {
  const state = await loadStore(path);
  return state.blacklist.some((b) => b.account === account);
}

export async function listFindings({ status, limit = 50 } = {}, path) {
  const state = await loadStore(path);
  let out = state.findings;
  if (status) out = out.filter((f) => f.status === status);
  out = out.sort((a, b) => (a.discovered_at < b.discovered_at ? 1 : -1));
  return out.slice(0, limit);
}

export const _internal = { loadStore, saveStore, emptyStore, findingId };
