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
  // A top-level post that mentions her is a call too — the mention is the signal,
  // not the depth. Only the mention, the guidance thread, or a reply under one of
  // her posts counts; everything else is ignored.
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

// =============================================================================
// THE INSTRUCTIONAL SERIES LOOP — handleLessonComment()
//
// The operator's loop for the Hathor Instructional Series (tutorial/instructional.mjs): a reader reads
// the lesson posts in order, comments on one (or mentions @hathor anywhere), and Hathor:
//
//   1. works out what the comment MEANS — a completion claim, a question, or anything else — in any
//      language and any wording. No exact phrase is ever required; the lesson's call_phrase is a hint.
//      (tutorial/lang.mjs keyword floor in 17 languages; the local brain refines it when HATHOR_LLM=1.)
//   2. AUTO-CHECKS the lesson for that account on EVERY lesson comment — she finds the work herself from
//      the account's public activity; nobody pastes a link.
//        PASS            -> upvote the qualifying post (or their comment) + a reply congratulating them
//                           and linking the NEXT lesson; if they also asked something, the answer rides
//                           in the same reply
//        FAIL + claim    -> a reply naming exactly what is still missing and how
//        FAIL + question -> just the answer (the check is not mentioned)
//        FAIL + other    -> nothing (no nagging)
//        not visible on chain (manual_review) + claim -> queued for the operator, never a fail
//   3. STRICT_ORDER (default ON): a lesson whose prerequisites are unfinished is not checked; a claim
//      gets a kind pointer at the first unfinished lesson.
//   4. Never rewards the same lesson twice for the same account (state.js lesson progress), and keeps
//      the taught-boundary rate limit.
//
// Questions: FAQ match first (the lesson's own FAQ). The brain (lesson context + site map) answers only
// when HATHOR_LLM=1; with it off an unmatched question is queued for the operator and gets no reply.
// Replies are composed in English from data (lesson, evidence, next lesson), with varied wording, and
// translated into the commenter's language by the brain when it is on (chain terms, @names and URLs are
// token-protected).
//
// Same boundaries as handleComment(): ZERO-WIF (ops are RETURNED, never signed here), soft-fail, offline.
// =============================================================================

const DEFAULT_LESSON_UPVOTE_WEIGHT = 5000;       // 50% — the operator tunes via LESSON_UPVOTE_WEIGHT
const VOTE_WINDOW_MS = 6.5 * 24 * 3600 * 1000;   // Graphene refuses votes after the 7-day cashout

function fnv(s) {
  let h = 0x811c9dc5;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const pick = (seed, arr) => arr[fnv(seed) % arr.length];

/** How to name the evidence the check found, in a reply. Data-driven; titles are esc()'d. */
export function describeEvidence(ev, check = {}) {
  if (!ev || typeof ev !== 'object') return 'your work';
  if (ev.title) return `your post "${esc(ev.title)}"`;
  if (ev.parent_author) return `your comment on @${esc(ev.parent_author)}'s post`;
  if (ev.permlink) return 'your post';
  if (ev.witness) return `your witness vote for @${esc(ev.witness)}`;
  if (ev.amount && check.kind === 'transfer_to_vesting') return `your power-up of ${esc(ev.amount)}`;
  if (ev.amount) return `your transfer of ${esc(ev.amount)}`;
  if (ev.field) return `your profile's ${esc(ev.field)}`;
  if (Array.isArray(ev.followed)) return `your follow of ${ev.followed.slice(0, 3).map((f) => `@${esc(f)}`).join(', ')}`;
  if (ev.account) return `your account @${esc(ev.account)}`;
  return 'your work';
}

const titleOf = (l) => l.shortTitle || l.title;
const lessonLabel = (l) => `Lesson ${esc(l.n)}, "${esc(titleOf(l))}"`;
const lessonLink = (l) => `[Lesson ${esc(l.n)}: ${esc(titleOf(l))}](${l.url})`;

/**
 * The Phase-2 deterministic reply floor for the lesson loop. Varied wording chosen from the data
 * (account + lesson), never one fixed string; the brain's one-line `voice` replaces the opener when it
 * is on. Returns English markdown.
 */
export function composeLessonReply(kind, f = {}) {
  const at = `@${esc(f.account)}`;
  const seed = `${f.account}|${f.lesson?.id}|${kind}`;
  const L = f.lesson;
  const out = [];
  const nextLine = () => {
    if (!f.next) return 'That was the last lesson of the series.';
    return pick(`${seed}|n`, [
      `Next: ${lessonLink(f.next)}`,
      `When you are ready, the next one is ${lessonLink(f.next)}.`,
      `The road goes on at ${lessonLink(f.next)}.`,
    ]);
  };
  switch (kind) {
    case 'pass': {
      const ev = describeEvidence(f.evidence, L?.check);
      const voted = f.votedOn === 'comment' ? 'this comment' : ev;
      out.push(f.voice ? `${at} ${f.voice}` : pick(seed, [
        `${at}, ${lessonLabel(L)} is complete. I found ${ev}, and my upvote is on ${voted}.`,
        `${at}, I checked ${lessonLabel(L)} against your account and it is done: ${ev}. ${voted === ev ? 'It' : 'This comment'} carries my upvote.`,
        `${lessonLabel(L)} is finished, ${at}. I found ${ev} and upvoted ${voted}.`,
      ]));
      if (f.voice) out.push(`I found ${ev} and upvoted ${voted}.`);
      if (f.answer) out.push(f.answer);
      out.push(nextLine());
      break;
    }
    case 'fail': {
      out.push(f.voice ? `${at} ${f.voice}` : pick(seed, [
        `${at}, I checked ${lessonLabel(L)} and it is not finished yet.`,
        `${at}, not yet: I looked at your account for ${lessonLabel(L)} and something is still open.`,
        `${at}, ${lessonLabel(L)} is close but not complete.`,
      ]));
      const miss = (f.missing || []).filter(Boolean);
      if (miss.length) out.push(`Still missing:\n${miss.map((m) => `- ${m}`).join('\n')}`);
      if (L?.tryThis) out.push(`The task: ${L.tryThis}`);
      if (L?.check?.explain) out.push(`How I check: ${L.check.explain}`);
      out.push('Comment here again when it is done and I will look.');
      break;
    }
    case 'already_done': {
      out.push(pick(seed, [
        `${at}, ${lessonLabel(L)} is already recorded as complete for you.`,
        `${at}, you finished ${lessonLabel(L)} already; it is on your record.`,
      ]));
      if (f.answer) out.push(f.answer);
      out.push(nextLine());
      break;
    }
    case 'out_of_order': {
      const first = f.firstUnfinished;
      out.push(pick(seed, [
        `${at}, the lessons are checked in order, and ${lessonLink(first)} comes before this one.`,
        `${at}, before ${lessonLabel(L)} I check ${lessonLink(first)}; that one is still open for you.`,
      ]));
      out.push('Finish it, comment on that lesson, and then come back to this one.');
      break;
    }
    case 'queued': {
      out.push(pick(seed, [
        `${at}, ${lessonLabel(L)} leaves nothing I can see on chain, so it is queued for a person to review.`,
        `${at}, I cannot see ${lessonLabel(L)} on chain; I have put it in the review queue.`,
      ]));
      if (L?.check?.explain) out.push(L.check.explain);
      break;
    }
    case 'answer': {
      if (f.answer) out.push(`${at} ${f.answer}`);
      break;
    }
    default:
      break;
  }
  return out.filter(Boolean).join('\n\n');
}

/** Which lesson a comment is about. */
function resolveLessonFor({ c, registry, via, rootLesson, cls, done }) {
  if (via === 'lesson' || via === 'thread') return { lesson: rootLesson, source: via };
  const named = registry.findInText(c.body) || (cls?.english ? registry.findInText(cls.english) : null)
    || (Number.isFinite(cls?.lessonNumber) ? registry.byNumber(cls.lessonNumber) : null);
  if (named) return { lesson: named, source: 'named' };
  const next = registry.firstUnfinished(done);
  return { lesson: next, source: next ? 'progress' : null };
}

/**
 * Handle one comment for the Instructional Series loop.
 *
 * @param {object|Array} op  a comment op (payload, ['comment', {...}], or { op })
 * @param {object} deps
 * @param {object}   deps.registry          tutorial/instructional.mjs registry (REQUIRED)
 * @param {Function} [deps.fetchUserActivity] (account) => chain-reader shape
 * @param {object}   [deps.brain]            tutorial/lesson-brain.mjs instance (off unless HATHOR_LLM=1)
 * @param {object}   [deps.state]            TutorialState (lesson progress + review queue)
 * @param {object}   [deps.limiter]          createCallLimiter()
 * @param {Function} [deps.resolveRoot]      async (author, permlink) => { root_author, root_permlink }
 * @param {boolean}  [deps.strictOrder]      default: STRICT_ORDER env, ON unless '0'
 * @param {number}   [deps.upvoteWeight]     default LESSON_UPVOTE_WEIGHT env or 5000
 * @param {string}   [deps.siteMap]          site-map text for the brain's answers
 * @param {Function} [deps.now]
 * @returns {Promise<object>} outcome — { kind, intent, lang, lessonId, ops, reply, commit?, check, ... }
 */
export async function handleLessonComment(op, deps = {}) {
  try {
    return await handleLesson(op, deps);
  } catch (err) {
    return outcome({ ok: false, kind: 'error', error: String(err && err.message ? err.message : err) });
  }
}

async function handleLesson(op, deps) {
  const registry = deps.registry;
  if (!registry || typeof registry.byPermlink !== 'function') return outcome({ ok: false, kind: 'error', error: 'no lesson registry' });
  const witness = String(deps.witnessAccount || registry.witness || WITNESS_ACCOUNT).toLowerCase();
  const c = normalizeCommentOp(op);
  if (!c || !c.author) return outcome({ kind: 'ignored', reason: 'not a comment op' });
  const account = String(c.author).toLowerCase();
  if (account === witness) return outcome({ account, kind: 'ignored', reason: 'own comment' });

  // 1. Addressed? A comment directly on a lesson post, a reply deeper in a lesson thread under one of
  //    her comments, or an @hathor mention anywhere.
  const parentAuthor = String(c.parent_author || '').toLowerCase();
  let via = null;
  let rootLesson = null;
  if (parentAuthor === witness && registry.byPermlink(c.parent_permlink)) {
    via = 'lesson'; rootLesson = registry.byPermlink(c.parent_permlink);
  } else if (parentAuthor === witness && typeof deps.resolveRoot === 'function') {
    try {
      const root = await deps.resolveRoot(parentAuthor, String(c.parent_permlink || ''));
      if (root && String(root.root_author || '').toLowerCase() === witness && registry.byPermlink(root.root_permlink)) {
        via = 'thread'; rootLesson = registry.byPermlink(root.root_permlink);
      }
    } catch { /* soft: an unresolved root just means "not a lesson thread" */ }
  }
  const mentioned = mentionsWitness(c.body, witness);
  if (!via && mentioned) via = 'mention';
  if (!via) return outcome({ account, kind: 'ignored', reason: 'not addressed to the witness' });

  const base = { account, handled: true, trigger: via };
  const replyTo = { parent_author: c.author, parent_permlink: c.permlink };
  const state = deps.state || null;
  const done = state && typeof state.lessonsDone === 'function' ? state.lessonsDone(account) : [];

  // 2. What does the comment mean? (brain when on; multilingual keyword floor always)
  const brain = deps.brain || null;
  let cls = null;
  if (brain && typeof brain.classify === 'function') {
    try { cls = await brain.classify(c.body, { lesson: rootLesson }); } catch { cls = null; }
  }
  if (!cls) {
    const { classifyIntentFallback } = await import('./lang.mjs');
    const fb = classifyIntentFallback(c.body, { callPhrase: rootLesson?.callPhrase || '' });
    cls = { intent: fb.intent, lang: fb.lang === 'und' ? 'en' : fb.lang, english: fb.lang === 'en' ? c.body : '', lessonNumber: null, via: fb.via };
  }
  const { intent, lang } = cls;

  // Rate limit — a taught boundary, once per window; quiet after.
  if (deps.limiter && typeof deps.limiter.check === 'function') {
    const rate = deps.limiter.check(account);
    if (rate.limited) {
      if (!rate.teach) return outcome({ ...base, kind: 'rate_limited', intent, lang, rate });
      const { body, template } = composeReply({ kind: 'rate_limited', account, rate }, {});
      const text = await localize(body, lang, brain);
      return outcome({ ...base, kind: 'rate_limited', intent, lang, rate, template, reply: { ...replyTo, body: text }, ops: [buildReplyOp(c, text, { witness, suffix: 'rate' })] });
    }
  }

  // 3. Which lesson?
  const { lesson, source } = resolveLessonFor({ c, registry, via, rootLesson, cls, done });
  if (!lesson) return outcome({ ...base, kind: 'ignored', intent, lang, reason: 'no lesson to check (series complete or empty)' });
  const withLesson = { ...base, intent, lang, lessonId: lesson.id, lessonN: lesson.n, lessonSource: source, lesson: { id: lesson.id, n: lesson.n, permlink: lesson.permlink } };
  const next = registry.next(lesson.id);

  // The answer to a question, if there is one: FAQ first, the brain second (only when it is on).
  let answer = null;
  let answerVia = null;
  if (intent === 'question') {
    const { faqMatch, lessonContext, siteMapExcerpt } = await import('./lesson-brain.mjs');
    const hit = faqMatch(cls.english || c.body, lesson.faq) || (cls.english ? null : faqMatch(c.body, lesson.faq));
    if (hit) { answer = hit.a; answerVia = 'faq'; }
    else if (brain && typeof brain.answer === 'function') {
      try {
        const a = await brain.answer({
          question: c.body, english: cls.english, lesson, from: account,
          context: lessonContext(lesson, registry),
          siteMap: deps.siteMap ? siteMapExcerpt(cls.english || c.body, deps.siteMap) : '',
        });
        if (a) { answer = a; answerVia = 'brain'; }
      } catch { /* soft */ }
    }
    if (!answer && state && typeof state.queueReview === 'function') {
      try { state.queueReview({ account, lessonId: lesson.id, kind: 'unanswered_question', ref: c.permlink, text: String(c.body).slice(0, 500) }); } catch { /* soft */ }
    }
  }

  const reply = async (kind, facts, suffix, extra = {}) => {
    let voice = null;
    if ((kind === 'pass' || kind === 'fail') && brain && typeof brain.voice === 'function') {
      try { voice = await brain.voice(kind, { account, lesson: lesson.title }); } catch { voice = null; }
    }
    const english = composeLessonReply(kind, { account, lesson, next, answer, voice, ...facts });
    if (!english) return outcome({ ...withLesson, kind, answerVia, ...extra });
    const body = await localize(english, lang, brain);
    return outcome({
      ...withLesson, kind, answerVia, template: PHASE2_TEMPLATE, replyLang: body === english ? 'en' : lang,
      reply: { ...replyTo, body }, ops: [buildReplyOp(c, body, { witness, suffix })], ...extra,
    });
  };
  const quiet = (kind, extra = {}) => outcome({ ...withLesson, kind, answerVia, ...extra });

  // 4. Already finished? Never reward twice.
  if (state && typeof state.hasLesson === 'function' && state.hasLesson(account, lesson.id)) {
    if (intent === 'claim') return reply('already_done', {}, `l${lesson.n}-done`);
    if (answer) return reply('answer', {}, `l${lesson.n}-answer`, { kind: 'answer' });
    return quiet('already_done');
  }

  // 5. Strict order: prerequisites first. Reading is open to everyone; CHECKS go in order.
  const strict = deps.strictOrder ?? (String(process.env.STRICT_ORDER ?? '1') !== '0');
  if (strict) {
    const doneSet = new Set(done);
    const firstUnfinished = registry.prerequisitesOf(lesson.id).find((p) => !doneSet.has(p.id)) || null;
    if (firstUnfinished) {
      if (intent === 'claim') return reply('out_of_order', { firstUnfinished }, `l${lesson.n}-order`, { firstUnfinishedId: firstUnfinished.id });
      if (answer) return reply('answer', {}, `l${lesson.n}-answer`);
      return quiet('out_of_order', { firstUnfinishedId: firstUnfinished.id });
    }
  }

  // 6. The auto-check — on every addressed comment, not only on claims.
  const { runLessonCheck } = await import('./detector.js');
  let activity = {};
  if (lesson.check.kind !== 'manual_review' && lesson.check.kind !== 'account_exists') {
    const fetchActivity = await resolveActivityReader(deps);
    if (!fetchActivity) return outcome({ ...withLesson, ok: false, kind: 'error', error: 'no fetchUserActivity injected' });
    try { activity = (await fetchActivity(account)) || {}; } catch (err) {
      return outcome({ ...withLesson, ok: false, kind: 'error', error: `activity read failed: ${String(err && err.message ? err.message : err)}` });
    }
    if (activity.meta && activity.meta.ok === false && activity.meta.errors?.length) {
      // The chain did not answer: that is not the reader's failure. Say nothing rather than "not done".
      return outcome({ ...withLesson, ok: false, kind: 'error', error: `chain read failed: ${activity.meta.errors.slice(0, 2).join('; ')}` });
    }
  } else if (lesson.check.kind === 'account_exists') {
    activity = { account, account_exists: true }; // they just signed a comment with it
  }
  const check = runLessonCheck(lesson.check, activity, { account });
  const checkSummary = { status: check.status, kind: check.kind, missing: check.missing, reason: check.reason || null };

  if (check.status === 'not_checkable') {
    if (intent === 'claim') {
      if (state && typeof state.queueReview === 'function') {
        try { state.queueReview({ account, lessonId: lesson.id, kind: 'manual_review', ref: c.permlink, text: String(c.body).slice(0, 500) }); } catch { /* soft */ }
      }
      return reply('queued', {}, `l${lesson.n}-review`, { check: checkSummary });
    }
    if (answer) return reply('answer', {}, `l${lesson.n}-answer`, { check: checkSummary });
    return quiet('not_checkable', { check: checkSummary });
  }

  if (check.status === 'fail') {
    if (intent === 'claim') return reply('fail', { missing: check.missing }, `l${lesson.n}-open`, { check: checkSummary, missing: check.missing });
    if (answer) return reply('answer', {}, `l${lesson.n}-answer`, { check: checkSummary });
    return quiet('checked_not_done', { check: checkSummary });
  }

  // PASS — upvote the work (or, when the work cannot take a vote, their comment) + congratulate + next.
  const ev = check.evidence;
  const votes = Array.isArray(activity.votes_received) ? activity.votes_received : [];
  const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
  const evVotable = ev && typeof ev === 'object' && ev.permlink && String(ev.author || account).toLowerCase() === account
    && !(ev.created && nowMs - Date.parse(ev.created) > VOTE_WINDOW_MS)
    && !votes.some((v) => v.voter === witness && v.permlink === ev.permlink);
  const target = evVotable ? { author: account, permlink: String(ev.permlink) } : { author: account, permlink: String(c.permlink) };
  const weight = Math.max(1, Math.min(10000, Number(deps.upvoteWeight ?? process.env.LESSON_UPVOTE_WEIGHT ?? DEFAULT_LESSON_UPVOTE_WEIGHT) || DEFAULT_LESSON_UPVOTE_WEIGHT));
  const voteOp = ['vote', { voter: witness, author: target.author, permlink: target.permlink, weight }];
  const passed = await reply('pass', { evidence: ev, votedOn: evVotable ? 'work' : 'comment' }, `l${lesson.n}-done`, { check: checkSummary });
  const ops = [voteOp, ...(passed.ops || [])];
  const commit = async ({ txId = null } = {}) => {
    if (!state || typeof state.recordLesson !== 'function') return false;
    try { return state.recordLesson(account, lesson.id, { txId, evidencePermlink: target.permlink, via }); } catch { return false; }
  };
  return { ...passed, kind: 'pass', ops, rewardTarget: target, evidence: ev, commit, nextLessonId: next ? next.id : null };
}

/** Translate an English reply into the commenter's language when the brain is on; else English. */
async function localize(english, lang, brain) {
  if (!lang || lang === 'en' || !brain || typeof brain.translate !== 'function') return english;
  try {
    const t = await brain.translate(english, lang);
    return typeof t === 'string' && t.trim() ? t : english;
  } catch { return english; }
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
