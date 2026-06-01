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
import { composeCreditingNote, composeImageCreditNote } from './compose.js';
import { recordFinding, isWhitelisted, isBlacklisted, listFindings } from './store.js';
import {
  CHEETAH_ACCOUNT,
  SIMILARITY_THRESHOLD,
  FREQUENCY_CAP_PER_AUTHOR_DAY,
  STORE_PATH,
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

// ---- scan one post ---------------------------------------------------------

async function scanPost(post, { dryRun, corpus }) {
  // skip if blacklisted (the author is already known-pass-off; Hathor's job, not Cheetah's)
  if (await isBlacklisted(post.author, STORE_PATH)) {
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
  const imageCredit = imageScan.findings[0] || null;

  if (!detection.match) {
    // no text match — but an image may still be creditable
    if (imageCredit) {
      const comment = composeImageCreditNote({ match: true, source: imageCredit.source, confidence: imageCredit.confidence }, `${post.author}-${post.permlink}-img`);
      return dryRun
        ? { intent: 'image-credit-comment', post, source: imageCredit.source, confidence: imageCredit.confidence, comment }
        : { imageCredit: true, post, source: imageCredit.source, images: imageScan.imageCount };
    }
    return { skipped: 'no-match', post, confidence: detection.confidence, images: imageScan.imageCount };
  }

  // whitelist guard — if the author has proven authorship of similar material,
  // suppress the comment.
  if (await isWhitelisted(post.author, null, STORE_PATH)) {
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
    }, STORE_PATH);
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
  }, STORE_PATH);
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
      const tag = r.broadcast ? '✓ broadcast' : r.intent ? `→ ${r.intent}` : `· ${r.skipped}`;
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
    const findings = await listFindings({ limit: 10 }, STORE_PATH);
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

main().catch((err) => {
  console.error(`cheetah/index.js fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
