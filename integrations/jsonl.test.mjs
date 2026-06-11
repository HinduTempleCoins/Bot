// jsonl.test.mjs — offline tests for the JSONL serialize/parse/append/dedupe helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJsonl, parseJsonl, appendJsonl, dedupeJsonl } from './jsonl.mjs';

test('toJsonl: one object per line, no trailing newline', () => {
  const out = toJsonl([{ a: 1 }, { b: 2 }]);
  assert.equal(out, '{"a":1}\n{"b":2}');
  assert.ok(!out.endsWith('\n'));
});

test('toJsonl: empty / non-array → empty string', () => {
  assert.equal(toJsonl([]), '');
  assert.equal(toJsonl(null), '');
  assert.equal(toJsonl(undefined), '');
  assert.equal(toJsonl('nope'), '');
});

test('toJsonl: skips null/undefined entries', () => {
  assert.equal(toJsonl([{ a: 1 }, null, undefined, { b: 2 }]), '{"a":1}\n{"b":2}');
});

test('toJsonl: soft-fails on un-serializable records (circular / BigInt), never throws', () => {
  const circ = {}; circ.self = circ;
  let out;
  assert.doesNotThrow(() => { out = toJsonl([{ ok: 1 }, circ, { big: 10n }, { ok: 2 }]); });
  assert.equal(out, '{"ok":1}\n{"ok":2}');
});

test('parseJsonl: round-trips toJsonl output', () => {
  const recs = [{ a: 1 }, { b: 'two' }, { c: [3, 4] }];
  const { records, errors } = parseJsonl(toJsonl(recs));
  assert.deepEqual(records, recs);
  assert.equal(errors.length, 0);
});

test('parseJsonl: skips blank lines (incl. trailing newline tail)', () => {
  const { records, errors } = parseJsonl('{"a":1}\n\n   \n{"b":2}\n');
  assert.deepEqual(records, [{ a: 1 }, { b: 2 }]);
  assert.equal(errors.length, 0);
});

test('parseJsonl: captures per-line errors instead of throwing', () => {
  let res;
  assert.doesNotThrow(() => { res = parseJsonl('{"a":1}\nnot json\n{"b":2}'); });
  assert.deepEqual(res.records, [{ a: 1 }, { b: 2 }]);
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].line, 2); // 1-based line number
  assert.ok(typeof res.errors[0].message === 'string' && res.errors[0].message.length > 0);
});

test('parseJsonl: null/empty input → empty result, no throw', () => {
  assert.deepEqual(parseJsonl(null), { records: [], errors: [] });
  assert.deepEqual(parseJsonl(''), { records: [], errors: [] });
});

test('appendJsonl: joins without leading/trailing blank lines', () => {
  const out = appendJsonl('{"a":1}', [{ b: 2 }]);
  assert.equal(out, '{"a":1}\n{"b":2}');
});

test('appendJsonl: empty existing text → just the new records', () => {
  assert.equal(appendJsonl('', [{ b: 2 }]), '{"b":2}');
  assert.equal(appendJsonl(null, [{ b: 2 }]), '{"b":2}');
});

test('appendJsonl: empty new records → existing text unchanged (trailing newline normalized)', () => {
  assert.equal(appendJsonl('{"a":1}\n', []), '{"a":1}');
  assert.equal(appendJsonl('{"a":1}', null), '{"a":1}');
});

test('appendJsonl: collapses an existing trailing newline before joining', () => {
  assert.equal(appendJsonl('{"a":1}\n\n', [{ b: 2 }]), '{"a":1}\n{"b":2}');
});

test('dedupeJsonl: first-wins by keyFn', () => {
  const recs = [
    { id: 'x', v: 1 },
    { id: 'y', v: 2 },
    { id: 'x', v: 99 }, // duplicate id — dropped, first wins
  ];
  const out = dedupeJsonl(recs, (r) => r.id);
  assert.deepEqual(out, [{ id: 'x', v: 1 }, { id: 'y', v: 2 }]);
});

test('dedupeJsonl: default key is whole-record stringify', () => {
  const out = dedupeJsonl([{ a: 1 }, { a: 1 }, { a: 2 }]);
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test('dedupeJsonl: non-array → empty array', () => {
  assert.deepEqual(dedupeJsonl(null), []);
  assert.deepEqual(dedupeJsonl('nope'), []);
});

test('dedupeJsonl: null/undefined key → record kept (un-keyable, never dropped)', () => {
  const recs = [{ a: 1 }, { a: 2 }];
  const out = dedupeJsonl(recs, () => undefined);
  assert.deepEqual(out, recs);
});

test('dedupeJsonl: keyFn that throws → record kept, never throws', () => {
  let out;
  assert.doesNotThrow(() => {
    out = dedupeJsonl([{ a: 1 }, { a: 2 }], (r) => { if (r.a === 2) throw new Error('boom'); return r.a; });
  });
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test('dedupeJsonl: object key is stringified for comparison', () => {
  const recs = [{ a: 1, b: 2 }, { a: 1, b: 3 }];
  const out = dedupeJsonl(recs, (r) => ({ a: r.a })); // same {a:1} key → second dropped
  assert.deepEqual(out, [{ a: 1, b: 2 }]);
});
