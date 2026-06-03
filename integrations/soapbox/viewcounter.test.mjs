import { test } from 'node:test';
import assert from 'node:assert';
import { record, count, summary, formatViews, memStore } from './viewcounter.mjs';

test('record increments real hits; count reads the total', () => {
  const store = memStore();
  assert.equal(count('/markets', store), 0); // never invented — starts at 0
  record({ page: '/markets', store });
  record({ page: '/markets', store });
  record({ page: '/markets', store });
  assert.equal(count('/markets', store), 3);
  assert.equal(count('/unseen', store), 0); // untouched page is genuinely 0
});

test('unique dedup then discard: views count all hits, uniques count distinct ipHashes', () => {
  const store = memStore();
  record({ page: '/p', store, ipHash: 'alice' });
  record({ page: '/p', store, ipHash: 'alice' }); // same visitor again
  record({ page: '/p', store, ipHash: 'bob' });
  const s = summary(store);
  assert.equal(s.pages['/p'].views, 3);
  assert.equal(s.pages['/p'].uniques, 2);
  // privacy: the identifier set is never surfaced in the public record
  assert.deepEqual(Object.keys(s.pages['/p']).sort(), ['uniques', 'views']);
  assert.equal(s.pages['/p']._seen, undefined);
});

test('record without ipHash still counts views but leaves uniques at 0', () => {
  const store = memStore();
  record({ page: '/anon', store });
  record({ page: '/anon', store });
  const s = summary(store);
  assert.equal(s.pages['/anon'].views, 2);
  assert.equal(s.pages['/anon'].uniques, 0);
});

test('record returns the public view (views/uniques only)', () => {
  const store = memStore();
  const r = record({ page: '/x', store, ipHash: 'h' });
  assert.deepEqual(r, { views: 1, uniques: 1 });
});

test('summary aggregates pages and totals', () => {
  const store = memStore();
  record({ page: '/a', store, ipHash: '1' });
  record({ page: '/a', store, ipHash: '2' });
  record({ page: '/b', store, ipHash: '1' });
  const s = summary(store);
  assert.equal(s.totalViews, 3);
  assert.equal(s.totalUniques, 3);
  assert.deepEqual(Object.keys(s.pages).sort(), ['/a', '/b']);
});

test('formatViews: K/M/B with trimmed trailing zero', () => {
  assert.equal(formatViews(5), '5');
  assert.equal(formatViews(999), '999');
  assert.equal(formatViews(1000), '1K');
  assert.equal(formatViews(1200), '1.2K');
  assert.equal(formatViews(3_400_000), '3.4M');
  assert.equal(formatViews(2_000_000_000), '2B');
});

test('formatViews: guards bad input to "0" (never fabricates)', () => {
  assert.equal(formatViews(NaN), '0');
  assert.equal(formatViews(-5), '0');
  assert.equal(formatViews(undefined), '0');
  assert.equal(formatViews(12.9), '12'); // floors, no rounding-up invention
});

test('record validates inputs', () => {
  const store = memStore();
  assert.throws(() => record({ store }), /page is required/);
  assert.throws(() => record({ page: '/p' }), /store with incr/);
});
