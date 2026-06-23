// file-store.mjs — a persistent, dependency-free store for Hathor's ONE mind.
//
// createBrainMemory({ makeStore }) (memory/compartments.mjs) takes a `makeStore(name) => {ingestRecords,
// recall}` per compartment. The default is in-memory (per-process, lost on restart). For the ONE Hathor
// brain that runs as a single service, her memory must PERSIST and be a single store — so this is a
// file-backed makeStore: one JSONL file per compartment under a base dir, appended on ingest, keyword-scored
// on recall. Dependency-free (no vector stack) so the brain always has memory; the vector store can be
// swapped back in later by injecting a different makeStore.
//
// Single-writer by design: the one Agency brain service is the only process that writes. Soft-fails, never
// throws. House style: ESM, pure-ish, injectable fs for tests.

import { promises as fsp } from 'node:fs';
import { dirname, join } from 'node:path';

const toks = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));

/**
 * makeFileStore(baseDir, opts?) → (compartmentName) => { ingestRecords, recall }
 * Each compartment persists to `${baseDir}/${name}.jsonl` (one JSON record per line). Records are kept in
 * memory after load for fast keyword recall; ingest appends to the file AND the in-memory list.
 * @param {string} baseDir
 * @param {object} opts { fs?, max? }  fs injectable for tests; max caps records kept/loaded per compartment.
 */
export function makeFileStore(baseDir, opts = {}) {
  const fs = opts.fs || fsp;
  const max = opts.max || 50_000;

  return function store(name) {
    const file = join(baseDir, `${String(name).replace(/[^a-z0-9_-]/gi, '_')}.jsonl`);
    let recs = null;          // lazy-loaded in-memory mirror
    let loading = null;

    async function load() {
      if (recs) return recs;
      if (loading) return loading;
      loading = (async () => {
        try {
          const raw = await fs.readFile(file, 'utf8');
          recs = raw.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          if (recs.length > max) recs = recs.slice(-max);
        } catch { recs = []; }   // no file yet → empty
        return recs;
      })();
      return loading;
    }

    return {
      async ingestRecords(records) {
        const list = await load();
        const rows = (Array.isArray(records) ? records : []).filter((r) => r && r.text);
        if (!rows.length) return { ingested: 0 };
        try {
          await fs.mkdir(dirname(file), { recursive: true });
          await fs.appendFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
        } catch { /* soft-fail: still keep it in memory for this run */ }
        for (const r of rows) list.push(r);
        if (list.length > max) list.splice(0, list.length - max);
        return { ingested: rows.length };
      },
      async recall(query, { k = 5 } = {}) {
        const list = await load();
        const q = toks(query);
        if (!q.size) return [];
        return list.map((r) => {
          const rt = toks(r.text); let n = 0; for (const w of q) if (rt.has(w)) n++;
          return { id: r.id, text: r.text, meta: r.meta, score: n / q.size };
        }).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
      },
    };
  };
}
