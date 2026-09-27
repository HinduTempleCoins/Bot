// ryan-mind/store.mjs — the engine's DATA dir. Private material lives here, so the dir must be OUTSIDE
// the public git tree: default <repo>/.local/ryan-mind (gitignored) in the Codespace, or whatever
// RYAN_MIND_DIR points at on the server (a private path outside the checkout). A dir inside the repo but not
// under .local/ is refused.
//
// Layout:
//   sources.json            registry  [{id, kind, date, date_basis, title, path, privacy, stage, ...}]
//   claims.jsonl            append-only claim records (immutable; status is DERIVED from annals)
//   annals.jsonl            append-only judgements {ts, claim_a, claim_b, relation, reason, model, ...}
//   taxonomy.json           editable category data (seeded from the corpus; the operator may edit it)
//   config.json             optional {self_emails:[], self_handles:[]} — who counts as "the operator"
//   embeddings.jsonl        cache {claim_id, model, v}
//   state.json              {reconciled:[claim ids]} — which claims have been bounced into the mind
//   positions/<cat>.json|md position documents; positions/_state.json incremental cursor
//   exports/                rag.jsonl, train.jsonl, eval-candidates.jsonl
//
// Dry-run: a Store opened with dryRun:true never touches disk for writes; writes land in an in-memory
// overlay that later reads see, so a whole pipeline can be rehearsed end-to-end.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from './util.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolve + vet the data dir. Returns {ok, dir} or {ok:false, reason}. Never throws. */
export function resolveDataDir({ dir, repoRoot = REPO_ROOT, env = process.env } = {}) {
  const d = path.resolve(dir || env.RYAN_MIND_DIR || path.join(repoRoot, '.local', 'ryan-mind'));
  if (isInside(d, repoRoot) && !isInside(d, path.join(repoRoot, '.local'))) {
    return { ok: false, reason: `refused: data dir ${d} is inside the public repo and not under .local/ — private material must stay out of git` };
  }
  return { ok: true, dir: d };
}

export class Store {
  constructor(dir, { dryRun = false } = {}) {
    this.dir = dir; this.dryRun = !!dryRun;
    this.overlay = new Map(); // rel path -> string (full content)
    this.writes = [];          // log of intended writes (for dry-run reporting)
  }
  p(rel) { return path.join(this.dir, rel); }
  readText(rel) {
    if (this.overlay.has(rel)) return this.overlay.get(rel);
    try { return fs.readFileSync(this.p(rel), 'utf8'); } catch { return null; }
  }
  readJson(rel, fallback = null) {
    const t = this.readText(rel); if (t == null) return fallback;
    try { return JSON.parse(t); } catch { return fallback; }
  }
  readJsonl(rel) { return parseJsonl(this.readText(rel) || ''); }
  writeText(rel, text) {
    this.writes.push({ op: 'write', rel, bytes: Buffer.byteLength(text) });
    if (this.dryRun) { this.overlay.set(rel, text); return true; }
    try {
      fs.mkdirSync(path.dirname(this.p(rel)), { recursive: true });
      fs.writeFileSync(this.p(rel), text);
      return true;
    } catch { return false; }
  }
  writeJson(rel, obj) { return this.writeText(rel, JSON.stringify(obj, null, 2) + '\n'); }
  /** Append rows to a JSONL file. Append-only: existing lines are never rewritten. */
  appendJsonl(rel, rows) {
    if (!rows?.length) return true;
    const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    this.writes.push({ op: 'append', rel, rows: rows.length });
    if (this.dryRun) { this.overlay.set(rel, (this.readText(rel) || '') + text); return true; }
    try {
      fs.mkdirSync(path.dirname(this.p(rel)), { recursive: true });
      fs.appendFileSync(this.p(rel), text);
      return true;
    } catch { return false; }
  }
}

export function openStore(opts = {}) {
  const r = resolveDataDir(opts);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, store: new Store(r.dir, { dryRun: opts.dryRun }) };
}

/**
 * Claims as the mind sees them: claims.jsonl (immutable records) with the latest category re-assignment
 * from recategorized.jsonl applied (written when the taxonomy grows and an uncategorised claim now fits).
 */
export function readClaims(store) {
  const claims = store.readJsonl('claims.jsonl');
  const re = new Map();
  for (const r of store.readJsonl('recategorized.jsonl')) re.set(r.claim_id, r);
  if (!re.size) return claims;
  return claims.map((c) => (re.has(c.id) ? { ...c, category: re.get(c.id).category, categories: re.get(c.id).categories || c.categories, category_by: re.get(c.id).by } : c));
}
