/**
 * state.mjs — deterministic in-memory state with file persistence + hashing.
 *
 * Security study §6 C ("State integrity & verifiability"):
 *   - the sidechain state is a pure deterministic fold over L1 blocks;
 *   - we hash the full state per processed block so anyone can replay and
 *     compare ("publish hashes so snapshots are verifiable, not trusted").
 *
 * This is a small LokiJS-style document store kept in a single JSON file,
 * chosen over SQLite so the testnet node has zero native-build dependencies
 * (better-sqlite3/isolated_vm aren't installed in this repo's runtime). The
 * collection API mirrors what a contract needs: find / findOne / insert /
 * update / remove. State is serialised deterministically (sorted keys) so the
 * hash is stable across nodes.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export class State {
  constructor(file = null) {
    this.file = file;
    // collections: { name -> array of docs }
    this.collections = {};
    // chain bookkeeping
    this.meta = { lastBlock: 0, lastBlockId: null, stateHash: null };
    if (file && existsSync(file)) this._load();
  }

  _load() {
    const raw = JSON.parse(readFileSync(this.file, 'utf8'));
    this.collections = raw.collections || {};
    this.meta = raw.meta || this.meta;
  }

  persist() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    // include the computed state hash in the snapshot
    this.meta.stateHash = this.hash();
    writeFileSync(this.file, this._serialize(), 'utf8');
  }

  collection(name) {
    if (!this.collections[name]) this.collections[name] = [];
    return this.collections[name];
  }

  insert(name, doc) {
    this.collection(name).push(doc);
    return doc;
  }

  find(name, query = {}) {
    return this.collection(name).filter((d) => matches(d, query));
  }

  findOne(name, query = {}) {
    return this.collection(name).find((d) => matches(d, query)) || null;
  }

  update(name, doc) {
    // docs are referenced objects; mutation is enough, but keep API explicit.
    return doc;
  }

  remove(name, query = {}) {
    const col = this.collection(name);
    for (let i = col.length - 1; i >= 0; i--) {
      if (matches(col[i], query)) col.splice(i, 1);
    }
  }

  /** Deterministic JSON with recursively sorted keys. */
  _serialize() {
    return JSON.stringify({ meta: this.meta, collections: this.collections }, sortReplacer(), 0);
  }

  /** SHA-256 of the deterministic state serialisation (collections only). */
  hash() {
    const body = JSON.stringify({ collections: this.collections }, sortReplacer(), 0);
    return createHash('sha256').update(body).digest('hex');
  }
}

function sortReplacer() {
  return function (_key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce((acc, k) => {
          acc[k] = value[k];
          return acc;
        }, {});
    }
    return value;
  };
}

function matches(doc, query) {
  for (const [k, v] of Object.entries(query)) {
    if (doc[k] !== v) return false;
  }
  return true;
}
