// reviewQueue.test.js — tests for the Ashurbanipal review queue (Task #71-library).
//
// Drafts await operator APPROVAL before publish; nothing auto-publishes. These tests run fully
// offline against an in-memory fs and a frozen clock (no real disk, no network, no LLM).
//
// Core guard asserted here: a PENDING draft can NOT be published — only an APPROVED draft can.
//
// Run: node --test test/reviewQueue.test.js   (node:test + node:assert/strict, no new deps)

import test from 'node:test';
import assert from 'node:assert/strict';

import ReviewQueue, { STATUSES } from '../src/reviewQueue.js';

// ── in-memory fs (injectable) ─────────────────────────────────────────────────────────────────
function memFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) {
        const e = new Error(`ENOENT: ${p}`);
        e.code = 'ENOENT';
        throw e;
      }
      return files.get(p);
    },
    writeFileSync: (p, data) => { files.set(p, String(data)); },
    mkdirSync: () => {}, // no-op; in-memory has no dirs
  };
}

// A frozen clock returning a fixed ISO timestamp, plus a deterministic id factory.
function fixedQueue(extra = {}) {
  const fs = memFs(extra.initial);
  let n = 0;
  return new ReviewQueue({
    fs,
    path: { dirname: () => 'data' },
    now: () => new Date('2026-06-03T12:00:00.000Z'),
    idFactory: () => `id-${++n}`,
    storePath: 'data/review-queue.jsonl',
    ...extra,
  });
}

// ── enqueueDraft → status pending ────────────────────────────────────────────────────────────
test('enqueueDraft adds a draft with status pending + an id, returns it', () => {
  const q = fixedQueue();
  const draft = q.enqueueDraft({
    title: 'Kyphi',
    body: 'Sacred Egyptian incense.',
    sources: ['phoenician/kyphi.md'],
    articleId: 'Kyphi',
  });
  assert.equal(draft.status, 'pending');
  assert.equal(draft.id, 'id-1');
  assert.equal(draft.title, 'Kyphi');
  assert.equal(draft.articleId, 'Kyphi');
  assert.deepEqual(draft.sources, ['phoenician/kyphi.md']);
  assert.equal(draft.enqueuedAt, '2026-06-03T12:00:00.000Z');
  assert.equal(draft.reviewer, null);
  assert.equal(draft.publishedAt, null);
  // It's actually in the queue.
  assert.equal(q.get('id-1').status, 'pending');
});

// ── listQueue filters by status ──────────────────────────────────────────────────────────────
test('listQueue filters by status and returns all when status omitted', () => {
  const q = fixedQueue();
  const a = q.enqueueDraft({ title: 'A' });
  const b = q.enqueueDraft({ title: 'B' });
  q.enqueueDraft({ title: 'C' });
  q.approve(b.id, { reviewer: 'operator' });

  assert.equal(q.listQueue().length, 3);
  assert.deepEqual(q.listQueue({ status: 'pending' }).map((r) => r.title).sort(), ['A', 'C']);
  assert.deepEqual(q.listQueue({ status: 'approved' }).map((r) => r.title), ['B']);
  assert.deepEqual(q.listQueue({ status: 'rejected' }), []);
  assert.ok(STATUSES.includes('published'));
});

// ── approve moves to approved + records reviewer/when/note ──────────────────────────────────
test('approve moves a pending draft to approved and records reviewer + when + note', () => {
  const q = fixedQueue();
  const d = q.enqueueDraft({ title: 'Egregore' });
  const res = q.approve(d.id, { reviewer: 'operator', note: 'verified sources' });
  assert.equal(res.ok, true);
  assert.equal(res.record.status, 'approved');
  assert.equal(res.record.reviewer, 'operator');
  assert.equal(res.record.note, 'verified sources');
  assert.equal(res.record.reviewedAt, '2026-06-03T12:00:00.000Z');
});

// ── reject moves to rejected ────────────────────────────────────────────────────────────────
test('reject moves a pending draft to rejected and records the reviewer', () => {
  const q = fixedQueue();
  const d = q.enqueueDraft({ title: 'Bad Draft' });
  const res = q.reject(d.id, { reviewer: 'operator', note: 'hallucinated claim' });
  assert.equal(res.ok, true);
  assert.equal(res.record.status, 'rejected');
  assert.equal(res.record.reviewer, 'operator');
  assert.equal(res.record.note, 'hallucinated claim');
  assert.deepEqual(q.listQueue({ status: 'rejected' }).map((r) => r.title), ['Bad Draft']);
});

// ── CORE GUARD: markPublished succeeds ONLY after approve, FAILS on a pending draft ─────────────
test('markPublished SUCCEEDS only after approve', () => {
  const q = fixedQueue();
  const d = q.enqueueDraft({ title: 'Heterosis' });
  assert.equal(q.approve(d.id, { reviewer: 'operator' }).ok, true);
  const pub = q.markPublished(d.id);
  assert.equal(pub.ok, true);
  assert.equal(pub.record.status, 'published');
  assert.equal(pub.record.publishedAt, '2026-06-03T12:00:00.000Z');
});

test('markPublished FAILS on a PENDING draft (the core no-auto-publish guard)', () => {
  const q = fixedQueue();
  const d = q.enqueueDraft({ title: 'Unapproved' });
  // Still pending — must NOT publish.
  const pub = q.markPublished(d.id);
  assert.equal(pub.ok, false);
  assert.match(pub.error, /not 'approved'|approval required/);
  // Status unchanged — it stays pending, never silently published.
  assert.equal(q.get(d.id).status, 'pending');
  assert.equal(q.get(d.id).publishedAt, null);
});

test('markPublished FAILS on a REJECTED draft (rejected is terminal)', () => {
  const q = fixedQueue();
  const d = q.enqueueDraft({ title: 'Rejected One' });
  q.reject(d.id, { reviewer: 'operator' });
  const pub = q.markPublished(d.id);
  assert.equal(pub.ok, false);
  assert.equal(q.get(d.id).status, 'rejected');
});

test('NO auto-approve path: the only way out of pending is an explicit approve/reject call', () => {
  const q = fixedQueue();
  q.enqueueDraft({ title: 'X' });
  q.enqueueDraft({ title: 'Y' });
  // Without any approve/reject call, everything is still pending and nothing is approved/published.
  const stats = q.queueStats();
  assert.equal(stats.pending, 2);
  assert.equal(stats.approved, 0);
  assert.equal(stats.published, 0);
  // And publishing any of them is refused.
  for (const r of q.listQueue({ status: 'pending' })) {
    assert.equal(q.markPublished(r.id).ok, false);
  }
});

// ── approve is rejected on a non-pending draft (can't re-approve a published one) ─────────────
test('approve refuses a draft that is not pending/approved-transitionable to published-then-approve', () => {
  const q = fixedQueue();
  const d = q.enqueueDraft({ title: 'Z' });
  q.approve(d.id, { reviewer: 'op' });
  q.markPublished(d.id);
  // published is terminal — re-approving is refused.
  const res = q.approve(d.id, { reviewer: 'op' });
  assert.equal(res.ok, false);
  assert.equal(q.get(d.id).status, 'published');
});

// ── pendingCount / queueStats ──────────────────────────────────────────────────────────────────
test('pendingCount and queueStats count by status', () => {
  const q = fixedQueue();
  const a = q.enqueueDraft({ title: 'A' });
  const b = q.enqueueDraft({ title: 'B' });
  const c = q.enqueueDraft({ title: 'C' });
  q.enqueueDraft({ title: 'D' });
  q.approve(a.id, { reviewer: 'op' });
  q.approve(b.id, { reviewer: 'op' });
  q.markPublished(b.id);
  q.reject(c.id, { reviewer: 'op' });
  // D left pending.

  assert.equal(q.pendingCount(), 1);
  const stats = q.queueStats();
  assert.deepEqual(stats, { pending: 1, approved: 1, rejected: 1, published: 1, total: 4 });
});

// ── persistence + soft-fail on read ────────────────────────────────────────────────────────────
test('persists as JSONL and a fresh queue over the same fs reloads the records', () => {
  const fs = memFs();
  let n = 0;
  const opts = {
    fs,
    path: { dirname: () => 'data' },
    now: () => new Date('2026-06-03T12:00:00.000Z'),
    idFactory: () => `id-${++n}`,
    storePath: 'data/review-queue.jsonl',
  };
  const q1 = new ReviewQueue(opts);
  const d = q1.enqueueDraft({ title: 'Persisted' });
  q1.approve(d.id, { reviewer: 'operator' });

  // Stored as JSONL (one JSON object per line).
  const raw = fs.files.get('data/review-queue.jsonl');
  assert.ok(raw.includes('"status":"approved"'));
  for (const line of raw.split('\n').filter(Boolean)) JSON.parse(line); // each line is valid JSON

  // A new queue instance reading the same fs sees the approved record.
  let m = 0;
  const q2 = new ReviewQueue({ ...opts, idFactory: () => `x-${++m}` });
  assert.equal(q2.get(d.id).status, 'approved');
  assert.equal(q2.queueStats().approved, 1);
});

test('soft-fails to an empty queue when the store is missing or corrupt (never throws)', () => {
  // Missing file.
  const q1 = fixedQueue();
  assert.equal(q1.listQueue().length, 0);

  // Corrupt content → ignored line(s), no throw; valid lines still load.
  const corrupt = ['{ not json', '{"id":"ok-1","status":"pending","title":"Good"}', ''].join('\n');
  let built;
  assert.doesNotThrow(() => {
    built = new ReviewQueue({
      fs: memFs({ 'data/review-queue.jsonl': corrupt }),
      path: { dirname: () => 'data' },
      storePath: 'data/review-queue.jsonl',
    });
  });
  assert.equal(built.get('ok-1').title, 'Good');
  assert.equal(built.listQueue().length, 1);
});
