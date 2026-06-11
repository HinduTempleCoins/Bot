// flag-pipe.test.mjs — OFFLINE tests for the unified moderation pipe.
// No network, no keys. Default store is in-memory; the JSONL variant is exercised with a temp dir.
//
//   node --test integrations/flag-pipe.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fileFlag, reviewQueue, resolve, summary, listFlags,
  memoryStore, jsonlStore, __setStore, __setClock, __setIdGen, __getStore,
  KINDS, GATED_KINDS, STATUSES, RESOLVE_ACTIONS, normalizeKind, isGated, esc,
} from './flag-pipe.mjs';

// Each test gets a fresh in-memory store + deterministic clock/ids so the default singleton is clean.
beforeEach(() => {
  __setStore(memoryStore());
  let n = 0;
  __setClock(() => `2026-06-11T00:00:0${(n % 10)}.000Z`);
  __setIdGen(() => `flag_test_${n++}`);
});

// ── constants ─────────────────────────────────────────────────────────────────────────────────────
test('KINDS covers all ten traditional harms', () => {
  assert.deepEqual([...KINDS].sort(), [
    'csam', 'doxxing', 'harassment', 'image-theft', 'impersonation',
    'misinformation', 'plagiarism', 'scam', 'spam', 'sybil',
  ]);
  assert.equal(KINDS.length, 10);
});

test('csam is the gated kind; isGated reflects it', () => {
  assert.deepEqual(GATED_KINDS, ['csam']);
  assert.equal(isGated('csam'), true);
  assert.equal(isGated('CSAM'), true);
  assert.equal(isGated('spam'), false);
});

test('esc escapes HTML so evidence is safe to render', () => {
  assert.equal(esc('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  assert.equal(esc(null), '');
});

// ── fileFlag happy path ─────────────────────────────────────────────────────────────────────────
test('fileFlag records a pending flag with clamped severity', () => {
  const { flag, deduped, error } = fileFlag({
    target: '@alice/spammy', kind: 'spam', severity: 9, reason: 'flood', reporter: 'bob', evidence: '50 posts/min',
  });
  assert.equal(error, undefined);
  assert.equal(deduped, false);
  assert.equal(flag.target, '@alice/spammy');
  assert.equal(flag.kind, 'spam');
  assert.equal(flag.severity, 5);          // clamped 9 -> 5
  assert.equal(flag.status, 'pending');
  assert.equal(flag.reporter, 'bob');
  assert.equal(flag.gated, false);
  assert.equal(listFlags().length, 1);
});

test('fileFlag applies a per-kind default severity when omitted', () => {
  const { flag } = fileFlag({ target: '@x/p', kind: 'scam', reason: 'phish' });
  assert.equal(flag.severity, 4);          // scam default
  const { flag: f2 } = fileFlag({ target: '@y/p', kind: 'plagiarism' });
  assert.equal(f2.severity, 2);
});

// ── edge: validation ──────────────────────────────────────────────────────────────────────────
test('fileFlag refuses a missing target (soft-fail, no throw)', () => {
  const r = fileFlag({ kind: 'spam' });
  assert.equal(r.flag, null);
  assert.equal(r.error, 'missing-target');
  assert.equal(listFlags().length, 0);
});

test('fileFlag refuses an unknown kind rather than mislabeling it', () => {
  const r = fileFlag({ target: '@a/p', kind: 'vibes' });
  assert.equal(r.flag, null);
  assert.match(r.error, /^unknown-kind:vibes$/);
  assert.equal(listFlags().length, 0);
});

test('normalizeKind lowercases + trims', () => {
  assert.equal(normalizeKind('  SPAM '), 'spam');
  assert.equal(normalizeKind(undefined), '');
});

// ── dedupe by (target, kind) ──────────────────────────────────────────────────────────────────
test('fileFlag dedupes a still-pending (target,kind); same target different kind is distinct', () => {
  const a = fileFlag({ target: '@bob/post', kind: 'spam', reporter: 'x' });
  const b = fileFlag({ target: '@bob/post', kind: 'spam', reporter: 'y' }); // dup target+kind
  assert.equal(b.deduped, true);
  assert.equal(b.flag.id, a.flag.id);                 // returns the existing flag
  const c = fileFlag({ target: '@bob/post', kind: 'harassment' });          // different kind
  assert.equal(c.deduped, false);
  assert.equal(listFlags().length, 2);
});

test('a re-offense after resolution is a fresh flag (resolved does not block)', () => {
  const a = fileFlag({ target: '@bob/post', kind: 'spam' });
  resolve(a.flag.id, { action: 'dismissed', by: 'mod' });
  const b = fileFlag({ target: '@bob/post', kind: 'spam' });
  assert.equal(b.deduped, false);
  assert.notEqual(b.flag.id, a.flag.id);
  assert.equal(listFlags().length, 2);
});

// ── CSAM gating ───────────────────────────────────────────────────────────────────────────────
test('csam flag is gated, severity 5, and evidence is force-redacted (no imagery stored)', () => {
  const { flag, gated } = fileFlag({
    target: '@bad/acct', kind: 'csam', reporter: 'detector',
    evidence: 'data:image/png;base64,AAAAVERYLONGBLOBxxxxxxxxxxxxxxxxxxxxxxxxxx',
  });
  assert.equal(gated, true);
  assert.equal(flag.gated, true);
  assert.equal(flag.severity, 5);
  assert.doesNotMatch(flag.evidence, /base64|AAAAVERYLONGBLOB/); // image bytes never stored
  assert.match(flag.evidence, /GATED\(csam\)/);
  assert.match(flag.evidence, /PhotoDNA\/NCMEC/);
});

// ── reviewQueue ranking ─────────────────────────────────────────────────────────────────────────
test('reviewQueue returns pending flags ranked most-severe first, then oldest-first', () => {
  fileFlag({ target: '@a/1', kind: 'spam' });          // sev 2, filed first
  fileFlag({ target: '@b/2', kind: 'scam' });          // sev 4
  fileFlag({ target: '@c/3', kind: 'csam' });          // sev 5
  fileFlag({ target: '@d/4', kind: 'plagiarism' });    // sev 2, filed after @a
  const q = reviewQueue({ status: 'pending' });
  assert.deepEqual(q.map((f) => f.kind), ['csam', 'scam', 'spam', 'plagiarism']);
});

test('reviewQueue can filter by kind and target', () => {
  fileFlag({ target: '@a/1', kind: 'spam' });
  fileFlag({ target: '@b/2', kind: 'scam' });
  assert.equal(reviewQueue({ kind: 'scam' }).length, 1);
  assert.equal(reviewQueue({ target: '@a/1' }).length, 1);
  assert.equal(reviewQueue({ status: 'all' }).length, 2);
});

// ── resolve (append-only) ─────────────────────────────────────────────────────────────────────
test('resolve appends an immutable event and updates current state; original flag event survives', () => {
  const store = __getStore();
  const { flag } = fileFlag({ target: '@a/1', kind: 'harassment' });
  const updated = resolve(flag.id, { action: 'actioned', by: 'hathor', note: 'hidden in condenser' });
  assert.equal(updated.status, 'actioned');
  assert.equal(updated.action, 'actioned');
  assert.equal(updated.resolvedBy, 'hathor');
  // append-only: two events on disk (flag + resolve), but ONE collapsed flag.
  assert.equal(store.events().length, 2);
  assert.equal(store.events()[0].type, 'flag');
  assert.equal(store.events()[1].type, 'resolve');
  assert.equal(listFlags().length, 1);
  // it left the pending queue.
  assert.equal(reviewQueue({ status: 'pending' }).length, 0);
  assert.equal(reviewQueue({ status: 'actioned' }).length, 1);
});

test('resolve rejects an unknown action and a missing id', () => {
  const { flag } = fileFlag({ target: '@a/1', kind: 'spam' });
  assert.equal(resolve(flag.id, { action: 'nuke' }), null);
  assert.equal(resolve('no-such-id', { action: 'dismissed' }), null);
});

test('resolve supports the gated escalation action', () => {
  const { flag } = fileFlag({ target: '@a/1', kind: 'csam' });
  const u = resolve(flag.id, { action: 'escalated', by: 'counsel', note: 'NCMEC referral' });
  assert.equal(u.status, 'escalated');
  assert.deepEqual(RESOLVE_ACTIONS.includes('escalated'), true);
});

// ── summary ───────────────────────────────────────────────────────────────────────────────────
test('summary counts by kind and status plus gatedPending', () => {
  fileFlag({ target: '@a/1', kind: 'spam' });
  fileFlag({ target: '@b/2', kind: 'spam' });
  fileFlag({ target: '@c/3', kind: 'csam' });
  const { flag } = fileFlag({ target: '@d/4', kind: 'scam' });
  resolve(flag.id, { action: 'dismissed', by: 'mod' });
  const s = summary();
  assert.equal(s.total, 4);
  assert.equal(s.byKind.spam, 2);
  assert.equal(s.byKind.csam, 1);
  assert.equal(s.byStatus.pending, 3);
  assert.equal(s.byStatus.dismissed, 1);
  assert.equal(s.gatedPending, 1); // the csam flag is still pending
});

// ── injectable JSONL store (file-backed, offline temp dir) ─────────────────────────────────────
test('jsonlStore persists append-only lines and replays them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flagpipe-'));
  const path = join(dir, 'flags.jsonl');
  const store = jsonlStore({ path });
  __setStore(store);

  const { flag } = fileFlag({ target: '@a/1', kind: 'misinformation', reason: 'unsupported claim' });
  resolve(flag.id, { action: 'reviewed', by: 'fact-checker' });

  assert.equal(existsSync(path), true);
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);                       // append-only: flag + resolve
  assert.equal(JSON.parse(lines[0]).type, 'flag');
  assert.equal(JSON.parse(lines[1]).type, 'resolve');

  // a fresh store over the same path replays to the same collapsed state.
  __setStore(jsonlStore({ path }));
  assert.equal(listFlags().length, 1);
  assert.equal(reviewQueue({ status: 'reviewed' }).length, 1);
});

test('jsonlStore skips corrupt lines without throwing', () => {
  const fakeFs = {
    mkdirSync() {},
    appendFileSync() {},
    readFileSync() { return '{"type":"flag","id":"a","kind":"spam","target":"@x","status":"pending","severity":2}\nNOT JSON\n'; },
  };
  __setStore(jsonlStore({ fs: fakeFs, path: '/tmp/whatever.jsonl' }));
  assert.equal(listFlags().length, 1);
});

test('store write failure is soft (fileFlag returns an error, never throws)', () => {
  const failing = {
    append() { return false; },
    events() { return []; },
  };
  __setStore(failing);
  const r = fileFlag({ target: '@a/1', kind: 'spam' });
  assert.equal(r.error, 'store-write-failed');
  assert.ok(r.flag);                                   // the flag object is still returned
});

// ── all declared statuses are usable ───────────────────────────────────────────────────────────
test('STATUSES vocabulary is the expected set', () => {
  assert.deepEqual([...STATUSES].sort(), ['actioned', 'dismissed', 'escalated', 'pending', 'reviewed']);
});
