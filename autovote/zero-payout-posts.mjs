// zero-payout-posts.mjs — pick the $0.00-payout posts the MELEK witnesses should lift.
//
// The AutoVote author-ranker (karma-curation.mjs) decides WHO to lift; this decides the specific
// posts that still need it: unrewarded (pending_payout == 0) AND still inside the payout window
// (cashout_time in the future) — so a witness vote lands where it actually earns the author
// something, never on a post the crowd already paid or one already past cashout. New arrivals
// (e.g. VKBT/CURE holders we bring over) see their first posts earn instead of sitting at $0.00.
//
// Pure + injectable + soft-fail-never-throw. No keys, no broadcast — it emits a vote PLAN the
// signer-gated engine casts (voting is posting-auth; zero WIF in this repo). §9-safe: off-chain
// targeting only; the vote weight is the witness's own stake, never karma.

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const ms = (t) => {
  if (!t) return NaN;
  const s = String(t);
  return Date.parse(s.endsWith('Z') ? s : s + 'Z'); // Graphene timestamps are UTC without the 'Z'
};

/** A post is "zero-payout" when nothing has accrued to it yet. */
export function isZeroPayout(post = {}) {
  return num(post.pending_payout_value ?? post.pending_payout) === 0;
}

/** Still inside the payout window — a vote can still pay the author (cashout_time in the future). */
export function isPayable(post = {}, now = Date.now()) {
  const t = ms(post.cashout_time);
  if (!Number.isFinite(t)) return true;            // no cashout_time → treat as payable (soft)
  if (t <= ms('1970-01-01T00:00:00')) return false; // Graphene "already paid" sentinel (1969/1970)
  return t > now;
}

/**
 * Select the zero-payout, still-payable, top-level posts to lift.
 * @param {Array} posts  raw post objects (condenser get_discussions_by_created shape)
 * @param {object} [opts]
 *   excludeAuthors : Set|array of authors to skip (self/affiliated — the self-deal guard)
 *   alreadyVoted   : Set of "author/permlink" keys already voted (persist across rounds)
 *   minAgeSec      : skip posts younger than this (let organic votes land first; default 0)
 *   maxAgeSec      : skip posts older than this (default 0 = no cap)
 *   limit          : max posts to return (0 = all)
 *   now            : injectable clock
 * @returns {Array<{author,permlink,pending,created,cashout_time,ageSec}>}
 */
export function selectZeroPayoutPosts(posts = [], opts = {}) {
  const { excludeAuthors, alreadyVoted, minAgeSec = 0, maxAgeSec = 0, limit = 0, now = Date.now() } = opts;
  const excl = excludeAuthors instanceof Set
    ? new Set([...excludeAuthors].map((a) => String(a).toLowerCase()))
    : new Set((excludeAuthors || []).map((a) => String(a).toLowerCase()));
  const voted = alreadyVoted instanceof Set ? alreadyVoted : new Set(alreadyVoted || []);

  const rows = (Array.isArray(posts) ? posts : []).map((p) => {
    try {
      const author = String(p?.author || '').trim().toLowerCase();
      const permlink = String(p?.permlink || '').trim();
      if (!author || !permlink) return null;
      if (p.parent_author) return null;                 // comments are not top-level posts
      if (excl.has(author)) return null;
      if (voted.has(`${author}/${permlink}`)) return null;
      if (!isZeroPayout(p)) return null;
      if (!isPayable(p, now)) return null;
      const created = ms(p.created);
      const ageSec = Number.isFinite(created) ? (now - created) / 1000 : Infinity;
      if (minAgeSec && ageSec < minAgeSec) return null;
      if (maxAgeSec && ageSec > maxAgeSec) return null;
      return { author, permlink, pending: num(p.pending_payout_value ?? p.pending_payout), created: p.created, cashout_time: p.cashout_time, ageSec };
    } catch { return null; }
  }).filter(Boolean);

  // freshest first (most window left to accrue), deterministic tiebreak by author/permlink
  rows.sort((a, b) => (ms(b.created) || 0) - (ms(a.created) || 0)
    || (a.author < b.author ? -1 : a.author > b.author ? 1 : a.permlink < b.permlink ? -1 : a.permlink > b.permlink ? 1 : 0));

  const n = Number(limit);
  return n > 0 ? rows.slice(0, Math.floor(n)) : rows;
}

/** Upvoters who count as "someone else liked this": not the author, not the curator/our own accounts. */
export function otherUpvoters(post = {}, ignore = new Set()) {
  const author = String(post.author || '').toLowerCase();
  const out = new Set();
  for (const v of Array.isArray(post.active_votes) ? post.active_votes : []) {
    const voter = String(v?.voter || '').toLowerCase();
    const up = num(v?.rshares) > 0 || num(v?.percent) > 0 || num(v?.weight) > 0;
    if (voter && up && voter !== author && !ignore.has(voter)) out.add(voter);
  }
  return out;
}

/**
 * Select the posts the witness should back (operator rule 2026-10-18): admins' own posts, plus posts
 * that real people have ALREADY upvoted — never unvoted posts from unknowns, which is where spam sits.
 * @param {Array} posts  raw post objects (condenser shape, with active_votes)
 * @param {object} [opts]
 *   admins          : Set|array — these authors always qualify (still deduped, payable, aged)
 *   excludeAuthors  : Set|array — never vote these (self/affiliated); admins override this
 *   ignoreVoters    : Set|array — votes from these don't count as "someone else voted" (curator + ours)
 *   minOtherVoters  : how many other upvoters a non-admin post needs (default 1)
 *   authorLastVoted : { author: msTimestamp } of our last vote per author (persisted across rounds)
 *   authorCooldownSec : min gap between our votes on the same non-admin author (default 86400 = 1/day)
 *   alreadyVoted, minAgeSec, maxAgeSec, limit, now : as selectZeroPayoutPosts
 */
export function selectCurationPosts(posts = [], opts = {}) {
  const { alreadyVoted, minAgeSec = 0, maxAgeSec = 0, limit = 0, now = Date.now(),
    minOtherVoters = 1, authorLastVoted = {}, authorCooldownSec = 86400 } = opts;
  const lower = (s) => new Set([...(s instanceof Set ? s : new Set(s || []))].map((a) => String(a).toLowerCase()));
  const admins = lower(opts.admins);
  const excl = lower(opts.excludeAuthors);
  const ignore = lower(opts.ignoreVoters);
  const voted = alreadyVoted instanceof Set ? alreadyVoted : new Set(alreadyVoted || []);
  const lastByAuthor = { ...authorLastVoted };

  const rows = [];
  for (const p of (Array.isArray(posts) ? posts : [])) {
    try {
      const author = String(p?.author || '').trim().toLowerCase();
      const permlink = String(p?.permlink || '').trim();
      if (!author || !permlink || p.parent_author) continue;
      const isAdmin = admins.has(author);
      if (!isAdmin && excl.has(author)) continue;
      if (voted.has(`${author}/${permlink}`)) continue;
      if (!isPayable(p, now)) continue;
      const created = ms(p.created);
      const ageSec = Number.isFinite(created) ? (now - created) / 1000 : Infinity;
      if (minAgeSec && ageSec < minAgeSec) continue;
      if (maxAgeSec && ageSec > maxAgeSec) continue;
      const voters = otherUpvoters(p, ignore);
      if (!isAdmin && voters.size < Math.max(0, Number(minOtherVoters) || 0)) continue;
      rows.push({ author, permlink, admin: isAdmin, otherVoters: voters.size, created: p.created,
        cashout_time: p.cashout_time, ageSec, pending: num(p.pending_payout_value ?? p.pending_payout) });
    } catch { /* soft */ }
  }
  // admins first, then most-supported, then freshest
  rows.sort((a, b) => (b.admin - a.admin) || (b.otherVoters - a.otherVoters) || ((ms(b.created) || 0) - (ms(a.created) || 0))
    || (a.author < b.author ? -1 : a.author > b.author ? 1 : a.permlink < b.permlink ? -1 : 1));

  // one vote per non-admin author per cooldown window (stops post-every-five-minutes farming)
  const out = [];
  for (const r of rows) {
    if (!r.admin) {
      const last = Number(lastByAuthor[r.author]) || 0;
      if (authorCooldownSec && now - last < authorCooldownSec * 1000) continue;
      lastByAuthor[r.author] = now;
    }
    out.push(r);
  }
  const n = Number(limit);
  return n > 0 ? out.slice(0, Math.floor(n)) : out;
}

/**
 * Live fetch of recent posts + zero-payout select. Injectable fetch; soft-fail → [].
 * @param {object} cfg { fetch, rpcUrl, tag='melek', fetchLimit=100, ...selectOpts }
 */
export async function fetchZeroPayoutPosts(cfg = {}) {
  const { fetch: f = (typeof fetch !== 'undefined' ? fetch : null), rpcUrl, tag = 'melek', fetchLimit = 100, mode = 'zero', ...selOpts } = cfg;
  if (typeof f !== 'function' || !rpcUrl) return [];
  const limit = Math.max(1, Math.min(100, Number(fetchLimit) || 100));

  // SCOPE FIX (2026-09-07). `tag` now accepts a COMMA-SEPARATED LIST, and an empty entry means the
  // global firehose. The single-tag default was a live bug: community members tag their posts
  // "photography", "art", "flower", "introduceyou" — almost never "melek" — so a melek-only scan saw
  // only Hathor's own posts, which the self-deal guard then correctly excluded. The round selected
  // zero posts every 30 minutes while thirteen real community posts sat unvoted and in-window.
  const tags = String(tag).split(',').map((t) => t.trim());
  const byKey = new Map();
  for (const t of tags) {
    try {
      const res = await f(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_discussions_by_created', params: [{ tag: t, limit }] }),
      });
      const j = await res.json();
      for (const p of (j && j.result) || []) {
        if (p && p.author && p.permlink) byKey.set(`${p.author}/${p.permlink}`, p);
      }
    } catch { /* soft: one dead tag never kills the round */ }
  }
  return mode === 'social'
    ? selectCurationPosts([...byKey.values()], selOpts)
    : selectZeroPayoutPosts([...byKey.values()], selOpts);
}

/**
 * Cast the witness's vote on the selected zero-payout posts (up to topN), dedupe across rounds.
 * castVote is an injected seam (the signer/engine); soft-fail per post — one bad vote never stops the round.
 * @param {object} cfg
 *   curator      : { account }  the voting witness
 *   posts        : selected posts (from selectZeroPayoutPosts / fetchZeroPayoutPosts)
 *   castVote     : ({voter,author,permlink,weight}) => Promise
 *   weight       : vote weight (witness's own stake %, 10000 = 100%); default a gentle 3000 = 30%
 *   topN         : max posts to lift this round
 *   alreadyVoted : Set of "author/permlink" keys (persist across rounds)
 * @returns {Promise<{curator, considered:number, cast:Array}>}
 */
export async function runZeroPayoutRound({ curator, posts = [], castVote, weight = 3000, topN = 10, alreadyVoted = new Set() } = {}) {
  if (!curator || !curator.account || typeof castVote !== 'function') {
    return { curator: curator && curator.account, considered: 0, cast: [] };
  }
  const list = (Array.isArray(posts) ? posts : []).slice(0, Math.max(0, Number(topN) || 0));
  const cast = [];
  for (const p of list) {
    if (!p || !p.author || !p.permlink) continue;
    const key = `${p.author}/${p.permlink}`;
    if (alreadyVoted.has(key)) continue;
    try {
      const res = await castVote({ voter: curator.account, author: p.author, permlink: p.permlink, weight });
      alreadyVoted.add(key);
      cast.push({ author: p.author, permlink: p.permlink, weight, id: (res && (res.id || res.hash)) || true });
    } catch { /* soft: skip this one, keep lifting */ }
  }
  return { curator: curator.account, considered: list.length, cast };
}
