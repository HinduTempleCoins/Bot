// verdictLog.test.js — tests for the APPEND-ONLY fact-checker verdict log (#101).
//
// Run: node test/verdictLog.test.js   (node:test + node:assert/strict, no new deps, fully OFFLINE)
//
// The log is the fact-checker's OWN store, advisory for operator review. The fact-checker FLAGS only;
// it NEVER edits the KB / knowledge source files. These tests inject a fake in-memory fs + a fixed
// clock so nothing touches the real disk or the wall clock — and they PROVE the append-only invariant
// (an earlier entry is byte-for-byte unchanged after later writes).

import test from 'node:test';
import assert from 'node:assert/strict';

const { recordVerdict, readLog, verdictStats } = await import('../src/factChecker/verdictLog.js');

// ── in-memory fs that satisfies the {readFileSync, appendFileSync, mkdirSync} contract ────────────
// It records EVERY write (mode + payload) so we can assert nothing ever truncated/overwrote the file.
function memFs() {
  const files = new Map();              // path → string contents
  const writes = [];                    // audit trail of every fs operation that mutated a file
  return {
    files,
    writes,
    mkdirSync(/* dir, opts */) { writes.push({ op: 'mkdir' }); },
    readFileSync(p) {
      if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return files.get(p);
    },
    appendFileSync(p, data) {
      writes.push({ op: 'append', path: p, data });        // ONLY appends are ever recorded
      files.set(p, (files.get(p) || '') + data);
    },
    // deliberately NO writeFileSync/truncateSync — if production ever tried to overwrite, it would throw.
  };
}

const FILE = '/tmp/in-memory/factcheck.jsonl';
const fixedClock = () => '2026-06-03T12:00:00.000Z';

test('recordVerdict appends an immutable entry with monotonic seq + content hash, and returns it', () => {
  const fs = memFs();
  const e1 = recordVerdict(
    { claim: 'Bitcoin launched in 2009', verdict: 'supported', confidence: 0.95, sources: ['https://e/1'], articleId: 'btc.wiki' },
    { fs, file: FILE, now: fixedClock },
  );
  assert.equal(e1.seq, 1, 'first entry seq is 1');
  assert.equal(e1.verdict, 'supported');
  assert.equal(e1.at, '2026-06-03T12:00:00.000Z', 'used the injected clock');
  assert.ok(typeof e1.hash === 'string' && e1.hash.length > 0, 'has a content hash');
  assert.deepEqual(e1.sources, ['https://e/1']);

  const e2 = recordVerdict(
    { claim: 'It uses proof-of-work', verdict: 'supported', articleId: 'btc.wiki' },
    { fs, file: FILE, now: fixedClock },
  );
  assert.equal(e2.seq, 2, 'seq is monotonic across appends');

  // exactly two JSONL lines on disk, each parseable
  const lines = fs.files.get(FILE).trim().split('\n');
  assert.equal(lines.length, 2, 'two appends → two JSONL lines');
  assert.deepEqual(JSON.parse(lines[0]), e1);
  assert.deepEqual(JSON.parse(lines[1]), e2);
});

test('APPEND-ONLY: an earlier entry is byte-for-byte unchanged after later writes', () => {
  const fs = memFs();
  const first = recordVerdict({ claim: 'first', verdict: 'refuted', articleId: 'a' }, { fs, file: FILE, now: fixedClock });
  const firstLineAfterWrite1 = fs.files.get(FILE).split('\n')[0];

  // three more writes
  recordVerdict({ claim: 'second', verdict: 'supported', articleId: 'a' }, { fs, file: FILE, now: fixedClock });
  recordVerdict({ claim: 'third', verdict: 'unverified', articleId: 'b' }, { fs, file: FILE, now: fixedClock });
  recordVerdict({ claim: 'fourth', verdict: 'uncertain', articleId: 'b' }, { fs, file: FILE, now: fixedClock });

  // the first line is identical to what it was after the first write
  const firstLineNow = fs.files.get(FILE).split('\n')[0];
  assert.equal(firstLineNow, firstLineAfterWrite1, 'first JSONL line never mutated');
  // and it still deserializes to the original entry (seq + hash intact)
  const reparsed = JSON.parse(firstLineNow);
  assert.deepEqual(reparsed, first);

  // structural proof: EVERY fs mutation was an append — never an overwrite/truncate
  assert.ok(fs.writes.filter((w) => w.op === 'append').length === 4, 'four appends recorded');
  assert.ok(fs.writes.every((w) => w.op !== 'write' && w.op !== 'truncate'), 'no overwrite/truncate ever happened');
});

test('readLog filters by verdict, articleId, and since (read-only)', () => {
  const fs = memFs();
  let n = 0;
  const clockSeq = () => `2026-06-0${++n}T00:00:00.000Z`;   // 1st→day 01, 2nd→day 02, ...
  recordVerdict({ claim: 'c1', verdict: 'supported', articleId: 'x' }, { fs, file: FILE, now: clockSeq });   // 06-01
  recordVerdict({ claim: 'c2', verdict: 'refuted', articleId: 'x' }, { fs, file: FILE, now: clockSeq });     // 06-02
  recordVerdict({ claim: 'c3', verdict: 'supported', articleId: 'y' }, { fs, file: FILE, now: clockSeq });   // 06-03
  recordVerdict({ claim: 'c4', verdict: 'unverified', articleId: 'y' }, { fs, file: FILE, now: clockSeq });  // 06-04

  // by verdict (case-insensitive)
  const supported = readLog({ fs, file: FILE, verdict: 'SUPPORTED' });
  assert.equal(supported.length, 2);
  assert.deepEqual(supported.map((r) => r.claim).sort(), ['c1', 'c3']);

  // by articleId
  const onX = readLog({ fs, file: FILE, articleId: 'x' });
  assert.deepEqual(onX.map((r) => r.claim).sort(), ['c1', 'c2']);

  // by since (keep entries at >= 06-03)
  const recent = readLog({ fs, file: FILE, since: '2026-06-03T00:00:00.000Z' });
  assert.deepEqual(recent.map((r) => r.claim).sort(), ['c3', 'c4']);

  // combined filters AND together
  const supportedY = readLog({ fs, file: FILE, verdict: 'supported', articleId: 'y' });
  assert.deepEqual(supportedY.map((r) => r.claim), ['c3']);

  // reading did not mutate the store
  assert.equal(fs.writes.filter((w) => w.op === 'append').length, 4, 'readLog performed no writes');
});

test('verdictStats counts by verdict (normalised to upper-case)', () => {
  const fs = memFs();
  recordVerdict({ claim: 'a', verdict: 'supported' }, { fs, file: FILE, now: fixedClock });
  recordVerdict({ claim: 'b', verdict: 'supported' }, { fs, file: FILE, now: fixedClock });
  recordVerdict({ claim: 'c', verdict: 'refuted' }, { fs, file: FILE, now: fixedClock });
  recordVerdict({ claim: 'd', verdict: 'unverified' }, { fs, file: FILE, now: fixedClock });
  recordVerdict({ claim: 'e', verdict: 'uncertain' }, { fs, file: FILE, now: fixedClock });

  const stats = verdictStats({ fs, file: FILE });
  assert.deepEqual(stats, { SUPPORTED: 2, REFUTED: 1, UNVERIFIED: 1, UNCERTAIN: 1 });
});

test('readLog skips a corrupt JSONL line without throwing (corrupt-tolerant)', () => {
  const fs = memFs();
  recordVerdict({ claim: 'good1', verdict: 'supported', articleId: 'z' }, { fs, file: FILE, now: fixedClock });
  // inject a corrupt line directly into the store (as a real torn write might leave)
  fs.files.set(FILE, fs.files.get(FILE) + '{ this is not valid json \n');
  recordVerdict({ claim: 'good2', verdict: 'refuted', articleId: 'z' }, { fs, file: FILE, now: fixedClock });

  const recs = readLog({ fs, file: FILE });
  assert.equal(recs.length, 2, 'two valid records survive; the corrupt line is skipped');
  assert.deepEqual(recs.map((r) => r.claim).sort(), ['good1', 'good2']);

  // stats also tolerates the corrupt line
  assert.deepEqual(verdictStats({ fs, file: FILE }), { SUPPORTED: 1, REFUTED: 1 });
});

test('readLog on a missing file returns [] (soft-fail, never throws)', () => {
  const fs = memFs();
  assert.deepEqual(readLog({ fs, file: '/tmp/does/not/exist.jsonl' }), []);
  assert.deepEqual(verdictStats({ fs, file: '/tmp/does/not/exist.jsonl' }), {});
});
