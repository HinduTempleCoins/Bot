// qa-pairs.test.mjs — offline node:test suite for tools/qa-pairs.mjs. Happy paths + edge/soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, isQuestion, extractPairs, stripQuoted, toRecords, stats } from './qa-pairs.mjs';

test('esc escapes HTML metacharacters and handles null', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('isQuestion: trailing question mark', () => {
  assert.equal(isQuestion('Is this the way?'), true);
  assert.equal(isQuestion('This is a statement.'), false);
});

test('isQuestion: leading interrogatives (no question mark needed)', () => {
  assert.equal(isQuestion('How do I claim my account'), true);
  assert.equal(isQuestion('What is MELEK'), true);
  assert.equal(isQuestion('Can you help me'), true);
  assert.equal(isQuestion('Does it support SMT'), true);
  assert.equal(isQuestion('Thanks for the help'), false);
});

test('isQuestion: soft-fail on non-string / empty', () => {
  assert.equal(isQuestion(null), false);
  assert.equal(isQuestion(123), false);
  assert.equal(isQuestion(''), false);
  assert.equal(isQuestion('   '), false);
});

test('isQuestion: a question buried under a quoted reply still detects via the live line', () => {
  const t = '> previous statement.\nHow do I do this';
  assert.equal(isQuestion(t), true);
});

test('stripQuoted removes > lines and On..wrote: attribution headers', () => {
  const input = 'On Mon, Jan 1, 2024 at 3pm, Alice <a@x> wrote:\n> old question here?\n> second quoted line\n\nHere is the real answer.';
  assert.equal(stripQuoted(input), 'Here is the real answer.');
});

test('stripQuoted keeps real content with > only stripped, collapses blanks', () => {
  const input = 'line one\n\n\n\nline two\n> quoted';
  assert.equal(stripQuoted(input), 'line one\n\nline two');
});

test('stripQuoted soft-fails on non-string', () => {
  assert.equal(stripQuoted(null), '');
  assert.equal(stripQuoted(99), '');
});

test('stripQuoted does not drop a normal sentence that happens to contain "wrote:"', () => {
  // sentence punctuation before "wrote:" means it is real prose, not an attribution header.
  const input = 'The scribe wrote: peace. Then he wrote:';
  const out = stripQuoted(input);
  assert.ok(out.includes('peace'));
});

test('extractPairs: basic email thread pairs question with next differing-author reply', () => {
  const thread = [
    { author: 'alice', text: 'How do I claim my witness account?' },
    { author: 'hathor', text: '> How do I claim my witness account?\n\nRun the claim flow, then set your URL.' },
  ];
  const pairs = extractPairs(thread);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].question, 'How do I claim my witness account?');
  assert.equal(pairs[0].answer, 'Run the claim flow, then set your URL.');
  assert.equal(pairs[0].qIndex, 0);
  assert.equal(pairs[0].aIndex, 1);
});

test('extractPairs: same-author follow-up is not an answer; later differing author within window is', () => {
  const thread = [
    { author: 'alice', text: 'Is the active slot protected?' },
    { author: 'alice', text: 'I mean for the first year.' }, // same author -> not an answer
    { author: 'hathor', text: 'Yes, scoped to hathor for one year.' },
  ];
  const pairs = extractPairs(thread);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].aIndex, 2);
  assert.equal(pairs[0].answer, 'Yes, scoped to hathor for one year.');
});

test('extractPairs: skips empty / quoted-only turns when finding the answer', () => {
  const thread = [
    { author: 'alice', text: 'What is MELEK?' },
    { author: 'bob', text: '> What is MELEK?' }, // quoted-only -> empty after strip, skipped
    { author: 'bob', text: '' },                  // empty, skipped
    { author: 'hathor', text: 'The chain Hathor serves.' },
  ];
  const pairs = extractPairs(thread, { maxGap: 5 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].aIndex, 3);
});

test('extractPairs: respects maxGap window (no answer within window -> no pair)', () => {
  const thread = [
    { author: 'alice', text: 'Why is the egregore held as a position?' },
    { author: 'alice', text: 'noise 1' },
    { author: 'alice', text: 'noise 2' },
    { author: 'alice', text: 'noise 3' },
    { author: 'hathor', text: 'Because it is its genuinely-defensible form.' }, // gap 4 > default 3
  ];
  assert.equal(extractPairs(thread).length, 0);
  // with a wider window it pairs
  const wide = extractPairs(thread, { maxGap: 4 });
  assert.equal(wide.length, 1);
  assert.equal(wide[0].aIndex, 4);
});

test('extractPairs: multiple questions each get their own pair; one answer can serve two', () => {
  const thread = [
    { author: 'alice', text: 'Is it standard Graphene?' },
    { author: 'hathor', text: 'Yes, comment/vote/transfer/delegate only.' },
    { author: 'bob', text: 'Can anyone make a signup option?' },
    { author: 'hathor', text: 'Yes, via the vendor-picker registry.' },
  ];
  const pairs = extractPairs(thread);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((p) => p.aIndex), [1, 3]);
});

test('extractPairs: role-less / author-less turns pair on adjacency', () => {
  const thread = [
    { text: 'How does this work?' },
    { text: 'Like so.' },
  ];
  const pairs = extractPairs(thread);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].answer, 'Like so.');
});

test('extractPairs: soft-fail on non-array / empty', () => {
  assert.deepEqual(extractPairs(null), []);
  assert.deepEqual(extractPairs(undefined), []);
  assert.deepEqual(extractPairs([]), []);
  assert.deepEqual(extractPairs('nope'), []);
  assert.deepEqual(extractPairs(42), []);
});

test('extractPairs: invalid maxGap falls back to default 3', () => {
  const thread = [
    { author: 'a', text: 'What now?' },
    { author: 'b', text: 'This.' },
  ];
  assert.equal(extractPairs(thread, { maxGap: 0 }).length, 1);
  assert.equal(extractPairs(thread, { maxGap: -5 }).length, 1);
  assert.equal(extractPairs(thread, { maxGap: 'x' }).length, 1);
});

test('toRecords produces chat-shaped messages ready for training-export', () => {
  const pairs = [
    { question: 'Q1?', answer: 'A1', qIndex: 0, aIndex: 1 },
    { question: 'Q2?', answer: 'A2', qIndex: 2, aIndex: 3 },
  ];
  const recs = toRecords(pairs);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0], {
    messages: [
      { role: 'user', content: 'Q1?' },
      { role: 'assistant', content: 'A1' },
    ],
  });
});

test('toRecords skips pairs with empty/missing sides and soft-fails on bad input', () => {
  const recs = toRecords([
    { question: '', answer: 'orphan' },
    { question: 'Q', answer: '' },
    { question: '  ', answer: '  ' },
    null,
    'nope',
    { question: 'Good?', answer: 'Yes' },
  ]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].messages[0].content, 'Good?');
  assert.deepEqual(toRecords(null), []);
  assert.deepEqual(toRecords('x'), []);
});

test('stats computes count and rounded average lengths', () => {
  const pairs = [
    { question: '12345', answer: '123' },      // qlen 5, alen 3
    { question: '123', answer: '1234567' },     // qlen 3, alen 7
  ];
  const s = stats(pairs);
  assert.equal(s.count, 2);
  assert.equal(s.avgQLen, 4);   // (5+3)/2
  assert.equal(s.avgALen, 5);   // (3+7)/2
});

test('stats ignores invalid pairs and soft-fails to zeros', () => {
  assert.deepEqual(stats([]), { count: 0, avgQLen: 0, avgALen: 0 });
  assert.deepEqual(stats(null), { count: 0, avgQLen: 0, avgALen: 0 });
  assert.deepEqual(stats([{ question: '', answer: 'x' }, null]), { count: 0, avgQLen: 0, avgALen: 0 });
});

test('end-to-end: thread -> pairs -> records -> stats', () => {
  const thread = [
    { author: 'alice', text: 'How do I claim my MELEK witness account?' },
    { author: 'hathor', text: 'On Mon, alice wrote:\n> How do I claim my MELEK witness account?\n\nRun the claim flow, then set your witness URL.' },
    { author: 'alice', text: 'Thanks!' },
    { author: 'bob', text: 'Is the active slot really protected?' },
    { author: 'hathor', text: 'Yes, for the first year, scoped to hathor.' },
  ];
  const pairs = extractPairs(thread);
  assert.equal(pairs.length, 2);
  const recs = toRecords(pairs);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].messages[0].role, 'user');
  assert.equal(recs[1].messages[1].role, 'assistant');
  assert.equal(stats(pairs).count, 2);
});
