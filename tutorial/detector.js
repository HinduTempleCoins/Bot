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
