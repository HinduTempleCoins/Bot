// annal-rank.test.mjs — OFFLINE unit tests for rankAnnals() + PRIORITY_RULE.
// Uses a per-test tmp fixture dir (real .md files) so nothing touches the network or
// the live repo. rankAnnals() is filesystem-only; it soft-fails (returns empty) on a
// missing dir, which we assert below.
//
//   node --test tools/annal-rank.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rankAnnals, PRIORITY_RULE } from './annal-rank.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'annal-rank-'));
}
function write(dir, name, body = '') {
  fs.writeFileSync(path.join(dir, name), body, 'utf8');
}

test('newest-first ordering by ## Edit marker', () => {
  const dir = mkTmp();
  write(dir, 'old.md', '# A\n\n## Edit — 2026-01-01T00:00:00');
  write(dir, 'new.md', '# B\n\n## Edit — 2026-06-01T00:00:00');
  write(dir, 'mid.md', '# C\n\n## Edit — 2026-03-01T00:00:00');
  const r = rankAnnals(dir, '', { budget: 8 });
  assert.equal(r.total, 3);
  assert.deepEqual(r.ranked.map(x => x.file), ['new.md', 'mid.md', 'old.md']);
  assert.equal(r.ranked[0].rank, 1);
});

test('subject keyword filters to matching annals (name or body)', () => {
  const dir = mkTmp();
  write(dir, 'egregore-notes.md', 'discussion of egregore\n## Edit — 2026-02-01T00:00:00');
  write(dir, 'pricing.md', 'just a price feed annal\n## Edit — 2026-05-01T00:00:00');
  const r = rankAnnals(dir, 'egregore', { budget: 8 });
  assert.equal(r.total, 1);
  assert.equal(r.ranked[0].file, 'egregore-notes.md');
});

test('multi-keyword subject requires every keyword present', () => {
  const dir = mkTmp();
  write(dir, 'both.md', 'angelic witness and egregore here\n## Edit — 2026-04-01T00:00:00');
  write(dir, 'one.md', 'only egregore here\n## Edit — 2026-04-02T00:00:00');
  const r = rankAnnals(dir, 'angelic egregore', { budget: 8 });
  assert.equal(r.total, 1);
  assert.equal(r.ranked[0].file, 'both.md');
});

test('budget caps ranked output and reports dropped + tiers', () => {
  const dir = mkTmp();
  for (let i = 0; i < 5; i++) {
    write(dir, `a${i}.md`, `## Edit — 2026-0${i + 1}-01T00:00:00`);
  }
  const r = rankAnnals(dir, '', { budget: 2 });
  assert.equal(r.total, 5);
  assert.equal(r.ranked.length, 2);
  assert.equal(r.dropped, 3);
  // budget 2 -> ceil(2/2)=1 read-first slot
  assert.equal(r.ranked[0].tier, 'read-first');
  assert.equal(r.ranked[1].tier, 'read-if-needed');
});

test('ranked entries carry a trimmed ISO when field', () => {
  const dir = mkTmp();
  write(dir, 'x.md', '## Edit — 2026-06-01T12:34:56');
  const r = rankAnnals(dir, '', { budget: 8 });
  assert.equal(r.ranked[0].when, '2026-06-01T12:34');
});

test('filename timestamp used as recency when no Edit marker', () => {
  const dir = mkTmp();
  write(dir, 'log-2026-06-09T08-00-00.md', 'no edit marker body');
  write(dir, 'log-2026-01-09T08-00-00.md', 'no edit marker body');
  const r = rankAnnals(dir, '', { budget: 8 });
  assert.equal(r.ranked[0].file, 'log-2026-06-09T08-00-00.md');
  assert.notEqual(r.ranked[0].when, 'unknown');
});

test('non-.md files are ignored', () => {
  const dir = mkTmp();
  write(dir, 'keep.md', '## Edit — 2026-06-01T00:00:00');
  write(dir, 'ignore.txt', '## Edit — 2026-06-02T00:00:00');
  const r = rankAnnals(dir, '', { budget: 8 });
  assert.equal(r.total, 1);
  assert.equal(r.ranked[0].file, 'keep.md');
});

test('missing directory soft-fails to empty result (no throw)', () => {
  let r;
  assert.doesNotThrow(() => {
    r = rankAnnals('/no/such/annal/dir/xyz', 'anything', { budget: 8 });
  });
  assert.deepEqual(r, { ranked: [], dropped: 0 });
});

test('empty directory returns zero matches', () => {
  const dir = mkTmp();
  const r = rankAnnals(dir, '', { budget: 8 });
  assert.equal(r.total, 0);
  assert.equal(r.ranked.length, 0);
  assert.equal(r.dropped, 0);
});

test('PRIORITY_RULE is a non-empty newest-first prompt string', () => {
  assert.equal(typeof PRIORITY_RULE, 'string');
  assert.ok(PRIORITY_RULE.length > 0);
  assert.match(PRIORITY_RULE, /NEWEST first/);
});
