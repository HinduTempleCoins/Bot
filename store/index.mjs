// store/index.mjs — the shared multi-bot store. Hathor, Cheetah, and future siblings read/write
// ONE coordinated substrate instead of each keeping private files (operator: a shared store is
// coming as the bot count grows). Namespaced, JSON-backed, atomic-ish writes, append-or-merge.
//
// Design: a namespace is a collection (e.g. 'cheetah.findings', 'shared.flags'). Each record has
// an id (provided or derived). Cheetah WRITES findings + the evidenced whitelist/blacklist; Hathor
// READS them to handle resolution conversations. Nothing here signs or broadcasts — pure data.
//
//   import { Store } from './store/index.mjs'
//   const s = new Store();  await s.append('cheetah.findings', {id, ...});  await s.all('cheetah.findings')

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_ROOT = process.env.MELEK_STORE_ROOT || join(process.cwd(), 'store', '.data');

export class Store {
  constructor(root = DEFAULT_ROOT) { this.root = root; }

  _path(ns) {
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)*$/i.test(ns)) throw new Error(`bad namespace: ${ns}`);
    return join(this.root, `${ns}.json`);
  }

  async _load(ns) {
    const p = this._path(ns);
    if (!existsSync(p)) return { items: [] };
    try { return JSON.parse(await readFile(p, 'utf8')); } catch { return { items: [] }; }
  }

  async _save(ns, state) {
    const p = this._path(ns);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await rename(tmp, p); // atomic on the same filesystem
  }

  /** All records in a namespace (optionally filtered by a predicate). */
  async all(ns, filter) {
    const { items } = await this._load(ns);
    return filter ? items.filter(filter) : items;
  }

  /** One record by id, or null. */
  async get(ns, id) {
    const { items } = await this._load(ns);
    return items.find((x) => x.id === id) || null;
  }

  /**
   * Append a record. Idempotent on id (derived from the record if absent). If the id already
   * exists, it is left untouched (use update() to change it). Returns { id, added }.
   */
  async append(ns, record) {
    const state = await this._load(ns);
    const id = record.id || createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 16);
    if (state.items.some((x) => x.id === id)) return { id, added: false };
    state.items.push({ ...record, id, _at: record._at || new Date().toISOString() });
    await this._save(ns, state);
    return { id, added: true };
  }

  /** Merge fields into an existing record (creates it if missing). Returns the record. */
  async update(ns, id, patch) {
    const state = await this._load(ns);
    let rec = state.items.find((x) => x.id === id);
    if (!rec) { rec = { id, _at: new Date().toISOString() }; state.items.push(rec); }
    Object.assign(rec, patch, { id, _updated: new Date().toISOString() });
    await this._save(ns, state);
    return rec;
  }

  /** Remove a record by id. Returns true if it existed. */
  async remove(ns, id) {
    const state = await this._load(ns);
    const before = state.items.length;
    state.items = state.items.filter((x) => x.id !== id);
    if (state.items.length === before) return false;
    await this._save(ns, state);
    return true;
  }

  /** Namespaces that currently exist (best-effort: by file presence). */
  async namespaces() {
    if (!existsSync(this.root)) return [];
    const { readdir } = await import('node:fs/promises');
    return (await readdir(this.root)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  }
}

// a process-wide default instance for convenience.
export const store = new Store();
