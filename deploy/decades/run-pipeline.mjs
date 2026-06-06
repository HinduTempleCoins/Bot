#!/usr/bin/env node
// run-pipeline.mjs — the server-side runner the systemd timer invokes.
//
// Walks the brief/annal queue, runs each item through integrations/decades-pipeline.mjs
// (route + dedup against the existing store), and writes a result JSON next to each item.
// Items already processed (a fresh .decades.json exists) are skipped — idempotent.
//
// ALL paths come from the environment (the operator's env file substitutes the real values);
// the repo ships only placeholders in decades.env.example. No hostnames, no real paths here.
//
//   DECADES_QUEUE_DIR    directory of *.json or *.md brief/annal files to process
//   DECADES_STORE_FILE   JSON file: [{ id, text, route?, vec? }]  (the existing corpus)
//   DECADES_ROUTES_FILE  optional JSON: [{ label, examples:[...] }] (known topics)
//   DECADES_OUT_DIR      where to write <id>.decades.json results (default: alongside queue items)
//   DECADES_DUP_THRESHOLD / DECADES_ROUTE_THRESHOLD   optional numeric overrides
//   DECADES_EMBEDDER     optional: module path exporting `embed(text)->number[]`
//                        (e.g. the parallel integrations/minilm-embedder.mjs). Absent → word-bag.
//
// Exit 0 always on a clean walk (per-item failures are logged + skipped, never fatal) so the
// timer's OnFailure stays meaningful for real crashes only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPipeline } from '../../integrations/decades-pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// Extract plain text from a queue item file (.json → .text/.body/whole; .md → raw).
async function loadItem(file) {
  const id = path.basename(file).replace(/\.(json|md|txt)$/i, '');
  const raw = await fs.readFile(file, 'utf8');
  if (/\.json$/i.test(file)) {
    try {
      const o = JSON.parse(raw);
      return { id: o.id || id, text: o.text || o.body || o.content || raw, kind: o.kind || 'brief' };
    } catch { /* fall through to raw */ }
  }
  return { id, text: raw, kind: /annal/i.test(file) ? 'annal' : 'brief' };
}

async function loadEmbedder() {
  const spec = env.DECADES_EMBEDDER;
  if (!spec) return undefined;
  try {
    const mod = await import(pathToFileURL(path.resolve(HERE, spec)).href);
    const fn = mod.embed || mod.default || mod.embedder;
    if (typeof fn === 'function') return (t) => fn(t);
  } catch (e) { console.error(`[decades] embedder load failed (${spec}): ${e.message} — using word-bag`); }
  return undefined;
}

async function main() {
  const queueDir = env.DECADES_QUEUE_DIR;
  if (!queueDir) { console.error('[decades] DECADES_QUEUE_DIR not set — nothing to do'); return; }
  const outDir = env.DECADES_OUT_DIR || queueDir;
  await fs.mkdir(outDir, { recursive: true });

  const storeArr = await readJson(env.DECADES_STORE_FILE, []);
  const routesArr = env.DECADES_ROUTES_FILE ? await readJson(env.DECADES_ROUTES_FILE, null) : null;
  const store = {
    list: () => storeArr,
    routes: () => routesArr,
  };
  const embedder = await loadEmbedder();
  const pipe = createPipeline({
    store, embedder,
    dupThreshold: num(env.DECADES_DUP_THRESHOLD, undefined),
    routeThreshold: num(env.DECADES_ROUTE_THRESHOLD, undefined),
  });

  let entries = [];
  try { entries = await fs.readdir(queueDir); } catch (e) {
    console.error(`[decades] cannot read queue dir: ${e.message}`); return;
  }
  const items = entries.filter((f) => /\.(json|md|txt)$/i.test(f) && !/\.decades\.json$/i.test(f));
  let processed = 0, skipped = 0, dupes = 0;

  for (const f of items) {
    const src = path.join(queueDir, f);
    try {
      const item = await loadItem(src);
      const resultPath = path.join(outDir, `${item.id}.decades.json`);
      // idempotent: skip if a result newer than the source already exists
      try {
        const [rs, ss] = await Promise.all([fs.stat(resultPath), fs.stat(src)]);
        if (rs.mtimeMs >= ss.mtimeMs) { skipped++; continue; }
      } catch { /* no prior result → process */ }

      const result = await pipe.process(item);
      if (result.isDuplicate) dupes++;
      await fs.writeFile(resultPath, JSON.stringify(result, null, 2));
      processed++;
    } catch (e) {
      console.error(`[decades] item failed (${f}): ${e.message}`); // logged, not fatal
    }
  }
  console.log(`[decades] queue=${queueDir} processed=${processed} skipped=${skipped} duplicates=${dupes} candidates=${storeArr.length}`);
}

main().catch((e) => { console.error('[decades] fatal:', e.message); process.exit(1); });
