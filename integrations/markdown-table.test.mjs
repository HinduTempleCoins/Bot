// markdown-table.test.mjs — offline tests for the pure GFM table renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdTable, mdTableFromMatrix, esc } from './markdown-table.mjs';

test('basic table: header + separator + data rows', () => {
  const out = mdTable(
    [{ a: 'one', b: 'two' }],
    { columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }] }
  );
  const lines = out.split('\n');
  assert.equal(lines[0], '| A | B |');
  assert.equal(lines[1], '| --- | --- |');
  assert.equal(lines[2], '| one | two |');
  assert.equal(lines.length, 3);
});

test('separator row honors per-column align l/r/c', () => {
  const out = mdTable([], {
    columns: [
      { key: 'a', header: 'A', align: 'l' },
      { key: 'b', header: 'B', align: 'r' },
      { key: 'c', header: 'C', align: 'c' },
      { key: 'd', header: 'D' },
    ],
  });
  const sep = out.split('\n')[1];
  assert.equal(sep, '| :--- | ---: | :---: | --- |');
});

test('align accepts long forms left/right/center', () => {
  const out = mdTable([], {
    columns: [
      { key: 'a', header: 'A', align: 'LEFT' },
      { key: 'b', header: 'B', align: 'Right' },
      { key: 'c', header: 'C', align: 'center' },
    ],
  });
  assert.equal(out.split('\n')[1], '| :--- | ---: | :---: |');
});

test('top-level align array applies positionally as fallback', () => {
  const out = mdTable([], {
    columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }],
    align: ['r', 'c'],
  });
  assert.equal(out.split('\n')[1], '| ---: | :---: |');
});

test('column own-align overrides top-level align', () => {
  const out = mdTable([], {
    columns: [{ key: 'a', header: 'A', align: 'l' }, { key: 'b', header: 'B' }],
    align: 'r',
  });
  assert.equal(out.split('\n')[1], '| :--- | ---: |');
});

test('pipe characters in cells are escaped', () => {
  const out = mdTable(
    [{ a: 'x | y' }],
    { columns: [{ key: 'a', header: 'H | dr' }] }
  );
  const lines = out.split('\n');
  assert.equal(lines[0], '| H \\| dr |');
  assert.equal(lines[2], '| x \\| y |');
});

test('newlines in cells collapse to a space', () => {
  const out = mdTable(
    [{ a: 'line1\nline2\r\nline3' }],
    { columns: [{ key: 'a', header: 'A' }] }
  );
  assert.equal(out.split('\n').length, 3); // header, sep, one data row (no extra rows)
  assert.equal(out.split('\n')[2], '| line1 line2 line3 |');
});

test('format callback transforms the cell', () => {
  const out = mdTable(
    [{ px: 1.5 }],
    { columns: [{ key: 'px', header: 'Price', format: (v) => `$${v.toFixed(2)}` }] }
  );
  assert.equal(out.split('\n')[2], '| $1.50 |');
});

test('format callback receives the full row object', () => {
  const out = mdTable(
    [{ a: 2, b: 3 }],
    { columns: [{ key: 'a', header: 'Sum', format: (v, row) => v + row.b }] }
  );
  assert.equal(out.split('\n')[2], '| 5 |');
});

test('format that throws falls back to raw value (soft-fail)', () => {
  const out = mdTable(
    [{ a: 'raw' }],
    { columns: [{ key: 'a', header: 'A', format: () => { throw new Error('boom'); } }] }
  );
  assert.equal(out.split('\n')[2], '| raw |');
});

test('missing keys render as empty cell', () => {
  const out = mdTable(
    [{ a: 'present' }],
    { columns: [{ key: 'a', header: 'A' }, { key: 'missing', header: 'B' }] }
  );
  assert.equal(out.split('\n')[2], '| present |  |');
});

test('non-string values coerced via String()', () => {
  const out = mdTable(
    [{ n: 42, b: true, o: null, u: undefined }],
    { columns: [
      { key: 'n', header: 'N' },
      { key: 'b', header: 'B' },
      { key: 'o', header: 'O' },
      { key: 'u', header: 'U' },
    ] }
  );
  assert.equal(out.split('\n')[2], '| 42 | true |  |  |');
});

test('cells are trimmed', () => {
  const out = mdTable(
    [{ a: '  spaced  ' }],
    { columns: [{ key: 'a', header: '  H  ' }] }
  );
  assert.equal(out.split('\n')[0], '| H |');
  assert.equal(out.split('\n')[2], '| spaced |');
});

test('empty rows => header-only table (header + separator)', () => {
  const out = mdTable([], { columns: [{ key: 'a', header: 'A' }] });
  assert.equal(out, '| A |\n| --- |');
});

test('header defaults to key when header omitted', () => {
  const out = mdTable([], { columns: [{ key: 'colkey' }] });
  assert.equal(out.split('\n')[0], '| colkey |');
});

test('no columns => empty string', () => {
  assert.equal(mdTable([{ a: 1 }], { columns: [] }), '');
  assert.equal(mdTable([{ a: 1 }]), '');
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => mdTable(null, null));
  assert.doesNotThrow(() => mdTable(undefined));
  assert.doesNotThrow(() => mdTable('not-an-array', { columns: 'nope' }));
  assert.doesNotThrow(() => mdTable([null, 5, 'x'], { columns: [{ key: 'a', header: 'A' }, null, 3] }));
});

test('mdTableFromMatrix builds a table', () => {
  const out = mdTableFromMatrix(['A', 'B'], [[1, 2], [3, 4]], { align: ['l', 'r'] });
  const lines = out.split('\n');
  assert.equal(lines[0], '| A | B |');
  assert.equal(lines[1], '| :--- | ---: |');
  assert.equal(lines[2], '| 1 | 2 |');
  assert.equal(lines[3], '| 3 | 4 |');
});

test('mdTableFromMatrix pads ragged rows and truncates overflow', () => {
  const out = mdTableFromMatrix(['A', 'B'], [[1], [1, 2, 3]]);
  const lines = out.split('\n');
  assert.equal(lines[2], '| 1 |  |');   // padded
  assert.equal(lines[3], '| 1 | 2 |');  // truncated to header count
});

test('mdTableFromMatrix with no headers => empty string', () => {
  assert.equal(mdTableFromMatrix([], [[1]]), '');
  assert.equal(mdTableFromMatrix(undefined, undefined), '');
});

test('mdTableFromMatrix never throws on garbage', () => {
  assert.doesNotThrow(() => mdTableFromMatrix('x', 'y', 'z'));
  assert.doesNotThrow(() => mdTableFromMatrix(['A'], [null, 7]));
});

test('esc() standalone: pipes, newlines, backslashes, coercion', () => {
  assert.equal(esc('a|b'), 'a\\|b');
  assert.equal(esc('a\nb'), 'a b');
  assert.equal(esc('a\\b'), 'a\\\\b');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(123), '123');
  assert.equal(esc('  trim  '), 'trim');
});
