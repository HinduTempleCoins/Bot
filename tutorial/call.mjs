/**
 * tutorial/call.mjs — the TRIGGER for Hathor's tutorial loop (design doc §A).
 *
 * `.local/TUTORIAL_CALL_AND_CHECK_DESIGN.md` names three missing pieces. This is
 * piece A: the on-demand call handler. Detection (tutorial/detector.js) has always
 * been pure and reusable "for tests, replay, and future strategies (per-block,
 * per-cron, on-demand)" — nothing ever invoked the on-demand path. This module is
 * that invocation.
 *
 * A user triggers a check two ways, and only two:
 *
 *   (a) CALLING her — a comment whose body mentions @hathor.
 *   (b) commenting on the GUIDANCE THREAD for a tutorial — i.e. replying under one
 *       of her published lesson posts. The published lesson posts ARE the guidance
 *       threads (design doc §2); series-publisher.mjs assigns each a stable
 *       permlink, and lessons/index.mjs carries the `stageRef` that binds that
 *       permlink to a stage key. No new "guidance thread" concept is invented here.
 *
 * Flow (the design doc's `onComment` pseudocode, followed step for step):
 *
 *   1. addressed to Hathor?          -> mention | known lesson permlink | parent_author === hathor
 *   2. which stage is claimed?       -> lesson permlink -> stageRef
 *                                    -> else the user's current stage from state.js
 *                                    -> else ask which one
 *   3. fetch that user's activity    -> injected fetchUserActivity(account) (tutorial/chain-reader.mjs)
 *   4. detector check, ON DEMAND     -> detectCompletedStages(activity)[stageKey]
 *   5a. PASS -> composeReward()      -> RETURN ops for the caller's signer; advance state via commit()
 *   5b. FAIL -> reply naming EXACTLY what is still missing and how to finish
 *
 * BOUNDARIES — non-negotiable, they are why this file is shaped the way it is:
 *
 *   • ZERO-WIF. This module composes and RETURNS Graphene ops. It never signs,
 *     never broadcasts, never imports a signer, never holds a key (CLAUDE.md key
 *     custody, BRIEF.md §7). Handing ops back to a caller who owns the signer
 *     boundary is the correct shape.
 *   • NO NAGGING, NO CONDEMNATION. tutorial/README.md is explicit: many users skip
 *     the tutorial and that is fine. A FAIL reply names what is still open and how
 *     to close it — it never scolds, never guilts, never chases.
 *   • NO HARD-CODED GREETING / RESPONSE SCRIPT. CHARACTER.md §2: disposition, not
 *     script. Everything user-facing is generated from stages.json data (`label`,
 *     `description`, `completion_criteria`, `witness_response.style`). The built-in
 *     assembly is a MINIMAL, CLEARLY-MARKED Phase-2 deterministic template
 *     (`template: 'phase-2-deterministic'`); inject `deps.composeText` to render the
 *     same context in the Angelic register in Phase 3 and this file needs no edit.
 *   • NO PERSONAL INFORMATION. Every input is a public chain op or public account
 *     activity (BRIEF.md §6/§7). Nothing here asks the user to disclose anything,
 *     and nothing is stored beyond the existing per-stage response state.
 *   • SOFT-FAIL, NEVER THROW. Every path returns an outcome object. A broken
 *     dependency degrades to `{ ok: false, kind: 'error' }`, never an exception in
 *     a comment-stream loop.
 *   • OFFLINE + INJECTABLE. No live RPC is imported. `deps.fetchUserActivity` is
 *     injected; the optional lazy fallback to ./chain-reader.mjs is guarded and
 *     silent when that sibling module does not exist yet.
 *
 * Rate limiting: stages.json carries a `rate_limit_education` block, so the answer
 * to someone calling twenty times is a TAUGHT BOUNDARY, not silence and not spam.
 * See createCallLimiter() — the first call past the limit teaches the boundary
 * once; the rest of that window is quiet.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { LESSONS } from './lessons/index.mjs';
import { seriesLessons, permlinkFor } from './series-publisher.mjs';
import { slugify } from '../src/chain/permlink.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGES_PATH = path.join(__dirname, 'stages.json');

/** The Witness's account name on the MELEK chain (CLAUDE.md: lowercase `hathor`). */
export const WITNESS_ACCOUNT = 'hathor';

/** Marker for every reply body this module assembles itself. */
export const PHASE2_TEMPLATE = 'phase-2-deterministic';

/** Rate-limit defaults, used when stages.json does not carry tuned values. */
const DEFAULT_MAX_CALLS = 3;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

// ---- injectable seams -------------------------------------------------------

const _defaultReader = () => JSON.parse(readFileSync(STAGES_PATH, 'utf8'));
let _reader = _defaultReader;

/** Override the stages.json reader (tests / replay). Pass a non-function to restore. */
export function __setReader(fn) {
  _reader = typeof fn === 'function' ? fn : _defaultReader;
}

function loadStagesDoc() {
  try {
    const doc = _reader();
    if (doc && Array.isArray(doc.stages)) return doc;
  } catch {
    /* soft-fail: a missing/corrupt stages.json must not throw into a comment loop */
  }
  return { stages: [] };
}

// ---- esc() — house rule for all interpolation -------------------------------

/**
 * Neutralize anything interpolated into chain output. A hostile account name or
 * comment body must never smuggle markup into a reply Hathor signs.
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- op normalization -------------------------------------------------------

/**
 * Accept either a raw comment_operation payload or a Graphene `['comment', {...}]`
 * tuple, and return the payload. Anything else -> null.
 */
export function normalizeCommentOp(op) {
  if (!op) return null;
  if (Array.isArray(op)) {
    if (op.length !== 2 || op[0] !== 'comment') return null;
    return op[1] && typeof op[1] === 'object' ? op[1] : null;
  }
  if (typeof op !== 'object') return null;
  if (op.op && Array.isArray(op.op)) return normalizeCommentOp(op.op);
  return op;
}

// ---- (b) the guidance threads: lesson permlink -> stageRef ------------------

/**
 * Build the permlink -> lesson index.
 *
 * This is deliberately derived from series-publisher.mjs's OWN permlink assignment
 * (`seriesLessons` order + `permlinkFor`), not from a copied list — so if the
 * series order or the permlink scheme changes, this index changes with it and the
 * guidance-thread trigger cannot silently drift out of sync. Pure: it reads lesson
 * METADATA only and never loads the markdown files, so it stays offline.
 *
 * @returns {Map<string, {id,title,permlink,stageRef,n}>}
 */
export function lessonPermlinkIndex({ lessons = LESSONS } = {}) {
  const index = new Map();
  let ordered;
  try {
    ordered = seriesLessons(lessons);
  } catch {
    return index;
  }
  ordered.forEach((lesson, i) => {
    try {
      index.set(permlinkFor(i + 1, lesson), {
        id: lesson.id,
        title: lesson.title,
        permlink: permlinkFor(i + 1, lesson),
        stageRef: lesson.stageRef ?? null,
        n: i + 1,
      });
    } catch {
      /* a malformed catalog entry is skipped, not fatal */
    }
  });
  return index;
}

let _indexCache = null;
function defaultIndex() {
  if (!_indexCache) _indexCache = lessonPermlinkIndex();
  return _indexCache;
}

// ---- (1) is this addressed to Hathor? ---------------------------------------

/**
 * Does this body CALL her? A word-boundaried @hathor mention — `@hathorian` and
 * `email@hathor.example` must not trigger.
 */
export function mentionsWitness(body, account = WITNESS_ACCOUNT) {
  const name = String(account || '').toLowerCase();
  if (!name) return false;
  const re = new RegExp(`(^|[^a-z0-9._@-])@${name}(?![a-z0-9._-])`, 'i');
  return re.test(String(body ?? ''));
}

/**
 * Step 1 of the design doc's onComment: is this comment addressed to Hathor?
 *
 * @returns {{ addressed: boolean, via: 'mention'|'lesson'|'reply'|null, lesson: object|null }}
 */
export function isAddressedToWitness(op, deps = {}) {
  const witness = deps.witnessAccount || WITNESS_ACCOUNT;
  const c = normalizeCommentOp(op);
  if (!c) return { addressed: false, via: null, lesson: null };

  // Never trigger on her own comments — that is how a bot builds an infinite loop.
  if (String(c.author || '').toLowerCase() === witness) {
    return { addressed: false, via: null, lesson: null };
  }
  // Top-level posts are not calls; only comments (a comment has a parent_author).
  const index = deps.lessonIndex || defaultIndex();
  const parentPermlink = String(c.parent_permlink || '');
  const lesson = index.get(parentPermlink) || null;

  if (mentionsWitness(c.body, witness)) return { addressed: true, via: 'mention', lesson };
  if (lesson) return { addressed: true, via: 'lesson', lesson };
  if (String(c.parent_author || '').toLowerCase() === witness) {
    return { addressed: true, via: 'reply', lesson: null };
  }
  return { addressed: false, via: null, lesson: null };
}

// ---- (2) which stage is being claimed? --------------------------------------

/**
 * The user's current stage from tutorial/state.js — the first stage in catalog
 * order this account has not already been responded to. Uses the existing store's
 * public API (`respondedStages`); it does not reinvent per-user state.
 *
 * @returns {object|null} the stage definition, or null if every stage is done.
 */
export function currentStageFor(account, state, stagesDoc = loadStagesDoc()) {
  if (!state || typeof state.respondedStages !== 'function') return null;
  let done;
  try {
    done = new Set(state.respondedStages(account) || []);
  } catch {
    return null;
  }
  for (const stage of stagesDoc.stages) {
    if (stage && stage.key && !done.has(stage.key)) return stage;
  }
  return null;
}

/**
 * Resolve the claimed stage in the design doc's priority order:
 *   lesson permlink -> stageRef  >  current stage from state  >  ask which one.
 *
 * @returns {{ stageKey: string|null, source: 'lesson'|'state'|null, stage: object|null }}
 */
export function resolveClaimedStage(op, deps = {}, ctx = {}) {
  const stagesDoc = ctx.stagesDoc || loadStagesDoc();
  const byKey = (k) => stagesDoc.stages.find((s) => s && s.key === k) || null;

  // 1. The guidance thread names the stage outright.
  const lesson = ctx.lesson || null;
  if (lesson && lesson.stageRef) {
    const stage = byKey(lesson.stageRef);
    if (stage) return { stageKey: stage.key, source: 'lesson', stage };
  }

  // 2. Otherwise, the user's current stage from state.
  const stage = currentStageFor(ctx.account, deps.state, stagesDoc);
  if (stage) return { stageKey: stage.key, source: 'state', stage };

  // 3. Otherwise, ask which one.
  return { stageKey: null, source: null, stage: null };
}

// ---- rate limiting (stages.json `rate_limit_education`) ---------------------

/**
 * Read the tunable rate-limit config. stages.json is the source of truth for
 * thresholds in this subsystem, so if the operator adds `max_calls_per_window` /
 * `window_minutes` to the `rate_limit_education` block it takes effect with no
 * redeploy; otherwise the defaults apply.
 */
export function rateLimitConfig(stagesDoc = loadStagesDoc()) {
  const block = (stagesDoc && stagesDoc.rate_limit_education) || {};
  const maxCalls = Number.isFinite(block.max_calls_per_window)
    ? Math.max(1, Math.trunc(block.max_calls_per_window))
    : DEFAULT_MAX_CALLS;
  const windowMs = Number.isFinite(block.window_minutes)
    ? Math.max(1, Math.trunc(block.window_minutes)) * 60 * 1000
    : DEFAULT_WINDOW_MS;
  return { maxCalls, windowMs, style: block.style || '', trigger: block.trigger || '' };
}

/**
 * In-memory sliding-window call limiter.
 *
 * The chain enforces bandwidth; the Witness EDUCATES around the limit
 * (`rate_limit_education.style`). So the policy is deliberately three-valued:
 *
 *   within limit        -> check normally
 *   FIRST call past it  -> teach the boundary, once  (`teach: true`)
 *   the rest of the window -> quiet (`teach: false`) — refusing to spam back
 *
 * That is "a taught boundary, not silence and not spam". `now` is injectable so
 * tests drive the clock instead of sleeping.
 */
export function createCallLimiter({ maxCalls = DEFAULT_MAX_CALLS, windowMs = DEFAULT_WINDOW_MS, now = () => Date.now() } = {}) {
  const hits = new Map(); // account -> { times: number[], taughtAt: number|null }

  return {
    maxCalls,
    windowMs,
    /**
     * Record a call and report the verdict.
     * @returns {{ count: number, limited: boolean, teach: boolean, maxCalls: number, windowMs: number, retryAfterMs: number }}
     */
    check(account) {
      const key = String(account || '');
      const t = now();
      const entry = hits.get(key) || { times: [], taughtAt: null };
      entry.times = entry.times.filter((ts) => t - ts < windowMs);
      if (entry.taughtAt != null && t - entry.taughtAt >= windowMs) entry.taughtAt = null;
      entry.times.push(t);

      const count = entry.times.length;
      const limited = count > maxCalls;
      let teach = false;
      if (limited && entry.taughtAt == null) {
        teach = true;
        entry.taughtAt = t;
      }
      hits.set(key, entry);

      const oldest = entry.times[0] ?? t;
      return {
        count,
        limited,
        teach,
        maxCalls,
        windowMs,
        retryAfterMs: limited ? Math.max(0, windowMs - (t - oldest)) : 0,
      };
    },
    /** Test/ops helper — forget one account, or everything. */
    reset(account) {
      if (account == null) hits.clear();
      else hits.delete(String(account));
    },
  };
}

// ---- criteria -> "exactly what is still missing" ----------------------------

// Which activity field each criteria `kind` reads, mirroring detector.js. A kind
// absent from this map has no chain-reader detector yet (Tier-B infra-gated and
// the Tier-C conversational arc) and is reported as not-yet-checkable rather than
// as a failure — the user did nothing wrong.
const CHECKABLE_KINDS = new Set([
  'post_authored',
  'comments_authored',
  'external_upvote_received',
  'transfer_to_vesting',
  'witness_vote_cast',
]);

function bodyLen(s) {
  return String(s ?? '').trim().length;
}

function tagsOf(post) {
  if (Array.isArray(post?.tags)) return post.tags;
  if (typeof post?.json_metadata === 'string') {
    try {
      const meta = JSON.parse(post.json_metadata);
      if (Array.isArray(meta.tags)) return meta.tags;
    } catch {
      /* malformed json_metadata is treated as no tags — same as detector.js */
    }
  }
  return [];
}

/**
 * How far along the user actually is, per criterion. Returns a map of
 * criterion-key -> the value they currently have, so the FAIL reply can say
 * "2 of 3" instead of a vague "not done".
 *
 * Computed from the same public activity the detector reads; nothing else.
 */
export function progressFor(stage, activity = {}) {
  const cc = (stage && stage.completion_criteria) || {};
  const have = {};
  const posts = Array.isArray(activity.posts) ? activity.posts : [];
  const comments = Array.isArray(activity.comments) ? activity.comments : [];

  switch (cc.kind) {
    case 'post_authored': {
      const tagSet = new Set((cc.tag_any_of || []).map((t) => String(t).toLowerCase()));
      const excl = new Set((cc.excludes_tag_any_of || []).map((t) => String(t).toLowerCase()));
      const candidates = posts.filter((p) => {
        const tags = tagsOf(p).map((t) => String(t).toLowerCase());
        if (tagSet.size && !tags.some((t) => tagSet.has(t))) return false;
        if (excl.size && tags.some((t) => excl.has(t))) return false;
        return true;
      });
      if (tagSet.size) have.tag_any_of = candidates.length > 0;
      if (cc.excludes_tag_any_of) have.excludes_tag_any_of = true;
      have.min_body_chars = candidates.reduce((m, p) => Math.max(m, bodyLen(p.body)), 0);
      break;
    }
    case 'comments_authored': {
      const qualifying = comments.filter((c) => {
        if (!c.parent_author) return false;
        if (cc.exclude_self_authored_parents && c.parent_author === c.author) return false;
        return bodyLen(c.body) >= (cc.min_body_chars_each ?? 0);
      });
      have.min_count = qualifying.length;
      have.min_distinct_parent_authors = new Set(qualifying.map((c) => c.parent_author)).size;
      have.min_body_chars_each = comments.reduce((m, c) => Math.max(m, bodyLen(c.body)), 0);
      break;
    }
    case 'external_upvote_received': {
      const votes = Array.isArray(activity.votes_received) ? activity.votes_received : [];
      have.min_count = votes.filter((v) => v.voter !== cc.exclude_voter_account && (v.weight ?? 0) > 0).length;
      break;
    }
    case 'transfer_to_vesting': {
      const tv = Array.isArray(activity.transfers_to_vesting) ? activity.transfers_to_vesting : [];
      have.min_amount_melek = tv.reduce((m, t) => {
        const a = parseFloat(t.amount);
        return Number.isFinite(a) ? Math.max(m, a) : m;
      }, 0);
      break;
    }
    case 'witness_vote_cast': {
      const wv = Array.isArray(activity.witness_votes) ? activity.witness_votes : [];
      have.min_count = wv.filter((v) => v.approve !== false).length;
      break;
    }
    default:
      break;
  }
  return have;
}

/** Humanize a criterion key without a per-stage script: `min_distinct_followed` -> `min distinct followed`. */
function humanize(key) {
  return String(key).replace(/_/g, ' ');
}

/**
 * Turn one criterion into a clause naming EXACTLY what is required and, where
 * measurable, what the user currently has. Generated from the criteria data, so a
 * new stage needs no new prose here.
 */
export function criterionClause(key, need, have) {
  const shown = have === undefined || have === null ? null : have;
  switch (key) {
    case 'min_count':
      return `${esc(shown ?? 0)} of ${esc(need)} so far`;
    case 'min_distinct_parent_authors':
      return `${esc(shown ?? 0)} of ${esc(need)} different authors so far`;
    case 'min_distinct_followed':
      return `${esc(shown ?? 0)} of ${esc(need)} different accounts followed`;
    case 'min_body_chars':
      return `at least ${esc(need)} characters (longest so far: ${esc(shown ?? 0)})`;
    case 'min_body_chars_each':
      return `at least ${esc(need)} characters each (longest so far: ${esc(shown ?? 0)})`;
    case 'min_amount_melek':
      return `at least ${esc(need)} MELEK (largest so far: ${esc(shown ?? 0)})`;
    case 'min_amount_mp':
      return `at least ${esc(need)} MP`;
    case 'min_turns':
      return `at least ${esc(need)} exchanges`;
    case 'tag_any_of':
      return `tagged one of: ${(need || []).map((t) => esc(t)).join(', ')}`;
    case 'excludes_tag_any_of':
      return `not tagged: ${(need || []).map((t) => esc(t)).join(', ')}`;
    case 'require_fields_any_of':
      return `any of these fields set: ${(need || []).map((t) => esc(t)).join(', ')}`;
    case 'exclude_voter_account':
      return `from someone other than @${esc(need)}`;
    case 'exclude_recipient_self':
    case 'exclude_self':
    case 'exclude_self_authored_parents':
      return need ? 'to someone other than yourself' : null;
    case 'target_must_be_newer_account':
      return need ? 'to an account newer than yours' : null;
    case 'kind':
      return null;
    default:
      return `${esc(humanize(key))}: ${esc(Array.isArray(need) ? need.join(', ') : need)}`;
  }
}

/**
 * The structured shortfall: which criteria are not yet met, with need + have.
 * `unmet` drives the FAIL reply; `all` is the full requirement list, useful to a
 * Phase-3 generator that wants to restate the whole ask.
 */
export function shortfall(stage, activity = {}) {
  const cc = (stage && stage.completion_criteria) || {};
  const have = progressFor(stage, activity);
  const all = [];
  const unmet = [];

  for (const [key, need] of Object.entries(cc)) {
    if (key === 'kind') continue;
    const clause = criterionClause(key, need, have[key]);
    if (!clause) continue;
    const got = have[key];
    let met;
    if (got === undefined) met = null; // not measurable without a detector for this kind
    else if (typeof need === 'number' || (typeof need === 'string' && /^[\d.]+$/.test(need))) {
      met = Number(got) >= Number(need);
    } else if (typeof got === 'boolean') met = got;
    else met = null;

    const item = { criterion: key, need, have: got ?? null, met, clause };
    all.push(item);
    if (met !== true) unmet.push(item);
  }
  return { all, unmet, have };
}

// ---- reply text: generated, never scripted ----------------------------------

/**
 * Assemble a reply body.
 *
 * `deps.composeText(ctx)` is the Phase-3 seam: give it the stage, its
 * `witness_response.style` disposition, and the structured facts, and it renders
 * the Angelic register (CHARACTER.md §2). When it is absent, the block below is a
 * MINIMAL Phase-2 DETERMINISTIC TEMPLATE — a floor that is better than silence,
 * explicitly not the voice, marked as such in the returned `template` field. It
 * carries no greeting, no fixed opener, and no scolding.
 *
 * @returns {{ body: string, template: string }}
 */
export function composeReply(ctx, deps = {}) {
  if (typeof deps.composeText === 'function') {
    try {
      const body = deps.composeText(ctx);
      if (typeof body === 'string' && body.trim()) return { body: body.trim(), template: 'injected' };
    } catch {
      /* a failing Phase-3 generator falls back to the deterministic floor */
    }
  }
  return { body: deterministicBody(ctx), template: PHASE2_TEMPLATE };
}

function deterministicBody(ctx) {
  const at = `@${esc(ctx.account)}`;
  const stage = ctx.stage || null;
  const lines = [];

  switch (ctx.kind) {
    case 'pass': {
      // The reward comment itself comes from reward.mjs; this line only confirms
      // the check that was asked for.
      lines.push(`${at} — ${esc(stage?.label ?? ctx.stageKey)}: checked and complete.`);
      break;
    }
    case 'fail': {
      lines.push(`${at} — ${esc(stage?.label ?? ctx.stageKey)}: checked, not yet complete.`);
      const items = (ctx.missing || []).map((m) => `- ${m.clause}`);
      if (items.length) lines.push('Still open:', items.join('\n'));
      if (stage?.description) lines.push(esc(stage.description));
      break;
    }
    case 'already_rewarded': {
      lines.push(`${at} — ${esc(stage?.label ?? ctx.stageKey)} is already recorded as complete; the reward for it has been sent.`);
      if (ctx.nextStage) lines.push(`Next, when you want it: ${esc(ctx.nextStage.label)} — ${esc(ctx.nextStage.description)}`);
      break;
    }
    case 'not_checkable': {
      lines.push(`${at} — ${esc(stage?.label ?? ctx.stageKey)} cannot be verified on chain yet; the feature it depends on is not live.`);
      if (stage?.description) lines.push(esc(stage.description));
      break;
    }
    case 'ambiguous': {
      lines.push(`${at} — which stage are you claiming? Reply on that lesson's post and I will check that one.`);
      if (Array.isArray(ctx.options) && ctx.options.length) {
        lines.push(ctx.options.map((s) => `- ${esc(s.key)}: ${esc(s.label)}`).join('\n'));
      }
      break;
    }
    case 'rate_limited': {
      const mins = Math.round((ctx.rate?.windowMs ?? DEFAULT_WINDOW_MS) / 60000);
      lines.push(
        `${at} — I check up to ${esc(ctx.rate?.maxCalls ?? DEFAULT_MAX_CALLS)} times per ${esc(mins)} minutes per account, so the checking never crowds out the chain's own bandwidth limits.`,
        'The allowance regenerates on its own; nothing is lost, and nothing needs to be done about it. Post the work and call me after it refills.',
      );
      break;
    }
    default:
      lines.push(`${at} — nothing to check.`);
  }
  return lines.filter(Boolean).join('\n\n');
}

// ---- op construction (composed, NEVER broadcast) ----------------------------

function replyPermlink(commentOp, suffix) {
  const base = slugify(`re ${commentOp.author || ''} ${commentOp.permlink || ''} ${suffix || ''}`);
  return (base || slugify(`re hathor ${suffix || 'check'}`) || 'hathor-check').slice(0, 200);
}

/** The Graphene `comment` op for Hathor's reply, threaded under the triggering comment. */
export function buildReplyOp(commentOp, body, { witness = WITNESS_ACCOUNT, suffix = 'check' } = {}) {
  return [
    'comment',
    {
      parent_author: String(commentOp.author || ''),
      parent_permlink: String(commentOp.permlink || ''),
      author: witness,
      permlink: replyPermlink(commentOp, suffix),
      title: '',
      body,
      json_metadata: JSON.stringify({ tags: ['hathor-tutorial'], app: 'hathor/0.1', format: 'markdown' }),
    },
  ];
}

/**
 * Turn a reward.mjs plan into Graphene ops. reward.mjs deliberately returns a
 * plan (weights and amounts), not ops — this is where the plan becomes
 * `[['comment',...], ['vote',...], ['transfer',...]]` for a signer the CALLER owns.
 */
function buildRewardOps(plan, commentOp, target, witness) {
  const ops = [];
  if (plan.comment?.body) {
    ops.push(buildReplyOp(commentOp, plan.comment.body, { witness, suffix: `${plan.stageKey}-reward` }));
  }
  if (plan.upvoteWeight) {
    ops.push(['vote', { voter: witness, author: target.author, permlink: target.permlink, weight: plan.upvoteWeight }]);
  }
  if (plan.transfer) {
    ops.push(['transfer', { from: witness, to: plan.transfer.to, amount: plan.transfer.amount, memo: plan.transfer.memo }]);
  }
  return ops;
}

/**
 * What the reward upvote should land on: the evidence the user actually produced,
 * when the detector handed back something with a permlink; otherwise the comment
 * that called her.
 */
function rewardTarget(evidence, commentOp) {
  const e = Array.isArray(evidence) ? evidence[0] : evidence;
  if (e && typeof e === 'object' && e.permlink && e.author) {
    return { author: String(e.author), permlink: String(e.permlink) };
  }
  return { author: String(commentOp.author || ''), permlink: String(commentOp.permlink || '') };
}

// ---- the handler ------------------------------------------------------------

function outcome(base) {
  return {
    ok: true,
    handled: false,
    kind: 'ignored',
    account: '',
    stageKey: null,
    stageSource: null,
    lesson: null,
    trigger: null,
    reply: null,
    ops: null,
    plan: null,
    missing: null,
    evidence: null,
    template: null,
    ...base,
  };
}

/**
 * Handle one incoming `comment` operation. THE trigger for the tutorial loop.
 *
 * @param {object|Array} op   a Graphene comment_operation payload, a
 *                            `['comment', {...}]` tuple, or `{ op: [...] }`.
 * @param {object} deps
 * @param {(account:string)=>Promise<object>} deps.fetchUserActivity
 *        the Phase-2 chain reader (tutorial/chain-reader.mjs). REQUIRED in
 *        practice; injected in tests. This module never imports a live RPC.
 * @param {object}  [deps.detector]   { detectCompletedStages } — defaults to tutorial/detector.js
 * @param {object}  [deps.state]      a TutorialState (tutorial/state.js)
 * @param {Function}[deps.composeReward] reward.mjs composeReward — defaults to tutorial/reward.mjs
 * @param {object}  [deps.limiter]    a createCallLimiter() instance (share one across calls)
 * @param {Function}[deps.composeText] Phase-3 Angelic renderer for reply bodies
 * @param {Map}     [deps.lessonIndex] override the permlink -> lesson index
 * @param {string}  [deps.witnessAccount]
 * @param {boolean} [deps.recordOnPass] record the state advance immediately instead
 *                  of handing back commit() (dry-run / scheduler parity). Default false.
 *
 * @returns {Promise<object>} outcome; `ops` are COMPOSED, never broadcast, and on a
 *          PASS the caller advances state by awaiting `outcome.commit({ txId })`
 *          AFTER its signer succeeds.
 */
export async function handleComment(op, deps = {}) {
  try {
    return await handle(op, deps);
  } catch (err) {
    // Soft-fail-never-throw: this runs inside a comment stream.
    return outcome({ ok: false, kind: 'error', error: String(err && err.message ? err.message : err) });
  }
}

async function handle(op, deps) {
  const witness = (deps.witnessAccount || WITNESS_ACCOUNT).toLowerCase();
  const commentOp = normalizeCommentOp(op);
  if (!commentOp || !commentOp.author) return outcome({ kind: 'ignored', reason: 'not a comment op' });

  const account = String(commentOp.author);
  const stagesDoc = loadStagesDoc();

  // 1. Addressed to Hathor?
  const addressed = isAddressedToWitness(commentOp, { ...deps, witnessAccount: witness });
  if (!addressed.addressed) {
    return outcome({ account, kind: 'ignored', reason: 'not addressed to the witness' });
  }
  const base = {
    account,
    handled: true,
    trigger: addressed.via,
    lesson: addressed.lesson,
  };

  // Rate limiting — a taught boundary, not silence and not spam.
  const limiter = deps.limiter || null;
  if (limiter && typeof limiter.check === 'function') {
    const rate = limiter.check(account);
    if (rate.limited) {
      if (!rate.teach) {
        // Already taught this window. Quiet is correct here; she does not spam back.
        return outcome({ ...base, kind: 'rate_limited', rate, reply: null, ops: null });
      }
      const { body, template } = composeReply({ kind: 'rate_limited', account, rate, style: rateLimitConfig(stagesDoc).style }, deps);
      const replyOp = buildReplyOp(commentOp, body, { witness, suffix: 'rate' });
      return outcome({
        ...base,
        kind: 'rate_limited',
        rate,
        template,
        reply: { parent_author: account, parent_permlink: commentOp.permlink, body },
        ops: [replyOp],
      });
    }
  }

  // 2. Which stage is being claimed?
  const claimed = resolveClaimedStage(commentOp, deps, { stagesDoc, account, lesson: addressed.lesson });
  if (!claimed.stageKey) {
    const options = stagesDoc.stages.filter((s) => s && s.tier === 'A').slice(0, 6);
    const { body, template } = composeReply({ kind: 'ambiguous', account, options }, deps);
    return outcome({
      ...base,
      kind: 'ambiguous',
      template,
      reply: { parent_author: account, parent_permlink: commentOp.permlink, body },
      ops: [buildReplyOp(commentOp, body, { witness, suffix: 'which-stage' })],
    });
  }
  const { stageKey, stage } = claimed;
  const withStage = { ...base, stageKey, stageSource: claimed.source };

  // Already rewarded? Never pay twice, and never scold for asking.
  if (deps.state && typeof deps.state.hasResponded === 'function' && deps.state.hasResponded(account, stageKey)) {
    const nextStage = stagesDoc.stages.find((s) => s && s.id === stage.next_stage) || null;
    const { body, template } = composeReply({ kind: 'already_rewarded', account, stage, stageKey, nextStage }, deps);
    return outcome({
      ...withStage,
      kind: 'already_rewarded',
      template,
      reply: { parent_author: account, parent_permlink: commentOp.permlink, body },
      ops: [buildReplyOp(commentOp, body, { witness, suffix: `${stageKey}-done` })],
    });
  }

  // Stages whose `kind` has no chain-reader detector yet (infra-gated Tier B, the
  // Tier-C conversational arc) are not failures. Say so plainly.
  const kind = stage?.completion_criteria?.kind;
  if (!CHECKABLE_KINDS.has(kind)) {
    const { body, template } = composeReply({ kind: 'not_checkable', account, stage, stageKey }, deps);
    return outcome({
      ...withStage,
      kind: 'not_checkable',
      template,
      reply: { parent_author: account, parent_permlink: commentOp.permlink, body },
      ops: [buildReplyOp(commentOp, body, { witness, suffix: `${stageKey}-pending` })],
    });
  }

  // 3. Fetch that user's activity (injected reader — never a live RPC import here).
  const fetchActivity = await resolveActivityReader(deps);
  if (!fetchActivity) {
    return outcome({ ...withStage, ok: false, kind: 'error', error: 'no fetchUserActivity injected' });
  }
  let activity;
  try {
    activity = (await fetchActivity(account)) || {};
  } catch (err) {
    return outcome({ ...withStage, ok: false, kind: 'error', error: `activity read failed: ${String(err && err.message ? err.message : err)}` });
  }

  // 4. The on-demand detector call.
  const detector = deps.detector || (await import('./detector.js'));
  let result = null;
  try {
    result = detector.detectCompletedStages(activity)?.[stageKey] ?? null;
  } catch (err) {
    return outcome({ ...withStage, ok: false, kind: 'error', error: `detection failed: ${String(err && err.message ? err.message : err)}` });
  }
  if (!result) {
    const { body, template } = composeReply({ kind: 'not_checkable', account, stage, stageKey }, deps);
    return outcome({
      ...withStage,
      kind: 'not_checkable',
      template,
      reply: { parent_author: account, parent_permlink: commentOp.permlink, body },
      ops: [buildReplyOp(commentOp, body, { witness, suffix: `${stageKey}-pending` })],
    });
  }

  // 5b. FAIL — name exactly what is still missing. No nagging, no condemnation.
  if (!result.complete) {
    const miss = shortfall(stage, activity);
    const { body, template } = composeReply(
      { kind: 'fail', account, stage, stageKey, missing: miss.unmet, requirements: miss.all, style: stage?.witness_response?.style },
      deps,
    );
    return outcome({
      ...withStage,
      kind: 'fail',
      template,
      missing: miss.unmet,
      reply: { parent_author: account, parent_permlink: commentOp.permlink, body },
      ops: [buildReplyOp(commentOp, body, { witness, suffix: `${stageKey}-open` })],
    });
  }

  // 5a. PASS — compose the reward and RETURN the ops. Nothing is signed here.
  const composeRewardFn = deps.composeReward || (await import('./reward.mjs')).composeReward;
  const plan = composeRewardFn(stageKey, account, {});
  if (!plan || !plan.ok) {
    return outcome({ ...withStage, ok: false, kind: 'error', error: plan?.error || 'reward composition failed', evidence: result.evidence });
  }

  const target = rewardTarget(result.evidence, commentOp);
  const ops = buildRewardOps(plan, commentOp, target, witness);

  // State advances only once the caller's signer has actually broadcast — hence
  // commit(), not an eager write. Recording first would mark a reward as paid that
  // a signer failure never delivered.
  const evidencePermlink = target.permlink || null;
  const commit = async ({ txId = null } = {}) => {
    if (!deps.state || typeof deps.state.recordResponse !== 'function') return false;
    try {
      deps.state.recordResponse(account, stageKey, { txId, action: plan.action, evidencePermlink });
      return true;
    } catch {
      return false;
    }
  };
  if (deps.recordOnPass) await commit({ txId: null });

  return outcome({
    ...withStage,
    kind: 'pass',
    plan,
    ops,
    evidence: result.evidence,
    rewardTarget: target,
    template: null,
    reply: plan.comment ? { parent_author: account, parent_permlink: commentOp.permlink, body: plan.comment.body } : null,
    commit,
  });
}

/**
 * The chain reader. An injected `deps.fetchUserActivity` ALWAYS wins — that is how
 * tests stay offline and how a caller supplies its own RPC configuration. The lazy
 * import of ./chain-reader.mjs is the production default, and it is guarded so this
 * file still works if that sibling module is absent (it returns null, and the
 * handler reports the missing reader rather than inventing one).
 *
 * Exported for testability: it is the only place a live endpoint can enter.
 */
export async function resolveActivityReader(deps = {}) {
  if (typeof deps.fetchUserActivity === 'function') return deps.fetchUserActivity;
  try {
    const mod = await import('./chain-reader.mjs');
    if (typeof mod.fetchUserActivity === 'function') return mod.fetchUserActivity;
  } catch {
    /* not built yet — the caller must inject one */
  }
  return null;
}

// ---- CLI (guarded) ----------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Offline demo: a fake call with a fake reader. Broadcasts nothing.
  const fakeActivity = {
    posts: [{ author: 'newcomer', permlink: 'hello', title: 'Hello', body: 'x'.repeat(250), tags: ['introduceyourself'] }],
    comments: [], votes_received: [], transfers_to_vesting: [], witness_votes: [],
  };
  const out = await handleComment(
    { author: 'newcomer', permlink: 'my-call', parent_author: 'someone', parent_permlink: 'thread', body: 'hey @hathor I posted my intro' },
    { fetchUserActivity: async () => fakeActivity, limiter: createCallLimiter() },
  );
  const { commit, ...printable } = out;
  process.stdout.write(JSON.stringify(printable, null, 2) + '\n');
}
