/**
 * tutorial/detector.js — pure functions that check stage completion.
 *
 * Inputs are chain-shaped data structures. The detector does not fetch
 * anything itself — that's Phase 2 chain-reader work. By keeping
 * detection pure, the same module is reusable for tests, replay, and
 * future strategies (per-block, per-cron, on-demand).
 *
 * Expected userActivity shape:
 *   {
 *     posts: [{ author, permlink, title, body, json_metadata|tags, created }, ...],
 *     comments: [{ author, parent_author, parent_permlink, body, created }, ...],
 *     votes_received: [{ voter, author, permlink, weight, time }, ...],
 *     transfers_to_vesting: [{ from, to, amount, timestamp }, ...],
 *     witness_votes: [{ witness, approve }, ...]
 *   }
 *
 * Stage IDs and thresholds come from stages.json, not from constants
 * here. Tune in JSON; don't redeploy code to change a threshold.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGES_PATH = path.join(__dirname, 'stages.json');

let _stagesCache = null;
export function loadStages() {
  if (_stagesCache) return _stagesCache;
  _stagesCache = JSON.parse(readFileSync(STAGES_PATH, 'utf8'));
  return _stagesCache;
}

function getStage(key) {
  const { stages } = loadStages();
  const stage = stages.find((s) => s.key === key);
  if (!stage) throw new Error(`stage not found: ${key}`);
  return stage;
}

function extractTags(post) {
  if (Array.isArray(post.tags)) return post.tags;
  if (typeof post.json_metadata === 'string') {
    try {
      const meta = JSON.parse(post.json_metadata);
      if (Array.isArray(meta.tags)) return meta.tags;
    } catch {
      /* malformed json_metadata is treated as no tags */
    }
  }
  return [];
}

function bodyLen(s) {
  return (s ?? '').trim().length;
}

// ---- stage 1: intro_post ----

export function detectIntroPost(userPosts = []) {
  const stage = getStage('intro_post');
  const { tag_any_of, min_body_chars } = stage.completion_criteria;
  const tagSet = new Set(tag_any_of);
  return userPosts.find((p) => {
    const tags = extractTags(p);
    if (!tags.some((t) => tagSet.has(t.toLowerCase()))) return false;
    if (bodyLen(p.body) < min_body_chars) return false;
    return true;
  }) ?? null;
}

// ---- stage 2: engage_three_posts ----

export function detectEngageThreePosts(userComments = []) {
  const stage = getStage('engage_three_posts');
  const {
    min_count,
    min_distinct_parent_authors,
    min_body_chars_each,
    exclude_self_authored_parents,
  } = stage.completion_criteria;
  const qualifying = userComments.filter((c) => {
    if (!c.parent_author) return false; // top-level posts, not comments
    if (exclude_self_authored_parents && c.parent_author === c.author) return false;
    if (bodyLen(c.body) < min_body_chars_each) return false;
    return true;
  });
  if (qualifying.length < min_count) return null;
  const distinctAuthors = new Set(qualifying.map((c) => c.parent_author));
  if (distinctAuthors.size < min_distinct_parent_authors) return null;
  return qualifying.slice(0, min_count);
}

// ---- stage 3: share_what_you_know ----

export function detectShareWhatYouKnow(userPosts = []) {
  const stage = getStage('share_what_you_know');
  const { min_body_chars, excludes_tag_any_of } = stage.completion_criteria;
  const excludeSet = new Set(excludes_tag_any_of ?? []);
  return userPosts.find((p) => {
    if (bodyLen(p.body) < min_body_chars) return false;
    const tags = extractTags(p);
    if (tags.some((t) => excludeSet.has(t.toLowerCase()))) return false;
    return true;
  }) ?? null;
}

// ---- stage 4: first_organic_upvote ----

export function detectFirstOrganicUpvote(votesReceived = []) {
  const stage = getStage('first_organic_upvote');
  const { exclude_voter_account, min_count } = stage.completion_criteria;
  const organic = votesReceived
    .filter((v) => v.voter !== exclude_voter_account && (v.weight ?? 0) > 0)
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  if (organic.length < min_count) return null;
  return organic[0];
}

// ---- stage 5: power_up ----

export function detectPowerUp(transfersToVesting = []) {
  const stage = getStage('power_up');
  const { min_amount_melek } = stage.completion_criteria;
  const minAmount = parseFloat(min_amount_melek);
  return transfersToVesting.find((t) => {
    const amount = parseFloat(t.amount); // "1.000 MELEK" -> 1.000
    return Number.isFinite(amount) && amount >= minAmount;
  }) ?? null;
}

// ---- stage 6: vote_for_a_witness ----

export function detectWitnessVote(witnessVotes = []) {
  const stage = getStage('vote_for_a_witness');
  const { min_count } = stage.completion_criteria;
  const approvals = witnessVotes.filter((v) => v.approve !== false);
  if (approvals.length < min_count) return null;
  return approvals[0];
}

// ---- stage 7: set_profile ----

export function detectSetProfile(profile = null) {
  const stage = getStage('set_profile');
  const { require_fields_any_of } = stage.completion_criteria;
  if (!profile || typeof profile !== 'object') return null;
  for (const field of require_fields_any_of) {
    const v = profile[field];
    if (typeof v === 'string' && v.trim() !== '') return { field, value: v.trim() };
  }
  return null;
}

// ---- stage 8: follow_three_authors ----

export function detectFollowThreeAuthors(follows = [], account = '') {
  const stage = getStage('follow_three_authors');
  const { min_distinct_followed, exclude_self } = stage.completion_criteria;
  const self = String(account || '').toLowerCase();
  const distinct = new Set();
  for (const f of follows) {
    // accept a bare name or a { following } record from get_following
    const name = String((f && typeof f === 'object' ? f.following : f) ?? '').toLowerCase();
    if (!name) continue;
    if (exclude_self && name === self) continue;
    distinct.add(name);
  }
  if (distinct.size < min_distinct_followed) return null;
  return { followed: [...distinct], count: distinct.size };
}

// ---- stage 9: send_first_transfer ----

export function detectSendFirstTransfer(transfersSent = [], account = '') {
  const stage = getStage('send_first_transfer');
  const { min_amount_melek, exclude_recipient_self } = stage.completion_criteria;
  const minAmount = parseFloat(min_amount_melek);
  const self = String(account || '').toLowerCase();
  return transfersSent.find((t) => {
    if (!t) return false;
    if (exclude_recipient_self && String(t.to || '').toLowerCase() === self) return false;
    const amount = parseFloat(t.amount); // "0.001 MELEK" -> 0.001
    return Number.isFinite(amount) && amount >= minAmount;
  }) ?? null;
}

// ---- stage 10: delegate_some_mp ----

export function detectDelegateSomeMp(delegations = [], account = '') {
  const stage = getStage('delegate_some_mp');
  const { min_amount_mp, exclude_recipient_self } = stage.completion_criteria;
  const minAmount = parseFloat(min_amount_mp);
  const self = String(account || '').toLowerCase();
  return delegations.find((d) => {
    if (!d) return false;
    if (exclude_recipient_self && String(d.delegatee || d.to || '').toLowerCase() === self) return false;
    // vesting delegations are denominated in VESTS on chain; stages.json states
    // the threshold in MP. The reader hands over whichever the node gave it, so
    // read the MP-denominated field when present and fall back to the raw amount.
    const raw = d.amount_mp ?? d.vesting_shares ?? d.amount;
    const amount = parseFloat(raw);
    return Number.isFinite(amount) && amount >= minAmount;
  }) ?? null;
}

// ---- orchestrator ----

/**
 * Detect all stage completions for a user. Returns an object keyed by
 * stage key with each entry being { complete: bool, evidence: ... }.
 *
 * Evidence is the matched post/comment/vote/etc. — useful for the
 * witness response (so it can quote what it saw).
 */
export function detectCompletedStages(userActivity) {
  const a = userActivity ?? {};
  return {
    intro_post: wrap(detectIntroPost(a.posts)),
    engage_three_posts: wrap(detectEngageThreePosts(a.comments)),
    share_what_you_know: wrap(detectShareWhatYouKnow(a.posts)),
    first_organic_upvote: wrap(detectFirstOrganicUpvote(a.votes_received)),
    power_up: wrap(detectPowerUp(a.transfers_to_vesting)),
    vote_for_a_witness: wrap(detectWitnessVote(a.witness_votes)),
    set_profile: wrap(detectSetProfile(a.profile)),
    follow_three_authors: wrap(detectFollowThreeAuthors(a.follows, a.account)),
    send_first_transfer: wrap(detectSendFirstTransfer(a.transfers_sent, a.account)),
    delegate_some_mp: wrap(detectDelegateSomeMp(a.delegations, a.account)),
  };
}

function wrap(evidence) {
  return { complete: Boolean(evidence), evidence: evidence || null };
}

/**
 * The next stage the user should attempt, given current completions.
 *
 * Only considers stages the detector can actually evaluate from chain data
 * (the keys returned by detectCompletedStages — the full Tier-A spine,
 * stages 1–10). Stages 11+ in stages.json are infra-gated Tier-B placeholders
 * or the Phase-3 Tier-C conversational arc; none is obtainable from a standard
 * Graphene read (see KIND_COVERAGE in chain-reader.mjs for which, and why), so
 * they cannot be "the next stage to attempt" through this path. As detectors
 * are added for new kinds, those stages automatically become eligible here.
 *
 * Returns the stage definition object, or null if every detectable stage is
 * complete.
 */
export function nextStageFor(userActivity) {
  const { stages } = loadStages();
  const completions = detectCompletedStages(userActivity);
  for (const stage of stages) {
    const tracked = completions[stage.key];
    if (!tracked) continue; // detector has no rule for this stage yet
    if (!tracked.complete) return stage;
  }
  return null;
}

// ============================================================================
// LESSON CHECKS — the Hathor Instructional Series (tutorial/instructional.mjs).
//
// Each lesson's front-matter carries `check: { kind, params, explain }`. Unlike the stage detectors
// above (thresholds from stages.json), a lesson check is PARAMETERISED BY THE LESSON: the same kind
// serves many lessons with different tags / domains / amounts. Every kind reads only public chain
// activity in the chain-reader.mjs shape — the reader never has to paste a link; Hathor finds the work.
//
// Result: { status: 'pass'|'fail'|'not_checkable', evidence, missing: string[], kind }
//   - pass           → `evidence` is the qualifying post/comment/op (it carries author+permlink when
//                      it is votable, so the reward upvote lands on the actual work)
//   - fail           → `missing` names EXACTLY what is still open, in plain words
//   - not_checkable  → Hathor cannot see this on chain (manual_review, unknown kind). NEVER a fail.
// ============================================================================

const lc = (s) => String(s ?? '').toLowerCase().replace(/^@/, '');
const listOf = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

function postTags(p) { return extractTags(p).map((t) => lc(t)); }

function hasAnyTag(p, tags) {
  const want = listOf(tags).map(lc).filter(Boolean);
  if (!want.length) return true;
  const have = postTags(p);
  return want.some((t) => have.includes(t));
}

const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)|<img\s[^>]*src=|https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*)?/i;
function hasImage(p) {
  if (IMAGE_RE.test(String(p?.body || ''))) return true;
  try {
    const meta = typeof p?.json_metadata === 'string' ? JSON.parse(p.json_metadata) : p?.json_metadata;
    return Array.isArray(meta?.image) && meta.image.length > 0;
  } catch { return false; }
}

/** Every http(s) URL in a body, parsed. Markdown/HTML punctuation trimmed. */
export function urlsIn(body) {
  const out = [];
  for (const m of String(body || '').matchAll(/https?:\/\/[^\s)\]"'<>]+/gi)) {
    try { out.push(new URL(m[0].replace(/[.,;:!?]+$/, ''))); } catch { /* not a URL */ }
  }
  return out;
}

function linkMatches(u, domain, prefixes) {
  const host = u.hostname.toLowerCase();
  const d = lc(domain);
  if (d && !(host === d || host.endsWith(`.${d}`))) return false;
  if (!prefixes.length) return true;
  return prefixes.some((pre) => u.pathname.startsWith(pre));
}

function pass(evidence, kind) { return { status: 'pass', evidence, missing: [], kind }; }
function fail(missing, kind) { return { status: 'fail', evidence: null, missing, kind }; }
function notCheckable(reason, kind) { return { status: 'not_checkable', evidence: null, missing: [], kind, reason }; }

const LESSON_CHECKS = {
  // The account exists on chain. A commenter's signed comment is itself proof; the reader still looks
  // at the account record (activity.account_exists) and only fails when the chain says it is absent.
  account_exists(params, a, ctx) {
    if (a.account_exists === false) return fail(['your account was not found on chain'], 'account_exists');
    return pass({ account: ctx.account || a.account || null }, 'account_exists');
  },

  // A top-level post, optionally tagged, optionally with a minimum body length.
  post_authored(params, a, ctx) { return LESSON_CHECKS.post_with_tag(params, a, ctx, 'post_authored'); },

  post_with_tag(params, a, _ctx, kind = 'post_with_tag') {
    const tags = listOf(params.tag_any_of ?? params.tags_any_of ?? params.tag ?? params.tags);
    const minChars = Number(params.min_body_chars) || 0;
    const needImage = Boolean(params.require_image);
    const posts = Array.isArray(a.posts) ? a.posts : [];
    const tagged = posts.filter((p) => hasAnyTag(p, tags));
    const long = tagged.filter((p) => bodyLen(p.body) >= minChars);
    const hit = long.find((p) => !needImage || hasImage(p));
    if (hit) return pass(hit, kind);
    const missing = [];
    if (!posts.length) missing.push('a post of your own (I found none yet)');
    else if (tags.length && !tagged.length) missing.push(`a post tagged ${tags.map((t) => `#${t}`).join(' or ')}`);
    else if (minChars && !long.length) {
      const longest = tagged.reduce((m, p) => Math.max(m, bodyLen(p.body)), 0);
      missing.push(`at least ${minChars} characters in that post (the longest I found has ${longest})`);
    } else if (needImage) missing.push('an image in that post');
    return fail(missing, kind);
  },

  // A post whose body links to a given domain (+ optional path prefix), e.g. a picture from the studio.
  post_contains_link(params, a) {
    const domain = params.domain || '';
    const prefixes = listOf(params.path_prefix_any_of ?? params.path_prefix).map(String).filter(Boolean);
    const tags = listOf(params.tag_any_of ?? params.tags_any_of);
    const minCount = Math.max(1, Number(params.min_count) || 1);
    const scope = params.in || 'posts';
    const pool = [
      ...(scope === 'comments' ? [] : (a.posts || [])),
      ...(scope === 'posts' ? [] : (a.comments || [])),
    ];
    const withLink = pool.filter((p) => urlsIn(p.body).filter((u) => linkMatches(u, domain, prefixes)).length >= minCount);
    const hit = withLink.find((p) => hasAnyTag(p, tags));
    if (hit) return pass(hit, 'post_contains_link');
    const where = `${domain}${prefixes.length === 1 ? prefixes[0] : ''}`;
    const missing = [];
    if (!pool.length) missing.push('a post of your own (I found none yet)');
    else if (!withLink.length) missing.push(`a post containing a link or picture from ${where || 'the right site'}${prefixes.length > 1 ? ` (an address starting ${prefixes.join(' or ')})` : ''}`);
    else missing.push(`the tag ${tags.map((t) => `#${t}`).join(' or ')} on the post with that link`);
    return fail(missing, 'post_contains_link');
  },

  // A comment (reply) on a specific author's post — optionally a specific permlink.
  comment_on(params, a) {
    const author = lc(params.author);
    const permlink = String(params.permlink || '');
    const minChars = Number(params.min_body_chars) || 0;
    const comments = Array.isArray(a.comments) ? a.comments : [];
    const hit = comments.find((c) => (!author || lc(c.parent_author) === author)
      && (!permlink || String(c.parent_permlink) === permlink)
      && bodyLen(c.body) >= minChars);
    if (hit) return pass(hit, 'comment_on');
    return fail([`a comment on ${author ? `@${author}'s` : 'the'} ${permlink ? `post "${permlink}"` : 'post'}${minChars ? ` of at least ${minChars} characters` : ''}`], 'comment_on');
  },

  transfer_to_vesting(params, a) {
    const min = parseFloat(params.min_amount_melek ?? params.min_amount ?? '0.001');
    const hit = (a.transfers_to_vesting || []).find((t) => parseFloat(t.amount) >= min);
    if (hit) return pass(hit, 'transfer_to_vesting');
    return fail([`a power-up of at least ${min} MELEK (Wallet → Power up)`], 'transfer_to_vesting');
  },

  witness_vote_cast(params, a) {
    const min = Math.max(1, Number(params.min_count) || 1);
    const approvals = (a.witness_votes || []).filter((v) => v.approve !== false);
    if (approvals.length >= min) return pass(approvals[0], 'witness_vote_cast');
    return fail([`${min} witness vote${min > 1 ? 's' : ''} (you have ${approvals.length})`], 'witness_vote_cast');
  },

  profile_set(params, a) {
    const fields = listOf(params.require_fields_any_of).length ? listOf(params.require_fields_any_of) : ['name', 'about', 'profile_image'];
    const p = a.profile && typeof a.profile === 'object' ? a.profile : null;
    const field = p && fields.find((f) => typeof p[f] === 'string' && p[f].trim());
    if (field) return pass({ field, value: String(p[field]).trim() }, 'profile_set');
    return fail([`one of these profile fields filled in: ${fields.join(', ')}`], 'profile_set');
  },

  follows_created(params, a, ctx) {
    const self = lc(ctx.account || a.account);
    const names = new Set();
    for (const f of a.follows || []) {
      const n = lc(f && typeof f === 'object' ? f.following : f);
      if (!n || (params.exclude_self !== false && n === self)) continue;
      names.add(n);
    }
    const must = listOf(params.must_include).map(lc).filter(Boolean);
    const lacking = must.filter((m) => !names.has(m));
    const min = Math.max(1, Number(params.min_distinct_followed) || 1);
    if (!lacking.length && names.size >= min) return pass({ followed: [...names] }, 'follows_created');
    const missing = [];
    if (lacking.length) missing.push(`a follow of ${lacking.map((m) => `@${m}`).join(', ')}`);
    if (names.size < min) missing.push(`${min} account${min > 1 ? 's' : ''} followed (you follow ${names.size})`);
    return fail(missing, 'follows_created');
  },

  transfer_sent(params, a, ctx) {
    const min = parseFloat(params.min_amount_melek ?? '0.001');
    const self = lc(ctx.account || a.account);
    const hit = (a.transfers_sent || []).find((t) => lc(t.to) !== self && parseFloat(t.amount) >= min
      && (!params.to || lc(t.to) === lc(params.to)));
    if (hit) return pass(hit, 'transfer_sent');
    return fail([`a transfer of at least ${min} MELEK${params.to ? ` to @${lc(params.to)}` : ' to someone else'}`], 'transfer_sent');
  },

  vesting_delegation_made(params, a) {
    const min = parseFloat(params.min_amount_mp ?? params.min_amount ?? '0');
    const hit = (a.delegations || []).find((d) => parseFloat(d.amount_mp ?? d.vesting_shares ?? d.amount) > min);
    if (hit) return pass(hit, 'vesting_delegation_made');
    return fail(['a delegation of MELEK POWER to another account'], 'vesting_delegation_made');
  },

  // Not visible on chain: queued for the operator, NEVER a fail against the reader.
  manual_review(params) {
    return notCheckable(params.what ? `reviewed by hand: ${params.what}` : 'reviewed by hand', 'manual_review');
  },
};

export const LESSON_CHECK_KINDS = Object.freeze(Object.keys(LESSON_CHECKS));

/**
 * Run one lesson's check against chain activity. Pure; never throws.
 * @param {{kind:string, params?:object}} check
 * @param {object} activity  the chain-reader.mjs shape (plus `account_exists`)
 * @param {{account?:string}} [ctx]
 */
export function runLessonCheck(check, activity = {}, ctx = {}) {
  const kind = String(check?.kind || '');
  const fn = LESSON_CHECKS[kind];
  if (!fn) return notCheckable(`no detector for "${kind || '(none)'}" yet`, kind || null);
  try {
    return fn(check.params && typeof check.params === 'object' ? check.params : {}, activity || {}, ctx || {});
  } catch (err) {
    return notCheckable(`check error: ${String(err && err.message ? err.message : err)}`, kind);
  }
}
