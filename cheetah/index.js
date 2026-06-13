/**
 * cheetah/index.js — orchestrator + CLI for CheetahAdvanced.
 *
 * Wires the modules in this directory into a runnable bot. Pulls posts via
 * the Hathor chain client, runs text-detection against them, applies the
 * frequency cap + whitelist guard, composes the comment when a match
 * crosses threshold, broadcasts (or dry-runs) the comment, records the
 * finding in the shared store.
 *
 * Modes (mirror witness/feed-publisher.js + welcomer/index.js conventions):
 *   node cheetah/index.js --once             # one scan pass, exit
 *   node cheetah/index.js --dry-run          # scan + print intended actions, no broadcast
 *   node cheetah/index.js --cron             # scan on CHEETAH_CRON schedule
 *   node cheetah/index.js --scan-fixtures    # use fixture posts (no chain) — handy
 *                                            # before MELEK testnet RPC exists
 *
 * Env knobs (cheetah/config.js):
 *   CHEETAH_ACCOUNT, CHEETAH_SIMILARITY_THRESHOLD, CHEETAH_FREQ_CAP,
 *   CHEETAH_STORE, CHEETAH_SELF_ID_URL, CHEETAH_WEB_SEARCH,
 *   MELEK_RPC_URL / MELEK_CHAIN_ID / MELEK_ADDRESS_PREFIX (chain),
 *   CHEETAH_CRON (cron expr; default "*5/* * * *" — every 5 min)
 *
 * Per CHEETAH_ADVANCED.md design:
 *   - State facts, never accuse. Detection finds matches; intent is for
 *     Hathor's resolution layer to handle in conversation.
 *   - Credit first, escalate last. Default first contact is the friendly
 *     crediting note. Blacklist only after the human-in-loop resolution
 *     trail (Cheetah cannot auto-blacklist; see store.js).
 *   - Self-identify on every comment. Footer is appended by compose.js.
 *   - Earn unsolicited appearances. Frequency cap per author + similarity
 *     threshold + per-author opt-out (TODO when opt-out list lands).
 */

import 'dotenv/config';
import cron from 'node-cron';
import { Hathor } from '../witness/hathor.js';
import { detectText } from './text-detection.js';
import { scanPostImages } from './image-scan.js';
import { composeCreditingNote, composeImageCreditNote, composeDiscoveryNote } from './compose.js';
import { discover } from './discovery.js';
import { recordFinding, isWhitelisted, isBlacklisted, listFindings } from './store.js';
import {
  CHEETAH_ACCOUNT,
  SIMILARITY_THRESHOLD,
  FREQUENCY_CAP_PER_AUTHOR_DAY,
  STORE_ROOT,
  status as cheetahStatus,
} from './config.js';

const CHEETAH_CRON = process.env.CHEETAH_CRON || '*/5 * * * *';

// Frequency-cap memory (in-process for now — graduating to store-backed
// when we want the cap to survive restart).
const recentCommentsByAuthor = new Map();
function recordComment(author) {
  const now = Date.now();
  const list = recentCommentsByAuthor.get(author) || [];
  list.push(now);
  // keep only last 24h
  recentCommentsByAuthor.set(author, list.filter(t => now - t < 86400000));
}
function recentlyCommentedOn(author) {
  const list = recentCommentsByAuthor.get(author) || [];
  const now = Date.now();
  const within24h = list.filter(t => now - t < 86400000);
  recentCommentsByAuthor.set(author, within24h);
  return within24h.length >= FREQUENCY_CAP_PER_AUTHOR_DAY;
}

// Test-only seam: let the offline harness pre-arm the in-process frequency-cap
// (which the live loop arms via recordComment after a successful broadcast) so
// the cap's suppression can be exercised without a chain. Not used in
// production code paths. Mirrors the __setFetch/__setDecoder convention.
export function __recordComment(author) { recordComment(author); }
export function __resetCap() { recentCommentsByAuthor.clear(); }

// ---- fixtures (used pre-chain) ---------------------------------------------

const FIXTURES = [
  {
    author: 'alice',
    permlink: 'fresh-take-on-graphene',
    body: 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule.',
  },
  {
    author: 'bob',
    permlink: 'borrowed-paragraph',
    body: 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule. I think this is interesting.',
  },
  {
    author: 'carol',
    permlink: 'totally-original',
    body: 'I went to the store and bought some bananas. The cashier was friendly. I like bananas.',
  },
];

// Collapse image-scan findings to one entry per distinct source, highest confidence first. A source
// is keyed by @author/permlink (on-chain) or its url (open-web reverse-image), so a post with N
// images each first seen elsewhere yields N credit entries — not N copies of the loudest match.
export function dedupeSources(findings) {
  const best = new Map();
  for (const f of findings) {
    if (!f || !f.source) continue;
    const s = f.source;
    const key = s.author ? `@${s.author}/${s.permlink}` : (s.url || JSON.stringify(s));
    const conf = f.confidence || 0;
    const prev = best.get(key);
    if (!prev || conf > prev.confidence) best.set(key, { ...s, confidence: conf });
  }
  return [...best.values()].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

// ---- scan one post ---------------------------------------------------------

export async function scanPost(post, { dryRun, corpus, storeRoot = STORE_ROOT } = {}) {
  // skip if blacklisted (the author is already known-pass-off; Hathor's job, not Cheetah's)
  if (await isBlacklisted(post.author, storeRoot)) {
    return { skipped: 'author-blacklisted', post };
  }
  // frequency cap
  if (recentlyCommentedOn(post.author)) {
    return { skipped: 'frequency-cap', post };
  }

  const detection = await detectText(post.body, { corpus });

  // image credit-giver pass (pHash / reverse-image) — runs regardless of the text result, so a
  // post that copies an IMAGE (with original text) is still credited. Indexes images for future.
  const imageScan = await scanPostImages(post, { dryRun }).catch(() => ({ findings: [], indexed: 0, imageCount: 0 }));
  // Credit EVERY distinct source, not just the first. A post can carry several images each first
  // seen elsewhere (on-chain OR open-web via reverse-image); collapse findings to one entry per
  // source (highest confidence wins) so the note lists them all.
  const imageSources = dedupeSources(imageScan.findings || []);
  const imageCredit = imageSources[0] || null;

  if (!detection.match) {
    // no text match — but one or more images may still be creditable
    if (imageCredit) {
      const comment = composeImageCreditNote({ match: true, sources: imageSources }, `${post.author}-${post.permlink}-img`);
      if (dryRun) {
        return { intent: 'image-credit-comment', post, sources: imageSources, source: imageCredit, confidence: imageCredit.confidence, comment };
      }
      // Live path — previously this returned WITHOUT broadcasting, so image-only copies were
      // detected but never actually credited on-chain. Mirror the text-crediting path below:
      // broadcast the credit comment via Hathor's posting auth, or record the finding if the
      // chain isn't ready yet.
      const hathor = new Hathor();
      if (!hathor.status().readyToConnect) {
        await recordFinding({
          post: { author: post.author, permlink: post.permlink },
          source: imageCredit,
          confidence: imageCredit.confidence,
        }, storeRoot);
        return { imageCredit: false, post, sources: imageSources, source: imageCredit, reason: 'chain-not-ready', images: imageScan.imageCount };
      }
      await hathor.adapter || hathor.connect();
      const result = await hathor.adapter.reply({
        parentAuthor: post.author,
        parentPermlink: post.permlink,
        body: comment,
        tags: ['cheetah', 'attribution', 'image'],
      });
      recordComment(post.author);
      await recordFinding({
        post: { author: post.author, permlink: post.permlink },
        source: imageCredit,
        confidence: imageCredit.confidence,
      }, storeRoot);
      return { imageCredit: true, broadcast: true, post, sources: imageSources, source: imageCredit, images: imageScan.imageCount, tx: result.id };
    }

    // Discovery-first librarian face (CHEETAH_ADVANCED.md Step 5). Not a copy,
    // but the post may still *connect* to prior work on the chain — Cheetah's
    // primary, friendlier surface. Same deterministic shingle engine, in the
    // relatedness BAND (below the copy threshold, above incidental overlap).
    // Respects the frequency cap (checked at scanPost top) and the same
    // whitelist suppression as crediting. This fires far more often than the
    // copy path, so it is the librarian's main appearance.
    if (await isWhitelisted(post.author, null, storeRoot)) {
      return { skipped: 'author-whitelisted', post, confidence: detection.confidence, images: imageScan.imageCount };
    }
    const { related } = discover(post, { corpus });
    if (related.length) {
      // compose the librarian "see also" note. composeDiscoveryNote wants a
      // url per related entry; build the @author/permlink link for each.
      const relatedWithUrls = related.map((r) => ({ ...r, url: `@${r.author}/${r.permlink}` }));
      const comment = composeDiscoveryNote({ related: relatedWithUrls }, `${post.author}-${post.permlink}-disc`);
      if (dryRun) {
        return { intent: 'discovery-comment', post, related, comment };
      }
      // Live path mirrors the crediting branch: broadcast if the chain is up,
      // otherwise just note it. Discovery is a "see also", not a finding, so it
      // is not recorded in cheetah.findings (those are possible-copy records).
      const hathor = new Hathor();
      const hathorStatus = hathor.status();
      if (!hathorStatus.readyToConnect) {
        return { discovery: false, post, related, reason: 'chain-not-ready' };
      }
      await hathor.adapter || hathor.connect();
      const result = await hathor.adapter.reply({
        parentAuthor: post.author,
        parentPermlink: post.permlink,
        body: comment,
        tags: ['cheetah', 'discovery'],
      });
      recordComment(post.author);
      return { discovery: true, post, related, tx: result.id };
    }

    return { skipped: 'no-match', post, confidence: detection.confidence, images: imageScan.imageCount };
  }

  // whitelist guard — if the author has proven authorship of similar material,
  // suppress the comment.
  if (await isWhitelisted(post.author, null, storeRoot)) {
    return { skipped: 'author-whitelisted', post };
  }

  const comment = composeCreditingNote(detection, `${post.author}-${post.permlink}`);

  if (dryRun) {
    return { intent: 'crediting-comment', post, source: detection.source, confidence: detection.confidence, comment };
  }

  // Live broadcast path — requires chain config + posting key (via
  // MELEK-Signer eventually). For now, if Hathor isn't ready to connect,
  // we record the finding without broadcasting and let the operator handle
  // it manually until the chain is live.
  const hathor = new Hathor();
  const hathorStatus = hathor.status();
  if (!hathorStatus.readyToConnect) {
    await recordFinding({
      post: { author: post.author, permlink: post.permlink },
      source: detection.source,
      confidence: detection.confidence,
    }, storeRoot);
    return { broadcast: false, post, reason: 'chain-not-ready', source: detection.source };
  }

  // Reply via Hathor's posting auth — Cheetah uses the same chain adapter
  // because they're sibling bots in the same Bot Repo.
  await hathor.adapter || hathor.connect();
  const result = await hathor.adapter.reply({
    parentAuthor: post.author,
    parentPermlink: post.permlink,
    body: comment,
    tags: ['cheetah', 'attribution'],
  });
  recordComment(post.author);
  await recordFinding({
    post: { author: post.author, permlink: post.permlink },
    source: detection.source,
    confidence: detection.confidence,
  }, storeRoot);
  return { broadcast: true, post, source: detection.source, confidence: detection.confidence, tx: result.id };
}

// ---- scan a batch ----------------------------------------------------------

async function scanBatch({ posts, corpus, dryRun }) {
  console.log(`[cheetah] scanning ${posts.length} post(s), threshold=${SIMILARITY_THRESHOLD}, dry=${dryRun}`);
  const results = [];
  for (const post of posts) {
    try {
      const r = await scanPost(post, { dryRun, corpus });
      results.push(r);
      const tag = r.broadcast ? '✓ broadcast'
        : r.discovery ? '✓ discovery'
        : r.imageCredit ? '✓ image-credit'
        : r.intent ? `→ ${r.intent}`
        : r.skipped ? `· ${r.skipped}`
        : r.reason ? `· ${r.reason}`
        : '·';
      const conf = r.confidence ? ` (${(r.confidence * 100).toFixed(0)}%)` : '';
      console.log(`  ${tag}${conf} — ${post.author}/${post.permlink}`);
    } catch (err) {
      console.error(`  ✗ ${post.author}/${post.permlink}: ${err.message}`);
      results.push({ error: err.message, post });
    }
  }
  return results;
}

// ---- main ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const once = args.includes('--once');
  const cronMode = args.includes('--cron');
  const fixtures = args.includes('--scan-fixtures');
  const showStatus = args.includes('--status');

  if (showStatus) {
    const s = cheetahStatus();
    const findings = await listFindings({ limit: 10 }, STORE_ROOT);
    console.log('Cheetah status:');
    for (const [k, v] of Object.entries(s)) console.log(`  ${k}: ${v}`);
    console.log(`  recent findings: ${findings.length}`);
    return;
  }

  if (!once && !cronMode && !fixtures) {
    console.error('specify one of: --once, --cron, --scan-fixtures, --status');
    console.error('(use with --dry-run to skip broadcast)');
    process.exit(1);
  }

  if (fixtures) {
    console.log('[cheetah] FIXTURE MODE — no chain calls; each fixture checked against the OTHER fixtures');
    const results = [];
    for (const post of FIXTURES) {
      // corpus is "everything except this post" — otherwise it matches itself 100%
      const corpus = FIXTURES.filter((f) => !(f.author === post.author && f.permlink === post.permlink));
      const batch = await scanBatch({ posts: [post], corpus, dryRun: true });
      results.push(...batch);
    }
    console.log(`[cheetah] fixture scan: ${results.length} posts processed`);
    return;
  }

  if (once) {
    await scanOnce({ dryRun });
    return;
  }

  if (cronMode) {
    if (!cron.validate(CHEETAH_CRON)) {
      console.error(`invalid CHEETAH_CRON: ${CHEETAH_CRON}`);
      process.exit(1);
    }
    console.log(`[cheetah] scheduling: ${CHEETAH_CRON} (dry=${dryRun})`);
    cron.schedule(CHEETAH_CRON, () => scanOnce({ dryRun }).catch((e) => console.error(`[cheetah] cron tick failed: ${e.message}`)));
    await scanOnce({ dryRun });
    // keep process alive
  }
}

async function scanOnce({ dryRun }) {
  // Live mode: pull recent posts from MELEK. Gated on chain RPC being up.
  // When MELEK_RPC_URL exists this path activates; until then it logs the
  // gating and exits.
  const hathor = new Hathor();
  const s = hathor.status();
  if (!s.readyToConnect) {
    console.log('[cheetah] chain not ready (missing env: ' + s.missingConfig.join(', ') + ')');
    console.log('[cheetah] use --scan-fixtures to validate the detection pipeline without chain.');
    return;
  }
  // TODO when chain reader supports it: pull recent posts via Hathor's
  // adapter, scan each. For now this is the structural placeholder.
  console.log('[cheetah] chain ready but post-pull integration not yet wired — see witness/chain-reader.js');
}

// Only run the CLI when invoked directly (node cheetah/index.js ...), not when
// imported (e.g. by tests). Mirrors welcomer/index.js's isCli guard.
const isCli = import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isCli) {
  main().catch((err) => {
    console.error(`cheetah/index.js fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}
