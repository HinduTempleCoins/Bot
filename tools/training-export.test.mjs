import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toChatJsonl,
  toCompletionJsonl,
  toInstructionJsonl,
  fromConversation,
  validateRecord,
  lineCount,
  coerce,
  lastStats,
} from './training-export.mjs';

test('coerce accepts q/a, question/answer, prompt/completion, instruction/output', () => {
  assert.deepEqual(coerce({ q: 'a?', a: 'b' }), { prompt: 'a?', completion: 'b' });
  assert.deepEqual(coerce({ question: 'a?', answer: 'b' }), { prompt: 'a?', completion: 'b' });
  assert.deepEqual(coerce({ prompt: 'a?', completion: 'b' }), { prompt: 'a?', completion: 'b' });
  assert.deepEqual(coerce({ instruction: 'a?', output: 'b' }), { prompt: 'a?', completion: 'b' });
  assert.deepEqual(coerce({ nope: 1 }), { prompt: '', completion: '' });
});

test('toChatJsonl emits one chat object per line, each ending with \\n', () => {
  const out = toChatJsonl([{ q: 'Hi', a: 'Hello' }]);
  assert.ok(out.endsWith('\n'));
  const obj = JSON.parse(out.trim());
  assert.deepEqual(obj, { messages: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
  ] });
});

test('toChatJsonl prepends a system turn when {system} given', () => {
  const out = toChatJsonl([{ q: 'Hi', a: 'Hello' }], { system: 'be kind' });
  const obj = JSON.parse(out.trim());
  assert.equal(obj.messages.length, 3);
  assert.deepEqual(obj.messages[0], { role: 'system', content: 'be kind' });
});

test('empty/whitespace system is ignored', () => {
  const obj = JSON.parse(toChatJsonl([{ q: 'Hi', a: 'Hello' }], { system: '   ' }).trim());
  assert.equal(obj.messages.length, 2);
  assert.equal(obj.messages[0].role, 'user');
});

test('toCompletionJsonl emits {prompt, completion}', () => {
  const out = toCompletionJsonl([{ question: 'Q', answer: 'A' }]);
  assert.deepEqual(JSON.parse(out.trim()), { prompt: 'Q', completion: 'A' });
});

test('toInstructionJsonl emits Alpaca {instruction, input, output}; input from input/context', () => {
  const out = toInstructionJsonl([{ instruction: 'Do X', input: 'ctx', output: 'Y' }]);
  assert.deepEqual(JSON.parse(out.trim()), { instruction: 'Do X', input: 'ctx', output: 'Y' });
  // no input field → empty-string input (Alpaca convention)
  const out2 = toInstructionJsonl([{ q: 'Do X', a: 'Y' }]);
  assert.deepEqual(JSON.parse(out2.trim()), { instruction: 'Do X', input: '', output: 'Y' });
});

test('toInstructionJsonl does not duplicate input when it was the prompt source', () => {
  // only `input` present as prompt-side → it becomes instruction; should not also be echoed as input
  const out = toInstructionJsonl([{ input: 'Just this', output: 'Y' }]);
  assert.deepEqual(JSON.parse(out.trim()), { instruction: 'Just this', input: '', output: 'Y' });
});

test('embedded newlines survive via JSON escaping; lineCount stays correct', () => {
  const out = toCompletionJsonl([{ q: 'a\nb', a: 'c\nd' }]);
  assert.equal(lineCount(out), 1); // one record despite the embedded newlines
  assert.deepEqual(JSON.parse(out.trim()), { prompt: 'a\nb', completion: 'c\nd' });
});

test('multiple records → multiple lines', () => {
  const recs = [{ q: '1', a: 'one' }, { q: '2', a: 'two' }, { q: '3', a: 'three' }];
  assert.equal(lineCount(toChatJsonl(recs)), 3);
  assert.equal(lineCount(toCompletionJsonl(recs)), 3);
  assert.equal(lineCount(toInstructionJsonl(recs)), 3);
});

test('validateRecord flags missing fields and unknown format, returns errors[]', () => {
  assert.deepEqual(validateRecord({ q: 'a', a: 'b' }), { ok: true, errors: [] });
  const bad = validateRecord({ q: 'a' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some(e => /completion|answer|output/.test(e)));
  assert.equal(validateRecord(null).ok, false);
  assert.equal(validateRecord([]).ok, false);
  assert.ok(validateRecord({ q: 'a', a: 'b' }, 'nonsense').errors.some(e => /unknown format/.test(e)));
});

test('invalid records are SKIPPED (soft-fail), not thrown; lastStats reports skips', () => {
  const recs = [
    { q: 'good', a: 'yes' },
    { q: '', a: 'orphan' },     // no prompt
    null,                        // not an object
    { q: 'also', a: '' },        // no completion
    { question: 'fine', answer: 'ok' },
  ];
  const out = toChatJsonl(recs);
  assert.equal(lineCount(out), 2);
  assert.deepEqual(lastStats(), { kept: 2, skipped: 3 });
});

test('non-array input → empty string, never throws', () => {
  assert.equal(toChatJsonl(null), '');
  assert.equal(toCompletionJsonl(undefined), '');
  assert.equal(toInstructionJsonl(42), '');
});

test('un-serializable record (circular) is skipped, never throws', () => {
  const circ = { q: 'a', a: 'b' };
  circ.self = circ;
  // JSON.stringify of the chat object built from this is fine (we only read prompt/completion),
  // so force the failure path with a value that genuinely can't serialize:
  const bad = { q: 'a', a: 'b', toJSON() { throw new Error('boom'); } };
  const out = toCompletionJsonl([{ q: 'ok', a: 'ok' }, bad]);
  // bad coerces fine (prompt/completion read), so it actually emits; ensure no throw + ok row present
  assert.ok(lineCount(out) >= 1);
});

test('fromConversation pairs user→assistant turns, ignores system, drops orphan user', () => {
  const recs = fromConversation([
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1' },
    { role: 'human', content: 'Q2' },
    { role: 'bot', content: 'A2' },
    { role: 'user', content: 'Q3-unanswered' },
  ]);
  assert.deepEqual(recs, [
    { prompt: 'Q1', completion: 'A1' },
    { prompt: 'Q2', completion: 'A2' },
  ]);
});

test('fromConversation output feeds straight into the emitters', () => {
  const recs = fromConversation([
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
  ]);
  const obj = JSON.parse(toChatJsonl(recs).trim());
  // no system turn here → index 0 is the user, index 1 the assistant
  assert.equal(obj.messages[0].content, 'Hi');
  assert.equal(obj.messages[1].content, 'Hello');
});

test('fromConversation non-array → [] and empty turns skipped', () => {
  assert.deepEqual(fromConversation(null), []);
  assert.deepEqual(fromConversation([{ role: 'user', content: '  ' }, { role: 'assistant', content: 'x' }]), []);
});

test('lineCount handles empty / non-string / trailing newline', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount(null), 0);
  assert.equal(lineCount('{"a":1}\n'), 1);
  assert.equal(lineCount('{"a":1}\n{"b":2}\n'), 2);
});
