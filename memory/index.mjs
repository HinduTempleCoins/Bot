// index.mjs — the MELEK Memory ORCHESTRATOR: one façade over the three brain pieces.
//
// Per .local/BRAIN_STACK_PLAN.md the brain's Memory has three layers:
//   1. integrations/docling-ingest.mjs — normalize a Docling export (or markdown) into records,
//      then chunk those records to embedding size (normalizeDocling/toAnnalRecords/chunkForEmbedding).
//   2. memory/embed.mjs — createEmbedder({...}) -> embed(texts) -> vectors (granite/ollama/fn/hash).
//   3. memory/vector-store.mjs — createMemory({ db, embed }) -> upsert/search a pgvector store.
//
// This module ties them together so a caller has ONE thing to talk to:
//
//   import { createMemoryIndex } from './index.mjs'
//   import { makeFakeDb } from './vector-store.mjs'
//   import { createEmbedder } from './embed.mjs'
//   const mem = createMemoryIndex({ db: makeFakeDb(), embed: createEmbedder({ backend:'hash' }) });
//   await mem.ingestDoc(doclingJsonOrMarkdown, { source: 'phoenix-protocol.md' }); // -> { ingested:N }
//   await mem.recall('what is the phoenix protocol?', { k: 3 });                   // -> [{id,text,meta,score}]
//   await mem.ingestRecords([{ id, text, meta }]);                                 // pre-shaped records
//
// Seams (all IO injectable, fully offline-testable):
//   - db + embed are passed in (the same shapes vector-store.mjs/embed.mjs use).
//   - __setStore(fn) overrides how the inner Memory is built (default createMemory).
//   - __setDoclingTools({ normalizeDocling, toAnnalRecords, chunkForEmbedding }) swaps the ingest
//     adapter for tests.
// Soft-fail: malformed input → { ingested:0 } / [] / { ok:false }, never throws. esc() any HTML.
// Zero-WIF: data-shaping + store calls only — no keys, no signing, no chain, no network of its own.

import { createMemory } from './vector-store.mjs';
import {
  normalizeDocling as _normalizeDocling,
  toAnnalRecords as _toAnnalRecords,
  chunkForEmbedding as _chunkForEmbedding,
} from '../integrations/docling-ingest.mjs';

// --- injectable seams ----------------------------------------------------------------------------
let _makeStore = null; // (cfg) => Memory
export function __setStore(fn) { _makeStore = typeof fn === 'function' ? fn : null; }

let _docling = null; // { normalizeDocling, toAnnalRecords, chunkForEmbedding }
export function __setDoclingTools(tools) {
  _docling = tools && typeof tools === 'object' ? tools : null;
}

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function doclingTools() {
  return {
    normalizeDocling: (_docling && _docling.normalizeDocling) || _normalizeDocling,
    toAnnalRecords: (_docling && _docling.toAnnalRecords) || _toAnnalRecords,
    chunkForEmbedding: (_docling && _docling.chunkForEmbedding) || _chunkForEmbedding,
  };
}

/**
 * Build a Memory orchestrator over an injected db + embed seam.
 * @param {object} cfg
 * @param {{query(sql:string,params?:any[]):Promise<{rows:any[]}>}} cfg.db   pg-shaped handle (or makeFakeDb())
 * @param {(texts:string[])=>Promise<number[][]>} cfg.embed                  embedder (createEmbedder({...}))
 * @param {string} [cfg.table='memory_vectors']
 * @param {number} [cfg.dim=384]
 * @param {number} [cfg.maxChars=1500] chunk size handed to chunkForEmbedding
 * @param {number} [cfg.overlap=100]   chunk overlap handed to chunkForEmbedding
 */
export function createMemoryIndex(cfg = {}) {
  const db = cfg.db;
  const embed = cfg.embed;
  const maxChars = Number.isInteger(cfg.maxChars) && cfg.maxChars > 0 ? cfg.maxChars : 1500;
  const overlap = Number.isInteger(cfg.overlap) && cfg.overlap >= 0 ? cfg.overlap : 100;

  const build = _makeStore || createMemory;
  const store = build({ db, embed, table: cfg.table, dim: cfg.dim });

  /**
   * Ingest a Docling export (object) or a markdown/already-simplified doc: normalize → records →
   * chunk → upsert into the vector store. Returns { ingested:N } (N = rows written). Soft-fail → 0.
   */
  async function ingestDoc(input, opts = {}) {
    const source = String((opts && opts.source) || '');
    try {
      const { normalizeDocling, toAnnalRecords, chunkForEmbedding } = doclingTools();
      const doc = normalizeDocling(input, { source });
      const records = toAnnalRecords(doc, { source });
      const chunks = chunkForEmbedding(records, { maxChars, overlap });
      return await ingestRecords(chunks);
    } catch {
      return { ingested: 0 };
    }
  }

  /**
   * Upsert pre-shaped records [{ id, text, meta }] into the store. Soft-fail → { ingested:0 }.
   */
  async function ingestRecords(records) {
    const list = Array.isArray(records) ? records : records ? [records] : [];
    if (!list.length) return { ingested: 0 };
    try {
      const res = await store.upsert(list);
      return { ingested: (res && Number.isInteger(res.upserted) ? res.upserted : 0) };
    } catch {
      return { ingested: 0 };
    }
  }

  /**
   * Embed the query + search the store. Returns the nearest hits [{ id, text, meta, score }].
   * Soft-fail → [].
   */
  async function recall(query, opts = {}) {
    const k = Number.isInteger(opts && opts.k) && opts.k > 0 ? opts.k : 5;
    if (typeof query !== 'string' || !query.trim()) return [];
    try {
      const hits = await store.search(query, { k });
      return Array.isArray(hits) ? hits : [];
    } catch {
      return [];
    }
  }

  return { ingestDoc, ingestRecords, recall, store };
}

// --- CLI (guarded) -------------------------------------------------------------------------------
// No file IO here by design (the store needs a live db). This just documents the shape.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    'memory/index.mjs — createMemoryIndex({ db, embed }) -> { ingestDoc, ingestRecords, recall }.\n' +
      'Offline demo: import makeFakeDb from ./vector-store.mjs and createEmbedder({backend:"hash"}) ' +
      'from ./embed.mjs, then ingestDoc(markdown,{source}) and recall(query,{k}).',
  );
}
