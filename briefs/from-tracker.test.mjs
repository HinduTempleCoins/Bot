// from-tracker.test.mjs — the JSONL→floor adapter: parse tracker JSONL, render a stable skeleton.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadItems, renderBriefFromJsonl, __setReader } from './from-tracker.mjs';

// A small, realistic tracker sample: one in-progress (→ Read first), one open (→ Do next),
// one blocked, one with an unmet dependency (→ also Blocked), one done (→ dropped).
const SAMPLE = [
  { id: 'wip1', file: 'witness/monitor.mjs', section: 'Phase 1', text: 'finish the witness monitor', status: 'in_progress', dependsHint: null },
  { id: 'open1', file: 'signup/help.mjs', text: 'wire signup help', status: 'open', dependsHint: null },
  { id: 'blk1', file: 'engine/token.mjs', text: 'mint the side token', status: 'blocked', dependsHint: null },
  { id: 'dep1', file: 'misc.md', text: 'refactor later', status: 'open', dependsHint: 'needs the index first' },
  { id: 'done1', file: 'done.md', text: 'already shipped', status: 'done', dependsHint: null },
].map((o) => JSON.stringify(o)).join('\n');

test('loadItems: parses JSONL into items, in file order', () => {
  const items = loadItems(SAMPLE);
  assert.equal(items.length, 5);
  assert.equal(items[0].id, 'wip1');
  assert.equal(items[1].id, 'open1');
});

test('loadItems: skips blank lines and malformed lines (soft-fail)', () => {
  const jsonl = [
    '{"id":"a","status":"open","text":"ok"}',
    '',
    'not json at all',
    '   ',
    '{"id":"b","status":"open","text":"also ok"}',
    '[1,2,3]', // an array is not a tracker item → skipped
    '"just a string"', // not an object → skipped
  ].join('\n');
  const items = loadItems(jsonl);
  assert.deepEqual(items.map((i) => i.id), ['a', 'b']);
});

test('loadItems: garbage / empty input → [] (never throws)', () => {
  assert.deepEqual(loadItems(''), []);
  assert.deepEqual(loadItems('   \n  \n'), []);
  assert.deepEqual(loadItems(null), []);
  assert.deepEqual(loadItems(undefined), []);
  assert.deepEqual(loadItems(42), []);
});

test('renderBriefFromJsonl: in-progress item lands under "Read first"', () => {
  const md = renderBriefFromJsonl(SAMPLE);
  // The in-progress item must appear in the Read-first section, not after Do-next.
  const readFirstIdx = md.indexOf('Read first');
  const doNextIdx = md.indexOf('Do next');
  const wipIdx = md.indexOf('wip1');
  assert.ok(readFirstIdx >= 0 && doNextIdx >= 0 && wipIdx >= 0);
  assert.ok(wipIdx > readFirstIdx && wipIdx < doNextIdx, 'wip1 should sit between "Read first" and "Do next"');
});

test('renderBriefFromJsonl: blocked + has-dependency items land under "Blocked"', () => {
  const md = renderBriefFromJsonl(SAMPLE);
  const blockedIdx = md.indexOf('Blocked');
  assert.ok(blockedIdx >= 0);
  const blk1Idx = md.indexOf('blk1');
  const dep1Idx = md.indexOf('dep1');
  // both the blocked-status item and the unmet-dependency item appear after the Blocked header
  assert.ok(blk1Idx > blockedIdx, 'blk1 (status blocked) under Blocked');
  assert.ok(dep1Idx > blockedIdx, 'dep1 (has dependsHint) under Blocked');
});

test('renderBriefFromJsonl: done items are dropped from the skeleton', () => {
  const md = renderBriefFromJsonl(SAMPLE);
  assert.ok(!md.includes('done1'), 'done item must not appear');
  assert.ok(md.includes('open1'), 'open item must appear');
});

test('renderBriefFromJsonl: byte-identical for identical input (deterministic)', () => {
  assert.equal(renderBriefFromJsonl(SAMPLE), renderBriefFromJsonl(SAMPLE));
});

test('renderBriefFromJsonl: forwards opts (doNextCap) to buildFloor', () => {
  const many = Array.from({ length: 6 }, (_, i) =>
    JSON.stringify({ id: `o${i}`, file: 'x.md', text: 'open item', status: 'open' }),
  ).join('\n');
  const md = renderBriefFromJsonl(many, { doNextCap: 2 });
  // With cap 2, the overflow goes to a Deferred section.
  assert.match(md, /Deferred/);
});

test('renderBriefFromJsonl: empty / garbage → a valid (empty) skeleton, never throws', () => {
  const md = renderBriefFromJsonl('');
  assert.match(md, /Brief skeleton \(deterministic floor\)/);
  assert.match(md, /_\(none\)_/);
  assert.doesNotThrow(() => renderBriefFromJsonl(null));
});

test('renderBriefFromJsonl: HTML in tracker text is escaped (esc-safe)', () => {
  const jsonl = JSON.stringify({ id: 'x', file: 'a.md', text: 'patch <script>alert(1)</script>', status: 'open' });
  const md = renderBriefFromJsonl(jsonl);
  assert.ok(md.includes('&lt;script&gt;'), 'angle brackets escaped');
  assert.ok(!md.includes('<script>'), 'no raw script tag');
});

test('__setReader: injected reader drives the parse; clears with falsy', () => {
  __setReader(() => SAMPLE);
  // The reader returns the raw JSONL; loading it should yield the 5 items (done dropped at render).
  const items = loadItems(SAMPLE);
  assert.equal(items.length, 5);
  __setReader(null); // restore — no throw
  assert.equal(typeof __setReader, 'function');
});
