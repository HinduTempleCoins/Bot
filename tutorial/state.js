/**
 * state.js — tutorial response state, file-backed.
 *
 * The detector is pure and the chain reader is read-only. The scheduler
 * needs a tiny bit of memory between runs so it doesn't re-respond to
 * the same completion every cron tick. That's all this is.
 *
 * Schema (single JSON file, default tutorial/.state.json):
 *   {
 *     "_meta": { "version": 1, "updated": ISO-string },
 *     "accounts": {
 *       "<account>": {
 *         "responses": {
 *           "<stage_key>": {
 *             "respondedAt": ISO-string,
 *             "txId": string | null,
 *             "action": "comment_and_upvote" | "comment_and_transfer",
 *             "evidencePermlink": string | null
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * Concurrency: the scheduler is single-process (one cron loop), so no
 * locking. Writes are atomic via write-temp-then-rename. If the file is
 * missing or malformed, the store starts empty rather than throwing —
 * the worst outcome is re-responding once to a user, which is recoverable.
 *
 * Why a file, not a DB: Phase 2 has at most hundreds of tracked users.
 * A small JSON file is the right granularity. A real DB becomes the
 * right answer when the karma layer (BRIEF.md §9) joins this data —
 * that's Phase 3 and a different schema decision.
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = join(__dirname, '.state.json');

const EMPTY_STATE = () => ({
  _meta: { version: 1, updated: null },
  accounts: {},
});

export class TutorialState {
  constructor({ path = DEFAULT_STATE_PATH } = {}) {
    this.path = path;
    this.data = this.#load();
  }

  #load() {
    if (!existsSync(this.path)) return EMPTY_STATE();
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed?.accounts || typeof parsed.accounts !== 'object') return EMPTY_STATE();
      return parsed;
    } catch {
      // Treat malformed state the same as missing — start clean.
      return EMPTY_STATE();
    }
  }

  #save() {
    this.data._meta.updated = new Date().toISOString();
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path);
  }

  /**
   * Has the bot already responded to this account's completion of this stage?
   */
  hasResponded(account, stageKey) {
    return Boolean(this.data.accounts[account]?.responses?.[stageKey]);
  }

  /**
   * Record that a response was fired. Persists immediately.
   *
   * @param {string} account
   * @param {string} stageKey
   * @param {{
   *   txId?: string | null,
   *   action: string,
   *   evidencePermlink?: string | null
   * }} response
   */
  recordResponse(account, stageKey, response) {
    if (!this.data.accounts[account]) {
      this.data.accounts[account] = { responses: {} };
    }
    this.data.accounts[account].responses[stageKey] = {
      respondedAt: new Date().toISOString(),
      txId: response.txId ?? null,
      action: response.action,
      evidencePermlink: response.evidencePermlink ?? null,
    };
    this.#save();
  }

  /**
   * Return the set of stage_keys this account has already been responded to.
   */
  respondedStages(account) {
    return Object.keys(this.data.accounts[account]?.responses ?? {});
  }

  // ---- Instructional Series progress (tutorial/instructional.mjs lessons) -------------------------
  // Stored beside the stage responses under accounts[account].lessons[lessonId], so one per-user store
  // serves both programs (design doc: "same per-user store, different purposes").

  /** Lesson ids this account has completed (rewarded), in the order they were recorded. */
  lessonsDone(account) {
    const l = this.data.accounts[account]?.lessons ?? {};
    return Object.keys(l).sort((a, b) => String(l[a].doneAt).localeCompare(String(l[b].doneAt)));
  }

  hasLesson(account, lessonId) {
    return Boolean(this.data.accounts[account]?.lessons?.[lessonId]);
  }

  /** Record a completed lesson. Persists immediately. Idempotent: a second call keeps the first record. */
  recordLesson(account, lessonId, { txId = null, evidencePermlink = null, via = null } = {}) {
    if (!this.data.accounts[account]) this.data.accounts[account] = { responses: {} };
    const acc = this.data.accounts[account];
    if (!acc.lessons) acc.lessons = {};
    if (acc.lessons[lessonId]) return false;
    acc.lessons[lessonId] = { doneAt: new Date().toISOString(), txId, evidencePermlink, via };
    this.#save();
    return true;
  }

  /**
   * The operator's review queue: manual_review lessons someone has claimed, and questions the
   * deterministic bot could not answer. Deduped by (account, lessonId, kind, ref).
   */
  queueReview(item = {}) {
    if (!Array.isArray(this.data.reviews)) this.data.reviews = [];
    const key = `${item.account}|${item.lessonId}|${item.kind}|${item.ref || ''}`;
    if (this.data.reviews.some((r) => r.key === key)) return false;
    this.data.reviews.push({ key, at: new Date().toISOString(), ...item });
    this.#save();
    return true;
  }

  reviews() {
    return Array.isArray(this.data.reviews) ? this.data.reviews.slice() : [];
  }

  /**
   * All accounts known to the store. Useful for debugging / introspection.
   */
  accounts() {
    return Object.keys(this.data.accounts);
  }
}
