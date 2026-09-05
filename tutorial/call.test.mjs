/**
 * tutorial/call.test.mjs — offline tests for the tutorial call handler.
 *
 * Fully offline: every dependency is injected (chain reader, detector, state,
 * reward composer, clock). No RPC, no network, no filesystem writes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  handleComment,
  isAddressedToWitness,
  mentionsWitness,
  normalizeCommentOp,
  lessonPermlinkIndex,
  currentStageFor,
  resolveClaimedStage,
  createCallLimiter,
  rateLimitConfig,
  progressFor,
  shortfall,
  criterionClause,
  buildReplyOp,
  resolveActivityReader,
  esc,
  WITNESS_ACCOUNT,
  PHASE2_TEMPLATE,
} from './call.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- fixtures ---------------------------------------------------------------

const EMPTY_ACTIVITY = {
  posts: [], comments: [], votes_received: [], transfers_to_vesting: [], witness_votes: [],
};

/** An activity blob that satisfies intro_post. */
const introDone = (account = 'alice') => ({
  ...EMPTY_ACTIVITY,
  posts: [{
    author: account, permlink: 'hello-melek', title: 'Hello MELEK',
    body: 'x'.repeat(250), tags: ['introduceyourself'], created: '2026-09-01T00:00:00',
  }],
});

/** An activity blob that satisfies first_organic_upvote (a comment_and_transfer stage). */
const upvoteDone = (account = 'alice') => ({
  ...introDone(account),
  votes_received: [{ voter: 'bob', author: account, permlink: 'hello-melek', weight: 5000, time: '2026-09-02T00:00:00' }],
});

/** A call comment: mentions @hathor from a thread that is not one of her posts. */
const call = (over = {}) => ({
  author: 'alice',
  permlink: 'my-call-1',
  parent_author: 'carol',
  parent_permlink: 'carols-post',
  body: 'hey @hathor, I did the thing',
  ...over,
});

/** A minimal TutorialState stand-in with the same public surface state.js exposes. */
function fakeState(initial = {}) {
  const store = { ...initial };
  return {
    recorded: [],
    respondedStages(a) { return Object.keys(store[a] || {}); },
    hasResponded(a, k) { return Boolean(store[a] && store[a][k]); },
    recordResponse(a, k, r) {
      store[a] = store[a] || {};
      store[a][k] = r;
      this.recorded.push({ account: a, stageKey: k, ...r });
    },
  };
}

/** A detector stand-in with detector.js's exact return shape. */
function fakeDetector(map) {
  return { detectCompletedStages: () => map };
}

const realDetector = await import('./detector.js');
const realReward = await import('./reward.mjs');

const baseDeps = (over = {}) => ({
  fetchUserActivity: async () => EMPTY_ACTIVITY,
  detector: realDetector,
  composeReward: realReward.composeReward,
  state: fakeState(),
  ...over,
});

// ---- step 1: is it addressed to Hathor? -------------------------------------

test('mentionsWitness is word-boundaried', () => {
  assert.equal(mentionsWitness('hello @hathor please check'), true);
  assert.equal(mentionsWitness('@hathor'), true);
  assert.equal(mentionsWitness('(@hathor)'), true);
  assert.equal(mentionsWitness('@HATHOR shouting'), true);
  assert.equal(mentionsWitness('@hathorian is someone else'), false);
  assert.equal(mentionsWitness('hathor without an at-sign'), false);
  assert.equal(mentionsWitness('mail me at bob@hathor.example'), false);
  assert.equal(mentionsWitness(null), false);
});

test('normalizeCommentOp accepts payload, tuple and {op:[...]} shapes', () => {
  const payload = { author: 'a', permlink: 'p' };
  assert.deepEqual(normalizeCommentOp(payload), payload);
  assert.deepEqual(normalizeCommentOp(['comment', payload]), payload);
  assert.deepEqual(normalizeCommentOp({ op: ['comment', payload] }), payload);
  assert.equal(normalizeCommentOp(['vote', payload]), null);
  assert.equal(normalizeCommentOp(null), null);
});

test('addressed via mention, via lesson permlink, and via a reply under her post', () => {
  assert.equal(isAddressedToWitness(call()).via, 'mention');

  const index = lessonPermlinkIndex();
  const [lessonPermlink] = [...index.keys()];
  const viaLesson = isAddressedToWitness(call({ body: 'done!', parent_author: 'hathor', parent_permlink: lessonPermlink }));
  assert.equal(viaLesson.via, 'lesson');
  assert.equal(viaLesson.lesson.permlink, lessonPermlink);

  assert.equal(isAddressedToWitness(call({ body: 'thanks', parent_author: 'hathor', parent_permlink: 'some-other-post' })).via, 'reply');
});

test('a plain comment addressed to nobody is ignored', async () => {
  const out = await handleComment(call({ body: 'nice post carol' }), baseDeps());
  assert.equal(out.handled, false);
  assert.equal(out.kind, 'ignored');
  assert.equal(out.ops, null);
});

test('Hathor never triggers on her own comments (no self-loop)', async () => {
  const out = await handleComment(call({ author: WITNESS_ACCOUNT, body: 'as @hathor I say' }), baseDeps());
  assert.equal(out.handled, false);
  assert.equal(out.kind, 'ignored');
});

// ---- step 2: permlink -> stageRef -------------------------------------------

test('lessonPermlinkIndex maps published lesson permlinks to their stageRef', () => {
  const index = lessonPermlinkIndex();
  assert.ok(index.size >= 20, 'the whole series is indexed');
  const withStage = [...index.values()].filter((l) => l.stageRef);
  assert.ok(withStage.length >= 5, 'several lessons bind to stages');
  const intro = [...index.values()].find((l) => l.stageRef === 'intro_post');
  assert.ok(intro, 'the intro lesson is bound to intro_post');
  assert.match(intro.permlink, /^melek-tutorial-\d\d-/);
});

test('lesson permlink beats state when resolving the claimed stage', () => {
  const index = lessonPermlinkIndex();
  const intro = [...index.values()].find((l) => l.stageRef === 'intro_post');
  // state says the user is already past intro_post...
  const state = fakeState({ alice: { intro_post: {}, engage_three_posts: {} } });
  const resolved = resolveClaimedStage(call(), { state }, { account: 'alice', lesson: intro });
  assert.equal(resolved.stageKey, 'intro_post');
  assert.equal(resolved.source, 'lesson');
});

test('without a lesson, the claimed stage falls back to state', () => {
  const state = fakeState({ alice: { intro_post: {} } });
  const resolved = resolveClaimedStage(call(), { state }, { account: 'alice' });
  assert.equal(resolved.stageKey, 'engage_three_posts');
  assert.equal(resolved.source, 'state');
  assert.equal(currentStageFor('nobody', state).key, 'intro_post');
});

test('with neither lesson nor state, she asks which stage — and does not guess', async () => {
  const out = await handleComment(call(), baseDeps({ state: undefined }));
  assert.equal(out.kind, 'ambiguous');
  assert.equal(out.stageKey, null);
  assert.equal(out.ops.length, 1);
  assert.equal(out.ops[0][0], 'comment');
  assert.match(out.reply.body, /which stage/i);
});

test('a comment on a guidance thread triggers that lesson stage with no state at all', async () => {
  const index = lessonPermlinkIndex();
  const intro = [...index.values()].find((l) => l.stageRef === 'intro_post');
  const out = await handleComment(
    call({ body: 'posted it', parent_author: 'hathor', parent_permlink: intro.permlink }),
    baseDeps({ state: undefined, fetchUserActivity: async () => introDone('alice') }),
  );
  assert.equal(out.trigger, 'lesson');
  assert.equal(out.stageSource, 'lesson');
  assert.equal(out.stageKey, 'intro_post');
  assert.equal(out.kind, 'pass');
});

// ---- step 3/4: on-demand fetch + detection ----------------------------------

test('the injected chain reader is called with only the public account name', async () => {
  const seen = [];
  await handleComment(call(), baseDeps({
    fetchUserActivity: async (...args) => { seen.push(args); return EMPTY_ACTIVITY; },
    state: fakeState(),
  }));
  assert.deepEqual(seen, [['alice']]);
});

// ---- step 5a: PASS ----------------------------------------------------------

test('PASS returns composed ops and broadcasts nothing', async () => {
  const state = fakeState();
  const out = await handleComment(call(), baseDeps({ state, fetchUserActivity: async () => introDone('alice') }));

  assert.equal(out.ok, true);
  assert.equal(out.kind, 'pass');
  assert.equal(out.stageKey, 'intro_post');
  assert.equal(out.plan.action, 'comment_and_upvote');

  const kinds = out.ops.map((o) => o[0]);
  assert.deepEqual(kinds, ['comment', 'vote']);

  const [, comment] = out.ops[0];
  assert.equal(comment.author, 'hathor');
  assert.equal(comment.parent_author, 'alice');
  assert.equal(comment.parent_permlink, 'my-call-1');

  const [, vote] = out.ops[1];
  // the upvote lands on the evidence the user produced, not on the call comment
  assert.deepEqual(vote, { voter: 'hathor', author: 'alice', permlink: 'hello-melek', weight: 10000 });

  // zero-WIF: nothing signed, nothing sent, no signer anywhere in the outcome
  assert.equal(out.txId, undefined);
  assert.equal(JSON.stringify(Object.keys(out)).includes('wif'), false);
});

test('PASS on a transfer stage composes the transfer op from stages.json', async () => {
  const state = fakeState({ alice: { intro_post: {}, engage_three_posts: {}, share_what_you_know: {} } });
  const out = await handleComment(call(), baseDeps({ state, fetchUserActivity: async () => upvoteDone('alice') }));
  assert.equal(out.stageKey, 'first_organic_upvote');
  assert.equal(out.kind, 'pass');
  const transfer = out.ops.find((o) => o[0] === 'transfer');
  assert.ok(transfer, 'a transfer op is composed');
  assert.equal(transfer[1].from, 'hathor');
  assert.equal(transfer[1].to, 'alice');
  assert.match(transfer[1].amount, /^1\.000 MELEK$/);
  assert.equal(out.ops.some((o) => o[0] === 'vote'), false, 'transfer stages carry no upvote');
});

test('state advances only on commit(), after the caller broadcasts', async () => {
  const state = fakeState();
  const out = await handleComment(call(), baseDeps({ state, fetchUserActivity: async () => introDone('alice') }));

  assert.equal(state.hasResponded('alice', 'intro_post'), false, 'not recorded before broadcast');
  assert.equal(typeof out.commit, 'function');

  const ok = await out.commit({ txId: 'abc123' });
  assert.equal(ok, true);
  assert.equal(state.hasResponded('alice', 'intro_post'), true);
  assert.equal(state.recorded[0].txId, 'abc123');
  assert.equal(state.recorded[0].evidencePermlink, 'hello-melek');
});

test('recordOnPass advances state eagerly for dry-run / scheduler parity', async () => {
  const state = fakeState();
  await handleComment(call(), baseDeps({ state, recordOnPass: true, fetchUserActivity: async () => introDone('alice') }));
  assert.equal(state.hasResponded('alice', 'intro_post'), true);
});

test('a stage already rewarded is never paid twice, and never scolded for asking', async () => {
  const index = lessonPermlinkIndex();
  const intro = [...index.values()].find((l) => l.stageRef === 'intro_post');
  const state = fakeState({ alice: { intro_post: { action: 'comment_and_upvote' } } });
  const out = await handleComment(
    call({ body: 'check again please', parent_author: 'hathor', parent_permlink: intro.permlink }),
    baseDeps({ state, fetchUserActivity: async () => introDone('alice') }),
  );
  assert.equal(out.kind, 'already_rewarded');
  assert.equal(out.ops.some((o) => o[0] === 'vote' || o[0] === 'transfer'), false, 'no second reward');
  assert.doesNotMatch(out.reply.body, /should|must|failed|lazy|still haven/i);
});

// ---- step 5b: FAIL ----------------------------------------------------------

test('FAIL names exactly what is missing, with counts, and does not scold', async () => {
  const state = fakeState({ alice: { intro_post: {} } }); // current stage: engage_three_posts
  const activity = {
    ...EMPTY_ACTIVITY,
    comments: [
      { author: 'alice', parent_author: 'bob', parent_permlink: 'p1', body: 'y'.repeat(100) },
      { author: 'alice', parent_author: 'bob', parent_permlink: 'p2', body: 'y'.repeat(100) },
    ],
  };
  const out = await handleComment(call(), baseDeps({ state, fetchUserActivity: async () => activity }));

  assert.equal(out.kind, 'fail');
  assert.equal(out.stageKey, 'engage_three_posts');
  assert.equal(out.ops.length, 1);
  assert.equal(out.ops[0][0], 'comment');

  const criteria = out.missing.map((m) => m.criterion);
  assert.ok(criteria.includes('min_count'), 'the count shortfall is named');
  assert.ok(criteria.includes('min_distinct_parent_authors'), 'the distinct-author shortfall is named');
  assert.match(out.reply.body, /2 of 3/, 'the reply says exactly how far along they are');
  assert.match(out.reply.body, /Still open/);
  // no nagging, no condemnation (tutorial/README.md)
  assert.doesNotMatch(out.reply.body, /you failed|you must|you should have|why haven|disappoint/i);
});

test('shortfall / progressFor measure the real gap from public activity only', () => {
  const stage = { completion_criteria: { kind: 'comments_authored', min_count: 3, min_distinct_parent_authors: 3, min_body_chars_each: 80, exclude_self_authored_parents: true } };
  const activity = { comments: [{ author: 'a', parent_author: 'b', body: 'z'.repeat(90) }] };
  const have = progressFor(stage, activity);
  assert.equal(have.min_count, 1);
  assert.equal(have.min_distinct_parent_authors, 1);

  const { unmet } = shortfall(stage, activity);
  assert.equal(unmet.find((u) => u.criterion === 'min_count').have, 1);
  assert.equal(unmet.find((u) => u.criterion === 'min_count').need, 3);
});

test('criterionClause is generated from criteria data, including unknown keys', () => {
  assert.match(criterionClause('min_count', 3, 1), /1 of 3/);
  assert.match(criterionClause('min_amount_melek', '1.000', 0), /at least 1\.000 MELEK/);
  assert.match(criterionClause('tag_any_of', ['introduceyourself'], false), /introduceyourself/);
  // a criteria key nobody wrote prose for still produces a usable clause
  assert.match(criterionClause('some_future_threshold', 7, undefined), /some future threshold: 7/);
  assert.equal(criterionClause('kind', 'post_authored', undefined), null);
});

// ---- infra-gated stages are not failures ------------------------------------

test('a stage with no chain-reader detector reports not_checkable, not failure', async () => {
  const done = {};
  for (const k of ['intro_post', 'engage_three_posts', 'share_what_you_know', 'first_organic_upvote', 'power_up', 'vote_for_a_witness', 'set_profile', 'follow_three_authors', 'send_first_transfer', 'delegate_some_mp']) {
    done[k] = {};
  }
  const state = fakeState({ alice: done }); // current stage: join_a_community (Tier B, infra-gated)
  const out = await handleComment(call(), baseDeps({ state }));
  assert.equal(out.stageKey, 'join_a_community');
  assert.equal(out.kind, 'not_checkable');
  assert.equal(out.ops[0][0], 'comment');
  assert.doesNotMatch(out.reply.body, /you failed/i);
});

// ---- rate limiting: a taught boundary, not silence and not spam -------------

test('rateLimitConfig reads the stages.json rate_limit_education block', () => {
  const cfg = rateLimitConfig();
  assert.ok(cfg.maxCalls >= 1);
  assert.ok(cfg.windowMs > 0);
  assert.match(cfg.style, /limit/i, 'the block carries the educational disposition');
  // tunable in JSON without a redeploy
  const tuned = rateLimitConfig({ stages: [], rate_limit_education: { max_calls_per_window: 2, window_minutes: 5 } });
  assert.equal(tuned.maxCalls, 2);
  assert.equal(tuned.windowMs, 5 * 60 * 1000);
});

test('the limiter teaches once past the limit, then goes quiet, then resets', () => {
  let t = 0;
  const limiter = createCallLimiter({ maxCalls: 2, windowMs: 1000, now: () => t });
  assert.deepEqual([limiter.check('a').limited, limiter.check('a').limited], [false, false]);
  const third = limiter.check('a');
  assert.equal(third.limited, true);
  assert.equal(third.teach, true, 'the boundary is taught');
  const fourth = limiter.check('a');
  assert.equal(fourth.limited, true);
  assert.equal(fourth.teach, false, 'and not taught again — no spam');
  // a different account is unaffected
  assert.equal(limiter.check('b').limited, false);
  // the window regenerates
  t = 5000;
  assert.equal(limiter.check('a').limited, false);
});

test('over-limit calls get one educational reply, then no ops at all', async () => {
  let t = 0;
  const limiter = createCallLimiter({ maxCalls: 1, windowMs: 10_000, now: () => t });
  const deps = baseDeps({ limiter, state: fakeState(), fetchUserActivity: async () => introDone('alice') });

  const first = await handleComment(call({ permlink: 'c1' }), deps);
  assert.equal(first.kind, 'pass');

  const second = await handleComment(call({ permlink: 'c2' }), deps);
  assert.equal(second.kind, 'rate_limited');
  assert.ok(second.ops && second.ops.length === 1, 'the boundary is taught once, on chain');
  assert.match(second.reply.body, /regenerat/i, 'framed as a feature that refills, not a punishment');
  assert.doesNotMatch(second.reply.body, /stop|spam|annoy|blocked|banned/i);

  const third = await handleComment(call({ permlink: 'c3' }), deps);
  assert.equal(third.kind, 'rate_limited');
  assert.equal(third.ops, null, 'silence after the lesson — she does not spam back');
  assert.equal(third.reply, null);
});

// ---- voice: disposition, not script -----------------------------------------

test('reply bodies are marked as the Phase-2 deterministic template', async () => {
  const out = await handleComment(call(), baseDeps({ state: fakeState({ alice: { intro_post: {} } }) }));
  assert.equal(out.template, PHASE2_TEMPLATE);
});

test('an injected Phase-3 composer replaces every reply body', async () => {
  const seen = [];
  const composeText = (ctx) => { seen.push(ctx.kind); return `angelic:${ctx.kind}:${ctx.stageKey ?? ''}`; };
  const out = await handleComment(call(), baseDeps({ composeText, state: fakeState({ alice: { intro_post: {} } }) }));
  assert.equal(out.template, 'injected');
  assert.equal(out.reply.body, 'angelic:fail:engage_three_posts');
  assert.deepEqual(seen, ['fail']);
});

test('a throwing Phase-3 composer degrades to the deterministic floor', async () => {
  const composeText = () => { throw new Error('llm down'); };
  const out = await handleComment(call(), baseDeps({ composeText, state: fakeState({ alice: { intro_post: {} } }) }));
  assert.equal(out.ok, true);
  assert.equal(out.template, PHASE2_TEMPLATE);
  assert.ok(out.reply.body.length > 0);
});

test('no fixed greeting is emitted — replies differ by stage and outcome', async () => {
  const failOut = await handleComment(call(), baseDeps({ state: fakeState({ alice: { intro_post: {} } }) }));
  const ambiguousOut = await handleComment(call(), baseDeps({ state: undefined }));
  assert.notEqual(failOut.reply.body, ambiguousOut.reply.body);
  for (const body of [failOut.reply.body, ambiguousOut.reply.body]) {
    assert.doesNotMatch(body, /^(ah,|indeed,|greetings|hello, my dear)/i, 'no scripted opener');
  }
});

// ---- soft-fail-never-throw --------------------------------------------------

test('a throwing chain reader returns an error outcome instead of throwing', async () => {
  const out = await handleComment(call(), baseDeps({
    state: fakeState(),
    fetchUserActivity: async () => { throw new Error('rpc exploded'); },
  }));
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'error');
  assert.match(out.error, /rpc exploded/);
});

test('a throwing detector returns an error outcome instead of throwing', async () => {
  const out = await handleComment(call(), baseDeps({
    state: fakeState(),
    detector: { detectCompletedStages: () => { throw new Error('detector broke'); } },
  }));
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'error');
  assert.match(out.error, /detector broke/);
});

test('a failed reward composition does not throw and does not advance state', async () => {
  const state = fakeState();
  const out = await handleComment(call(), baseDeps({
    state,
    fetchUserActivity: async () => introDone('alice'),
    detector: fakeDetector({ intro_post: { complete: true, evidence: null } }),
    composeReward: () => ({ ok: false, error: 'nope' }),
  }));
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'error');
  assert.equal(state.hasResponded('alice', 'intro_post'), false);
});

test('garbage input is ignored rather than fatal', async () => {
  for (const bad of [null, undefined, 42, 'a string', {}, ['vote', {}]]) {
    const out = await handleComment(bad, baseDeps());
    assert.equal(out.ok, true);
    assert.equal(out.kind, 'ignored');
  }
});

test('the chain reader defaults to tutorial/chain-reader.mjs and is always overridable', async () => {
  // The production default is the sibling reader — resolved lazily, never a
  // live client imported at module load.
  const chainReader = await import('./chain-reader.mjs');
  assert.equal(await resolveActivityReader({}), chainReader.fetchUserActivity);

  // An injected reader always wins, which is what keeps these tests offline.
  const injected = async () => EMPTY_ACTIVITY;
  assert.equal(await resolveActivityReader({ fetchUserActivity: injected }), injected);
});

// ---- interpolation safety ---------------------------------------------------

test('esc neutralizes markup and control characters in interpolated values', () => {
  assert.equal(esc('<script>&x'), '&lt;script&gt;&amp;x');
  assert.equal(esc('a b'), 'ab');
  assert.equal(esc(null), '');
});

test('a hostile account name cannot smuggle markup into a reply', async () => {
  const out = await handleComment(
    call({ author: '<img src=x>', body: '@hathor check' }),
    baseDeps({ state: fakeState({ '<img src=x>': { intro_post: {} } }) }),
  );
  assert.doesNotMatch(out.reply.body, /<img/);
  assert.match(out.reply.body, /&lt;img/);
});

test('buildReplyOp produces a Graphene-legal permlink', () => {
  const [, payload] = buildReplyOp({ author: 'Alice_1', permlink: 'My--Post!' }, 'body', { suffix: 'intro_post-reward' });
  assert.match(payload.permlink, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(payload.permlink.length <= 200);
  assert.equal(payload.author, WITNESS_ACCOUNT);
});

// ---- boundary invariants (asserted against the source, not just behavior) ----

test('the module imports no signer, no RPC client, and no key material', () => {
  const src = readFileSync(path.join(__dirname, 'call.mjs'), 'utf8');
  const imports = [...src.matchAll(/^import .*?from '([^']+)';/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(spec.startsWith('.') || spec.startsWith('node:'), `unexpected dependency: ${spec}`);
  }
  for (const forbidden of ['dhive', 'hivesigner', 'melek-signer-client', 'jit-signer', 'BOT_POSTING_KEY', 'BOT_ACTIVE_KEY', 'sendOperations', 'privateKey', 'wif']) {
    assert.equal(src.includes(forbidden), false, `call.mjs must not reference ${forbidden}`);
  }
});

test('the module never asks the user for personal information', async () => {
  const bodies = [];
  const state = fakeState({ alice: { intro_post: {} } });
  bodies.push((await handleComment(call(), baseDeps({ state }))).reply.body);
  bodies.push((await handleComment(call(), baseDeps({ state: undefined }))).reply.body);
  for (const body of bodies) {
    assert.doesNotMatch(body, /\b(email|e-mail|phone|address|real name|date of birth|password|private key|posting key|seed phrase)\b/i);
  }
});
