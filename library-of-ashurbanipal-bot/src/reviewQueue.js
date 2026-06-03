/**
 * Ashurbanipal review queue (Task #71-library)
 *
 * Drafted wiki articles do NOT publish themselves. The wiki generator (wikiGenerator.js) produces a
 * draft; this queue holds it as 'pending' until the operator explicitly approves it. Only an
 * APPROVED draft is eligible to be marked published. Nothing auto-publishes: there is no code path
 * that moves a draft out of 'pending' without an explicit approve() (or reject()) call, and
 * markPublished() refuses any draft that is not 'approved'. That guard is the whole point of the
 * queue and is asserted in the tests.
 *
 * Flow:
 *   wikiGenerator drafts ── enqueueDraft() ──▶ pending
 *                                              │  approve(id) ──▶ approved ── markPublished(id) ──▶ published
 *                                              └  reject(id)  ──▶ rejected   (terminal; cannot publish)
 *
 * Module system: ESM (the package is "type":"module"), matching wikiGenerator.js / wikiStubGenerator.js.
 *
 * Injectable fs + clock: the constructor takes { fs, now, path } so tests run fully offline against
 * an in-memory fs and a frozen clock. Persistence is JSONL (one record per line) via the injected fs;
 * reads soft-fail (a missing or corrupt store yields an empty queue, never a throw).
 *
 * No secrets, no network. Pure state machine + JSONL persistence.
 *
 *   import ReviewQueue from './reviewQueue.js';
 *   const q = new ReviewQueue({ storePath: 'data/review-queue.jsonl' });
 *   const draft = q.enqueueDraft({ title: 'Kyphi', body: '...', sources: [...], articleId: 'Kyphi' });
 *   q.approve(draft.id, { reviewer: 'operator', note: 'looks good' });
 *   q.markPublished(draft.id);
 */

import nodeFs from 'node:fs';
import nodePath from 'node:path';

export const STATUSES = Object.freeze(['pending', 'approved', 'rejected', 'published']);

// Allowed status transitions. A draft only ever leaves 'pending' via an explicit approve/reject, and
// only an 'approved' draft may be published. 'rejected' and 'published' are terminal.
const TRANSITIONS = Object.freeze({
  pending: ['approved', 'rejected'],
  approved: ['published', 'rejected'],
  rejected: [],
  published: [],
});

export class ReviewQueue {
  /**
   * @param {object}   [opts]
   * @param {object}   [opts.fs]        fs-like with readFileSync/writeFileSync/existsSync/mkdirSync. Defaults to node:fs.
   * @param {Function} [opts.now]       () => Date|string|number, the clock. Defaults to () => new Date().
   * @param {object}   [opts.path]      path-like with dirname(). Defaults to node:path.
   * @param {string}   [opts.storePath] JSONL file the queue persists to. Defaults to data/review-queue.jsonl.
   * @param {Function} [opts.idFactory] () => string, for deterministic ids in tests. Default is time+counter.
   */
  constructor(opts = {}) {
    this.fs = opts.fs || nodeFs;
    this.path = opts.path || nodePath;
    this.now = typeof opts.now === 'function' ? opts.now : () => new Date();
    this.storePath = opts.storePath || 'data/review-queue.jsonl';

    let counter = 0;
    this.idFactory = typeof opts.idFactory === 'function'
      ? opts.idFactory
      : () => `rq_${this._stamp().replace(/[^0-9]/g, '').slice(0, 14)}_${(++counter).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // In-memory mirror of the JSONL store, keyed by id. Soft-fails to empty on read error.
    this.records = new Map();
    this._load();
  }

  // ── timestamps ──────────────────────────────────────────────────────────────────────────────
  _stamp(at) {
    const v = at != null ? at : this.now();
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    if (typeof v === 'string' && v) return v;
    return new Date().toISOString();
  }

  // ── persistence (JSONL via injected fs; reads soft-fail) ────────────────────────────────────
  _load() {
    this.records = new Map();
    try {
      if (this.fs.existsSync && !this.fs.existsSync(this.storePath)) return;
      const raw = this.fs.readFileSync(this.storePath, 'utf8');
      if (!raw) return;
      for (const line of String(raw).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const rec = JSON.parse(trimmed);
          if (rec && typeof rec.id === 'string') this.records.set(rec.id, rec);
        } catch { /* skip a single corrupt line, keep the rest */ }
      }
    } catch {
      // Missing / unreadable store → start empty. Never throw on read (soft-fail contract).
      this.records = new Map();
    }
  }

  _persist() {
    try {
      const dir = this.path.dirname(this.storePath);
      if (dir && dir !== '.' && this.fs.mkdirSync) {
        this.fs.mkdirSync(dir, { recursive: true });
      }
      const lines = [...this.records.values()].map((r) => JSON.stringify(r));
      this.fs.writeFileSync(this.storePath, lines.length ? lines.join('\n') + '\n' : '');
      return true;
    } catch (e) {
      // Soft-fail on write too: the in-memory state is still correct for this process.
      // eslint-disable-next-line no-console
      console.error(`[reviewQueue] persist skipped (${e && e.message})`);
      return false;
    }
  }

  // ── enqueue ─────────────────────────────────────────────────────────────────────────────────
  /**
   * Add a drafted article to the queue as 'pending'.
   * @returns {object} the stored record (status 'pending', with an id + enqueuedAt).
   */
  enqueueDraft({ title, body, sources, articleId, at } = {}) {
    const stamp = this._stamp(at);
    const rec = {
      id: this.idFactory(),
      articleId: articleId != null ? String(articleId) : (title != null ? String(title) : null),
      title: title != null ? String(title) : null,
      body: body != null ? String(body) : '',
      sources: Array.isArray(sources) ? sources : (sources != null ? [sources] : []),
      status: 'pending',
      enqueuedAt: stamp,
      reviewedAt: null,
      reviewer: null,
      note: null,
      publishedAt: null,
      history: [{ status: 'pending', at: stamp }],
    };
    this.records.set(rec.id, rec);
    this._persist();
    return rec;
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────────
  get(id) {
    return this.records.get(id) || null;
  }

  /** Drafts filtered by status (all if status omitted). */
  listQueue({ status } = {}) {
    const all = [...this.records.values()];
    if (status == null) return all;
    return all.filter((r) => r.status === status);
  }

  pendingCount() {
    return this.listQueue({ status: 'pending' }).length;
  }

  queueStats() {
    const stats = { pending: 0, approved: 0, rejected: 0, published: 0, total: 0 };
    for (const r of this.records.values()) {
      if (Object.prototype.hasOwnProperty.call(stats, r.status)) stats[r.status] += 1;
      stats.total += 1;
    }
    return stats;
  }

  // ── transitions ─────────────────────────────────────────────────────────────────────────────
  _transition(id, toStatus, { reviewer, note, at } = {}) {
    const rec = this.records.get(id);
    if (!rec) return { ok: false, error: `no draft with id ${id}`, record: null };

    const allowed = TRANSITIONS[rec.status] || [];
    if (!allowed.includes(toStatus)) {
      return {
        ok: false,
        error: `cannot move draft ${id} from '${rec.status}' to '${toStatus}'`,
        record: rec,
      };
    }

    const stamp = this._stamp(at);
    rec.status = toStatus;
    rec.history.push({ status: toStatus, at: stamp, reviewer: reviewer ?? null, note: note ?? null });
    if (toStatus === 'approved' || toStatus === 'rejected') {
      rec.reviewedAt = stamp;
      rec.reviewer = reviewer ?? null;
      rec.note = note ?? null;
    }
    if (toStatus === 'published') {
      rec.publishedAt = stamp;
    }
    this._persist();
    return { ok: true, error: null, record: rec };
  }

  /** Operator action: approve a pending draft. Records who + when + note. */
  approve(id, { reviewer, note, at } = {}) {
    return this._transition(id, 'approved', { reviewer, note, at });
  }

  /** Operator action: reject a draft (terminal — a rejected draft can never be published). */
  reject(id, { reviewer, note, at } = {}) {
    return this._transition(id, 'rejected', { reviewer, note, at });
  }

  /**
   * Mark an APPROVED draft as published. This is the core guard: a draft that is still 'pending'
   * (or 'rejected') is NOT eligible and this returns { ok: false } without changing its status.
   * There is no other code path that publishes — nothing auto-publishes.
   */
  markPublished(id, { at } = {}) {
    const rec = this.records.get(id);
    if (!rec) return { ok: false, error: `no draft with id ${id}`, record: null };
    if (rec.status !== 'approved') {
      return {
        ok: false,
        error: `draft ${id} is '${rec.status}', not 'approved' — refusing to publish (approval required)`,
        record: rec,
      };
    }
    return this._transition(id, 'published', { at });
  }
}

export default ReviewQueue;
