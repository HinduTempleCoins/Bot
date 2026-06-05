/**
 * autovote/store.js — tiny JSON-file persistence (no external deps).
 *
 * Schema:
 *   users:    { [username]: { username, postingKey, createdAt } }   // TESTNET: key in clear
 *   trails:   [ { id, owner, target, weight, delayMs, dailyCap, paused, createdAt } ]
 *   fanbases: [ { id, owner, authors:[...], weight, delayMs, maxPerDay, paused, createdAt } ]
 *   schedules:[ { id, owner, author, permlink, weight, voteAt, done, paused, createdAt } ]
 *   votes:    [ { id, owner, author, permlink, weight, rule, ruleId, txId, at, ok, error } ]
 *
 * Writes are synchronous + atomic-ish (write temp, rename). Adequate for a
 * single-process testnet service. Swap for SQLite if it ever needs concurrency.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = { users: {}, trails: [], fanbases: [], schedules: [], votes: [] };

export class Store {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.dbPath, 'utf8');
      this.data = { ...EMPTY, ...JSON.parse(raw) };
    } catch {
      this.data = JSON.parse(JSON.stringify(EMPTY));
    }
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
  upsertUser(username, postingKey) {
    const u = String(username).toLowerCase().trim();
    this.data.users[u] = {
      username: u,
      postingKey,
      createdAt: this.data.users[u]?.createdAt || Date.now(),
    };
    this._save();
    return this.data.users[u];
  }

  getUser(username) {
    return this.data.users[String(username).toLowerCase().trim()] || null;
  }

  // ---- trails ----
  addTrail({ owner, target, weight, delayMs = 0, dailyCap = 0 }) {
    const t = {
      id: Store.id(),
      owner,
      target: String(target).toLowerCase().trim(),
      weight: Number(weight),
      delayMs: Number(delayMs),
      dailyCap: Number(dailyCap),
      paused: false,
      createdAt: Date.now(),
    };
    this.data.trails.push(t);
    this._save();
    return t;
  }

  // ---- fanbases ----
  addFanbase({ owner, authors, weight, delayMs = 0, maxPerDay = 0 }) {
    const f = {
      id: Store.id(),
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
  addSchedule({ owner, author, permlink, weight, voteAt }) {
    const s = {
      id: Store.id(),
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

  // ---- generic rule helpers ----
  rulesFor(owner) {
    return {
      trails: this.data.trails.filter((r) => r.owner === owner),
      fanbases: this.data.fanbases.filter((r) => r.owner === owner),
      schedules: this.data.schedules.filter((r) => r.owner === owner),
    };
  }

  setPaused(kind, id, paused) {
    const arr = this.data[kind];
    if (!arr) return null;
    const r = arr.find((x) => x.id === id);
    if (!r) return null;
    r.paused = !!paused;
    this._save();
    return r;
  }

  remove(kind, id, owner) {
    const arr = this.data[kind];
    if (!arr) return false;
    const before = arr.length;
    this.data[kind] = arr.filter((x) => !(x.id === id && (!owner || x.owner === owner)));
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

  // ---- vote log / dedupe ----
  hasVoted(owner, author, permlink) {
    return this.data.votes.some(
      (v) => v.owner === owner && v.author === author && v.permlink === permlink && v.ok,
    );
  }

  logVote(entry) {
    const v = { id: Store.id(), at: Date.now(), ...entry };
    this.data.votes.unshift(v);
    // keep the log bounded
    if (this.data.votes.length > 5000) this.data.votes.length = 5000;
    this._save();
    return v;
  }

  votesFor(owner, limit = 100) {
    return this.data.votes.filter((v) => v.owner === owner).slice(0, limit);
  }

  // votes by this owner today (UTC), counting only successful broadcasts
  votesToday(owner) {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const t0 = start.getTime();
    return this.data.votes.filter((v) => v.owner === owner && v.ok && v.at >= t0);
  }

  allUsers() {
    return Object.values(this.data.users);
  }
}
