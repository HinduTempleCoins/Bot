// Tests for self-crawl-schedule.mjs — the deterministic self-crawl scheduler/selector (task #54).
// Fully offline: injected clock (fixed `now`) + injected file-lister via __setLister. No network.
//
//   node --test integrations/self-crawl-schedule.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CADENCES, CONFERENCE_HOURS_UTC, DEFAULT_MAX_GAP_MS,
  cadenceIntervalMs, assignCadence, dueForCrawl, buildSchedule,
  verifyLoopFired, markCrawled, scheduleFromRepo, __setLister,
} from './self-crawl-schedule.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-03T18:00:00Z');   // fixed clock for every test

// ── cadences aligned to the 12-and-12 rhythm ───────────────────────────────────────────────────────
test('CADENCES: high=6h, medium=1d, low=1w; conferences are twice daily', () => {
  assert.equal(CADENCES.high.intervalMs, 6 * HOUR);
  assert.equal(CADENCES.medium.intervalMs, 1 * DAY);
  assert.equal(CADENCES.low.intervalMs, 7 * DAY);
  // twice-daily conference rhythm
  assert.deepEqual(CONFERENCE_HOURS_UTC, [6, 18]);
  assert.equal(CONFERENCE_HOURS_UTC.length, 2);
});

test('cadenceIntervalMs resolves names, objects, and unknowns', () => {
  assert.equal(cadenceIntervalMs('high'), 6 * HOUR);
  assert.equal(cadenceIntervalMs('low'), 7 * DAY);
  assert.equal(cadenceIntervalMs({ intervalMs: 1234 }), 1234);
  assert.equal(cadenceIntervalMs('nonsense'), 1 * DAY);   // → default medium
});

// ── assignCadence (priority weighting) ─────────────────────────────────────────────────────────────
test('assignCadence: hathor/core paths → high, scripture → low', () => {
  assert.equal(assignCadence('witness/hathor.js'), 'high');
  assert.equal(assignCadence('integrations/hathor-persona.mjs'), 'high');
  assert.equal(assignCadence('cheetah/text-detection.mjs'), 'high');
  assert.equal(assignCadence('signup/index.js'), 'high');
  assert.equal(assignCadence('src/chain/graphene.js'), 'high');

  assert.equal(assignCadence('knowledge/scripture/phoenix-protocol.md'), 'low');
  assert.equal(assignCadence('LINEAGE.md'), 'low');
  assert.equal(assignCadence('witness/hathor-render.png'), 'low');   // binary beats high

  assert.equal(assignCadence('integrations/macro.mjs'), 'medium');
  assert.equal(assignCadence('tutorial/stages.json'), 'medium');
  assert.equal(assignCadence('knowledge/diaspora.md'), 'medium');    // non-scripture corpus
  assert.equal(assignCadence(''), 'medium');                         // empty → default
});

// ── dueForCrawl ──────────────────────────────────────────────────────────────────────────────────
test('dueForCrawl selects never-crawled + overdue, excludes fresh', () => {
  const items = [
    { path: 'a-never.md' },                                              // never crawled → due
    { path: 'b-null.md', cadence: 'medium', lastCrawledAt: null },       // null → due
    { path: 'c-overdue.md', cadence: 'high', lastCrawledAt: NOW - 7 * HOUR }, // 7h > 6h → due
    { path: 'd-fresh.md', cadence: 'high', lastCrawledAt: NOW - 1 * HOUR },   // 1h < 6h → NOT due
    { path: 'e-daily-old.md', cadence: 'medium', lastCrawledAt: NOW - 2 * DAY }, // 2d > 1d → due
    { path: 'f-daily-fresh.md', cadence: 'medium', lastCrawledAt: NOW - 3 * HOUR }, // < 1d → NOT due
  ];
  const due = dueForCrawl(items, { now: NOW });
  const paths = due.map((d) => d.path).sort();
  assert.deepEqual(paths, ['a-never.md', 'b-null.md', 'c-overdue.md', 'e-daily-old.md']);
  // input not mutated
  assert.equal(items.length, 6);
});

test('dueForCrawl: exactly-at-interval counts as due (>=)', () => {
  const items = [{ path: 'x.md', cadence: 'high', lastCrawledAt: NOW - 6 * HOUR }];
  assert.equal(dueForCrawl(items, { now: NOW }).length, 1);
});

test('dueForCrawl: cadence inferred from path when not given', () => {
  const items = [
    { path: 'witness/hathor.js', lastCrawledAt: NOW - 7 * HOUR },               // high(6h) → due
    { path: 'knowledge/scripture/x.md', lastCrawledAt: NOW - 2 * DAY },         // low(1w) → NOT due
  ];
  const due = dueForCrawl(items, { now: NOW });
  assert.deepEqual(due.map((d) => d.path), ['witness/hathor.js']);
});

test('dueForCrawl: ISO-string timestamps parse correctly', () => {
  const items = [
    { path: 'old.md', cadence: 'high', lastCrawledAt: new Date(NOW - 8 * HOUR).toISOString() },
    { path: 'new.md', cadence: 'high', lastCrawledAt: new Date(NOW - 2 * HOUR).toISOString() },
  ];
  assert.deepEqual(dueForCrawl(items, { now: NOW }).map((d) => d.path), ['old.md']);
});

test('dueForCrawl: bad input soft-fails to empty', () => {
  assert.deepEqual(dueForCrawl(null, { now: NOW }), []);
  assert.deepEqual(dueForCrawl(undefined), []);
  assert.deepEqual(dueForCrawl([null, {}, { nope: 1 }], { now: NOW }), []);
});

// ── buildSchedule ──────────────────────────────────────────────────────────────────────────────────
test('buildSchedule: summary counts per cadence + dueNow are right', () => {
  const items = [
    { path: 'witness/hathor.js', lastCrawledAt: NOW - 7 * HOUR },     // high, due
    { path: 'cheetah/x.mjs' },                                        // high, never → due
    { path: 'integrations/macro.mjs', lastCrawledAt: NOW - 3 * HOUR },// medium, fresh → not due
    { path: 'tutorial/stages.json', lastCrawledAt: NOW - 2 * DAY },   // medium, due
    { path: 'knowledge/scripture/a.md', lastCrawledAt: NOW - 2 * DAY },// low, not due
  ];
  const { summary } = buildSchedule(items, { now: NOW });
  assert.equal(summary.total, 5);
  assert.equal(summary.high, 2);
  assert.equal(summary.medium, 2);
  assert.equal(summary.low, 1);
  assert.equal(summary.dueNow, 3);   // 2 high + 1 medium
});

test('buildSchedule: next[] has dueAt times, sorted soonest-first, with overdue flag', () => {
  const items = [
    { path: 'fresh-high.md', cadence: 'high', lastCrawledAt: NOW - 1 * HOUR }, // due in 5h
    { path: 'never.md', cadence: 'high' },                                     // due now
    { path: 'daily.md', cadence: 'medium', lastCrawledAt: NOW - 3 * HOUR },    // due in 21h
  ];
  const { next } = buildSchedule(items, { now: NOW });
  assert.equal(next.length, 3);
  // soonest first
  for (let i = 1; i < next.length; i++) assert.ok(next[i - 1].dueAt <= next[i].dueAt);
  // never-crawled is dueAt=now and overdue
  const never = next.find((n) => n.path === 'never.md');
  assert.equal(never.dueAt, NOW);
  assert.equal(never.overdue, true);
  // fresh-high due exactly 6h after its last crawl
  const fh = next.find((n) => n.path === 'fresh-high.md');
  assert.equal(fh.dueAt, NOW - 1 * HOUR + 6 * HOUR);
  assert.equal(fh.overdue, false);
});

test('buildSchedule: empty/bad input → safe empty schedule', () => {
  const s = buildSchedule(null, { now: NOW });
  assert.deepEqual(s.due, []);
  assert.deepEqual(s.next, []);
  assert.equal(s.summary.total, 0);
  assert.equal(s.summary.dueNow, 0);
});

// ── verifyLoopFired ────────────────────────────────────────────────────────────────────────────────
test('verifyLoopFired: ok when last run is recent', () => {
  const history = [NOW - 30 * HOUR, NOW - 2 * HOUR];   // most recent 2h ago
  const r = verifyLoopFired(history, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.stale, false);
  assert.equal(r.lastRun, NOW - 2 * HOUR);
  assert.equal(r.gapMs, 2 * HOUR);
  assert.equal(r.runs, 2);
});

test('verifyLoopFired: stale when last run older than maxGap', () => {
  const history = [NOW - 40 * HOUR];   // 40h > default 26h
  const r = verifyLoopFired(history, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.stale, true);
  assert.equal(r.gapMs, 40 * HOUR);
});

test('verifyLoopFired: respects a custom maxGapMs', () => {
  const history = [NOW - 5 * HOUR];
  assert.equal(verifyLoopFired(history, { now: NOW, maxGapMs: 4 * HOUR }).stale, true);
  assert.equal(verifyLoopFired(history, { now: NOW, maxGapMs: 6 * HOUR }).stale, false);
});

test('verifyLoopFired: empty history → stale (loop never observed firing)', () => {
  const r = verifyLoopFired([], { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.stale, true);
  assert.equal(r.lastRun, null);
  assert.equal(r.gapMs, null);
  assert.equal(r.runs, 0);
});

test('verifyLoopFired: accepts record shapes ({at}/{ts}/{crawledAt}) + ISO strings', () => {
  const history = [
    { at: new Date(NOW - 50 * HOUR).toISOString() },
    { crawledAt: NOW - 3 * HOUR },
    { ts: NOW - 100 * HOUR },
  ];
  const r = verifyLoopFired(history, { now: NOW });
  assert.equal(r.lastRun, NOW - 3 * HOUR);
  assert.equal(r.ok, true);
  assert.equal(r.runs, 3);
});

test('DEFAULT_MAX_GAP_MS spans more than one conference window (~12h) with grace', () => {
  assert.ok(DEFAULT_MAX_GAP_MS > 12 * HOUR);
});

// ── markCrawled (pure update of only the target) ───────────────────────────────────────────────────
test('markCrawled updates only the target path, immutably', () => {
  const items = [
    { path: 'a.md', cadence: 'high', lastCrawledAt: 100 },
    { path: 'b.md', cadence: 'medium', lastCrawledAt: 200 },
  ];
  const updated = markCrawled(items, 'a.md', NOW);
  // target updated
  assert.equal(updated.find((i) => i.path === 'a.md').lastCrawledAt, NOW);
  // other untouched (and same ref — unchanged object)
  assert.equal(updated.find((i) => i.path === 'b.md').lastCrawledAt, 200);
  assert.equal(updated[1], items[1]);
  // original array not mutated
  assert.equal(items[0].lastCrawledAt, 100);
});

test('markCrawled: no matching path → all refs unchanged', () => {
  const items = [{ path: 'a.md', lastCrawledAt: 1 }];
  const updated = markCrawled(items, 'missing.md', NOW);
  assert.equal(updated[0], items[0]);
});

// ── round-trip: mark a due item, it stops being due ─────────────────────────────────────────────────
test('round-trip: dueForCrawl → markCrawled → no longer due', () => {
  let items = [{ path: 'witness/hathor.js' }];   // never crawled → due (high)
  assert.equal(dueForCrawl(items, { now: NOW }).length, 1);
  items = markCrawled(items, 'witness/hathor.js', NOW);
  assert.equal(dueForCrawl(items, { now: NOW }).length, 0);          // fresh now
  // 6h+ later it's due again
  assert.equal(dueForCrawl(items, { now: NOW + 6 * HOUR }).length, 1);
});

// ── injected lister: offline scheduleFromRepo ──────────────────────────────────────────────────────
test('scheduleFromRepo uses the injected lister (offline)', () => {
  __setLister(() => [
    { path: 'witness/hathor.js' },                              // high, never → due
    { path: 'knowledge/scripture/a.md', lastCrawledAt: NOW - 2 * DAY }, // low → not due
    { path: 'integrations/macro.mjs', lastCrawledAt: NOW - 2 * DAY },   // medium → due
  ]);
  try {
    const s = scheduleFromRepo({ now: NOW });
    assert.equal(s.summary.total, 3);
    assert.equal(s.summary.high, 1);
    assert.equal(s.summary.low, 1);
    assert.equal(s.summary.dueNow, 2);   // witness + macro
    const duePaths = s.due.map((d) => d.path).sort();
    assert.deepEqual(duePaths, ['integrations/macro.mjs', 'witness/hathor.js']);
  } finally {
    __setLister(null);   // restore default
  }
});

test('scheduleFromRepo soft-fails when the lister throws', () => {
  __setLister(() => { throw new Error('boom'); });
  try {
    const s = scheduleFromRepo({ now: NOW });
    assert.equal(s.summary.total, 0);
    assert.deepEqual(s.due, []);
  } finally {
    __setLister(null);
  }
});
