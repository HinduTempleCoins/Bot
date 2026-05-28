/**
 * watcher/state.js — file-backed watcher state.
 *
 * Tracks two things:
 *   1. lastHistoryIndex — the highest account_history index this watcher
 *      has processed for its account. Graphene account_history is monotonic
 *      per account, so the next tick can ask `get_account_history` for
 *      only entries above this index. `null` = not yet bootstrapped.
 *   2. alertedEvents — set of historyIndex values for which an alert has
 *      already been dispatched (across at least one sink). Defensive guard:
 *      even if a tick re-reads an old entry, we won't double-alert.
 *
 * Schema (single JSON file, default watcher/.state.json):
 *   {
 *     "_meta": { "version": 1, "updated": ISO-string, "account": string|null,
 *                "last_history_index": int|null },
 *     "alerted": { "<historyIndex>": { alertedAt, trxId, kind } }
 *   }
 *
 * Concurrency: single-process watcher; no locking. Atomic write via
 * write-temp-then-rename. Malformed/missing files start clean (worst
 * case: re-alert old events the next tick if the cursor is lost too).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = join(__dirname, '.state.json');

const EMPTY_STATE = () => ({
  _meta: { version: 1, updated: null, account: null, last_history_index: null },
  alerted: {},
});

export class WatcherState {
  constructor({ path = DEFAULT_STATE_PATH } = {}) {
    this.path = path;
    this.data = this.#load();
  }

  #load() {
    if (!existsSync(this.path)) return EMPTY_STATE();
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed?.alerted || typeof parsed.alerted !== 'object') return EMPTY_STATE();
      if (!parsed._meta) parsed._meta = { version: 1, updated: null, account: null, last_history_index: null };
      if (parsed._meta.last_history_index === undefined) parsed._meta.last_history_index = null;
      if (parsed._meta.account === undefined) parsed._meta.account = null;
      return parsed;
    } catch {
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
   * The account this state file is keyed to. Returns null until set.
   * Used by the orchestrator to refuse to run against a different account
   * with stale state — silent re-alerting on a switched account would
   * defeat the dedupe.
   */
  getAccount() {
    return this.data._meta.account;
  }

  setAccount(account) {
    if (this.data._meta.account && this.data._meta.account !== account) {
      throw new Error(
        `state file is keyed to "${this.data._meta.account}" but watcher started for "${account}"; ` +
          `use a separate state file or delete this one`,
      );
    }
    this.data._meta.account = account;
    this.#save();
  }

  getLastHistoryIndex() {
    return this.data._meta.last_history_index;
  }

  setLastHistoryIndex(idx) {
    if (typeof idx !== 'number' || !Number.isFinite(idx)) {
      throw new Error('setLastHistoryIndex: number required');
    }
    // never move backwards
    if (this.data._meta.last_history_index !== null && idx < this.data._meta.last_history_index) {
      return;
    }
    this.data._meta.last_history_index = idx;
    this.#save();
  }

  hasAlerted(historyIndex) {
    return Object.prototype.hasOwnProperty.call(this.data.alerted, String(historyIndex));
  }

  recordAlerted(historyIndex, { trxId = null, kind = null } = {}) {
    this.data.alerted[String(historyIndex)] = {
      alertedAt: new Date().toISOString(),
      trxId,
      kind,
    };
    this.#save();
  }

  alertedCount() {
    return Object.keys(this.data.alerted).length;
  }
}
