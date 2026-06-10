// cheetah/policing-run.mjs — the STANDING "Cheetah comes to stop it" loop (old-queue #265).
//
// We proved the loop live on the testnet: a thief posts a copy of a Hathor post; @cheetahbot replies
// on the thief's post with a credit-first note, visible in the normal feed. This module is the durable,
// version-controlled, OFFLINE-TESTABLE version of that loop — the box runs it on a timer.
//
// It GLUES the two halves that already exist in this directory:
//   • the PULL seam — fetchRecentPosts (alpha-report.mjs / the same get_discussions_by_created the
//     read-only watch loop uses), and
//   • the SCAN seam — scanPost (index.js): detect → frequency-cap/whitelist guard → compose the
//     credit-first note. We always call scanPost in DRY-RUN so it returns the intended note and NEVER
//     broadcasts itself (it would instantiate Hathor with posting auth, which this repo must not hold).
//
// The actual reply is sent by an INJECTED broadcaster — exactly the welcomer.mjs pattern
// (`__setBroadcast`). The box wires a JIT-vault-key broadcaster (@cheetahbot's posting key, fetched
// per run, never on disk); with no broadcaster injected this module is a pure DRY-RUN that returns the
// reply PLANS. So the repo stays ZERO-WIF and the whole loop is testable with no chain and no keys.
//
// Reply DEDUP: we reply to a given (author, permlink) at most once. The "already replied" check is
// injectable (default: an in-process set) so the box can back it with a durable store across restarts.
//
// Credit-first / never-accuse and the per-author frequency cap are enforced inside scanPost/compose —
// this module does not re-implement detection or tone; a regression there fails the existing
// policing-scenarios.test.mjs before it reaches the chain.
//
//   import { policingScan, __setBroadcast } from './cheetah/policing-run.mjs'
//   const out = await policingScan({ corpus })            // dry-run: out.plans = intended replies
//   __setBroadcast(async (plan) => sendReplyWithJitKey(plan))  // box edge
//   const out = await policingScan({ corpus, broadcast: true }) // live: out.replied = sent replies

import { fetchRecentPosts } from './alpha-report.mjs';
import { scanPost } from './index.js';

// ── injectable seams (tests / box wiring) ──────────────────────────────────────────────────────────
let _fetchPosts = fetchRecentPosts;
let _scan = scanPost;
let _broadcast = null;

/** Inject the post-pull seam: fetchPosts({limit}) -> [{author, permlink, body, ...}]. Falsy resets. */
export function __setFetchPosts(fn) { _fetchPosts = fn || fetchRecentPosts; }
/** Inject the scan seam: scan(post, {dryRun, corpus, storeRoot}) -> result. Falsy resets. */
export function __setScan(fn) { _scan = fn || scanPost; }
/**
 * Inject the reply broadcaster: broadcast(plan) -> result. `plan` is
 * { parentAuthor, parentPermlink, body, tags, intent, source, confidence }.
 * The box wires a JIT-vault-key sender here; falsy clears it (back to dry-run).
 */
export function __setBroadcast(fn) { _broadcast = typeof fn === 'function' ? fn : null; }

// Default in-process reply-dedup (per author/permlink). The box can override via opts.alreadyReplied /
// opts.markReplied to make it survive restarts.
const _repliedKeys = new Set();
const replyKey = (author, permlink) => `${author}/${permlink}`;
/** Test seam: clear the in-process replied set. */
export function __resetReplied() { _repliedKeys.clear(); }

// scanPost dry-run results that represent an intended reply (a note Cheetah would post).
const INTENT_KINDS = new Set(['crediting-comment', 'discovery-comment', 'image-credit-comment']);
const INTENT_TAGS = {
  'crediting-comment': ['cheetah', 'attribution'],
  'discovery-comment': ['cheetah', 'discovery'],
  'image-credit-comment': ['cheetah', 'attribution'],
};

/**
 * One standing policing pass: pull recent posts, scan each against the corpus, and for every post that
 * warrants a credit-first note, either RETURN the plan (dry-run) or send it via the injected broadcaster.
 *
 * @param {object} [opts]
 * @param {Array}  [opts.corpus=[]]          canonical protected works to detect copies of (the box
 *                                           passes Hathor's real posts); cross-post overlap is added too.
 * @param {number} [opts.limit]              posts to pull this pass (forwarded to the fetch seam)
 * @param {boolean}[opts.broadcast=false]    when true AND a broadcaster is injected, actually reply
 * @param {string} [opts.storeRoot]          findings/whitelist store root (forwarded to scanPost)
 * @param {(a:string,p:string)=>boolean|Promise<boolean>} [opts.alreadyReplied]  dedup predicate
 * @param {(a:string,p:string)=>void|Promise<void>}       [opts.markReplied]     dedup writer
 * @returns {Promise<{ scanned:number, plans:Array, replied:Array, skipped:Array, errors:Array }>}
 */
export async function policingScan({
  corpus = [],
  limit,
  broadcast = false,
  storeRoot,
  alreadyReplied,
  markReplied,
} = {}) {
  const out = { scanned: 0, plans: [], replied: [], skipped: [], errors: [] };

  let posts = [];
  try {
    posts = await _fetchPosts(limit != null ? { limit } : {});
  } catch (e) {
    out.errors.push({ stage: 'fetch', error: e?.message || String(e) });
    return out;
  }
  if (!Array.isArray(posts)) posts = [];

  const seen = alreadyReplied || ((a, p) => _repliedKeys.has(replyKey(a, p)));
  const mark = markReplied || ((a, p) => { _repliedKeys.add(replyKey(a, p)); });

  for (const post of posts) {
    if (!post || !post.author || !post.permlink) continue;
    out.scanned += 1;

    // Already replied to this exact post → never double-post.
    try {
      if (await seen(post.author, post.permlink)) {
        out.skipped.push({ author: post.author, permlink: post.permlink, reason: 'already-replied' });
        continue;
      }
    } catch { /* dedup hiccup: fail open to scanning, the broadcaster's own guard is the backstop */ }

    // Corpus for this post = the canonical protected works ∪ the OTHER recent posts (cross-reference),
    // minus the post itself (so it never matches itself 100%).
    const postCorpus = corpus
      .concat(posts)
      .filter((c) => c && !(c.author === post.author && c.permlink === post.permlink));

    // Always scan in DRY-RUN: scanPost returns the intended note and never broadcasts (zero-WIF here).
    let r;
    try {
      r = await _scan(post, { dryRun: true, corpus: postCorpus, storeRoot });
    } catch (e) {
      out.errors.push({ author: post.author, permlink: post.permlink, stage: 'scan', error: e?.message || String(e) });
      continue;
    }

    if (!r || !INTENT_KINDS.has(r.intent)) {
      out.skipped.push({ author: post.author, permlink: post.permlink, reason: r?.skipped || r?.reason || 'no-action' });
      continue;
    }

    const plan = {
      parentAuthor: post.author,
      parentPermlink: post.permlink,
      body: r.comment,
      tags: INTENT_TAGS[r.intent] || ['cheetah'],
      intent: r.intent,
      source: r.source || null,
      confidence: r.confidence ?? null,
    };

    // Dry-run (no broadcaster, or broadcast:false): just collect the plan.
    if (!broadcast || !_broadcast) {
      out.plans.push(plan);
      continue;
    }

    // Live: send via the injected (JIT-key) broadcaster, then mark replied so we never repeat it.
    try {
      const res = await _broadcast(plan);
      await mark(post.author, post.permlink);
      out.replied.push({ ...plan, ok: true, tx: res?.id || res?.tx || null });
    } catch (e) {
      out.errors.push({ author: post.author, permlink: post.permlink, stage: 'broadcast', error: e?.message || String(e) });
    }
  }

  return out;
}

// ── CLI (guarded): a dry-run pass that prints intended replies. No broadcast without a wired key. ────
if (process.argv[1] && /policing-run\.mjs$/.test(process.argv[1])) {
  const out = await policingScan({});
  console.log(`[cheetah-policing] scanned=${out.scanned} plans=${out.plans.length} skipped=${out.skipped.length} errors=${out.errors.length}`);
  for (const p of out.plans) {
    console.log(`  → reply on @${p.parentAuthor}/${p.parentPermlink} [${p.intent}]${p.source ? ` (source ${p.source})` : ''}`);
  }
  if (!out.plans.length) console.log('  (nothing to credit this pass)');
  console.log('\nThis is a DRY RUN — no replies are sent without a JIT-key broadcaster wired at the box edge.');
}
