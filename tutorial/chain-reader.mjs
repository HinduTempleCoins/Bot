/**
 * tutorial/chain-reader.mjs — READ-ONLY Graphene reader that produces the
 * `userActivity` structure `tutorial/detector.js` is already written against.
 *
 * detector.js is pure: it takes chain-shaped data and decides which tutorial
 * stages a user has completed. This module is the missing half — it fetches
 * that data from a standard Graphene (Steem-fork) RPC node. Per
 * tutorial/README.md ("Reading the chain for completion") the reads are:
 *
 *   intro_post / share_what_you_know → get_discussions_by_author_before_date
 *   engage_three_posts               → the user's `comment` ops (account history)
 *   first_organic_upvote             → `vote` ops in the user's history where
 *                                      the user is the AUTHOR and voter != hathor
 *   power_up                         → `transfer_to_vesting` ops
 *   vote_for_a_witness               → the account's `witness_votes` field
 *                                      (supplemented by `account_witness_vote` ops)
 *
 * Contract — the exact shape detector.js expects (do not rename these keys):
 *   {
 *     posts:                [{ author, permlink, title, body, json_metadata, tags, created }],
 *     comments:             [{ author, parent_author, parent_permlink, body, created }],
 *     votes_received:       [{ voter, author, permlink, weight, time }],
 *     transfers_to_vesting: [{ from, to, amount, timestamp }],
 *     witness_votes:        [{ witness, approve }]
 *   }
 * plus the extra collections the stages 7–19 `completion_criteria` kinds need
 * (see "COVERAGE" below).
 *
 * Properties (repo rules — CLAUDE.md "Build & ship"):
 *   - READ-ONLY. No keys, no signing, no broadcasting, no writes. Ever.
 *   - Injectable fetch (`__setFetch` / `deps.fetch`) so tests run fully offline.
 *   - Soft-fail-never-throw. A dead / flaky / partial RPC yields an EMPTY or
 *     PARTIAL shape with the failure recorded in `meta.errors` — never an
 *     exception. Callers can hand the result straight to detector.js, which
 *     treats an empty collection as "stage not complete yet".
 *   - Bounded. History reads are windowed by `maxOps` (default 1000, the
 *     Graphene per-call ceiling); larger windows page backwards by sequence.
 *
 * ---------------------------------------------------------------------------
 * COVERAGE — which stages.json `completion_criteria.kind` values this satisfies
 * ---------------------------------------------------------------------------
 * FULLY SATISFIED from standard Graphene reads:
 *   post_authored            → posts
 *   comments_authored        → comments
 *   external_upvote_received → votes_received
 *   transfer_to_vesting      → transfers_to_vesting
 *   witness_vote_cast        → witness_votes
 *   profile_set              → profile          (get_accounts json_metadata /
 *                              posting_json_metadata `.profile`)
 *   follows_created          → follows          (condenser_api.get_following —
 *                              the follow plugin; falls back to the `follow`
 *                              custom_json ops in history when the plugin is off)
 *   transfer_sent            → transfers_sent   (`transfer` ops, from === account)
 *   vesting_delegation_made  → delegations      (`delegate_vesting_shares` ops)
 *
 * PRESENT BUT ONLY POPULATED ONCE THE CHAIN-SIDE FEATURE EXISTS (the read is
 * real and standard; MELEK just does not emit these ops yet — stages.json marks
 * them `infra_gated: true`):
 *   curation_reward_received → curation_rewards (`curation_reward` VIRTUAL op)
 *   market_trade_filled      → market_trades    (`fill_order` VIRTUAL op)
 *
 * NOT OBTAINABLE FROM A STANDARD GRAPHENE READ — always returned EMPTY, and the
 * reason is stated here rather than papered over with an invented RPC call:
 *   community_post_authored  → community_posts  Communities are NOT a Graphene
 *       consensus feature. On Hive they live in hivemind's `bridge.*` API (an
 *       off-chain indexer over `community` custom_json ops). MELEK runs neither
 *       hivemind nor a community plugin, so there is no node method to call.
 *   smt_held_or_created      → smt_events       SMT balances/setup are read via
 *       the SMT plugin's own API; MELEK's SMT surface is not exposed for token
 *       enumeration by account, so there is no per-account read to make.
 *   video_post_authored      → video_posts      "Is this post a video?" is an
 *       app-layer convention in json_metadata, not a chain fact. There is no
 *       video op and no agreed metadata contract yet, so guessing would be
 *       fabrication. Once the embed pipeline defines the marker, filter `posts`.
 *   wiki_edit_made           → wiki_edits       The wiki is MediaWiki, an
 *       entirely off-chain system. No Graphene op, no Graphene read.
 *   bridge_transfer_completed→ bridge_transfers The bridge settles on the EVM
 *       side; the MELEK leg looks like an ordinary `transfer` to a bridge
 *       account. Attributing one requires the bridge's own registry/indexer,
 *       which does not exist yet. Guessing from memos would be fabrication.
 *   conversation_with_witness→ conversations    "A real multi-turn conversation"
 *       is a Phase-3 relationship judgement, not a chain read. The raw reply
 *       chain IS visible (comments with parent_author === the witness), so
 *       `conversations` is populated with those raw candidate turns, but the
 *       min_turns/"genuine" determination is deliberately left to Phase 3.
 *   welcomed_a_newcomer      → welcomes         Requires knowing the parent
 *       author's account-creation date (`target_must_be_newer_account`), i.e. a
 *       second get_accounts fan-out over every account the user replied to.
 *       That is a policy decision about read budget, not a missing RPC — left
 *       empty here rather than silently issuing N extra calls per user.
 *
 * Known fidelity caveats (stated, not hidden):
 *   - Post BODIES from account history are the raw broadcast bodies; Graphene
 *     edits are patch-diffs against the previous body. The discussions-API path
 *     (tried first) returns current post state and has no such problem; the
 *     history fallback keeps the LAST body seen per permlink, which for a
 *     diff-style edit is a patch, not prose. Body-length thresholds should be
 *     trusted from the discussions path.
 *   - `votes_received` relies on the node indexing the vote's AUTHOR as an
 *     impacted account in account history (standard on full nodes with
 *     account_history). On a node with a filtered/partial history index this
 *     collection will simply be short — soft, not fatal.
 */

import { fileURLToPath } from 'node:url';

// ---- config -----------------------------------------------------------------

const DEFAULT_RPC = process.env.MELEK_RPC_URL || process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const WITNESS_ACCOUNT = process.env.MELEK_WITNESS_ACCOUNT || 'hathor';
const HISTORY_PAGE_MAX = 1000; // Graphene's per-call account-history ceiling.

// ---- injectable fetch seam --------------------------------------------------

let _fetch = null;

/** Inject a fetch implementation for offline tests. Pass null/undefined to
 *  restore the default (globalThis.fetch). */
export function __setFetch(fn) {
  _fetch = typeof fn === 'function' ? fn : null;
}

function pickFetch(deps) {
  if (deps && typeof deps.fetch === 'function') return deps.fetch;
  if (_fetch) return _fetch;
  return (...a) => globalThis.fetch(...a);
}

// ---- helpers ----------------------------------------------------------------

/** HTML-escape anything interpolated into output (house style). */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/^@/, '');

/** Graphene timestamps come back without a zone; normalize to a real ISO Z. */
function isoTime(ts) {
  if (!ts) return null;
  const s = String(ts);
  return /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`;
}

/**
 * One JSON-RPC call. Soft: returns null on any transport / shape / RPC error
 * and pushes a short reason onto `errors`.
 */
async function rpc(url, f, method, params, errors) {
  try {
    const r = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    if (r && r.ok === false) {
      errors.push(`${method}: http ${r.status ?? '?'}`);
      return null;
    }
    const j = await r.json();
    if (j && j.error) {
      errors.push(`${method}: ${j.error.message || 'rpc error'}`);
      return null;
    }
    return j ? j.result ?? null : null;
  } catch (err) {
    errors.push(`${method}: ${String((err && err.message) || err)}`);
    return null;
  }
}

/**
 * Normalize one account-history entry to { seq, timestamp, name, payload }.
 * Handles BOTH node shapes: op as [name, payload] (condenser) and as
 * { type: 'x_operation', value: {...} } (appbase).
 */
function normalizeHistoryEntry(entry) {
  if (!Array.isArray(entry) || entry.length < 2) return null;
  const seq = Number(entry[0]);
  const tx = entry[1];
  if (!tx || !tx.op) return null;
  let name;
  let payload;
  if (Array.isArray(tx.op)) {
    [name, payload] = tx.op;
  } else if (tx.op.type) {
    name = String(tx.op.type).replace(/_operation$/, '');
    payload = tx.op.value;
  }
  if (!name || !payload) return null;
  return {
    seq: Number.isFinite(seq) ? seq : null,
    timestamp: isoTime(tx.timestamp),
    name: String(name),
    payload,
  };
}

/**
 * Read a bounded window of account history, newest-first paging backwards by
 * sequence number. Returns normalized entries (oldest-first within the window).
 */
async function readHistory(account, { url, f, maxOps, errors }) {
  const want = Math.max(1, Number(maxOps) || HISTORY_PAGE_MAX);
  const out = [];
  let from = -1;
  let guard = 0;
  while (out.length < want && guard++ < 50) {
    const remaining = want - out.length;
    // Graphene requires limit <= from when from !== -1.
    const limit = from === -1
      ? Math.min(HISTORY_PAGE_MAX, remaining)
      : Math.min(HISTORY_PAGE_MAX, remaining, from);
    if (limit < 1) break;
    const page = await rpc(url, f, 'condenser_api.get_account_history', [account, from, limit], errors);
    if (!Array.isArray(page) || page.length === 0) break;
    const rows = page.map(normalizeHistoryEntry).filter(Boolean);
    out.unshift(...rows);
    const lowest = page.reduce((m, e) => {
      const n = Array.isArray(e) ? Number(e[0]) : NaN;
      return Number.isFinite(n) && n < m ? n : m;
    }, Infinity);
    if (!Number.isFinite(lowest) || lowest <= 0) break;
    from = lowest - 1;
    if (from < 0) break;
  }
  return out;
}

/** Parse a json_metadata string (or object) safely. */
function parseMeta(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Tags for a post. Prefers json_metadata.tags; when absent, falls back to the
 * `parent_permlink` of a root comment op — on Graphene that field IS the post's
 * primary tag. This is a chain fact, not a guess.
 */
function tagsFor({ json_metadata, parent_permlink }) {
  const meta = parseMeta(json_metadata);
  if (Array.isArray(meta.tags)) return meta.tags.map((t) => String(t));
  return parent_permlink ? [String(parent_permlink)] : [];
}

// ---- the shape --------------------------------------------------------------

/**
 * The empty result. Every failure path returns this (or a partial fill of it),
 * so callers and detector.js always see the same keys.
 */
export function emptyActivity(account = '') {
  return {
    account: norm(account),
    // --- the five collections detector.js reads (names are load-bearing) ---
    posts: [],
    comments: [],
    votes_received: [],
    transfers_to_vesting: [],
    witness_votes: [],
    // --- stages 7-10: satisfied from standard reads ---
    profile: null,
    follows: [],
    transfers_sent: [],
    delegations: [],
    // --- infra-gated but real reads (empty until the chain emits the op) ---
    curation_rewards: [],
    market_trades: [],
    // --- not obtainable from standard Graphene reads (see COVERAGE) ---
    community_posts: [],
    smt_events: [],
    video_posts: [],
    wiki_edits: [],
    bridge_transfers: [],
    conversations: [],
    welcomes: [],
    meta: { ok: false, rpcUrl: '', ops: 0, sources: [], errors: [] },
  };
}

// ---- the reader -------------------------------------------------------------

/**
 * Fetch a user's chain activity in exactly the shape detector.js expects.
 *
 * @param {string} account
 * @param {object} [deps]
 * @param {string} [deps.rpcUrl]   Graphene RPC endpoint (default MELEK_RPC_URL).
 * @param {Function} [deps.fetch]  injected fetch (overrides __setFetch).
 * @param {number} [deps.maxOps]   account-history window (default 1000).
 * @param {number} [deps.postLimit] discussions-API page size (default 100).
 * @param {string} [deps.witnessAccount] the account excluded from "organic"
 *   upvotes and used to spot witness conversations (default `hathor`).
 * @returns {Promise<object>} never rejects.
 */
export async function fetchUserActivity(account, deps = {}) {
  const acc = norm(account);
  const out = emptyActivity(acc);
  // An EXPLICIT rpcUrl of '' / null means "no endpoint" (and is reported as
  // such); only an omitted rpcUrl falls back to the env default.
  const url = Object.prototype.hasOwnProperty.call(deps, 'rpcUrl')
    ? String(deps.rpcUrl || '')
    : DEFAULT_RPC;
  out.meta.rpcUrl = url;
  if (!acc || !url) {
    out.meta.errors.push(!acc ? 'no account' : 'no rpcUrl');
    return out;
  }

  const f = pickFetch(deps);
  const errors = out.meta.errors;
  const sources = out.meta.sources;
  const witness = norm(deps.witnessAccount || WITNESS_ACCOUNT);
  const postLimit = Math.max(1, Math.min(100, Number(deps.postLimit) || 100));

  // --- 1. the account record: profile (stage 7) + witness_votes (stage 6) ----
  const accounts = await rpc(url, f, 'condenser_api.get_accounts', [[acc]], errors);
  const record = Array.isArray(accounts) ? accounts[0] : null;
  if (record) {
    sources.push('get_accounts');
    // profile_set: the profile object lives in json_metadata (or, on newer
    // forks, posting_json_metadata) under `.profile`.
    const meta = parseMeta(record.posting_json_metadata);
    const meta2 = parseMeta(record.json_metadata);
    const profile = (meta.profile && typeof meta.profile === 'object')
      ? meta.profile
      : ((meta2.profile && typeof meta2.profile === 'object') ? meta2.profile : null);
    if (profile) out.profile = profile;
    // witness_votes: the account's CURRENT approvals, as an array of names.
    if (Array.isArray(record.witness_votes)) {
      for (const w of record.witness_votes) {
        const name = norm(w);
        if (name) out.witness_votes.push({ witness: name, approve: true });
      }
    }
  }

  // --- 2. posts: the discussions API first (current post state) -------------
  const before = new Date(Date.now() + 86400000).toISOString().slice(0, 19);
  const discussions = await rpc(
    url, f, 'condenser_api.get_discussions_by_author_before_date',
    [acc, '', before, postLimit], errors,
  );
  const seenPermlinks = new Set();
  if (Array.isArray(discussions)) {
    sources.push('get_discussions_by_author_before_date');
    for (const d of discussions) {
      if (!d || norm(d.author) !== acc) continue;
      if (d.parent_author) continue; // replies are comments, not posts
      const permlink = String(d.permlink || '');
      if (!permlink || seenPermlinks.has(permlink)) continue;
      seenPermlinks.add(permlink);
      out.posts.push({
        author: acc,
        permlink,
        title: String(d.title || ''),
        body: String(d.body || ''),
        json_metadata: typeof d.json_metadata === 'string'
          ? d.json_metadata
          : JSON.stringify(d.json_metadata || {}),
        tags: tagsFor({ json_metadata: d.json_metadata, parent_permlink: d.parent_permlink }),
        created: isoTime(d.created),
      });
    }
  }

  // --- 3. account history: everything op-shaped ------------------------------
  const history = await readHistory(acc, { url, f, maxOps: deps.maxOps ?? HISTORY_PAGE_MAX, errors });
  if (history.length) sources.push('get_account_history');
  out.meta.ops = history.length;

  const historyPosts = new Map(); // permlink -> post (fallback when discussions is unavailable)
  const witnessVoteOps = new Map(); // witness -> approve (later ops win)

  for (const { timestamp, name, payload: d } of history) {
    switch (name) {
      case 'comment': {
        if (norm(d.author) !== acc) break; // someone else replying to us
        if (d.parent_author) {
          out.comments.push({
            author: acc,
            permlink: String(d.permlink || ''),
            parent_author: norm(d.parent_author),
            parent_permlink: String(d.parent_permlink || ''),
            body: String(d.body || ''),
            created: timestamp,
          });
        } else {
          historyPosts.set(String(d.permlink || ''), {
            author: acc,
            permlink: String(d.permlink || ''),
            title: String(d.title || ''),
            body: String(d.body || ''),
            json_metadata: typeof d.json_metadata === 'string'
              ? d.json_metadata
              : JSON.stringify(d.json_metadata || {}),
            tags: tagsFor(d),
            created: timestamp,
          });
        }
        break;
      }
      case 'vote': {
        // The account appears in its own history both as voter and as the
        // voted-on author. Stage 4 wants upvotes RECEIVED, so filter on author.
        if (norm(d.author) !== acc) break;
        out.votes_received.push({
          voter: norm(d.voter),
          author: acc,
          permlink: String(d.permlink || ''),
          weight: Number(d.weight) || 0,
          time: timestamp,
        });
        break;
      }
      case 'transfer_to_vesting': {
        // Stage 5 is "the user powered up", so only their own power-ups count
        // (a third party can power up TO this account).
        if (norm(d.from) !== acc) break;
        out.transfers_to_vesting.push({
          from: norm(d.from),
          to: norm(d.to || d.from),
          amount: typeof d.amount === 'string' ? d.amount : String(d.amount?.amount ?? d.amount ?? ''),
          timestamp,
        });
        break;
      }
      case 'transfer': {
        if (norm(d.from) !== acc) break; // stage 9 is transfers SENT
        out.transfers_sent.push({
          from: acc,
          to: norm(d.to),
          amount: typeof d.amount === 'string' ? d.amount : String(d.amount?.amount ?? d.amount ?? ''),
          memo: String(d.memo || ''),
          timestamp,
        });
        break;
      }
      case 'delegate_vesting_shares': {
        if (norm(d.delegator) !== acc) break;
        out.delegations.push({
          delegator: acc,
          delegatee: norm(d.delegatee),
          vesting_shares: typeof d.vesting_shares === 'string'
            ? d.vesting_shares
            : String(d.vesting_shares?.amount ?? d.vesting_shares ?? ''),
          timestamp,
        });
        break;
      }
      case 'account_witness_vote': {
        if (norm(d.account) !== acc) break;
        witnessVoteOps.set(norm(d.witness), d.approve !== false);
        break;
      }
      case 'custom_json': {
        // The follow plugin's op. Fallback for stage 8 when get_following is off.
        if (d.id !== 'follow') break;
        const body = parseMeta(d.json);
        const inner = Array.isArray(body) && body[0] === 'follow' ? body[1] : null;
        if (!inner || norm(inner.follower) !== acc) break;
        const what = Array.isArray(inner.what) ? inner.what.map(String) : [];
        out.follows.push({ follower: acc, following: norm(inner.following), what, time: timestamp });
        break;
      }
      case 'curation_reward': {
        // VIRTUAL op. Real read; stays empty until curation economics are on.
        out.curation_rewards.push({
          curator: norm(d.curator || acc),
          comment_author: norm(d.comment_author || d.author),
          comment_permlink: String(d.comment_permlink || d.permlink || ''),
          reward: typeof d.reward === 'string' ? d.reward : String(d.reward?.amount ?? d.reward ?? ''),
          timestamp,
        });
        break;
      }
      case 'fill_order': {
        // VIRTUAL op. Real read; stays empty until the internal market is live.
        out.market_trades.push({
          current_owner: norm(d.current_owner),
          current_pays: typeof d.current_pays === 'string' ? d.current_pays : String(d.current_pays?.amount ?? ''),
          open_owner: norm(d.open_owner),
          open_pays: typeof d.open_pays === 'string' ? d.open_pays : String(d.open_pays?.amount ?? ''),
          timestamp,
        });
        break;
      }
      default:
        break;
    }
  }

  // Posts fallback: only when the discussions API gave us nothing at all. See
  // the "fidelity caveats" note — history bodies can be edit patches.
  if (out.posts.length === 0 && historyPosts.size) {
    out.posts = [...historyPosts.values()];
    sources.push('posts-from-history');
  }

  // Witness votes: history ops are the authority on approve:false (an
  // un-vote). Merge them over the account record's current approvals.
  for (const [name, approve] of witnessVoteOps) {
    if (!name) continue;
    const existing = out.witness_votes.find((v) => v.witness === name);
    if (existing) existing.approve = approve;
    else out.witness_votes.push({ witness: name, approve });
  }

  // --- 4. follows via the follow plugin (preferred over the custom_json scan) -
  const following = await rpc(
    url, f, 'condenser_api.get_following', [acc, '', 'blog', 100], errors,
  );
  if (Array.isArray(following) && following.length) {
    sources.push('get_following');
    const merged = new Map();
    for (const row of following) {
      const name = norm(row && row.following);
      if (!name) continue;
      merged.set(name, {
        follower: acc,
        following: name,
        what: Array.isArray(row.what) ? row.what.map(String) : ['blog'],
        time: null,
      });
    }
    // Keep any custom_json-derived rows the plugin did not return.
    for (const row of out.follows) if (!merged.has(row.following)) merged.set(row.following, row);
    out.follows = [...merged.values()];
  }

  // --- 5. Phase-3 candidate turns (NOT a completion judgement) ---------------
  // The raw reply chain with the Witness is a plain chain read; whether it is a
  // "real conversation" (stage 18) is a Phase-3 call, so we surface candidates
  // only and leave the determination out of this module entirely.
  out.conversations = out.comments
    .filter((c) => c.parent_author === witness)
    .map((c) => ({ with: witness, permlink: c.permlink, parent_permlink: c.parent_permlink, created: c.created }));

  out.meta.ok = sources.length > 0;
  return out;
}

/**
 * Convenience: the exact five-key object detector.js's detectCompletedStages()
 * consumes, with nothing else attached. Useful when a caller wants to be sure
 * it is not accidentally depending on the extras.
 */
export function toDetectorShape(activity) {
  const a = activity || {};
  return {
    posts: a.posts || [],
    comments: a.comments || [],
    votes_received: a.votes_received || [],
    transfers_to_vesting: a.transfers_to_vesting || [],
    witness_votes: a.witness_votes || [],
  };
}

/**
 * Which stages.json `kind` values this reader can actually feed, and why the
 * rest are empty. Machine-readable version of the COVERAGE block above — so a
 * caller (or the Witness itself) can be honest about gaps instead of reporting
 * a stage as "not complete" when it is really "not readable".
 */
export const KIND_COVERAGE = Object.freeze({
  post_authored: { collection: 'posts', supported: true },
  comments_authored: { collection: 'comments', supported: true },
  external_upvote_received: { collection: 'votes_received', supported: true },
  transfer_to_vesting: { collection: 'transfers_to_vesting', supported: true },
  witness_vote_cast: { collection: 'witness_votes', supported: true },
  profile_set: { collection: 'profile', supported: true },
  follows_created: { collection: 'follows', supported: true },
  transfer_sent: { collection: 'transfers_sent', supported: true },
  vesting_delegation_made: { collection: 'delegations', supported: true },
  curation_reward_received: { collection: 'curation_rewards', supported: true, infra_gated: true, reason: 'real virtual-op read; empty until curation economics are enabled' },
  market_trade_filled: { collection: 'market_trades', supported: true, infra_gated: true, reason: 'real virtual-op read; empty until the internal market is live' },
  community_post_authored: { collection: 'community_posts', supported: false, reason: 'communities are a hivemind/off-chain indexer feature; no Graphene node method exists' },
  smt_held_or_created: { collection: 'smt_events', supported: false, reason: 'no per-account SMT enumeration read on this fork' },
  video_post_authored: { collection: 'video_posts', supported: false, reason: 'video is an app-layer json_metadata convention, not a chain fact; no marker defined yet' },
  wiki_edit_made: { collection: 'wiki_edits', supported: false, reason: 'MediaWiki is entirely off-chain' },
  bridge_transfer_completed: { collection: 'bridge_transfers', supported: false, reason: 'bridge legs look like ordinary transfers; attribution needs the bridge registry, which does not exist yet' },
  conversation_with_witness: { collection: 'conversations', supported: false, reason: 'raw reply turns are surfaced, but "a real conversation" is a Phase-3 judgement, not a chain read' },
  welcomed_a_newcomer: { collection: 'welcomes', supported: false, reason: 'needs per-parent-author account-creation dates — an N-call fan-out, deliberately not issued here' },
});

// ---- CLI (guarded) ----------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const account = process.argv[2] || WITNESS_ACCOUNT;
  fetchUserActivity(account).then((a) => {
    const line = [
      `account=${esc(a.account)}`,
      `rpc=${esc(a.meta.rpcUrl)}`,
      `ok=${a.meta.ok}`,
      `ops=${a.meta.ops}`,
      `posts=${a.posts.length}`,
      `comments=${a.comments.length}`,
      `votes_received=${a.votes_received.length}`,
      `power_ups=${a.transfers_to_vesting.length}`,
      `witness_votes=${a.witness_votes.length}`,
      `follows=${a.follows.length}`,
      `transfers_sent=${a.transfers_sent.length}`,
      `delegations=${a.delegations.length}`,
      `profile=${a.profile ? 'set' : 'unset'}`,
    ].join(' ');
    process.stdout.write(`${line}\n`);
    if (a.meta.errors.length) {
      process.stdout.write(`errors: ${a.meta.errors.map((e) => esc(e)).join('; ')}\n`);
    }
    process.stdout.write(`${JSON.stringify(a, null, 2)}\n`);
  });
}
