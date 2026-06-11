// qa-pairs.test.mjs — offline tests for the Q&A / instruction-pair builder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairsFromThread, toRecords, dedupePairs } from './qa-pairs.mjs';

test('pairsFromThread: basic question→answer email thread', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'alice', text: 'How do I claim my witness account?', ts: 1 },
      { author: 'hathor', text: 'Run the claim op, then set your keys.', ts: 2 },
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].instruction, 'How do I claim my witness account?');
  assert.equal(pairs[0].response, 'Run the claim op, then set your keys.');
  assert.equal(pairs[0].meta.questionAuthor, 'alice');
  assert.equal(pairs[0].meta.answerAuthor, 'hathor');
  assert.equal(pairs[0].meta.questionTs, 1);
  assert.equal(pairs[0].meta.answerTs, 2);
});

test('pairsFromThread: consecutive same-author turns are merged', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'alice', text: 'First part of question.' },
      { author: 'alice', text: 'Second part of question.' },
      { author: 'bob', text: 'Here is the answer.' },
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].instruction, 'First part of question.\n\nSecond part of question.');
  assert.equal(pairs[0].response, 'Here is the answer.');
});

test('pairsFromThread: strips quote blocks and attribution headers', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'alice', text: 'What is MELEK?' },
      {
        author: 'bob',
        text:
          'On Mon, Jan 1, 2020 at 9:00 AM Alice <a@x.com> wrote:\n' +
          '> What is MELEK?\n' +
          '\nIt is a Graphene blockchain.',
      },
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].response, 'It is a Graphene blockchain.');
});

test('pairsFromThread: strips signature after "-- " delimiter', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'alice', text: 'Question here.' },
      { author: 'bob', text: 'The answer.\n-- \nBob\nWitness operator\nbob@x.com' },
    ],
  });
  assert.equal(pairs[0].response, 'The answer.');
});

test('pairsFromThread: drops empty / quoted-only turns so they do not split a run', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'alice', text: 'Part one.' },
      { author: 'alice', text: '> only a quote\n> more quote' }, // becomes empty, dropped
      { author: 'alice', text: 'Part two.' },
      { author: 'bob', text: 'Answer.' },
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].instruction, 'Part one.\n\nPart two.');
});

test('pairsFromThread: explicit roles override author identity', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'x', role: 'user', text: 'Q1' },
      { author: 'y', role: 'assistant', text: 'A1' },
      { author: 'x', role: 'user', text: 'Q2' },
      { author: 'y', role: 'assistant', text: 'A2' },
    ],
  });
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].instruction, 'Q1');
  assert.equal(pairs[1].response, 'A2');
});

test('pairsFromThread: user turn with no following answer is dropped', () => {
  const pairs = pairsFromThread({
    messages: [
      { author: 'alice', text: 'Answered question?' },
      { author: 'bob', text: 'Yes.' },
      { author: 'alice', text: 'Unanswered trailing question?' },
    ],
  });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].instruction, 'Answered question?');
});

test('pairsFromThread: soft-fail on bad input returns []', () => {
  assert.deepEqual(pairsFromThread(null), []);
  assert.deepEqual(pairsFromThread({}), []);
  assert.deepEqual(pairsFromThread({ messages: 'nope' }), []);
  assert.deepEqual(pairsFromThread(undefined), []);
  // malformed message entries are skipped, not thrown on
  assert.deepEqual(pairsFromThread({ messages: [null, 42, { text: '' }] }), []);
});

test('toRecords: builds chat-format records with optional system prompt', () => {
  const pairs = [{ instruction: 'Q', response: 'A', meta: {} }];
  const recs = toRecords(pairs, { system: 'You are Hathor.' });
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].messages, [
    { role: 'system', content: 'You are Hathor.' },
    { role: 'user', content: 'Q' },
    { role: 'assistant', content: 'A' },
  ]);
});

test('toRecords: no system prompt omits the system turn', () => {
  const recs = toRecords([{ instruction: 'Q', response: 'A' }]);
  assert.equal(recs[0].messages.length, 2);
  assert.equal(recs[0].messages[0].role, 'user');
});

test('toRecords: skips pairs missing either side; soft-fail on bad input', () => {
  const recs = toRecords([
    { instruction: 'Q', response: '' },
    { instruction: '', response: 'A' },
    { instruction: 'Q2', response: 'A2' },
  ]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].messages[0].content, 'Q2');
  assert.deepEqual(toRecords(null), []);
  assert.deepEqual(toRecords('x'), []);
});

test('dedupePairs: first-wins on normalized instruction', () => {
  const out = dedupePairs([
    { instruction: 'How  do I sign up?', response: 'first' },
    { instruction: 'how do i sign up?', response: 'second' }, // dup (case/space normalized)
    { instruction: 'Different question', response: 'third' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].response, 'first');
  assert.equal(out[1].instruction, 'Different question');
});

test('dedupePairs: soft-fail and empty-instruction skip', () => {
  assert.deepEqual(dedupePairs(null), []);
  assert.deepEqual(dedupePairs([{ instruction: '   ', response: 'x' }, null, 5]), []);
});

test('end-to-end: thread → pairs → dedupe → records', () => {
  const pairs = dedupePairs(
    pairsFromThread({
      messages: [
        { author: 'alice', text: 'What is a witness?' },
        { author: 'hathor', text: 'A block producer.' },
        { author: 'alice', text: 'what is a witness?' }, // dup question, different turn
        { author: 'hathor', text: 'Same answer again.' },
      ],
    }),
  );
  assert.equal(pairs.length, 1);
  const recs = toRecords(pairs, { system: 'sys' });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].messages.length, 3);
});
