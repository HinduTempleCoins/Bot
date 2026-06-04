import { test } from 'node:test';
import assert from 'node:assert';
import {
  BUCKETS, HALLUCINATION_SUBFLAG_REPO, briefLines,
  classifyItem, scoreBrief, createScorecardStore, recordScorecard, rollup, renderScorecard,
} from './brief-scorecard.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
const ITEM_DONE = 'Wire the Discord news feed into the !sb command';
const ITEM_UNDONE = 'Refactor the watcher to use the new sink interface';
const ITEM_IGNORED = 'Translate the whole site into Esperanto for nobody in particular';
const ITEM_REPO = 'The repo has a src/quantum directory ready to extend';

const CTX = {
  confirmedItems: [{ text: ITEM_DONE }, { text: ITEM_UNDONE }],
  doneItems: [{ text: ITEM_DONE }],
  repoFlags: [{ text: 'There is a src quantum directory in the repo to extend' }],
};

// ── BUCKETS / constants ──────────────────────────────────────────────────────────────────────────────
test('BUCKETS exposes the five categories + repo-structure sub-flag', () => {
  assert.deepEqual(
    Object.values(BUCKETS).sort(),
    ['completed', 'hallucination', 'ignored', 'left-undone', 'unrelated'].sort(),
  );
  assert.equal(HALLUCINATION_SUBFLAG_REPO, 'repo-structure-mistake');
});

// ── classifyItem ──────────────────────────────────────────────────────────────────────────────────────
test('classifyItem: a done line → completed (✓)', () => {
  const r = classifyItem(ITEM_DONE, CTX);
  assert.equal(r.bucket, BUCKETS.COMPLETED);
  assert.equal(r.mark, '✓');
});

test('classifyItem: a confirmed-not-done line → left-undone (✗)', () => {
  const r = classifyItem(ITEM_UNDONE, CTX);
  assert.equal(r.bucket, BUCKETS.LEFT_UNDONE);
  assert.equal(r.mark, '✗');
});

test('classifyItem: an unreferenced line → ignored (✗)', () => {
  const r = classifyItem(ITEM_IGNORED, CTX);
  assert.equal(r.bucket, BUCKETS.IGNORED);
  assert.equal(r.mark, '✗');
});

test('classifyItem: a diagnostics-flagged repo claim → hallucination + repo-structure-mistake subflag', () => {
  const r = classifyItem(ITEM_REPO, CTX);
  assert.equal(r.bucket, BUCKETS.HALLUCINATION);
  assert.equal(r.subflag, HALLUCINATION_SUBFLAG_REPO);
  assert.equal(r.mark, '✗');
});

test('classifyItem: an explicitly-unrelated line → unrelated (~)', () => {
  const r = classifyItem('Some off-topic aside about the weather today', {
    ...CTX, unrelated: [{ text: 'an off topic aside about the weather today' }],
  });
  assert.equal(r.bucket, BUCKETS.UNRELATED);
  assert.equal(r.mark, '~');
});

test('classifyItem: repo-flag takes priority even if it would otherwise look done', () => {
  // same text in both done and repoFlags → hallucination wins (priority order).
  const r = classifyItem(ITEM_REPO, { doneItems: [{ text: ITEM_REPO }], repoFlags: [{ text: ITEM_REPO }] });
  assert.equal(r.bucket, BUCKETS.HALLUCINATION);
});

// ── briefLines ────────────────────────────────────────────────────────────────────────────────────────
test('briefLines pulls action lines from markdown and ignores fenced code + prose', () => {
  const md = [
    '# Heading prose that is not an item',
    'plain prose paragraph, not a bullet',
    '- [ ] do the first thing',
    '- do the second thing',
    '```',
    '- this is inside a code fence and must be skipped',
    '```',
    '1. do the third thing',
  ].join('\n');
  const lines = briefLines(md);
  assert.equal(lines.length, 3);
  assert.ok(lines.some((l) => /first thing/.test(l)));
  assert.ok(!lines.some((l) => /code fence/.test(l)));
});

test('briefLines accepts arrays and {items} objects', () => {
  assert.deepEqual(briefLines(['a', '', 'b']), ['a', 'b']);
  assert.deepEqual(briefLines({ items: [{ text: 'x' }, 'y'] }), ['x', 'y']);
});

// ── scoreBrief: completedPct + bucket classification ─────────────────────────────────────────────────
test('scoreBrief computes completedPct from done/confirmed and classifies each line', async () => {
  const brief = [ITEM_DONE, ITEM_UNDONE, ITEM_IGNORED, ITEM_REPO];
  const card = await scoreBrief(brief, CTX);

  // % completed = doneItems(1) / confirmedItems(2) = 50%
  assert.equal(card.completedPct, 50);
  assert.equal(card.total, 4);

  assert.equal(card.buckets.completed, 1);
  assert.equal(card.buckets.leftUndone, 1);
  assert.equal(card.buckets.ignored, 1);
  assert.equal(card.buckets.hallucination, 1);
  assert.equal(card.buckets.unrelated, 0);

  // one item per line, each carrying a mark
  assert.equal(card.items.length, 4);
  for (const it of card.items) assert.ok(['✓', '✗', '~'].includes(it.mark));
});

test('scoreBrief falls back to completed-lines/total when no confirmed count given', async () => {
  const brief = [ITEM_DONE, ITEM_IGNORED]; // 1 completed of 2 lines = 50%
  const card = await scoreBrief(brief, { doneItems: [{ text: ITEM_DONE }] });
  assert.equal(card.completedPct, 50);
});

test('scoreBrief soft-fails on empty/garbage input (no throw, zeroed)', async () => {
  const card = await scoreBrief(null, {});
  assert.equal(card.total, 0);
  assert.equal(card.completedPct, 0);
  assert.deepEqual(card.items, []);
});

test('scoreBrief is deterministic with an injected clock', async () => {
  const now = () => Date.parse('2026-06-04T12:00:00Z');
  const a = await scoreBrief([ITEM_DONE], { ...CTX, now, quality: 0.5 });
  const b = await scoreBrief([ITEM_DONE], { ...CTX, now, quality: 0.5 });
  assert.deepEqual(a, b);
  assert.equal(a.ts, '2026-06-04T12:00:00.000Z');
});

// ── recordScorecard: append-only, never deletes ──────────────────────────────────────────────────────
test('recordScorecard appends to a store without deleting prior records', async () => {
  const store = createScorecardStore();
  const c1 = await scoreBrief([ITEM_DONE], CTX);
  const c2 = await scoreBrief([ITEM_UNDONE], CTX);

  const r1 = recordScorecard(c1, { store });
  assert.equal(r1.ok, true);
  assert.equal(store.size, 1);

  const r2 = recordScorecard(c2, { store });
  assert.equal(r2.ok, true);
  assert.equal(store.size, 2);

  // first record still present — append-only, nothing deleted/overwritten
  const all = store.list();
  assert.equal(all.length, 2);
  assert.equal(all[0].id, c1.id);
  assert.ok('recordedAt' in all[0]);
});

test('recordScorecard soft-fails on a missing/invalid store', () => {
  assert.equal(recordScorecard({}, {}).ok, false);
  assert.equal(recordScorecard(null, { store: createScorecardStore() }).ok, false);
});

test('store.list() returns a copy — callers cannot mutate the backing records', async () => {
  const store = createScorecardStore();
  recordScorecard(await scoreBrief([ITEM_DONE], CTX), { store });
  const snapshot = store.list();
  snapshot.length = 0; // mutate the returned array
  assert.equal(store.size, 1); // backing store unaffected
});

// ── rollup ────────────────────────────────────────────────────────────────────────────────────────────
test('rollup averages completion % and counts buckets across scorecards', async () => {
  const a = await scoreBrief([ITEM_DONE, ITEM_UNDONE], CTX);          // 50%
  const b = await scoreBrief([ITEM_DONE], { confirmedItems: [{ text: ITEM_DONE }], doneItems: [{ text: ITEM_DONE }] }); // 100%
  const r = rollup([a, b]);

  assert.equal(r.count, 2);
  assert.equal(r.avgCompletedPct, 75); // (50 + 100) / 2
  assert.equal(r.buckets.completed, a.buckets.completed + b.buckets.completed);
  assert.equal(r.buckets.leftUndone, a.buckets.leftUndone + b.buckets.leftUndone);
});

test('rollup surfaces the worst-ignored and most-hallucinated briefs', async () => {
  const ignoredHeavy = await scoreBrief([ITEM_IGNORED, 'another totally unreferenced random line here'], {});
  const halluHeavy = await scoreBrief([ITEM_REPO], { repoFlags: CTX.repoFlags });
  ignoredHeavy.id = 'ignored-heavy';
  halluHeavy.id = 'hallu-heavy';

  const r = rollup([ignoredHeavy, halluHeavy]);
  assert.equal(r.worstIgnored.id, 'ignored-heavy');
  assert.ok(r.worstIgnored.count >= 1);
  assert.equal(r.mostHallucinated.id, 'hallu-heavy');
  assert.ok(r.mostHallucinated.count >= 1);
});

test('rollup on empty input is safe', () => {
  const r = rollup([]);
  assert.equal(r.count, 0);
  assert.equal(r.avgCompletedPct, 0);
  assert.equal(r.worstIgnored, null);
  assert.equal(r.mostHallucinated, null);
});

// ── renderScorecard ──────────────────────────────────────────────────────────────────────────────────
test('renderScorecard shows ✓/✗/~ marks, the percent, and the bucket summary', async () => {
  const brief = [ITEM_DONE, ITEM_UNDONE, ITEM_IGNORED, ITEM_REPO];
  const card = await scoreBrief(brief, CTX);
  const md = renderScorecard(card);

  assert.match(md, /50% completed/);
  assert.match(md, /✓/);  // a completed line
  assert.match(md, /✗/);  // an undone/ignored/hallucination line
  assert.match(md, /completed 1/);
  assert.match(md, /hallucination 1/);
  assert.match(md, /repo-structure-mistake/); // subflag rendered
});

test('renderScorecard handles an empty scorecard without throwing', () => {
  const md = renderScorecard({});
  assert.match(md, /0% completed/);
  assert.match(md, /No items/);
});
