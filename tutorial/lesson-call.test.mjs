// lesson-call.test.mjs — OFFLINE. handleLessonComment(): the Instructional Series loop end to end with
// injected registry, chain activity, state, brain and limiter. No network, no signer, no model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './instructional.mjs';
import { handleLessonComment, composeLessonReply, createCallLimiter } from './call.mjs';
import { TutorialState } from './state.js';

const reg = loadRegistry({ dir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'instructional') });
const L = (id) => reg.byId(id);
const freshState = () => new TutorialState({ path: path.join(mkdtempSync(path.join(os.tmpdir(), 'lesson-')), 'p.json') });
const NOW = Date.parse('2026-09-26T12:00:00Z');

const intro = { author: 'alice', permlink: 'hello-melek', title: 'Hello MELEK', body: 'x'.repeat(260), tags: ['introduceyourself'], created: '2026-09-25T10:00:00Z' };
const activity = (o = {}) => ({ account: 'alice', account_exists: true, posts: [], comments: [], votes_received: [], meta: { ok: true, errors: [] }, ...o });
const on = (lessonId, body, extra = {}) => ({ author: 'alice', permlink: `c-${Math.random().toString(36).slice(2, 8)}`, parent_author: 'hathor', parent_permlink: L(lessonId).permlink, body, ...extra });

function deps(o = {}) {
  const state = o.state || freshState();
  for (const id of o.done || []) state.recordLesson('alice', id, {});
  return { registry: reg, state, fetchUserActivity: async () => o.activity || activity(), now: () => NOW, strictOrder: o.strict ?? true, ...o.extra };
}
const bodyOf = (out) => (out.ops || []).find((x) => x[0] === 'comment')?.[1].body || '';
const voteOf = (out) => (out.ops || []).find((x) => x[0] === 'vote')?.[1] || null;

test('PASS on a claim: upvote the qualifying post + reply that congratulates and links the next lesson', async () => {
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [intro] }) });
  const out = await handleLessonComment(on('how-to-post', 'done! check me'), d);
  assert.equal(out.kind, 'pass');
  assert.equal(out.intent, 'claim');
  assert.deepEqual(voteOf(out), { voter: 'hathor', author: 'alice', permlink: 'hello-melek', weight: 5000 });
  assert.match(bodyOf(out), /Hello MELEK/);
  assert.match(bodyOf(out), /\[Lesson 3: Your First Image\]\(https:\/\/melek\.salon\/@hathor\/fixture-guide-03-first-image\)/);
  assert.equal(out.ops[0][0], 'vote');
  // progress only advances after the caller's signer succeeds
  assert.equal(d.state.hasLesson('alice', 'how-to-post'), false);
  assert.equal(await out.commit({ txId: 'abc' }), true);
  assert.equal(d.state.hasLesson('alice', 'how-to-post'), true);
});

test('AUTO-CHECK on every comment: a question on a finished lesson still passes, and the FAQ answer rides along', async () => {
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [intro] }) });
  const out = await handleLessonComment(on('how-to-post', 'how can I add a photo to my post?'), d);
  assert.equal(out.kind, 'pass');
  assert.equal(out.intent, 'question');
  assert.equal(out.answerVia, 'faq');
  assert.match(bodyOf(out), /Drag the photo into the editor/);
  assert.match(bodyOf(out), /Lesson 3/);
});

test('the upvote falls back to their comment when the post is past the vote window or already voted', async () => {
  const old = { ...intro, created: '2026-09-01T00:00:00Z' };
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [old] }) });
  const c = on('how-to-post', 'finished');
  const out = await handleLessonComment(c, d);
  assert.equal(voteOf(out).permlink, c.permlink);
  assert.match(bodyOf(out), /upvoted this comment|This comment carries my upvote|my upvote is on this comment/);

  const d2 = deps({ done: ['sign-up'], activity: activity({ posts: [intro], votes_received: [{ voter: 'hathor', permlink: 'hello-melek', weight: 3000 }] }) });
  const c2 = on('how-to-post', 'finished');
  assert.equal(voteOf(await handleLessonComment(c2, d2)).permlink, c2.permlink);
});

test('FAIL + claim names exactly what is missing, the task, and how she checks', async () => {
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [{ ...intro, tags: ['life'] }] }) });
  const out = await handleLessonComment(on('how-to-post', 'I did it, please check'), d);
  assert.equal(out.kind, 'fail');
  assert.match(bodyOf(out), /Still missing:\n- a post tagged #introduceyourself or #introduction/);
  assert.match(bodyOf(out), /The task: write a short hello/);
  assert.match(bodyOf(out), /How I check:/);
  assert.equal(voteOf(out), null);
});

test('FAIL + question: just the answer, the check is not mentioned', async () => {
  const d = deps({ done: ['sign-up'] });
  const out = await handleLessonComment(on('how-to-post', 'which tags should I use?'), d);
  assert.equal(out.kind, 'answer');
  assert.match(bodyOf(out), /introduceyourself first/);
  assert.doesNotMatch(bodyOf(out), /missing|not finished/i);
});

test('FAIL + other: nothing is said (no nagging)', async () => {
  const out = await handleLessonComment(on('how-to-post', 'nice lesson'), deps({ done: ['sign-up'] }));
  assert.equal(out.kind, 'checked_not_done');
  assert.equal(out.ops, null);
});

test('unanswerable question with the brain off: no reply, queued for the operator', async () => {
  const d = deps({ done: ['sign-up'] });
  const out = await handleLessonComment(on('how-to-post', 'what is the MELEK price today?'), d);
  assert.equal(out.ops, null);
  assert.equal(d.state.reviews()[0].kind, 'unanswered_question');
});

test('STRICT_ORDER: a claim on lesson 3 with lesson 2 unfinished points at lesson 2; nothing is checked', async () => {
  let reads = 0;
  const d = deps({ done: ['sign-up'], extra: { fetchUserActivity: async () => { reads++; return activity(); } } });
  const out = await handleLessonComment(on('first-image', 'terminé'), d);
  assert.equal(out.kind, 'out_of_order');
  assert.equal(out.firstUnfinishedId, 'how-to-post');
  assert.match(bodyOf(out), /Lesson 2: How to Post/);
  assert.equal(reads, 0);
  // With strict order off, the same comment is checked.
  const d2 = deps({ done: ['sign-up'], strict: false });
  assert.equal((await handleLessonComment(on('first-image', 'terminé'), d2)).kind, 'fail');
});

test('never rewards the same lesson twice', async () => {
  const d = deps({ done: ['sign-up', 'how-to-post'], activity: activity({ posts: [intro] }) });
  const out = await handleLessonComment(on('how-to-post', 'done again!'), d);
  assert.equal(out.kind, 'already_done');
  assert.equal(voteOf(out), null);
  assert.match(bodyOf(out), /already/);
});

test('manual_review + claim is queued for the operator — never a fail', async () => {
  const d = deps({ done: ['sign-up', 'how-to-post', 'first-image'] });
  const out = await handleLessonComment(on('signer-login', 'done, I logged into the Studio'), d);
  assert.equal(out.kind, 'queued');
  assert.equal(voteOf(out), null);
  assert.equal(d.state.reviews()[0].kind, 'manual_review');
});

test('account_exists passes for any commenter on lesson 1 (her signature is the proof)', async () => {
  const out = await handleLessonComment(on('sign-up', 'hello'), deps());
  assert.equal(out.kind, 'pass');
  assert.equal(voteOf(out).permlink, out.reply.parent_permlink);
});

test('@hathor mention outside the lessons: the lesson is worked out from the text, or from progress', async () => {
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [intro] }) });
  const named = await handleLessonComment({ author: 'alice', permlink: 'm1', parent_author: 'bob', parent_permlink: 'x', body: '@hathor I finished lesson 2' }, d);
  assert.equal(named.lessonId, 'how-to-post');
  assert.equal(named.lessonSource, 'named');
  assert.equal(named.kind, 'pass');
  const d2 = deps({ done: ['sign-up'], activity: activity({ posts: [intro] }) });
  const prog = await handleLessonComment({ author: 'alice', permlink: 'm2', parent_author: '', parent_permlink: 'life', body: 'done @hathor' }, d2);
  assert.equal(prog.lessonId, 'how-to-post');
  assert.equal(prog.lessonSource, 'progress');
});

test('a reply deeper in a lesson thread is resolved to its lesson via the root', async () => {
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [intro] }), extra: {
    resolveRoot: async () => ({ root_author: 'hathor', root_permlink: L('how-to-post').permlink }),
  } });
  const out = await handleLessonComment({ author: 'alice', permlink: 'deep', parent_author: 'hathor', parent_permlink: 're-alice-xyz', body: 'ok done now' }, d);
  assert.equal(out.trigger, 'thread');
  assert.equal(out.kind, 'pass');
});

test('ignored: her own comments, and comments not addressed to her', async () => {
  assert.equal((await handleLessonComment({ ...on('how-to-post', 'x'), author: 'hathor' }, deps())).kind, 'ignored');
  assert.equal((await handleLessonComment({ author: 'alice', permlink: 'p', parent_author: 'bob', parent_permlink: 'q', body: 'hi' }, deps())).kind, 'ignored');
});

test('Bengali claim with the brain OFF: understood as a claim, the reply stays in English (deterministic bot)', async () => {
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [{ ...intro, tags: ['life'] }] }) });
  const out = await handleLessonComment(on('how-to-post', 'আমি পাঠটি শেষ করেছি, চেক করুন'), d);
  assert.equal(out.intent, 'claim');
  assert.equal(out.lang, 'bn');
  assert.equal(out.kind, 'fail');
  assert.equal(out.replyLang, 'en');
});

test('reply language: with a brain, a Bengali claim gets a Bengali reply with links and names intact', async () => {
  const brain = {
    classify: async () => ({ intent: 'claim', lang: 'bn', english: 'I finished the lesson, check it', lessonNumber: null, via: 'brain' }),
    voice: async () => null,
    translate: async (text, lang) => {
      assert.equal(lang, 'bn');
      const links = text.match(/\[[^\]]+\]\([^)]+\)|@\w+/g) || [];
      return `পাঠ সম্পূর্ণ হয়েছে। ${links.join(' ')}`;
    },
    answer: async () => null,
  };
  const d = deps({ done: ['sign-up'], activity: activity({ posts: [intro] }), extra: { brain } });
  const out = await handleLessonComment(on('how-to-post', 'আমি পাঠটি শেষ করেছি'), d);
  assert.equal(out.kind, 'pass');
  assert.equal(out.replyLang, 'bn');
  assert.match(bodyOf(out), /পাঠ সম্পূর্ণ/);
  assert.match(bodyOf(out), /https:\/\/melek\.salon\/@hathor\/fixture-guide-03-first-image/);
});

test('Spanish question with a brain: FAQ matched on the English gloss, answer translated', async () => {
  const brain = {
    classify: async () => ({ intent: 'question', lang: 'es', english: 'How do I add a photo to my post?', via: 'brain' }),
    translate: async (t) => `ES: ${t}`,
    answer: async () => { throw new Error('should not be called when the FAQ matches'); },
    voice: async () => null,
  };
  const out = await handleLessonComment(on('how-to-post', '¿Cómo pongo una foto en mi post?'), deps({ done: ['sign-up'], extra: { brain } }));
  assert.equal(out.kind, 'answer');
  assert.equal(out.answerVia, 'faq');
  assert.match(bodyOf(out), /^ES: @alice Drag the photo/);
});

test('brain answers only what the FAQ does not cover, with the lesson context in hand', async () => {
  let seen = null;
  const brain = {
    classify: async () => ({ intent: 'question', lang: 'en', english: 'Can I schedule a post for later?', via: 'brain' }),
    answer: async (a) => { seen = a; return 'Not yet: posts publish when you press Publish.'; },
    translate: async (t) => t, voice: async () => null,
  };
  const out = await handleLessonComment(on('how-to-post', 'Can I schedule a post for later?'), deps({ done: ['sign-up'], extra: { brain, siteMap: '- Studio tool **Scheduler** — https://x/y — schedule posts later' } }));
  assert.equal(out.answerVia, 'brain');
  assert.match(seen.context, /LESSON 2: Fixture Guide, Part 02/);
  assert.match(seen.siteMap, /Scheduler/);
});

test('rate limit: the first call past the limit teaches the boundary once, then quiet', async () => {
  const limiter = createCallLimiter({ maxCalls: 1, windowMs: 60_000, now: () => 0 });
  const d = deps({ done: ['sign-up'], extra: { limiter } });
  await handleLessonComment(on('how-to-post', 'nice'), d);
  const taught = await handleLessonComment(on('how-to-post', 'nice'), d);
  assert.equal(taught.kind, 'rate_limited');
  assert.equal(taught.ops.length, 1);
  const quiet = await handleLessonComment(on('how-to-post', 'nice'), d);
  assert.equal(quiet.kind, 'rate_limited');
  assert.equal(quiet.ops, null);
});

test('a failed chain read is an error, never a "not done" reply', async () => {
  const d = deps({ done: ['sign-up'], activity: { posts: [], meta: { ok: false, errors: ['get_accounts: timeout'] } } });
  const out = await handleLessonComment(on('how-to-post', 'done'), d);
  assert.equal(out.kind, 'error');
  assert.equal(out.ops, null);
});

test('replies vary with the data, are esc()d, and are never one fixed string', () => {
  const lesson = L('how-to-post');
  const bodies = new Set(['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((a) => composeLessonReply('pass', { account: a, lesson, next: L('first-image'), evidence: intro }).replace(/@\w+/, '@x')));
  assert.ok(bodies.size >= 2);
  const hostile = composeLessonReply('pass', { account: 'alice', lesson, evidence: { ...intro, title: '<script>x</script>' } });
  assert.doesNotMatch(hostile, /<script>/);
  assert.match(composeLessonReply('pass', { account: 'a', lesson, next: null, evidence: intro }), /last lesson/);
});

test('soft-fail: no registry or a junk op never throws', async () => {
  assert.equal((await handleLessonComment({ author: 'a' }, {})).kind, 'error');
  assert.equal((await handleLessonComment(null, deps())).kind, 'ignored');
});
