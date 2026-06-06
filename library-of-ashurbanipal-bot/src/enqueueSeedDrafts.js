/**
 * Ashurbanipal seed-draft enqueuer.
 *
 * Some wiki articles are hand-authored canonical seeds rather than freshly synthesized by the
 * Gemini-backed wikiGenerator (which needs a network key and rewrites from scratch each run). A seed
 * draft is a load-bearing article whose exact prose + citations must be preserved — e.g. the
 * SteemBots/Steemcenter ecosystem article, whose @MarsResident provenance (the operator's 2017-era
 * Steem handle) is a hard requirement and must not be dropped by a strict-from-excerpts synthesizer.
 *
 * Seeds live in `seed-drafts/` as a pair:
 *   <name>.wiki   — the article body (MediaWiki source)
 *   <name>.json   — { articleId, title, bodyFile, sources, provenanceNote }
 *
 * This module loads each seed and enqueues it into the ReviewQueue as 'pending'. It NEVER approves or
 * publishes — the review queue's guard (only an explicit approve() then markPublished() can publish)
 * is left intact. Re-running is idempotent: a seed whose articleId already has a non-rejected record
 * in the queue is skipped (so we never pile up duplicate pending drafts).
 *
 * ESM, no network, no secrets. fs/path/queue are injectable for offline tests.
 *
 *   import { loadSeedDrafts, enqueueSeedDrafts } from './enqueueSeedDrafts.js';
 *   const res = enqueueSeedDrafts({ queue });   // uses ./seed-drafts and a default ReviewQueue
 */

import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import ReviewQueue from './reviewQueue.js';

const __dirname = nodePath.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SEED_DIR = nodePath.join(__dirname, '..', 'seed-drafts');

/**
 * Read and parse every seed draft in `seedDir`. A valid seed is a `.json` descriptor whose `bodyFile`
 * resolves to a readable `.wiki` body in the same directory. Malformed descriptors are skipped (with
 * a console warning) rather than throwing, so one bad seed never blocks the rest.
 *
 * @returns {Array<{articleId,title,body,sources,provenanceNote,_file}>}
 */
export function loadSeedDrafts({ fs = nodeFs, path = nodePath, seedDir = DEFAULT_SEED_DIR } = {}) {
  let entries = [];
  try {
    if (fs.existsSync && !fs.existsSync(seedDir)) return [];
    entries = fs.readdirSync(seedDir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }

  const drafts = [];
  for (const file of entries) {
    const jsonPath = path.join(seedDir, file);
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[seed-drafts] skipping ${file}: bad JSON (${e && e.message})`);
      continue;
    }
    if (!meta || !meta.title || !meta.bodyFile) {
      // eslint-disable-next-line no-console
      console.warn(`[seed-drafts] skipping ${file}: missing title/bodyFile`);
      continue;
    }
    let body;
    try {
      body = fs.readFileSync(path.join(seedDir, meta.bodyFile), 'utf8');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[seed-drafts] skipping ${file}: cannot read body ${meta.bodyFile} (${e && e.message})`);
      continue;
    }
    drafts.push({
      articleId: meta.articleId || meta.title,
      title: meta.title,
      body,
      sources: Array.isArray(meta.sources) ? meta.sources : [],
      provenanceNote: meta.provenanceNote || null,
      _file: file,
    });
  }
  return drafts;
}

/**
 * Enqueue all seed drafts into the review queue as 'pending', idempotently.
 *
 * @param {object}      [opts]
 * @param {ReviewQueue} [opts.queue]   a ReviewQueue (defaults to one on data/review-queue.jsonl)
 * @param {object}      [opts.fs]
 * @param {object}      [opts.path]
 * @param {string}      [opts.seedDir]
 * @returns {{ enqueued: object[], skipped: object[] }}
 */
export function enqueueSeedDrafts({ queue, fs = nodeFs, path = nodePath, seedDir = DEFAULT_SEED_DIR } = {}) {
  const q = queue || new ReviewQueue();
  const drafts = loadSeedDrafts({ fs, path, seedDir });

  // Existing non-rejected articleIds already in the queue — never enqueue a duplicate of those.
  const live = new Set(
    q.listQueue()
      .filter((r) => r.status !== 'rejected')
      .map((r) => r.articleId)
  );

  const enqueued = [];
  const skipped = [];
  for (const d of drafts) {
    if (live.has(d.articleId)) {
      skipped.push({ articleId: d.articleId, reason: 'already in queue (non-rejected)' });
      continue;
    }
    const rec = q.enqueueDraft({
      title: d.title,
      body: d.body,
      sources: d.sources,
      articleId: d.articleId,
    });
    live.add(d.articleId);
    enqueued.push(rec);
  }
  return { enqueued, skipped };
}

// CLI: node src/enqueueSeedDrafts.js
if (process.argv[1] && fileURLToPath(import.meta.url) === nodePath.resolve(process.argv[1])) {
  const { enqueued, skipped } = enqueueSeedDrafts();
  // eslint-disable-next-line no-console
  console.log(`[seed-drafts] enqueued ${enqueued.length} draft(s) as 'pending', skipped ${skipped.length}.`);
  for (const r of enqueued) console.log(`  + pending: ${r.title} (${r.id})`);
  for (const s of skipped) console.log(`  - skip:    ${s.articleId} — ${s.reason}`);
  console.log(`[seed-drafts] Nothing was published. Approve in the review queue, then markPublished.`);
}
