/**
 * tutorial/reward.mjs — deterministic per-stage COMPLETION reward composer.
 *
 * Where tutorial/composer.js produces the user-facing REPLY *text* (the
 * Phase-2 template prose) and tutorial/composers.mjs produces the forward-
 * looking LESSON post, this module produces the bare REWARD OP SET the Witness
 * broadcasts when a user *completes* a stage: the upvote weight, the optional
 * +MELEK transfer, and a short comment line — derived purely from each stage's
 * `witness_response` block in stages.json.
 *
 * Reward kinds (per tutorial/README.md):
 *   - upvote        : `comment_and_upvote`   → upvote at upvote_weight + comment
 *   - +MELEK transfer: `comment_and_transfer` → transfer_amount_melek + memo + comment
 *   - comment       : every stage carries a short comment line
 * (stages.json is the source of truth — this module READS it, never edits it.)
 *
 * Contract:
 *   composeReward(stageKey, account, deps) -> {
 *     ok, stageKey, account, action,
 *     upvoteWeight,                 // number, 0 when no upvote
 *     transfer?: { to, amount, memo },
 *     comment: { body },
 *     reward: ['upvote'|'transfer'|'comment', ...]
 *   }
 *
 * Properties:
 *   - Pure / offline. No chain reads, no network, no randomness, no clock.
 *     Same (stageKey, account) → byte-identical output.
 *   - esc()'d phrasing. The comment/memo are short deterministic templates that
 *     gesture at the stage's `style` disposition — NOT the Angelic voice and NOT
 *     a hard script (CHARACTER.md §2 / BRIEF.md §3). Phase-3 LLM polish layers
 *     over this; this is the floor that's better than silence.
 *   - Zero-WIF. The optional `deps.broadcast` is an INJECTED async sink. This
 *     module never signs, never holds a key, never imports a signer. If no
 *     broadcaster is injected, broadcastReward() just returns the planned ops.
 *   - Soft-fail-never-throw. Unknown / missing stage → { ok:false, ... }, never
 *     an exception. A throwing broadcaster is caught and reported.
 *
 * Injectable seams: __setReader (stages.json loader), __setStore (idempotency /
 * dedupe store), __setFetch (kept for parity; unused in pure path).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGES_PATH = path.join(__dirname, 'stages.json');

const CURRENCY = 'MELEK';

// ---- injectable seams -------------------------------------------------------

const _defaultReader = () => JSON.parse(readFileSync(STAGES_PATH, 'utf8'));
let _reader = _defaultReader;
let _store = null; // optional { has(key), put(key,val) } for idempotency
let _fetch = null; // parity seam; pure path does not use it

/** Override the stages.json reader. Pass a function returning the parsed doc;
 *  pass anything else (e.g. undefined) to restore the default disk reader. */
export function __setReader(fn) {
  _reader = typeof fn === 'function' ? fn : _defaultReader;
}
/** Override the dedupe/idempotency store. Pass null to clear. */
export function __setStore(store) {
  _store = store && typeof store === 'object' ? store : null;
}
/** Parity with house seams. Not used by the pure composer. */
export function __setFetch(fn) {
  _fetch = typeof fn === 'function' ? fn : null;
}

// ---- esc() — house rule for all interpolation -------------------------------

/**
 * Neutralize anything interpolated into chain output (comment bodies / memos).
 * Strips control chars and escapes angle brackets / ampersand so a hostile
 * account name can never smuggle markup downstream.
 */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---- stage lookup -----------------------------------------------------------

function findStage(stageKey) {
  let doc;
  try {
    doc = _reader();
  } catch {
    return null;
  }
  if (!doc || !Array.isArray(doc.stages)) return null;
  return doc.stages.find((s) => s && s.key === stageKey) || null;
}

// ---- deterministic comment templates ----------------------------------------
//
// Short, esc-safe, disposition-leaning lines — one per stage key. These are a
// deterministic FLOOR, not the Angelic register and not a fixed greeting; the
// phrasing varies by stage but never by run. Phase-3 LLM polish replaces the
// body while keeping this op shape.

const COMMENT_TEMPLATES = {
  intro_post: (a) => `Welcome, @${a}. Your introduction was read. The next door is engagement.`,
  engage_three_posts: (a) => `@${a}, real back-and-forth is the soul of this place. Well done.`,
  share_what_you_know: (a) => `@${a}, this was read, not skimmed. Thank you for teaching.`,
  first_organic_upvote: (a) => `@${a} — someone freely chose to lift your work. A small offering attached.`,
  power_up: (a) => `@${a}, you powered up. MP is your voice here — it regenerates and it compounds.`,
  vote_for_a_witness: (a) => `@${a}, you cast a witness vote. That's governance. The tutorial is finished.`,
  set_profile: (a) => `@${a}, a profile is the face you show the readership. It lives on-chain like the rest.`,
  follow_three_authors: (a) => `@${a}, your feed is becoming a conversation you chose. Keep curating who you hear.`,
  send_first_transfer: (a) => `@${a}, it cleared and it's final. Transfers are tips, payments, and notes in one.`,
  delegate_some_mp: (a) => `@${a}, you kept ownership and lent the weight. That's the generosity layer.`,
  join_a_community: (a) => `@${a}, a community is a room inside the house. Welcome into it.`,
  curate_with_intent: (a) => `@${a}, curation pays the good early reader. Find value before the crowd does.`,
  create_a_token: (a) => `@${a}, a token is a small economy you can author. Hold it with care.`,
  first_market_trade: (a) => `@${a}, a trade is a price you agreed with a stranger. The market is a tool.`,
  publish_a_video: (a) => `@${a}, video puts a face to the work. The content is what I answer to.`,
  contribute_to_the_wiki: (a) => `@${a}, the wiki is the shared memory of this place. Thank you for the corpus.`,
  use_the_bridge: (a) => `@${a}, a bridge is the riskiest primitive — honestly. You crossed it.`,
  meet_the_witness: (a) => `@${a}, this is not a reward — it's the start of a conversation. I'll remember.`,
  become_a_node_of_the_network: (a) =>
    `@${a}, you welcomed someone. The arc that began with your welcome closes by you giving one. As peers now.`,
};

/** A safe generic line for a stage that has no bespoke template. */
function genericComment(account, stage) {
  const label = stage && stage.label ? ` (${esc(stage.label)})` : '';
  return `@${esc(account)}, stage complete${label}. The path continues.`;
}

function commentBodyFor(stageKey, account, stage) {
  const tmpl = COMMENT_TEMPLATES[stageKey];
  // Account is the only interpolation point in the templates — esc it.
  return tmpl ? tmpl(esc(account)) : genericComment(account, stage);
}

// ---- core: composeReward ----------------------------------------------------

/**
 * Compose the deterministic reward op set for a completed stage.
 *
 * @param {string} stageKey  one of stages.json keys
 * @param {string} account   the user the reward is for (without @)
 * @param {object} [deps]    reserved (kept for caller parity; pure path unused)
 * @returns {{
 *   ok: boolean,
 *   stageKey: string,
 *   account: string,
 *   action?: string,
 *   upvoteWeight: number,
 *   transfer?: { to: string, amount: string, memo: string },
 *   comment?: { body: string },
 *   reward?: string[],
 *   tutorial_completion?: boolean,
 *   error?: string
 * }}
 */
export function composeReward(stageKey, account, deps = {}) {
  // Soft-fail on bad inputs — never throw.
  if (!stageKey || typeof stageKey !== 'string') {
    return { ok: false, stageKey: String(stageKey ?? ''), account: String(account ?? ''), upvoteWeight: 0, error: 'stageKey required' };
  }
  if (!account || typeof account !== 'string') {
    return { ok: false, stageKey, account: String(account ?? ''), upvoteWeight: 0, error: 'account required' };
  }

  const stage = findStage(stageKey);
  if (!stage) {
    return { ok: false, stageKey, account, upvoteWeight: 0, error: `unknown stage ${stageKey}` };
  }

  const wr = stage.witness_response || {};
  const action = wr.action || 'comment_and_upvote';
  const reward = [];

  const out = {
    ok: true,
    stageKey,
    account,
    action,
    upvoteWeight: 0,
    comment: { body: commentBodyFor(stageKey, account, stage) },
  };
  reward.push('comment');

  if (action === 'comment_and_transfer') {
    const amt = wr.transfer_amount_melek;
    if (amt) {
      out.transfer = {
        to: esc(account),
        amount: `${amt} ${CURRENCY}`,
        memo: esc(wr.transfer_memo ?? ''),
      };
      reward.push('transfer');
    }
  } else {
    // comment_and_upvote (default). upvote_weight is a Graphene basis-point
    // weight in [-10000, 10000]; clamp defensively and default to full.
    const w = Number.isFinite(wr.upvote_weight) ? wr.upvote_weight : 10000;
    out.upvoteWeight = Math.max(-10000, Math.min(10000, Math.trunc(w)));
    if (out.upvoteWeight !== 0) reward.push('upvote');
  }

  if (wr.tutorial_completion) out.tutorial_completion = true;

  out.reward = reward;
  return out;
}

// ---- optional broadcast (zero-WIF, injected sink) ---------------------------

/**
 * Plan + (optionally) broadcast the reward ops via an INJECTED async sink.
 * This module never signs and never holds a key. The sink is expected to be a
 * scoped, bearer-token MELEK-Signer client supplied by the caller.
 *
 * Idempotency: if a store is injected and already holds the reward key, the
 * call is treated as already-done and not re-sent.
 *
 * @param {string} stageKey
 * @param {string} account
 * @param {object} [deps]
 * @param {(plan:object)=>Promise<any>} [deps.broadcast]  injected async sink
 * @param {string} [deps.permlink]  permlink the comment/upvote targets
 * @returns {Promise<{ ok:boolean, sent:boolean, plan:object, result?:any, error?:string, skipped?:boolean }>}
 */
export async function broadcastReward(stageKey, account, deps = {}) {
  const plan = composeReward(stageKey, account, deps);
  if (!plan.ok) {
    return { ok: false, sent: false, plan, error: plan.error };
  }

  const rewardKey = `tutorial-reward::${stageKey}::${account}`;

  // Idempotency check against the injected store, if any.
  if (_store && typeof _store.has === 'function') {
    let already = false;
    try {
      already = await _store.has(rewardKey);
    } catch {
      already = false; // soft-fail: treat store errors as "not seen"
    }
    if (already) {
      return { ok: true, sent: false, skipped: true, plan };
    }
  }

  const broadcast = typeof deps.broadcast === 'function' ? deps.broadcast : null;
  if (!broadcast) {
    // No sink injected — return the plan so the caller can dispatch it.
    return { ok: true, sent: false, plan };
  }

  let result;
  try {
    result = await broadcast({ ...plan, permlink: deps.permlink });
  } catch (err) {
    return { ok: false, sent: false, plan, error: String(err && err.message ? err.message : err) };
  }

  if (_store && typeof _store.put === 'function') {
    try {
      await _store.put(rewardKey, { at: null, action: plan.action });
    } catch {
      // soft-fail: a store write failure must not undo a successful broadcast
    }
  }

  return { ok: true, sent: true, plan, result };
}

// ---- CLI (guarded) ----------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , stageKey = 'first_organic_upvote', account = 'newcomer'] = process.argv;
  const out = composeReward(stageKey, account);
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
