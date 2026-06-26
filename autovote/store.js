/**
 * autovote/store.js — tiny JSON-file persistence (no external deps).
 *
 * CHAIN-AGNOSTIC schema (additive migration from the single-chain form):
 *   users:    { ["<chain>:<account>"]: { chain, username, authMethod, postingKey?, hsToken?, hsExpiresAt?, createdAt } }
 *   trails:   [ { id, chain, owner, target, weight, delayMs, dailyCap, category, paused, createdAt } ]
 *             category ∈ '' (general) | 'token' (token/SCOT curation-project trail)
 *   fanbases: [ { id, chain, owner, authors:[...], weight, delayMs, maxPerDay, paused, createdAt } ]
 *   schedules:[ { id, chain, owner, author, permlink, weight, voteAt, done, paused, createdAt } ]
 *   votes:    [ { id, chain, owner, author, permlink, weight, rule, ruleId, txId, at, ok, error } ]
 *
 *   authMethod ∈ 'postingkey' | 'hivesigner' | 'whalevault'
 *     postingkey → postingKey (WIF) stored (testnet/throwaway only)
 *     hivesigner → hsToken (revocable OAuth bearer; server-usable offline)
 *     whalevault → no server credential (signs only in-browser, tab open)
 *
 * MIGRATION: a pre-existing store had users keyed by bare username and
 * rules/votes with no `chain`. On load we stamp those with the default chain
 * (melek-testnet) and re-key users to "<chain>:<account>", preserving keys,
 * history, and createdAt. The migration is idempotent.
 *
 * Writes are synchronous + atomic-ish (write temp, rename).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_CHAIN } from './chains.js';

const EMPTY = { users: {}, trails: [], fanbases: [], schedules: [], votes: [], _schema: 2 };

export function userKey(chain, account) {
  return `${chain}:${String(account).toLowerCase().trim()}`;
}

export class Store {
  constructor(dbPath, defaultChain = DEFAULT_CHAIN) {
    this.dbPath = dbPath;
    this.defaultChain = defaultChain;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      this.data = { ...JSON.parse(JSON.stringify(EMPTY)), ...JSON.parse(raw) };
    } catch {
      this.data = JSON.parse(JSON.stringify(EMPTY));
    }
    this._migrate();
  }

  /** Additive migration from the single-chain schema to chain-scoped. Idempotent. */
  _migrate() {
    const dc = this.defaultChain;
    let changed = false;

    // users: re-key bare "<account>" → "<chain>:<account>"; stamp chain + authMethod.
    const newUsers = {};
    for (const [key, u] of Object.entries(this.data.users || {})) {
      const hasChain = key.includes(':') && u && u.chain;
      if (hasChain) {
        newUsers[key] = u;
        continue;
      }
      const account = (u && u.username ? u.username : key).toLowerCase().trim();
      const migrated = {
        chain: dc,
        username: account,
        authMethod: u && u.authMethod ? u.authMethod : (u && u.postingKey ? 'postingkey' : 'postingkey'),
        postingKey: u ? u.postingKey : undefined,
        hsToken: u ? u.hsToken : undefined,
        hsExpiresAt: u ? u.hsExpiresAt : undefined,
        createdAt: (u && u.createdAt) || Date.now(),
      };
      newUsers[userKey(dc, account)] = migrated;
      changed = true;
    }
    this.data.users = newUsers;

    // rules + votes: stamp missing chain.
    for (const kind of ['trails', 'fanbases', 'schedules', 'votes']) {
      for (const r of this.data[kind] || []) {
        if (!r.chain) { r.chain = dc; changed = true; }
      }
    }

    // trails: stamp missing category (pre-Token-Trails rows are general). Idempotent.
    for (const t of this.data.trails || []) {
      if (t.category === undefined) { t.category = ''; changed = true; }
    }

    if (this.data._schema !== 2) { this.data._schema = 2; changed = true; }
    if (changed) this._save();
  }

  _save() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const tmp = `${this.dbPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.dbPath);
  }

  static id() {
    return crypto.randomBytes(8).toString('hex');
  }

  // ---- users ----
  /**
   * Create/update a user identity for a chain + auth method.
   * cred shape depends on authMethod:
   *   postingkey   → { postingKey }
   *   hivesigner   → { hsToken, hsExpiresAt }
   *   melek-signer → { msToken }  (revocable MELEK-Signer bearer; server-usable offline)
   *   whalevault   → {} (no server credential)
   */
  upsertUser(chain, account, authMethod, cred = {}) {
    const acct = String(account).toLowerCase().trim();
    const key = userKey(chain, acct);
    const prev = this.data.users[key] || {};
    this.data.users[key] = {
      chain,
      username: acct,
      authMethod,
      postingKey: authMethod === 'postingkey' ? cred.postingKey : prev.postingKey,
      hsToken: authMethod === 'hivesigner' ? cred.hsToken : prev.hsToken,
      hsExpiresAt: authMethod === 'hivesigner' ? cred.hsExpiresAt : prev.hsExpiresAt,
      msToken: authMethod === 'melek-signer' ? cred.msToken : prev.msToken,
      createdAt: prev.createdAt || Date.now(),
    };
    this._save();
    return this.data.users[key];
  }

  getUser(chain, account) {
    return this.data.users[userKey(chain, account)] || null;
  }

  allUsers() {
    return Object.values(this.data.users);
  }

  /** Distinct chains that have at least one user (for selective streaming). */
  activeChains() {
    const set = new Set();
    for (const u of this.allUsers()) set.add(u.chain);
    return [...set];
  }

  // ---- trails ----
  // category ∈ '' (general curation trail) | 'token' (a token/SCOT curation-project
  // trail). Token trails are surfaced in their own "Token Trails" list, not buried
  // at the bottom of the general trail list.
  addTrail({ chain, owner, target, weight, delayMs = 0, dailyCap = 0, category = '' }) {
    const t = {
      id: Store.id(),
      chain,
      owner,
      target: String(target).toLowerCase().trim(),
      weight: Number(weight),
      delayMs: Number(delayMs),
      dailyCap: Number(dailyCap),
      category: category === 'token' ? 'token' : '',
      paused: false,
      createdAt: Date.now(),
    };
    this.data.trails.push(t);
    this._save();
    return t;
  }

  /** True when a trail row is a token/SCOT curation-project trail. */
  static isTokenTrail(t) {
    return !!t && t.category === 'token';
  }

  // ---- fanbases ----
  addFanbase({ chain, owner, authors, weight, delayMs = 0, maxPerDay = 0 }) {
    const f = {
      id: Store.id(),
      chain,
      owner,
      authors: (Array.isArray(authors) ? authors : [authors])
        .map((a) => String(a).toLowerCase().trim())
        .filter(Boolean),
      weight: Number(weight),
      delayMs: Number(delayMs),
      maxPerDay: Number(maxPerDay),
      paused: false,
      createdAt: Date.now(),
    };
    this.data.fanbases.push(f);
    this._save();
    return f;
  }

  // ---- schedules ----
  addSchedule({ chain, owner, author, permlink, weight, voteAt }) {
    const s = {
      id: Store.id(),
      chain,
      owner,
      author: String(author).toLowerCase().trim(),
      permlink: String(permlink).trim(),
      weight: Number(weight),
      voteAt: Number(voteAt),
      done: false,
      paused: false,
      createdAt: Date.now(),
    };
    this.data.schedules.push(s);
    this._save();
    return s;
  }

  // ---- generic rule helpers (scoped per chain + owner) ----
  rulesFor(chain, owner) {
    const match = (r) => r.owner === owner && r.chain === chain;
    return {
      trails: this.data.trails.filter(match),
      fanbases: this.data.fanbases.filter(match),
      schedules: this.data.schedules.filter(match),
    };
  }

  setPaused(kind, id, paused, chain, owner) {
    const arr = this.data[kind];
    if (!arr) return null;
    const r = arr.find((x) => x.id === id);
    if (!r) return null;
    if (chain && r.chain !== chain) return null;
    if (owner && r.owner !== owner) return null;
    r.paused = !!paused;
    this._save();
    return r;
  }

  remove(kind, id, chain, owner) {
    const arr = this.data[kind];
    if (!arr) return false;
    const before = arr.length;
    this.data[kind] = arr.filter(
      (x) => !(x.id === id && (!owner || x.owner === owner) && (!chain || x.chain === chain)),
    );
    const changed = this.data[kind].length !== before;
    if (changed) this._save();
    return changed;
  }

  markScheduleDone(id, ok) {
    const s = this.data.schedules.find((x) => x.id === id);
    if (s) {
      s.done = true;
      s.lastOk = ok;
      this._save();
    }
  }

  // ---- vote log / dedupe (scoped per chain) ----
  hasVoted(chain, owner, author, permlink) {
    return this.data.votes.some(
      (v) => v.chain === chain && v.owner === owner && v.author === author && v.permlink === permlink && v.ok,
    );
  }

  logVote(entry) {
    const v = { id: Store.id(), at: Date.now(), ...entry };
    this.data.votes.unshift(v);
    if (this.data.votes.length > 5000) this.data.votes.length = 5000;
    this._save();
    return v;
  }

  votesFor(chain, owner, limit = 100) {
    return this.data.votes.filter((v) => v.chain === chain && v.owner === owner).slice(0, limit);
  }

  // votes by this owner today (UTC) on this chain, counting only successful broadcasts
  votesToday(chain, owner) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const t0 = start.getTime();
    return this.data.votes.filter((v) => v.chain === chain && v.owner === owner && v.ok && v.at >= t0);
  }
}
