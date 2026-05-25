/**
 * welcomer/state.js — per-account welcome state, file-backed.
 *
 * Parallel to tutorial/state.js but tracks a different thing: have we
 * welcomed this account at all, when, and with what tx. The welcomer
 * never re-welcomes; once an account is marked welcomed it stays marked.
 *
 * Schema (single JSON file, default welcomer/.state.json):
 *   {
 *     "_meta": { "version": 1, "updated": ISO-string, "last_processed_block": int|null },
 *     "accounts": {
 *       "<account>": {
 *         "discoveredAt": ISO-string,
 *         "discoveredAtBlock": int | null,
 *         "welcomedAt": ISO-string | null,
 *         "txId": string | null
 *       }
 *     }
 *   }
 *
 * `last_processed_block` is the discoverer's resume cursor — the highest
 * block number whose `account_create`/`account_create_with_delegation`
 * operations have been scanned. On restart the discoverer picks up at
 * `last_processed_block + 1`.
 *
 * `accounts` is the secondary guard the brief calls for: even if a block
 * gets re-processed for any reason, `hasWelcomed()` prevents a second
 * comment.
 *
 * Concurrency: single-process welcomer; no locking. Atomic write via
 * write-temp-then-rename. Malformed/missing files start clean (worst
 * case: re-welcome on first run after corruption; negligible blast radius).
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = join(__dirname, '.state.json');

const EMPTY_STATE = () => ({
  _meta: { version: 1, updated: null, last_processed_block: null },
  accounts: {},
});

export class WelcomerState {
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
      if (!parsed._meta) parsed._meta = { version: 1, updated: null, last_processed_block: null };
      if (parsed._meta.last_processed_block === undefined) parsed._meta.last_processed_block = null;
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
   * Record that we observed this account being created. Idempotent —
   * re-discovering an already-known account is a no-op (does not refresh
   * the discoveredAt timestamp).
   */
  recordDiscovery(account, { block = null } = {}) {
    if (this.data.accounts[account]) return;
    this.data.accounts[account] = {
      discoveredAt: new Date().toISOString(),
      discoveredAtBlock: block,
      welcomedAt: null,
      txId: null,
    };
    this.#save();
  }

  hasWelcomed(account) {
    return Boolean(this.data.accounts[account]?.welcomedAt);
  }

  isKnown(account) {
    return Boolean(this.data.accounts[account]);
  }

  /**
   * Mark a successful welcome. If the account wasn't pre-discovered (e.g.
   * orchestrator was handed an explicit account), an entry is created.
   */
  recordWelcome(account, { txId = null } = {}) {
    if (!this.data.accounts[account]) {
      this.data.accounts[account] = {
        discoveredAt: new Date().toISOString(),
        discoveredAtBlock: null,
        welcomedAt: null,
        txId: null,
      };
    }
    this.data.accounts[account].welcomedAt = new Date().toISOString();
    this.data.accounts[account].txId = txId;
    this.#save();
  }

  /** Accounts discovered but not yet welcomed. The orchestrator iterates these. */
  pendingAccounts() {
    return Object.entries(this.data.accounts)
      .filter(([, info]) => !info.welcomedAt)
      .map(([account]) => account);
  }

  /** Last block the discoverer scanned. Null = not yet bootstrapped. */
  getLastProcessedBlock() {
    return this.data._meta.last_processed_block;
  }

  setLastProcessedBlock(blockNum) {
    this.data._meta.last_processed_block = blockNum;
    this.#save();
  }

  accounts() {
    return Object.keys(this.data.accounts);
  }
}
