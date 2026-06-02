// submissions.mjs — the Directory's community-submission queue + trust-tier model (#138/#139).
// Owned by site/directory ONLY. A persistent append-only JSONL is the single source of truth; readers
// dedupe last-write-wins by URL so a moderation action just appends an updated line (never rewrites the
// file). Best-effort throughout: a missing/empty/corrupt JSONL yields an empty list, never an error.
//
// Trust ladder (operator was explicit — curated stays on TOP, community visually below it):
//   submitted ──approve──▶ community ──promote(criteria met)──▶ curated
//        └────────reject──▶ rejected (hidden)
//
// A submission starts `submitted` (status:'submitted', tier:'submitted'). Approval moves it to the
// `community` tier (shown in the directory's Community section). It earns `curated` when it independently
// checks out: a real Tranco popularity rank (via domain-insights), a domain age over a threshold (RDAP),
// AND a moderator's approved flag. Curated promotion is the only automatic step and it still requires the
// approved flag — a human is always in the loop before anything is shown or promoted.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const STATUSES = ['submitted', 'community', 'rejected'];
export const TIERS = ['submitted', 'community', 'curated'];

// Curated-promotion thresholds (overridable via env so the operator can tune without a code change).
export const CURATED_MAX_RANK = +(process.env.DIRECTORY_CURATED_MAX_RANK || 1_000_000); // must rank within the Tranco top-list
export const CURATED_MIN_AGE_YEARS = +(process.env.DIRECTORY_CURATED_MIN_AGE_YEARS || 1); // domain at least this old (RDAP)

// Anti-abuse caps.
export const MAX_FIELD = { url: 600, name: 120, category: 60, note: 280, crawl_title: 200 };
const MAX_LINE_BYTES = 4000; // a single serialized record can't exceed this — a hard size cap per submission

// ── URL validation / normalization (SSRF + malformed guard) ───────────────────
// Only public http(s) hosts. Returns a normalized URL string, or null if malformed / not a public host.
export function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw == null ? '' : raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (!h || h.length > 253) return null;
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|255\.)/.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  if (h.startsWith('[')) return null; // skip raw IPv6 (incl ::1, fc00::/7)
  // strip fragments + default ports; keep path/query (a submission may point at a specific resource)
  u.hash = '';
  return u.toString();
}

/** A stable dedupe key: scheme-agnostic, www-stripped host + path (ignores trailing slash + query order). */
export function dedupeKey(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '') || '';
    return host + path;
  } catch { return String(urlStr || '').toLowerCase(); }
}

// Normalize a legacy or partial record into the current shape. The earlier server used
// status pending|approved|featured; map those onto the submitted/community/curated model so old
// JSONL lines keep working without an on-disk migration.
function normalize(o) {
  if (!o || typeof o.url !== 'string') return null;
  let status = o.status;
  let tier = o.tier;
  // legacy status → new model
  if (status === 'pending') status = 'submitted';
  if (status === 'approved' || status === 'featured') { status = 'community'; if (!tier) tier = status === 'featured' ? 'curated' : 'community'; }
  if (!STATUSES.includes(status)) status = 'submitted';
  if (!TIERS.includes(tier)) tier = status === 'community' ? 'community' : 'submitted';
  // a rejected entry has no live tier
  if (status === 'rejected') tier = 'submitted';
  const trust = (typeof o.trust === 'number' && isFinite(o.trust)) ? o.trust : 0;
  return { ...o, status, tier, trust };
}

export class SubmissionStore {
  constructor(file) { this.file = file; }

  /** Read all live records (deduped by URL, last write wins), newest-first within each tier. Best-effort. */
  async all() {
    let txt;
    try { txt = await readFile(this.file, 'utf8'); } catch { return []; }
    const byKey = new Map();
    for (const line of txt.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let o; try { o = JSON.parse(s); } catch { continue; }
      const n = normalize(o);
      if (!n) continue;
      byKey.set(n.dedupe || dedupeKey(n.url), n); // later lines (incl. moderation rewrites) win
    }
    const tierRank = { curated: 0, community: 1, submitted: 2 };
    return [...byKey.values()].sort((a, b) =>
      ((tierRank[a.tier] ?? 3) - (tierRank[b.tier] ?? 3)) || ((b.ts_unix || 0) - (a.ts_unix || 0)));
  }

  /** Records the public directory should show: community + curated tiers, excluding rejected. */
  async visible() { return (await this.all()).filter((s) => s.status !== 'rejected' && (s.tier === 'community' || s.tier === 'curated')); }

  /** Records awaiting a moderation decision (the /moderate queue). */
  async pending() { return (await this.all()).filter((s) => s.status === 'submitted'); }

  /** Look up one live record by its dedupe key (or raw url). */
  async find(key) {
    const k = dedupeKey(key);
    return (await this.all()).find((s) => (s.dedupe || dedupeKey(s.url)) === k) || null;
  }

  // Append a record line, enforcing the per-submission size cap. Throws on an oversized record so the
  // caller can reject it; swallows nothing else (write errors propagate to the caller's try/catch).
  async append(record) {
    const line = JSON.stringify(record);
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new Error('submission too large');
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, line + '\n');
  }

  /**
   * Add a brand-new public submission. Validates + normalizes the URL, clamps every field, dedupes
   * against existing live records. Returns { ok, error?, duplicate?, record? }. Does NOT crawl —
   * the caller supplies any best-effort crawl result.
   */
  async submit({ url, name, category, note, crawl_status, crawl_title, ip } = {}) {
    const safe = safeUrl(url);
    if (!safe) return { ok: false, error: 'invalid_url' };
    const key = dedupeKey(safe);
    const existing = await this.find(key);
    if (existing) return { ok: false, duplicate: true, error: 'duplicate', record: existing };
    const clamp = (v, n) => String(v == null ? '' : v).slice(0, n);
    const record = {
      url: safe,
      dedupe: key,
      name: clamp(name, MAX_FIELD.name),
      category: clamp(category, MAX_FIELD.category),
      note: clamp(note, MAX_FIELD.note),
      crawl_status: Number.isFinite(crawl_status) ? crawl_status : 0,
      crawl_title: clamp(crawl_title, MAX_FIELD.crawl_title),
      status: 'submitted',
      tier: 'submitted',
      trust: 0,
      ip_hash: ip ? createHash('sha256').update(String(ip)).digest('hex').slice(0, 16) : 'redacted',
      ts_unix: Math.floor(Date.now() / 1000),
    };
    try { await this.append(record); } catch (e) { return { ok: false, error: e.message === 'submission too large' ? 'too_large' : 'write_failed' }; }
    return { ok: true, record };
  }

  /**
   * Apply a moderation action by appending an updated line for the matching record.
   * action: 'approve' → community tier; 'reject' → rejected (hidden); 'promote' → curated (criteria
   * must already be met by the caller); 'demote' → back to community.
   * Returns { ok, error?, record? }.
   */
  async moderate(key, action, { note, by } = {}) {
    const entry = await this.find(key);
    if (!entry) return { ok: false, error: 'not_found' };
    const now = Math.floor(Date.now() / 1000);
    switch (action) {
      case 'approve':
        entry.status = 'community';
        if (entry.tier !== 'curated') entry.tier = 'community';
        entry.approved = true;
        entry.trust = Math.max(entry.trust || 0, 1);
        break;
      case 'reject':
        entry.status = 'rejected';
        entry.tier = 'submitted';
        entry.approved = false;
        break;
      case 'promote': // → curated (caller has verified criteria)
        entry.status = 'community';
        entry.tier = 'curated';
        entry.approved = true;
        entry.trust = Math.max(entry.trust || 0, 2);
        break;
      case 'demote':
        entry.status = 'community';
        entry.tier = 'community';
        entry.trust = Math.max(entry.trust || 0, 1);
        break;
      default:
        return { ok: false, error: 'bad_action' };
    }
    if (note != null) entry.mod_note = String(note).slice(0, MAX_FIELD.note);
    if (by != null) entry.moderated_by = String(by).slice(0, 60);
    entry.moderated_unix = now;
    try { await this.append(entry); } catch (e) { return { ok: false, error: 'write_failed' }; }
    return { ok: true, record: entry };
  }
}

/**
 * Decide whether a record QUALIFIES for the curated tier, given live domain insights.
 * Criteria (#139): a real Tranco rank within CURATED_MAX_RANK, a domain age ≥ CURATED_MIN_AGE_YEARS via
 * RDAP, AND the moderator's approved flag. Returns { eligible, reasons:{rank,age,approved}, rank, ageYears }.
 * `getInsights` is injected (the domain-insights module) so this stays testable + keyless-by-default.
 */
export async function curatedEligibility(record, getInsights) {
  const reasons = { rank: false, age: false, approved: !!record.approved };
  let rank = null, ageYears = null;
  try {
    const ins = await getInsights(record.url, { seo: false, trend: false });
    rank = ins?.rank?.rank ?? null;
    ageYears = ins?.age?.ageYears ?? null;
  } catch { /* best-effort — leave both criteria unmet on failure */ }
  reasons.rank = rank != null && rank <= CURATED_MAX_RANK;
  reasons.age = ageYears != null && ageYears >= CURATED_MIN_AGE_YEARS;
  const eligible = reasons.rank && reasons.age && reasons.approved;
  return { eligible, reasons, rank, ageYears };
}
