import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, toJsonl, dedupe, validate, stripBlankLines } from './jsonl-validate.mjs';

test('parseLines parses non-blank lines and skips blanks', () => {
  const { records, errors } = parseLines('{"a":1}\n\n{"a":2}\n');
  assert.equal(errors.length, 0);
  assert.deepEqual(records, [{ a: 1 }, { a: 2 }]);
});

test('parseLines collects per-line errors, never throws', () => {
  const { records, errors } = parseLines('{"a":1}\noops\n{"a":2}');
  assert.deepEqual(records, [{ a: 1 }, { a: 2 }]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2); // 1-based line number
  assert.equal(errors[0].raw, 'oops');
  assert.ok(errors[0].message);
});

test('parseLines handles BOM and CRLF', () => {
  const text = '﻿{"a":1}\r\n{"a":2}\r\n';
  const { records, errors } = parseLines(text);
  assert.equal(errors.length, 0);
  assert.deepEqual(records, [{ a: 1 }, { a: 2 }]);
});

test('parseLines on empty / null is empty, no throw', () => {
  assert.deepEqual(parseLines(''), { records: [], errors: [] });
  assert.deepEqual(parseLines(null), { records: [], errors: [] });
});

test('toJsonl emits compact lines with trailing newline', () => {
  const out = toJsonl([{ a: 1 }, { b: 2 }]);
  assert.equal(out, '{"a":1}\n{"b":2}\n');
});

test('toJsonl round-trips through parseLines', () => {
  const recs = [{ id: 1, text: 'x' }, { id: 2, text: 'y' }];
  const { records, errors } = parseLines(toJsonl(recs));
  assert.equal(errors.length, 0);
  assert.deepEqual(records, recs);
});

test('toJsonl soft-skips unserializable and bare-undefined records', () => {
  const circular = {}; circular.self = circular;
  const out = toJsonl([{ a: 1 }, circular, undefined, { b: 2 }]);
  assert.equal(out, '{"a":1}\n{"b":2}\n');
});

test('toJsonl on non-array returns empty string', () => {
  assert.equal(toJsonl(null), '');
  assert.equal(toJsonl('nope'), '');
  assert.equal(toJsonl([]), '');
});

test('dedupe preserves first occurrence (default key)', () => {
  const recs = [{ id: 1 }, { id: 2 }, { id: 1 }];
  assert.deepEqual(dedupe(recs), [{ id: 1 }, { id: 2 }]);
});

test('dedupe with custom keyFn', () => {
  const recs = [{ id: 1, v: 'a' }, { id: 1, v: 'b' }, { id: 2, v: 'c' }];
  const out = dedupe(recs, r => r.id);
  assert.deepEqual(out, [{ id: 1, v: 'a' }, { id: 2, v: 'c' }]);
});

test('dedupe soft-fails on bad keyFn / non-array', () => {
  assert.deepEqual(dedupe(null), []);
  const recs = [{ id: 1 }, { id: 1 }];
  const out = dedupe(recs, () => { throw new Error('boom'); });
  // both map to String(r) which is identical -> deduped to one, no throw
  assert.equal(out.length, 1);
});

test('validate ok=true on clean input with required keys present', () => {
  const text = '{"id":1,"text":"a"}\n{"id":2,"text":"b"}\n';
  const res = validate(text, { requiredKeys: ['id', 'text'] });
  assert.equal(res.ok, true);
  assert.equal(res.count, 2);
  assert.equal(res.errors.length, 0);
  assert.equal(res.missingKeyLines.length, 0);
});

test('validate reports missing keys with correct line numbers', () => {
  const text = '{"id":1,"text":"a"}\n{"id":2}\n';
  const res = validate(text, { requiredKeys: ['id', 'text'] });
  assert.equal(res.ok, false);
  assert.equal(res.count, 2);
  assert.equal(res.missingKeyLines.length, 1);
  assert.equal(res.missingKeyLines[0].line, 2);
  assert.deepEqual(res.missingKeyLines[0].missing, ['text']);
});

test('validate reports parse errors and does not double-count them as missing-key', () => {
  const text = '{"id":1,"text":"a"}\nbroken\n{"id":3,"text":"c"}\n';
  const res = validate(text, { requiredKeys: ['id', 'text'] });
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].line, 2);
  assert.equal(res.missingKeyLines.length, 0);
  assert.equal(res.count, 2); // only the two parseable records
});

test('validate without requiredKeys checks only parseability', () => {
  const text = '{"id":1}\n{"id":2}\n';
  const res = validate(text);
  assert.equal(res.ok, true);
  assert.equal(res.missingKeyLines.length, 0);
});

test('validate flags a non-object (array/scalar) line as missing all required keys', () => {
  const text = '[1,2,3]\n42\n';
  const res = validate(text, { requiredKeys: ['id'] });
  assert.equal(res.ok, false);
  assert.equal(res.missingKeyLines.length, 2);
  assert.deepEqual(res.missingKeyLines[0].missing, ['id']);
});

test('stripBlankLines drops blank/whitespace lines, strips BOM, normalizes CRLF', () => {
  const text = '﻿{"a":1}\r\n\r\n   \n{"a":2}\n';
  assert.equal(stripBlankLines(text), '{"a":1}\n{"a":2}');
});
