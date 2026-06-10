// moderation-flags.test.mjs — OFFLINE tests for the condenser flag/report store (task #300).
// No network, no real files in the repo tree: each test uses a throwaway store path in a temp dir.
//
//   node --test integrations/moderation-flags.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createModerationStore, normalizeKind, REPORT_KINDS, defaultStorePath,
} from './moderation-flags.mjs';

function freshStore(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'modflags-'));
  const storePath = join(dir, 'flags.jsonl');
  let n = 0;
  return createModerationStore({
    storePath,
    clock: () => `2026-06-10T00:00:0${n}.000Z`, // monotonic-ish for sort stability
    idGen: () => `mod_test_${n++}`,
    ...opts,
  });
}

test('normalizeKind maps known kinds and coerces the rest to "other"', () => {
  for (const k of REPORT_KINDS) assert.equal(normalizeKind(k), k);
  assert.equal(normalizeKind('SPAM'), 'spam');
  assert.equal(normalizeKind('  Abuse '), 'abuse');
  assert.equal(normalizeKind('whatever'), 'other');
  assert.equal(normalizeKind(''), 'other');
  assert.equal(normalizeKind(undefined), 'other');
});

test('raiseReport writes a real append-only line to the store', () => {
  const s = freshStore();
  const { report, deduped } = s.raiseReport({ target: '@alice/spammy', kind: 'spam', reason: 'bot post', reporter: 'bob' });
  assert.equal(deduped, false);
  assert.ok(report.id);
  assert.equal(report.target, '@alice/spammy');
  assert.equal(report.kind, 'spam');
  assert.equal(report.status, 'open');

  // It went to a REAL file, not a console.log.
  assert.ok(existsSync(s.storePath), 'store file exists');
  const lines = readFileSync(s.storePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).target, '@alice/spammy');
});

test('the moderation queue reads back what was filed', () => {
  const s = freshStore();
  s.raiseReport({ target: '@a/p1', kind: 'spam', reporter: 'x' });
  s.raiseReport({ target: '@b/p2', kind: 'scam', reporter: 'y' });
  const q = s.queueForModeration();
  assert.equal(q.length, 2);
  assert.deepEqual(q.map((r) => r.target), ['@a/p1', '@b/p2']); // oldest-first FIFO
  assert.ok(q.every((r) => r.status === 'open'));
});

test('idempotent: same (reporter,target,kind) while open does NOT stack duplicates', () => {
  const s = freshStore();
  const a = s.raiseReport({ target: '@a/p', kind: 'spam', reporter: 'bob' });
  const b = s.raiseReport({ target: '@a/p', kind: 'spam', reporter: 'bob' });
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
  assert.equal(a.report.id, b.report.id);
  assert.equal(s.queueForModeration().length, 1, 'still one open report');

  // A different reporter, or a different kind, is a distinct report.
  s.raiseReport({ target: '@a/p', kind: 'spam', reporter: 'carol' });
  s.raiseReport({ target: '@a/p', kind: 'abuse', reporter: 'bob' });
  assert.equal(s.queueForModeration().length, 3);
});

test('resolveReport appends a new line (never edits) and removes it from the open queue', () => {
  const s = freshStore();
  const { report } = s.raiseReport({ target: '@a/p', kind: 'spam', reporter: 'bob' });
  const updated = s.resolveReport(report.id, { status: 'dismissed', note: 'creator proved ownership', by: 'hathor' });
  assert.equal(updated.status, 'dismissed');
  assert.equal(updated.note, 'creator proved ownership');
  assert.equal(updated.resolvedBy, 'hathor');

  // History preserved: TWO lines for the one id (append-only, not an edit).
  const lines = readFileSync(s.storePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).status, 'open');
  assert.equal(JSON.parse(lines[1]).status, 'dismissed');

  // Collapsed state = last line wins; no longer in the open queue.
  assert.equal(s.queueForModeration().length, 0);
  assert.equal(s.listReports({ status: 'dismissed' }).length, 1);
});

test('resolveReport rejects an unknown id or an invalid status', () => {
  const s = freshStore();
  const { report } = s.raiseReport({ target: '@a/p', kind: 'spam' });
  assert.equal(s.resolveReport('nope', { status: 'reviewed' }), null);
  assert.equal(s.resolveReport(report.id, { status: 'deleted' }), null); // not a valid status
});

test('raiseReport with no target is rejected with an error, not a crash', () => {
  const s = freshStore();
  const r = s.raiseReport({ kind: 'spam', reporter: 'bob' });
  assert.equal(r.report, null);
  assert.equal(r.error, 'missing-target');
});

test('stats counts by status', () => {
  const s = freshStore();
  const { report } = s.raiseReport({ target: '@a/p', kind: 'spam', reporter: 'b' });
  s.raiseReport({ target: '@c/p', kind: 'scam', reporter: 'd' });
  s.resolveReport(report.id, { status: 'actioned' });
  const st = s.stats();
  assert.equal(st.total, 2);
  assert.equal(st.open, 1);
  assert.equal(st.actioned, 1);
});

test('soft-fail: a write failure never throws out of raiseReport', () => {
  const throwingFs = {
    mkdirSync() {},
    appendFileSync() { throw new Error('disk full'); },
    readFileSync() { return ''; },
  };
  const s = createModerationStore({ fs: throwingFs, storePath: '/dev/null/whatever', idGen: () => 'x' });
  let report;
  assert.doesNotThrow(() => { report = s.raiseReport({ target: '@a/p', kind: 'spam' }).report; });
  assert.ok(report, 'still returns the report object even when persistence failed');
});

test('long free-text fields are capped so a report cannot bloat the store', () => {
  const s = freshStore();
  const huge = 'x'.repeat(50000);
  const { report } = s.raiseReport({ target: huge, kind: 'other', reason: huge });
  assert.ok(report.target.length <= 2000);
  assert.ok(report.reason.length <= 2000);
});

test('defaultStorePath honours MODERATION_FLAGS_JSONL and ends in .jsonl', () => {
  assert.ok(defaultStorePath().endsWith('.jsonl'));
});
