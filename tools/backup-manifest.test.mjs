// backup-manifest.test.mjs — offline, deterministic. No fs/network in the tested paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  sortEntries,
  buildManifest,
  diffManifests,
  rotationPlan,
  formatManifestText,
} from './backup-manifest.mjs';

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('sortEntries sorts by path and drops bad entries', () => {
  const out = sortEntries([
    { path: 'b.txt', size: 2 },
    { path: 'a.txt', size: 1 },
    null,
    { size: 99 },            // no path -> skipped
    'nope',                  // not an object -> skipped
    { path: '', size: 1 },   // empty path -> skipped
  ]);
  assert.deepEqual(out.map(e => e.path), ['a.txt', 'b.txt']);
  assert.equal(out.length, 2);
});

test('sortEntries normalizes size/sha/mtime', () => {
  const [e] = sortEntries([{ path: 'x', size: '12', sha256: 'ABCDEF', mtime: undefined }]);
  assert.equal(e.size, 12);
  assert.equal(e.sha256, 'abcdef');   // lowercased
  assert.equal(e.mtime, null);
  // negative / NaN size -> 0
  const [n] = sortEntries([{ path: 'y', size: -5 }]);
  assert.equal(n.size, 0);
});

test('buildManifest aggregates count/bytes/byExt deterministically', () => {
  const m = buildManifest([
    { path: 'docs/b.md', size: 100, sha256: 'aa' },
    { path: 'docs/a.md', size: 50, sha256: 'bb' },
    { path: 'img/c.PNG', size: 200, sha256: 'cc' },
    { path: 'README', size: 10, sha256: 'dd' },   // no extension
  ]);
  assert.equal(m.count, 4);
  assert.equal(m.totalBytes, 360);
  assert.equal(m.generatedAt, null);
  assert.equal(m.files[0].path, 'README');         // codepoint sort: 'R'(0x52) < 'd'(0x64)
  assert.deepEqual(m.files.map(f => f.path), ['README', 'docs/a.md', 'docs/b.md', 'img/c.PNG']);
  assert.deepEqual(m.byExt.md, { count: 2, bytes: 150 });
  assert.deepEqual(m.byExt.png, { count: 1, bytes: 200 });   // ext lowercased
  assert.deepEqual(m.byExt['(none)'], { count: 1, bytes: 10 });
  // byExt keys sorted
  assert.deepEqual(Object.keys(m.byExt), ['(none)', 'md', 'png']);
});

test('buildManifest injectable generatedAt; dotfiles have no ext', () => {
  const m = buildManifest([{ path: '.gitignore', size: 5 }], { generatedAt: '2026-06-11T00:00:00Z' });
  assert.equal(m.generatedAt, '2026-06-11T00:00:00Z');
  assert.deepEqual(m.byExt['(none)'], { count: 1, bytes: 5 });
});

test('buildManifest soft-fails on garbage input', () => {
  assert.deepEqual(buildManifest(null), { generatedAt: null, count: 0, totalBytes: 0, byExt: {}, files: [] });
  assert.deepEqual(buildManifest('nope'), { generatedAt: null, count: 0, totalBytes: 0, byExt: {}, files: [] });
});

test('diffManifests detects added/removed/changed by sha256', () => {
  const prev = buildManifest([
    { path: 'a', size: 1, sha256: 'h1' },
    { path: 'b', size: 2, sha256: 'h2' },
    { path: 'c', size: 3, sha256: 'h3' },
  ]);
  const next = buildManifest([
    { path: 'a', size: 1, sha256: 'h1' },    // unchanged
    { path: 'b', size: 2, sha256: 'CHANGED' }, // sha changed
    { path: 'd', size: 4, sha256: 'h4' },    // added; c removed
  ]);
  const d = diffManifests(prev, next);
  assert.deepEqual(d.added, ['d']);
  assert.deepEqual(d.removed, ['c']);
  assert.deepEqual(d.changed, ['b']);
});

test('diffManifests falls back to size when sha absent', () => {
  const prev = buildManifest([{ path: 'a', size: 10 }]);
  const next = buildManifest([{ path: 'a', size: 20 }]);
  assert.deepEqual(diffManifests(prev, next).changed, ['a']);
  // same size, no sha -> not changed
  const same = diffManifests(buildManifest([{ path: 'a', size: 10 }]), buildManifest([{ path: 'a', size: 10 }]));
  assert.deepEqual(same, { added: [], removed: [], changed: [] });
});

test('diffManifests accepts raw entry arrays and bad input', () => {
  const d = diffManifests([{ path: 'a', size: 1, sha256: 'x' }], [{ path: 'a', size: 1, sha256: 'y' }]);
  assert.deepEqual(d.changed, ['a']);
  assert.deepEqual(diffManifests(null, null), { added: [], removed: [], changed: [] });
});

test('rotationPlan grandfather-father-son keeps newest per bucket', () => {
  const snaps = [
    { id: 's1', date: '2026-06-11' },
    { id: 's2', date: '2026-06-10' },
    { id: 's3', date: '2026-06-09' },
    { id: 's4', date: '2026-06-01' }, // older day
    { id: 's5', date: '2026-05-01' }, // older month
    { id: 's6', date: '2026-01-01' }, // much older
  ];
  const { keep, prune } = rotationPlan(snaps, { keepDaily: 3, keepWeekly: 0, keepMonthly: 0 });
  const keepIds = keep.map(k => k.id).sort();
  assert.deepEqual(keepIds, ['s1', 's2', 's3']);   // 3 most recent distinct days
  assert.equal(prune.length, 3);
  // keep + prune partition all valid snapshots
  assert.equal(keep.length + prune.length, 6);
});

test('rotationPlan combines daily + monthly buckets', () => {
  const snaps = [
    { id: 'a', date: '2026-06-11' },
    { id: 'b', date: '2026-06-10' },
    { id: 'c', date: '2026-05-15' },
    { id: 'd', date: '2026-04-15' },
  ];
  const { keep } = rotationPlan(snaps, { keepDaily: 1, keepWeekly: 0, keepMonthly: 3 });
  const ids = keep.map(k => k.id).sort();
  // daily keeps 'a' (newest day); monthly keeps newest of June(a), May(c), Apr(d)
  assert.deepEqual(ids, ['a', 'c', 'd']);
});

test('rotationPlan soft-fails on bad dates and input', () => {
  const { keep, prune } = rotationPlan([
    { id: 'good', date: '2026-06-11' },
    { id: 'bad', date: 'not-a-date' },
    null,
    'x',
  ], { keepDaily: 7 });
  assert.deepEqual(keep.map(k => k.id), ['good']);
  assert.equal(prune.length, 0);
  assert.deepEqual(rotationPlan(null), { keep: [], prune: [] });
});

test('rotationPlan derives id from date when id missing, output sorted newest-first', () => {
  const { keep } = rotationPlan([
    { date: '2026-06-09' },
    { date: '2026-06-11' },
    { date: '2026-06-10' },
  ], { keepDaily: 7 });
  assert.equal(keep.length, 3);
  // newest first in output
  assert.ok(keep[0].date > keep[1].date && keep[1].date > keep[2].date);
  assert.equal(typeof keep[0].id, 'string');
});

test('formatManifestText produces a plain report', () => {
  const m = buildManifest([{ path: 'a.md', size: 5, sha256: 'deadbeef0000' }], { generatedAt: '2026-06-11T00:00:00Z' });
  const txt = formatManifestText(m);
  assert.ok(txt.includes('Backup manifest — 2026-06-11T00:00:00Z'));
  assert.ok(txt.includes('files: 1'));
  assert.ok(txt.includes('total: 5 bytes'));
  assert.ok(txt.includes('.md  1 file(s)  5 bytes'));
  assert.ok(txt.includes('a.md'));
  assert.ok(txt.includes('deadbeef0000'));
});

test('formatManifestText soft-fails on missing fields', () => {
  assert.ok(formatManifestText(null).includes('(time not set)'));
  assert.ok(formatManifestText({}).includes('files: 0'));
});
