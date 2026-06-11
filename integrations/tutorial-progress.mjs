// tutorial-progress.mjs — read-chain detection of a user's progress through the
// six core tutorial stages (tutorial/stages.json, tier A, ids 1..6).
//
// PURE w.r.t. I/O: this module performs NO network/chain calls itself. All chain
// reads are INJECTED via `deps`:
//     deps.getPosts(account)        -> [ { author, permlink, tags|json_metadata, body, created } ]
//     deps.getComments(account)     -> [ { author, parent_author, body, created } ]
//     deps.getVotes(account)        -> [ { voter, author, permlink, weight } ]  (votes RECEIVED by `account`)
//     deps.getWitnessVotes(account) -> [ "witnessname", ... ]  OR  [ { witness, approve } ]
//   ...and optionally:
//     deps.getTransfersToVesting(account) -> [ { from, to, amount } ]  (power-ups by `account`)
//
// The completion_criteria for the six stages live in tutorial/stages.json and
// tutorial/README.md — this module READS that intent; it does NOT edit those files.
//
// SOFT-FAIL, NEVER THROW: any reader that is missing, throws, or returns garbage is
// treated as "no data" → that stage is simply not-done. The function always returns a
// well-formed { stages, nextStage, pctComplete }.
//
//   import { progress, STAGE_KEYS } from './integrations/tutorial-progress.mjs';
//   const r = await progress('alice', {
//     getPosts, getComments, getVotes, getWitnessVotes, getTransfersToVesting
//   });
//   // -> { stages: [ {key,done}, ... ], nextStage: 'power_up'|null, pctComplete: 66.67 }
//
// CLI:  node integrations/tutorial-progress.mjs    # print a worked example

// ── the six core stages, in order (mirrors tutorial/stages.json ids 1..6, tier A) ───────────────
export const STAGE_KEYS = Object.freeze([
  'intro_post',
  'engage_three_posts',
  'share_what_you_know',
  'first_organic_upvote',
  'power_up',
  'vote_for_a_witness',
]);

// completion thresholds (copied from stages.json completion_criteria — do NOT edit stages.json)
export const CRITERIA = Object.freeze({
  intro_post: { tag_any_of: ['introduceyourself', 'introduction', 'introducing'], min_body_chars: 200 },
  engage_three_posts: { min_count: 3, min_distinct_parent_authors: 3, min_body_chars_each: 80 },
  share_what_you_know: { min_body_chars: 800, excludes_tag_any_of: ['introduceyourself', 'introduction'] },
  first_organic_upvote: { exclude_voter_account: 'hathor', min_count: 1 },
  power_up: { min_amount_melek: 1.0 },
  vote_for_a_witness: { min_count: 1 },
});

const WITNESS_ACCOUNT = 'hathor';

// ── HTML escape: for any interpolated value (CLI / future handler use) ──────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── safe helpers ────────────────────────────────────────────────────────────────────────────────
function asArray(x) {
  return Array.isArray(x) ? x : [];
}

function bodyLen(s) {
  return typeof s === 'string' ? s.trim().length : 0;
}

// pull tags from a record that may carry them as .tags (array) or .json_metadata.tags
function tagsOf(rec) {
  if (!rec || typeof rec !== 'object') return [];
  if (Array.isArray(rec.tags)) return rec.tags.map((t) => String(t).toLowerCase());
  const jm = rec.json_metadata;
  let parsed = jm;
  if (typeof jm === 'string') {
    try { parsed = JSON.parse(jm); } catch { parsed = null; }
  }
  if (parsed && Array.isArray(parsed.tags)) return parsed.tags.map((t) => String(t).toLowerCase());
  // some feeds put the primary tag in .category or .parent_permlink
  const cat = rec.category || rec.parent_permlink;
  return cat ? [String(cat).toLowerCase()] : [];
}

function hasAnyTag(rec, wanted) {
  const tags = tagsOf(rec);
  return wanted.some((w) => tags.includes(String(w).toLowerCase()));
}

function toNum(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  if (typeof x === 'string') {
    // "1.234 MELEK" or "1.234 TESTS" or "1.234"
    const m = x.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }
  if (x && typeof x === 'object' && 'amount' in x) return toNum(x.amount);
  return 0;
}

// run an injected reader defensively: returns the resolved array or [] on any failure
async function safeRead(fn, account) {
  if (typeof fn !== 'function') return [];
  try {
    const out = await fn(account);
    return asArray(out);
  } catch {
    return [];
  }
}

// ── per-stage detectors (each: data -> boolean) ─────────────────────────────────────────────────
function doneIntroPost(posts, self) {
  const c = CRITERIA.intro_post;
  return asArray(posts).some(
    (p) => bodyLen(p && p.body) >= c.min_body_chars && hasAnyTag(p, c.tag_any_of),
  );
}

function doneEngageThreePosts(comments, self) {
  const c = CRITERIA.engage_three_posts;
  const authors = new Set();
  let count = 0;
  for (const cm of asArray(comments)) {
    if (!cm || typeof cm !== 'object') continue;
    const parent = String(cm.parent_author || '').toLowerCase();
    if (!parent) continue; // top-level post, not a comment on someone
    if (parent === String(self).toLowerCase()) continue; // exclude self-authored parents
    if (bodyLen(cm.body) < c.min_body_chars_each) continue;
    count += 1;
    authors.add(parent);
  }
  return count >= c.min_count && authors.size >= c.min_distinct_parent_authors;
}

function doneShareWhatYouKnow(posts) {
  const c = CRITERIA.share_what_you_know;
  return asArray(posts).some(
    (p) => bodyLen(p && p.body) >= c.min_body_chars && !hasAnyTag(p, c.excludes_tag_any_of),
  );
}

function doneFirstOrganicUpvote(votes) {
  const c = CRITERIA.first_organic_upvote;
  const excl = String(c.exclude_voter_account).toLowerCase();
  let n = 0;
  for (const v of asArray(votes)) {
    if (!v || typeof v !== 'object') continue;
    const voter = String(v.voter || '').toLowerCase();
    if (!voter || voter === excl) continue;
    if (toNum(v.weight) <= 0 && 'weight' in v) continue; // ignore explicit downvotes/unvotes
    n += 1;
  }
  return n >= c.min_count;
}

function donePowerUp(transfers, self) {
  const c = CRITERIA.power_up;
  const me = String(self).toLowerCase();
  return asArray(transfers).some((t) => {
    if (!t || typeof t !== 'object') return false;
    // power-up = transfer_to_vesting from self (to self or another, but criteria only needs amount)
    if (t.from != null && String(t.from).toLowerCase() !== me) return false;
    return toNum(t.amount != null ? t.amount : t) >= c.min_amount_melek;
  });
}

function doneVoteForWitness(witnessVotes) {
  const c = CRITERIA.vote_for_a_witness;
  let n = 0;
  for (const w of asArray(witnessVotes)) {
    if (typeof w === 'string') {
      if (w.trim()) n += 1;
    } else if (w && typeof w === 'object') {
      // { witness, approve } shape — count approvals
      if (w.approve === false) continue;
      if (w.witness || w.name) n += 1;
    }
  }
  return n >= c.min_count;
}

// ── main API ────────────────────────────────────────────────────────────────────────────────────
// progress(account, deps) -> { stages:[{key,done}], nextStage, pctComplete }
export async function progress(account, deps = {}) {
  const acct = account == null ? '' : String(account);
  const d = deps && typeof deps === 'object' ? deps : {};

  // gather chain data through injected, defensively-wrapped readers (parallel, independent)
  const [posts, comments, votes, witnessVotes, transfers] = await Promise.all([
    safeRead(d.getPosts, acct),
    safeRead(d.getComments, acct),
    safeRead(d.getVotes, acct),
    safeRead(d.getWitnessVotes, acct),
    safeRead(d.getTransfersToVesting, acct),
  ]);

  const results = {
    intro_post: false,
    engage_three_posts: false,
    share_what_you_know: false,
    first_organic_upvote: false,
    power_up: false,
    vote_for_a_witness: false,
  };

  // each detector is wrapped so a single bad record can never throw the whole call
  const guard = (fn) => { try { return !!fn(); } catch { return false; } };

  results.intro_post = guard(() => doneIntroPost(posts, acct));
  results.engage_three_posts = guard(() => doneEngageThreePosts(comments, acct));
  results.share_what_you_know = guard(() => doneShareWhatYouKnow(posts));
  results.first_organic_upvote = guard(() => doneFirstOrganicUpvote(votes));
  results.power_up = guard(() => donePowerUp(transfers, acct));
  results.vote_for_a_witness = guard(() => doneVoteForWitness(witnessVotes));

  const stages = STAGE_KEYS.map((key) => ({ key, done: results[key] }));
  const doneCount = stages.reduce((acc, s) => acc + (s.done ? 1 : 0), 0);
  const next = stages.find((s) => !s.done);
  const nextStage = next ? next.key : null;
  const pctComplete = Math.round((doneCount / STAGE_KEYS.length) * 10000) / 100;

  return { stages, nextStage, pctComplete };
}

// ── CLI: worked example (guarded so import never runs this) ─────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const fakeDeps = {
    getPosts: () => [
      { author: 'alice', body: 'x'.repeat(250), tags: ['introduceyourself', 'melek'] },
      { author: 'alice', body: 'y'.repeat(900), tags: ['howto'] },
    ],
    getComments: () => [
      { author: 'alice', parent_author: 'bob', body: 'z'.repeat(90) },
      { author: 'alice', parent_author: 'carol', body: 'z'.repeat(90) },
      { author: 'alice', parent_author: 'dan', body: 'z'.repeat(90) },
    ],
    getVotes: () => [{ voter: 'eve', author: 'alice', permlink: 'p', weight: 5000 }],
    getWitnessVotes: () => ['hathor'],
    getTransfersToVesting: () => [{ from: 'alice', to: 'alice', amount: '2.000 MELEK' }],
  };
  progress('alice', fakeDeps).then((r) => {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  });
}
