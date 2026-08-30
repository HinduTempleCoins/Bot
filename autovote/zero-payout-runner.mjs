// zero-payout-runner.mjs — the live round that lifts MELEK's $0.00 posts.
//
// Glues autovote/zero-payout-posts.mjs into a runnable curation round for the witness account:
// fetch recent #melek posts from the local MELEK RPC → select the unrewarded-but-still-payable
// ones → cast the witness's own vote on the freshest N, at a gentle weight, deduping across rounds
// so a post is never lifted twice.
//
// KEY CUSTODY (zero-WIF-in-repo): this module NEVER holds, reads from disk, or logs a private key.
// `castVote` is an INJECTED seam. In the CLI, when EXECUTE=1, it builds a dhive-backed castVote that
// reads the posting WIF from the process env var HATHOR_POSTING_KEY — supplied JUST-IN-TIME by the
// box wrapper (bin/hathor-zero-payout-once.sh) which pulls it from the vault, passes it in env, and
// unsets it after (identical custody to bin/hathor-post-once.sh). The key never touches the repo,
// never a log line, never a commit. Without EXECUTE + that env var, the CLI is a DRY RUN that only
// prints the selection.
//
// House style: ESM, injectable fetch, soft-fail-never-throw, no top-level key material, guarded CLI.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fetchZeroPayoutPosts, runZeroPayoutRound } from './zero-payout-posts.mjs';
import { DEFAULT_RULES } from '../voting_rules/curation-engine.mjs';

// ── defaults (env-overridable) ────────────────────────────────────────────────────────────────────
export const DEFAULTS = {
  rpcUrl: process.env.ZERO_PAYOUT_RPC || 'http://127.0.0.1:18090',
  tag: process.env.ZERO_PAYOUT_TAG || 'melek',
  curator: process.env.ZERO_PAYOUT_CURATOR || 'hathor',
  weight: clampWeight(process.env.ZERO_PAYOUT_WEIGHT, 3000),      // gentle 30% by default
  topN: clampInt(process.env.ZERO_PAYOUT_TOPN, 10),              // per-round cap
  fetchLimit: clampInt(process.env.ZERO_PAYOUT_FETCH_LIMIT, 100),
  minAgeSec: clampInt(process.env.ZERO_PAYOUT_MIN_AGE_SEC, 300),  // let organic votes land first (5 min)
  // Dedupe store. The live deploy points ZERO_PAYOUT_DB at a persistent path outside the repo (set in
  // the service env); the neutral fallback keeps it out of the repo tree when unset.
  dbPath: process.env.ZERO_PAYOUT_DB || join(tmpdir(), 'melek-zero-payout-voted.json'),
  voteGapMs: clampInt(process.env.ZERO_PAYOUT_VOTE_GAP_MS, 0), // spacing between casts (chain min-vote interval)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clampWeight(v, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 10000 ? n : dflt;
}
function clampInt(v, dflt) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/**
 * The self-deal exclusion set: the curator itself + Hathor's own/affiliated accounts (the same guard
 * curation-engine.mjs uses: DEFAULT_RULES.selfAccounts) + any extra ZERO_PAYOUT_AFFILIATED accounts.
 * Never lift our own family's posts — the witness vote must land on the community, never self-deal.
 */
export function excludedAccounts({ curator = DEFAULTS.curator, extra = [] } = {}) {
  const affiliatedEnv = String(process.env.ZERO_PAYOUT_AFFILIATED || 'thoth,seshat,maat,initminer,vankush')
    .split(/[\s,]+/).filter(Boolean);
  const all = [
    curator,
    ...(DEFAULT_RULES.selfAccounts || []),
    ...affiliatedEnv,
    ...(Array.isArray(extra) ? extra : []),
  ].map((a) => String(a || '').trim().toLowerCase()).filter(Boolean);
  return new Set(all);
}

// ── dedupe persistence (a JSON array of "author/permlink" keys, outside the repo) ──────────────────
/** Load the persisted dedupe set. Soft-fail → empty Set (first run / unreadable file). */
export function loadVoted(dbPath = DEFAULTS.dbPath) {
  try {
    const raw = readFileSync(dbPath, 'utf8');
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : (Array.isArray(arr?.voted) ? arr.voted.map(String) : []));
  } catch { return new Set(); }
}

/** Persist the dedupe set (best-effort; never throws). Caps size so the file can't grow unbounded. */
export function saveVoted(set, dbPath = DEFAULTS.dbPath, cap = 5000) {
  try {
    const arr = [...(set instanceof Set ? set : new Set(set || []))];
    const kept = arr.length > cap ? arr.slice(arr.length - cap) : arr;   // keep the most-recent
    mkdirSync(dirname(dbPath), { recursive: true });
    writeFileSync(dbPath, JSON.stringify(kept));
    return kept.length;
  } catch { return -1; }
}

/**
 * Run one live zero-payout curation round.
 * Pure control-flow given its seams (fetch, castVote, clock). Soft-fail → a zero-cast result.
 * @param {object} cfg
 *   fetch        : injectable fetch (default global)
 *   rpcUrl, tag, fetchLimit, minAgeSec, weight, topN, curator, dbPath  (see DEFAULTS)
 *   castVote     : ({voter,author,permlink,weight})=>Promise  — the signer seam. If absent → DRY RUN
 *                  (selects + returns, casts nothing).
 *   extraExclude : extra authors to skip on top of the self-deal guard
 *   now          : injectable clock
 * @returns {Promise<{curator, dryRun, considered, selected, cast, dedupeSize, excluded}>}
 */
export async function runZeroPayoutCuration(cfg = {}) {
  const {
    fetch: f = (typeof fetch !== 'undefined' ? fetch : null),
    rpcUrl = DEFAULTS.rpcUrl, tag = DEFAULTS.tag, fetchLimit = DEFAULTS.fetchLimit,
    minAgeSec = DEFAULTS.minAgeSec, weight = DEFAULTS.weight, topN = DEFAULTS.topN,
    curator = DEFAULTS.curator, dbPath = DEFAULTS.dbPath, castVote, extraExclude = [],
    voteGapMs = DEFAULTS.voteGapMs, now = Date.now(),
  } = cfg;

  const excludeAuthors = excludedAccounts({ curator, extra: extraExclude });
  const alreadyVoted = loadVoted(dbPath);

  // select real $0.00, still-payable, top-level posts (freshest first), minus self/affiliated + dupes.
  const selected = await fetchZeroPayoutPosts({
    fetch: f, rpcUrl, tag, fetchLimit,
    excludeAuthors, alreadyVoted, minAgeSec, limit: topN,
  });

  const dryRun = typeof castVote !== 'function';
  if (dryRun) {
    return {
      curator, dryRun: true, considered: selected.length, selected,
      cast: [], dedupeSize: alreadyVoted.size, excluded: [...excludeAuthors],
    };
  }

  // Space casts by voteGapMs so we stay above the chain's min-vote interval (more land per round,
  // and it's gentler). A gap AFTER each cast; the seam stays soft-fail per post.
  const spaced = Number(voteGapMs) > 0
    ? async (v) => { const r = await castVote(v); await sleep(Number(voteGapMs)); return r; }
    : castVote;
  const round = await runZeroPayoutRound({
    curator: { account: curator }, posts: selected, castVote: spaced, weight, topN, alreadyVoted,
  });
  saveVoted(alreadyVoted, dbPath);

  return {
    curator, dryRun: false, considered: round.considered, selected,
    cast: round.cast, dedupeSize: alreadyVoted.size, excluded: [...excludeAuthors],
  };
}

/**
 * Build a dhive-backed castVote from a JIT posting WIF (env only — never from the repo). Kept out of
 * the pure path and dynamically importing dhive so the module stays offline-testable with no dep on a
 * key or a network. Broadcasts a single `vote` op to the local MELEK RPC. Never logs the key.
 */
export async function makeDhiveCastVote({ rpcUrl = DEFAULTS.rpcUrl, postingKey, chainId, addressPrefix = 'MELEK' } = {}) {
  if (!postingKey) throw new Error('no posting key in env (key NOT logged)');
  const dhive = await import('@hiveio/dhive');
  const { Client, PrivateKey } = dhive.default || dhive;
  const client = new Client(rpcUrl, { chainId, addressPrefix, timeout: 20000 });
  const key = PrivateKey.fromString(postingKey);
  return async ({ voter, author, permlink, weight }) => {
    const op = ['vote', { voter, author, permlink, weight }];
    return client.broadcast.sendOperations([op], key);
  };
}

// ── CLI (guarded) — DRY RUN unless EXECUTE=1 + a JIT key in env ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('zero-payout-runner.mjs')) {
  (async () => {
    const execute = process.env.EXECUTE === '1';
    const key = process.env.HATHOR_POSTING_KEY;                     // JIT from the box wrapper; never from repo
    let castVote;
    if (execute) {
      if (!key) { console.error('EXECUTE=1 but no HATHOR_POSTING_KEY in env — refusing (key NOT logged). Dry-running instead.'); }
      else {
        try {
          castVote = await makeDhiveCastVote({
            rpcUrl: DEFAULTS.rpcUrl, postingKey: key,
            chainId: process.env.MELEK_CHAIN_ID, addressPrefix: process.env.MELEK_ADDRESS_PREFIX || 'MELEK',
          });
        } catch (e) { console.error('could not build signer (key NOT logged):', String(e.message || e)); }
      }
    }
    const res = await runZeroPayoutCuration({ castVote });
    console.log(`[zero-payout] curator=@${res.curator} ${res.dryRun ? 'DRY-RUN' : 'LIVE'} rpc=${DEFAULTS.rpcUrl} tag=${DEFAULTS.tag} weight=${DEFAULTS.weight / 100}% cap=${DEFAULTS.topN} minAge=${DEFAULTS.minAgeSec}s gap=${DEFAULTS.voteGapMs}ms`);
    console.log(`[zero-payout] excluded (self/affiliated): ${res.excluded.join(', ')}`);
    console.log(`[zero-payout] selected ${res.selected.length} real $0.00 post(s):`);
    for (const p of res.selected) console.log(`   @${p.author}/${p.permlink}  age=${Math.round(p.ageSec)}s pending=${p.pending}`);
    if (!res.dryRun) {
      console.log(`[zero-payout] cast ${res.cast.length} vote(s):`);
      for (const c of res.cast) console.log(`   ✓ @${c.author}/${c.permlink}  w=${c.weight} id=${c.id}`);
    }
    console.log(`[zero-payout] dedupe set now holds ${res.dedupeSize} key(s) at ${DEFAULTS.dbPath}`);
    if (key) process.env.HATHOR_POSTING_KEY = '';                   // scrub the JIT key from our env
  })().catch((e) => { console.error('[zero-payout] round error:', String(e && e.message || e)); });
}
