// asks-to-tasks.test.mjs — OFFLINE unit tests for asksToTasks: the bridge from the asks-recorder
// to the task list. Pure text in -> task specs out (verbatim, deduped). No injection seam is needed
// because parseConversation is a pure string function; no fs, no network, no corpus access.
//
//   node --test tools/asks-to-tasks.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksToTasks } from './asks-to-tasks.mjs';

// An "operator" turn whose sentences trip the ACTION/DECISION signal phrases the parser keys on.
// (utterances() recognizes a "you:" / "operator:" speaker marker -> classified as operator.)
const convo = [
  'operator: We need to build the karma module this week.',
  'Go ahead and add a price-feed retry.',
  'okay',
].join('\n');

test('asksToTasks extracts asks verbatim into task specs', () => {
  const tasks = asksToTasks(convo);
  assert.ok(Array.isArray(tasks));
  assert.ok(tasks.length >= 2, 'should extract the build + the go-ahead asks');
  // each spec has the verbatim ask as its description (no paraphrase).
  const descriptions = tasks.map((t) => t.description);
  assert.ok(descriptions.includes('We need to build the karma module this week.'));
  assert.ok(descriptions.includes('Go ahead and add a price-feed retry.'));
  // noise ("okay") is dropped.
  assert.ok(!descriptions.some((d) => /^okay$/i.test(d)));
});

test('each task spec has subject, description, activeForm', () => {
  const tasks = asksToTasks(convo);
  for (const t of tasks) {
    assert.equal(typeof t.subject, 'string');
    assert.equal(typeof t.description, 'string');
    assert.equal(t.activeForm, 'Working on: ' + t.subject);
  }
});

test('short asks use the full ask as subject (no truncation)', () => {
  const tasks = asksToTasks('operator: Go ahead and fix the pool wizard.');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].subject, 'Go ahead and fix the pool wizard.');
  assert.equal(tasks[0].description, 'Go ahead and fix the pool wizard.');
});

test('long asks are truncated to a short subject with an ellipsis', () => {
  // > 70 chars: subject becomes a word-boundary slice (<= 67) + ellipsis; description stays full.
  const long =
    'operator: Go ahead and build the entire conversational witness persona pipeline end to end now.';
  const tasks = asksToTasks(long);
  assert.equal(tasks.length, 1);
  const t = tasks[0];
  assert.ok(t.subject.endsWith('…'), 'long subject should end with ellipsis');
  assert.ok(t.subject.length <= 70, 'truncated subject stays within 70 chars');
  assert.ok(t.description.length > 70, 'description keeps the full verbatim ask');
  assert.ok(t.description.startsWith('Go ahead and build the entire conversational'));
});

test('asks already covered by existingSubjects are deduped out (fuzzy)', () => {
  const text = 'operator: We need to build the karma database module soon.';
  // existing subject shares the strong tokens (build, karma, database, module) -> >70% overlap.
  const existing = ['build karma database module'];
  const tasks = asksToTasks(text, existing);
  assert.deepEqual(tasks, [], 'a near-duplicate of an existing task should be suppressed');
});

test('a novel ask survives when existingSubjects are unrelated', () => {
  const text = 'operator: We need to build the karma database module soon.';
  const tasks = asksToTasks(text, ['deploy the mining pool frontend tonight']);
  assert.equal(tasks.length, 1);
  assert.ok(/karma/.test(tasks[0].description));
});

test('two near-identical asks in one convo collapse to one task (internal dedupe)', () => {
  const text = [
    'operator: We need to build the karma database module.',
    'We need to build the karma database module today.',
  ].join('\n');
  const tasks = asksToTasks(text);
  assert.equal(tasks.length, 1, 'the second near-duplicate ask is dropped');
});

test('empty / signal-free conversation yields no tasks (soft, no throw)', () => {
  assert.deepEqual(asksToTasks(''), []);
  assert.deepEqual(asksToTasks('operator: nice weather today, the sky is blue.'), []);
});

test('existingSubjects defaults to empty array when omitted', () => {
  // calling with a single arg must not throw on the default param.
  assert.doesNotThrow(() => asksToTasks('operator: Go ahead and ship it.'));
});
