// cheetah/watch.mjs — the long-running READ-ONLY watch entrypoint for CheetahAdvanced.
//
// Old-queue #265: Cheetah watching the LIVE MELEK testnet. This is the thin
// watch loop the systemd service invokes. It:
//
//   1. Polls recent posts over the condenser RPC (read-only — fetchRecentPosts
//      from alpha-report.mjs; the same get_discussions_by_created seam).
//   2. Skips posts it has already seen (cursor in the shared store namespace
//      `cheetah.seen`) so each post is processed exactly once across restarts.
//   3. Runs the deterministic detection + discovery engines (runCheetahOnPosts —
//      shingle + Jaccard, NO LLM verdicts, NO generation-for-detection).
//   4. Records MATCH verdicts as findings in the shared store
//      (cheetah.findings via store.js recordFinding) so Hathor can read them.
//   5. Refreshes the test-report surface (alpha.melek.salon/cheetah/) so the
//      run is visible — the same index.html + report.json alpha-report writes.
//
// HARD INVARIANT — READ-ONLY THIS PHASE:
//   - NEVER broadcasts / replies / votes / signs. No posting key, no WIF, no
//     MELEK-Signer call. Chain access is GET-only (JSON-RPC reads).
//   - Findings + discovery notes are advisory: they land in the store and on the
//     report page. Resolution conversations are Phase 3 / Hathor's job per
//     CHEETAH_ADVANCED.md §5-6. Cheetah here detects; it does not act.
//   - Never edits knowledge/** (the engines only READ post bodies off the chain).
//
// Modes:
//   node cheetah/watch.mjs --once      # one poll pass, write store + report, exit
//   node cheetah/watch.mjs --watch     # poll forever every CHEETAH_POLL_INTERVAL ms
//
// Env (all optional, placeholder-safe defaults):
//   MELEK_RPC_URL            chain RPC (default http://127.0.0.1:8090) — read-only
//   CHEETAH_REPORT_DIR       where index.html + report.json are written
//                            (default /tmp/cheetah-alpha)
//   CHEETAH_STORE_ROOT       shared-store data dir (default store/.data)
//   CHEETAH_POLL_INTERVAL    --watch poll period in ms (default 300000 = 5 min)
//   CHEETAH_ALPHA_LIMIT      posts pulled per poll (default 20; read by alpha-report)
//
// Soft-fail everywhere: a down RPC, empty chain, or bad post never throws out of
// the loop — it logs and the next tick retries. The service stays up.

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  fetchRecentPosts,
  runCheetahOnPosts,
  reportHtml,
} from './alpha-report.mjs';
import { recordFinding } from './store.js';

export const REPORT_DIR = process.env.CHEETAH_REPORT_DIR || '/tmp/cheetah-alpha';
export const STORE_ROOT = process.env.CHEETAH_STORE_ROOT || process.env.MELEK_STORE_ROOT || undefined;
export const POLL_INTERVAL_MS = parseInt(process.env.CHEETAH_POLL_INTERVAL || '300000', 10);

// Injectable seams for offline tests — default to the real readers.
let _fetchPosts = fetchRecentPosts;
let _runEngines = runCheetahOnPosts;
export function __setReaders({ fetchPosts, runEngines } = {}) {
  if (fetchPosts) _fetchPosts = fetchPosts;
  if (runEngines) _runEngines = runEngines;
}
export function __resetReaders() {
  _fetchPosts = fetchRecentPosts;
  _runEngines = runCheetahOnPosts;
}

function postKey(p) {
  return `${p.author}/${p.permlink}`;
}

/**
 * One read-only poll pass.
 *
 * @param {object} opts
 * @param {Set<string>} [opts.seen]  in-process cursor of already-processed posts.
 *                                   Pass the SAME set across ticks in --watch mode.
 * @param {string} [opts.reportDir]  override the report output dir
 * @param {*} [opts.storeRoot]       override the store root (a path or Store)
 * @returns {Promise<{scanned, fresh, findingsRecorded, report, rpcError}>}
 */
export async function pollOnce({ seen = new Set(), reportDir = REPORT_DIR, storeRoot = STORE_ROOT } = {}) {
  // 1. Pull recent posts (read-only; soft-fails to [] with .error set).
  const posts = await _fetchPosts().catch((e) => Object.assign([], { error: e.message }));
  const rpcError = posts.error || null;

  // 2. Run the engines over the WHOLE recent set (cross-reference corpus is the
  //    other recent posts — exactly what alpha-report does). We render the full
  //    set to the report, but only RECORD findings for posts not seen before, so
  //    the store doesn't re-log the same finding every tick.
  const results = await _runEngines(posts).catch(() => []);

  // 3. Record fresh MATCH findings to the shared store. recordFinding is
  //    idempotent on (post, source), so even without the cursor it won't
  //    duplicate; the cursor just saves the work.
  let findingsRecorded = 0;
  const freshKeys = [];
  for (const r of results) {
    const key = `${r.author}/${r.permlink}`;
    if (seen.has(key)) continue;
    freshKeys.push(key);
    if (r.verdict === 'match' && r.top) {
      try {
        const res = await recordFinding(
          {
            post: { author: r.author, permlink: r.permlink },
            source: r.top,
            confidence: r.confidence,
          },
          storeRoot,
        );
        if (!res.deduplicated) findingsRecorded += 1;
      } catch (e) {
        // advisory-only: a store hiccup must not stop the watch.
        console.error(`[cheetah-watch] store write failed for ${key}: ${e.message}`);
      }
    }
  }
  for (const k of freshKeys) seen.add(k);

  // 4. Refresh the visible report surface (same artifacts as alpha-report).
  const report = {
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    head: null, // head is cosmetic on the page; the watch focuses on detection
    rpcError,
    results,
  };
  try {
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, 'index.html'), reportHtml(report));
    await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`[cheetah-watch] report write failed: ${e.message}`);
  }

  return {
    scanned: results.length,
    fresh: freshKeys.length,
    findingsRecorded,
    report,
    rpcError,
  };
}

// ---- CLI -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  const once = args.includes('--once');
  if (!watch && !once) {
    console.error('usage: node cheetah/watch.mjs (--once | --watch)');
    process.exit(2);
  }

  const seen = new Set();
  const tick = async () => {
    try {
      const r = await pollOnce({ seen });
      console.log(
        `[cheetah-watch] scanned=${r.scanned} fresh=${r.fresh} findings+=${r.findingsRecorded}` +
          (r.rpcError ? ` rpc-error="${r.rpcError}"` : '') +
          ` → ${REPORT_DIR}`,
      );
    } catch (e) {
      // pollOnce already soft-fails internally; this is the last-ditch guard so
      // --watch never dies on a surprise.
      console.error(`[cheetah-watch] tick failed (continuing): ${e.message}`);
    }
  };

  await tick();
  if (once) return;

  console.log(`[cheetah-watch] watching every ${POLL_INTERVAL_MS}ms (read-only; never broadcasts)`);
  setInterval(tick, POLL_INTERVAL_MS);
}

const isCli =
  import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isCli) {
  main().catch((err) => {
    console.error(`cheetah/watch.mjs fatal: ${err.message}`);
    process.exit(1);
  });
}
