/**
 * tutorial/payout.mjs — the BROADCAST path for tutorial completion rewards.
 *
 * `tutorial/reward.mjs` COMPOSES the reward (upvote weight + comment body, or
 * +MELEK transfer + memo + comment). Nothing broadcasts it. This module is that
 * missing half — and it exists mainly to hold ONE boundary, from
 * `.local/TUTORIAL_CALL_AND_CHECK_DESIGN.md` §C:
 *
 *   The reward ops split cleanly by Graphene authority.
 *     • `vote` and `comment`  → POSTING authority
 *     • `transfer` (+MELEK)   → ACTIVE authority
 *
 * So the posting-authority subset of the tutorial's rewards can ship the moment
 * a posting-scoped credential exists, while only the `comment_and_transfer`
 * stages wait for the higher-privilege route. This module classifies the ops,
 * executes the posting subset, and DEFERS (never silently drops, never
 * quietly escalates) the active subset unless the caller has explicitly handed
 * it an active-authority signer AND set `allowActive: true`.
 *
 * Do not collapse that split. "Just broadcast everything with whatever key is
 * around" is precisely the thing the zero-WIF boundary exists to prevent.
 *
 * KEY CUSTODY (BRIEF.md §7, MELEK_SIGNER.md, CLAUDE.md "Key custody"):
 *   • This module NEVER constructs, holds, reads, or logs a WIF.
 *   • It imports NO signing library. There is no local-signing fallback, by
 *     construction — there is no code path here that could sign anything.
 *   • Every broadcast goes through an INJECTED signer client with the shape
 *     `{ broadcast(ops, { clientRef }) -> Promise<result> }` — i.e. exactly
 *     `createSignerClient()` from `src/chain/melek-signer-client.mjs`, whose
 *     `createMockSigner()` twin makes this fully testable offline today.
 *   • Bearer tokens live in the injected client, never here. Errors are
 *     stringified from the client's `SignerError.reason`, which the client has
 *     already sanitized of its own token.
 *
 * SOFT-FAIL-NEVER-THROW: every exported function returns a result object.
 * A missing signer, a refusing signer, a malformed op, a throwing store — all
 * become a labelled result. A reward is never lost to an exception.
 *
 *   import { classifyOps, opsFromReward, payout, payoutReward } from './payout.mjs';
 *   node tutorial/payout.mjs        # offline demo against createMockSigner()
 */

import { fileURLToPath } from 'node:url';

// ── authority map ─────────────────────────────────────────────────────────────
//
// Graphene authorities, narrowest first. `posting` can vote and speak; `active`
// can move value. The tutorial only ever needs vote / comment / transfer, but
// the neighbouring ops are listed so a caller that hands us an unexpected op
// gets a correct answer instead of a guess.

/** Ops signable with POSTING authority. */
export const POSTING_OPS = Object.freeze([
  'vote',
  'comment',
  'comment_options',
  'delete_comment',
  'claim_reward_balance',
]);

/** Ops requiring ACTIVE authority (value movement, account/witness mutation). */
export const ACTIVE_OPS = Object.freeze([
  'transfer',
  'transfer_to_vesting',
  'transfer_to_savings',
  'transfer_from_savings',
  'withdraw_vesting',
  'delegate_vesting_shares',
  'account_create',
  'account_create_with_delegation',
  'create_account_with_keys_delegated',
  'account_update',
  'account_witness_vote',
  'account_witness_proxy',
  'witness_update',
  'feed_publish',
  'limit_order_create',
  'limit_order_cancel',
  'escrow_transfer',
  'escrow_release',
]);

const POSTING_SET = new Set(POSTING_OPS);
const ACTIVE_SET = new Set(ACTIVE_OPS);

/**
 * The Graphene authority one op needs: 'posting' | 'active' | 'unknown'.
 *
 * `custom_json` is deliberately payload-sensitive: it is signed with ACTIVE
 * authority when it declares `required_auths`, and with POSTING otherwise.
 * Anything not on either list is 'unknown' — NOT silently treated as posting.
 *
 * @param {[string, object]} op  a Graphene op tuple
 * @returns {'posting'|'active'|'unknown'}
 */
export function authorityFor(op) {
  if (!Array.isArray(op) || typeof op[0] !== 'string') return 'unknown';
  const kind = op[0];
  const payload = op[1] && typeof op[1] === 'object' ? op[1] : {};
  if (kind === 'custom_json') {
    const req = Array.isArray(payload.required_auths) ? payload.required_auths : [];
    return req.length > 0 ? 'active' : 'posting';
  }
  if (POSTING_SET.has(kind)) return 'posting';
  if (ACTIVE_SET.has(kind)) return 'active';
  return 'unknown';
}

/**
 * Split an op list by required Graphene authority. This is the staging boundary:
 * `posting` can ship now; `active` is the +MELEK transfer and waits for the
 * higher-privilege route; `unknown` is never auto-sent by payout().
 *
 * Order within each bucket is preserved (chain ops are order-sensitive).
 *
 * @param {Array<[string, object]>} ops
 * @returns {{ posting: Array, active: Array, unknown: Array }}
 */
export function classifyOps(ops) {
  const out = { posting: [], active: [], unknown: [] };
  if (!Array.isArray(ops)) return out;
  for (const op of ops) {
    if (!Array.isArray(op) || typeof op[0] !== 'string' || !op[1] || typeof op[1] !== 'object') {
      out.unknown.push(op);
      continue;
    }
    out[authorityFor(op)].push(op);
  }
  return out;
}

// ── reward plan → Graphene ops ───────────────────────────────────────────────

const MAX_PERMLINK = 200;

/** Graphene permlink charset: lowercase alnum and dashes. Deterministic. */
export function slugPermlink(s) {
  const base = String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base.slice(0, MAX_PERMLINK) || 'reward';
}

/**
 * The reply permlink for a stage reward. DETERMINISTIC by construction, and
 * that is load-bearing: re-broadcasting a `comment` with a permlink the same
 * author already used is an EDIT on Graphene, not a second comment. So the
 * comment leg of a reward is naturally idempotent at the chain level.
 */
export function rewardPermlink({ witness = 'hathor', stageKey = '', parentPermlink = '' } = {}) {
  return slugPermlink(`re-${parentPermlink}-${witness}-${stageKey}`);
}

/**
 * A stable, human-auditable `client_ref` for one (stage, account, authority)
 * payout. This is the string the signer's audit log carries, and the key the
 * optional idempotency store is written under. Callers may supply their own;
 * this is the default shape.
 */
export function rewardClientRef({ stageKey = '', account = '', authority = '' } = {}) {
  return ['tutorial-payout', stageKey, account, authority].filter(Boolean).join('::');
}

/**
 * Turn a `composeReward()` plan into the Graphene op tuples the signer takes.
 *
 * The plan does not know where on chain the reward lands — the caller does
 * (the lesson comment or post that evidenced completion). So `parentPermlink`
 * is required for the vote/comment legs.
 *
 * @param {object} plan  a `composeReward()` result (must have ok:true)
 * @param {object} [opts]
 * @param {string} [opts.witness='hathor']  the Witness account (voter/author/from)
 * @param {string} opts.parentPermlink      permlink of the user content being rewarded
 * @param {string} [opts.parentAuthor]      defaults to plan.account
 * @param {string} [opts.permlink]          override the deterministic reply permlink
 * @returns {{ ok:boolean, ops:Array, permlink?:string, error?:string, warnings:string[] }}
 */
export function opsFromReward(plan, opts = {}) {
  const warnings = [];
  if (!plan || typeof plan !== 'object' || plan.ok !== true) {
    return { ok: false, ops: [], warnings, error: (plan && plan.error) || 'reward plan not ok' };
  }
  const witness = String(opts.witness || 'hathor');
  const account = String(plan.account || '');
  if (!account) return { ok: false, ops: [], warnings, error: 'plan.account required' };

  const parentAuthor = String(opts.parentAuthor || account);
  const parentPermlink = String(opts.parentPermlink || '');
  const ops = [];

  // --- POSTING leg: the upvote ------------------------------------------------
  if (Number(plan.upvoteWeight) !== 0) {
    if (!parentPermlink) {
      warnings.push('upvote skipped: no parentPermlink');
    } else {
      ops.push(['vote', {
        voter: witness,
        author: parentAuthor,
        permlink: parentPermlink,
        weight: Math.max(-10000, Math.min(10000, Math.trunc(Number(plan.upvoteWeight) || 0))),
      }]);
    }
  }

  // --- POSTING leg: the comment ----------------------------------------------
  let permlink;
  if (plan.comment && typeof plan.comment.body === 'string' && plan.comment.body) {
    if (!parentPermlink) {
      warnings.push('comment skipped: no parentPermlink');
    } else {
      permlink = String(opts.permlink || rewardPermlink({ witness, stageKey: plan.stageKey, parentPermlink }));
      ops.push(['comment', {
        parent_author: parentAuthor,
        parent_permlink: parentPermlink,
        author: witness,
        permlink,
        title: '',
        body: plan.comment.body,
        json_metadata: JSON.stringify({
          app: 'melek-hathor-tutorial/1.0',
          tags: ['melek', 'tutorial'],
          stage: plan.stageKey,
        }),
      }]);
    }
  }

  // --- ACTIVE leg: the +MELEK transfer ---------------------------------------
  if (plan.transfer && plan.transfer.amount) {
    ops.push(['transfer', {
      from: witness,
      to: String(plan.transfer.to || account),
      amount: String(plan.transfer.amount),
      memo: String(plan.transfer.memo || ''),
    }]);
  }

  if (!ops.length) return { ok: false, ops: [], warnings, error: 'reward plan produced no ops' };
  return { ok: true, ops, permlink, warnings };
}

// ── the broadcast ────────────────────────────────────────────────────────────

const STATUS = Object.freeze({
  SENT: 'sent',
  SKIPPED: 'skipped',   // idempotency store says this ref was already claimed
  DEFERRED: 'deferred', // no route yet — queue it, do NOT drop it
  FAILED: 'failed',     // the signer refused or errored
  EMPTY: 'empty',       // no ops in this authority bucket
});

export { STATUS };

function errText(e) {
  if (!e) return 'unknown error';
  // SignerError carries a token-sanitized `reason`; prefer it.
  if (typeof e === 'object' && e.reason) return String(e.reason);
  return String((e && e.message) || e);
}

async function storeHas(store, key) {
  if (!store) return null;
  try {
    if (typeof store.get === 'function') return (await store.get(key)) || null;
    if (typeof store.has === 'function') {
      const r = await store.has(key);
      return r ? (typeof r === 'object' ? r : { state: 'claimed' }) : null;
    }
  } catch {
    // A store that throws must not become a double payment: treat an unreadable
    // store as "unknown", which the caller sees as a DEFERRAL, not a send.
    return { state: 'unreadable' };
  }
  return null;
}

async function storePut(store, key, rec) {
  if (!store || typeof store.put !== 'function') return false;
  try {
    await store.put(key, rec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Broadcast one authority bucket. Never throws.
 *
 * Idempotency protocol (reserve-then-send):
 *   1. read the store for `ref` — anything there ⇒ SKIPPED (never re-send)
 *   2. write `{ state: 'pending' }` BEFORE calling the signer
 *   3. write `{ state: 'sent', txId }` after
 * A crash between 2 and 3 leaves a `pending` record, which blocks a re-send.
 * That deliberately converts a double-pay risk into a possible missed pay,
 * which a human or a reconciler can resolve from the signer's audit log. For
 * money, at-most-once beats at-least-once.
 */
async function sendBucket({ authority, ops, signer, ref, store, now, gate }) {
  if (!ops.length) return { status: STATUS.EMPTY, authority, ops: [], clientRef: ref };

  if (gate && gate.blocked) {
    return { status: STATUS.DEFERRED, authority, ops, clientRef: ref, reason: gate.reason };
  }
  if (!signer || typeof signer.broadcast !== 'function') {
    return {
      status: STATUS.DEFERRED, authority, ops, clientRef: ref,
      reason: `no ${authority}-authority signer injected`,
    };
  }
  if (!ref) {
    return {
      status: STATUS.DEFERRED, authority, ops, clientRef: '',
      reason: 'no clientRef — refusing to broadcast a reward without an idempotency reference',
    };
  }

  const seen = await storeHas(store, ref);
  if (seen) {
    if (seen.state === 'unreadable') {
      return {
        status: STATUS.DEFERRED, authority, ops, clientRef: ref,
        reason: 'idempotency store unreadable — refusing to risk a double payment',
      };
    }
    return { status: STATUS.SKIPPED, authority, ops, clientRef: ref, reason: 'already claimed', record: seen };
  }

  const reserved = await storePut(store, ref, { state: 'pending', authority, at: now() });
  if (store && !reserved) {
    return {
      status: STATUS.DEFERRED, authority, ops, clientRef: ref,
      reason: 'could not reserve idempotency key — refusing to risk a double payment',
    };
  }

  let result;
  try {
    result = await signer.broadcast(ops, { clientRef: ref });
  } catch (e) {
    // Leave the pending marker in place: we do not know whether the signer
    // broadcast before failing. Surfacing it as FAILED + pending is honest.
    await storePut(store, ref, { state: 'failed', authority, at: now(), error: errText(e) });
    return { status: STATUS.FAILED, authority, ops, clientRef: ref, error: errText(e) };
  }

  const txId = (result && (result.id || result.tx_id || (result.result && result.result.id))) || null;
  await storePut(store, ref, { state: 'sent', authority, at: now(), txId });
  return { status: STATUS.SENT, authority, ops, clientRef: ref, result, txId };
}

/**
 * Broadcast a reward op set, split by Graphene authority.
 *
 * The posting-authority subset (vote + comment) goes out on `deps.signer`.
 * The active-authority subset (the +MELEK transfer) goes out ONLY when the
 * caller has BOTH injected `deps.activeSigner` AND set `deps.allowActive:true`.
 * Otherwise it comes back `deferred` with a reason, for the caller to queue.
 * Ops of unknown authority are never sent.
 *
 * @param {Array<[string,object]>} ops
 * @param {object} deps
 * @param {{broadcast:Function}} [deps.signer]        posting-authority signer client
 * @param {{broadcast:Function}} [deps.activeSigner]  active-authority signer client
 * @param {boolean} [deps.allowActive=false]          explicit opt-in for the active bucket
 * @param {string}  deps.clientRef                    base idempotency reference
 * @param {{has?:Function,get?:Function,put?:Function}} [deps.store]  idempotency store
 * @param {()=>string} [deps.now]                     clock seam (tests inject)
 * @returns {Promise<object>} never throws
 */
export async function payout(ops, deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString();
  const base = String(deps.clientRef || '');
  const split = classifyOps(ops);

  const out = {
    ok: false,
    complete: false,
    clientRef: base,
    counts: { posting: split.posting.length, active: split.active.length, unknown: split.unknown.length },
  };

  try {
    out.posting = await sendBucket({
      authority: 'posting',
      ops: split.posting,
      signer: deps.signer || deps.postingSigner || null,
      ref: base ? `${base}::posting` : '',
      store: deps.store || null,
      now,
      gate: null,
    });

    const activeGate = deps.allowActive === true
      ? null
      : { blocked: true, reason: 'active authority not enabled (deps.allowActive !== true) — +MELEK transfer deferred' };

    out.active = await sendBucket({
      authority: 'active',
      ops: split.active,
      signer: deps.activeSigner || null,
      ref: base ? `${base}::active` : '',
      store: deps.store || null,
      now,
      gate: activeGate,
    });
  } catch (e) {
    // Belt and braces: sendBucket is already total, but payout must never throw.
    out.error = errText(e);
    out.posting = out.posting || { status: STATUS.FAILED, authority: 'posting', ops: split.posting, error: out.error };
    out.active = out.active || { status: STATUS.FAILED, authority: 'active', ops: split.active, error: out.error };
  }

  out.unknown = split.unknown.length
    ? {
        status: STATUS.DEFERRED,
        authority: 'unknown',
        ops: split.unknown,
        reason: 'unrecognized op — never auto-broadcast; classify it before sending',
      }
    : { status: STATUS.EMPTY, authority: 'unknown', ops: [] };

  const buckets = [out.posting, out.active, out.unknown];
  out.failed = buckets.filter((b) => b && b.status === STATUS.FAILED);
  out.deferred = buckets.filter((b) => b && b.status === STATUS.DEFERRED);
  out.sent = buckets.filter((b) => b && b.status === STATUS.SENT);
  // ok = nothing broke. deferred is a designed outcome, not a failure.
  out.ok = out.failed.length === 0;
  // complete = every op reached the chain (or was already there).
  out.complete = out.ok && out.deferred.length === 0;
  return out;
}

/**
 * Convenience: `composeReward()` plan → ops → payout, in one call.
 * Supplies the default clientRef shape when the caller does not.
 *
 * @param {object} plan  a `composeReward()` result
 * @param {object} deps  as `payout()`, plus opsFromReward() options
 *                       (witness, parentAuthor, parentPermlink, permlink)
 */
export async function payoutReward(plan, deps = {}) {
  const built = opsFromReward(plan, deps);
  if (!built.ok) {
    return {
      ok: false, complete: false, error: built.error, warnings: built.warnings,
      clientRef: String(deps.clientRef || ''),
      counts: { posting: 0, active: 0, unknown: 0 },
      posting: { status: STATUS.EMPTY, authority: 'posting', ops: [] },
      active: { status: STATUS.EMPTY, authority: 'active', ops: [] },
      unknown: { status: STATUS.EMPTY, authority: 'unknown', ops: [] },
      failed: [], deferred: [], sent: [],
    };
  }
  const clientRef = deps.clientRef
    || rewardClientRef({ stageKey: plan.stageKey, account: plan.account });
  const res = await payout(built.ops, { ...deps, clientRef });
  res.warnings = built.warnings;
  res.permlink = built.permlink;
  return res;
}

// ── CLI demo (offline, against the in-process mock signer) ───────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { createSignerClient, createMockSigner } = await import('../src/chain/melek-signer-client.mjs');
  const { composeReward } = await import('./reward.mjs');

  const mock = createMockSigner({
    tokens: { 'tok-posting-demo': { scopes: ['vote', 'comment'] } },
  });
  const posting = createSignerClient({ url: 'http://mock', token: 'tok-posting-demo', fetch: mock.fetch });

  for (const stageKey of ['intro_post', 'first_organic_upvote']) {
    const plan = composeReward(stageKey, 'newcomer');
    const res = await payoutReward(plan, {
      signer: posting,
      parentPermlink: `demo-${stageKey}`,
      // no activeSigner, allowActive not set — the transfer leg must defer.
    });
    process.stdout.write(`${stageKey}: posting=${res.posting.status} active=${res.active.status}` +
      `${res.active.reason ? ` (${res.active.reason})` : ''}\n`);
  }
  process.stdout.write(`\nsigner audit:\n${JSON.stringify(mock.audit(), null, 2)}\n`);
}
