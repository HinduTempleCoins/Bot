// integrations/scrape-throttle.test.mjs — offline tests for the per-host crawl pacer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeThrottle, waitTimes, hostKey } from './scrape-throttle.mjs';

test('hostKey: normalizes URLs, bare hosts, ports, paths, blanks', () => {
  assert.equal(hostKey('https://Example.com/a/b?q=1'), 'example.com');
  assert.equal(hostKey('http://host:8080/x'), 'host');
  assert.equal(hostKey('Host.NET:443'), 'host.net');
  assert.equal(hostKey('plainhost/path'), 'plainhost');
  assert.equal(hostKey(''), '(none)');
  assert.equal(hostKey('   '), '(none)');
  assert.equal(hostKey(undefined), '(none)');
  assert.equal(hostKey(null), '(none)');
});

test('nextDelay: 0 before any mark (host unseen)', () => {
  const t = makeThrottle({ minIntervalMs: 2000, now: () => 1000 });
  assert.equal(t.nextDelay('a.com'), 0);
});

test('nextDelay: full interval immediately after a mark', () => {
  let clock = 0;
  const t = makeThrottle({ minIntervalMs: 2000, now: () => clock });
  t.mark('a.com');
  assert.equal(t.nextDelay('a.com'), 2000);
});

test('nextDelay: shrinks as the clock advances, hits 0 at the interval', () => {
  let clock = 0;
  const t = makeThrottle({ minIntervalMs: 2000, now: () => clock });
  t.mark('a.com');
  clock = 500;
  assert.equal(t.nextDelay('a.com'), 1500);
  clock = 1999;
  assert.equal(t.nextDelay('a.com'), 1);
  clock = 2000;
  assert.equal(t.nextDelay('a.com'), 0);
  clock = 5000;
  assert.equal(t.nextDelay('a.com'), 0);
});

test('nextDelay: per-host independence', () => {
  let clock = 0;
  const t = makeThrottle({ minIntervalMs: 2000, now: () => clock });
  t.mark('a.com');
  // b.com never marked -> no wait, even while a.com is still cooling down.
  assert.equal(t.nextDelay('b.com'), 0);
  assert.equal(t.nextDelay('a.com'), 2000);
});

test('nextDelay does not mutate state (pure question)', () => {
  let clock = 0;
  const t = makeThrottle({ minIntervalMs: 1000, now: () => clock });
  t.mark('a.com');
  assert.equal(t.nextDelay('a.com'), 1000);
  assert.equal(t.nextDelay('a.com'), 1000); // unchanged on repeat call
});

test('URL and bare-host forms collapse to the same bucket', () => {
  let clock = 0;
  const t = makeThrottle({ minIntervalMs: 2000, now: () => clock });
  t.mark('https://news.example.com/page1');
  assert.equal(t.nextDelay('news.example.com'), 2000);
});

test('lastMark and reset', () => {
  let clock = 42;
  const t = makeThrottle({ minIntervalMs: 2000, now: () => clock });
  assert.equal(t.lastMark('a.com'), null);
  t.mark('a.com');
  assert.equal(t.lastMark('a.com'), 42);
  t.reset('a.com');
  assert.equal(t.lastMark('a.com'), null);
  // reset-all
  t.mark('a.com');
  t.mark('b.com');
  t.reset();
  assert.equal(t.lastMark('a.com'), null);
  assert.equal(t.lastMark('b.com'), null);
});

test('soft-fail: bad minIntervalMs falls back to default 2000', () => {
  let clock = 0;
  for (const bad of [-5, NaN, Infinity, 'nope', undefined]) {
    const t = makeThrottle({ minIntervalMs: bad, now: () => clock });
    assert.equal(t.minIntervalMs, 2000, `fallback for ${String(bad)}`);
  }
});

test('soft-fail: non-function clock falls back to Date.now without throwing', () => {
  const t = makeThrottle({ minIntervalMs: 1000, now: 123 });
  assert.doesNotThrow(() => t.mark('a.com'));
  assert.doesNotThrow(() => t.nextDelay('a.com'));
});

test('defaults: no args yields 2000ms throttle', () => {
  const t = makeThrottle();
  assert.equal(t.minIntervalMs, 2000);
});

test('waitTimes: distinct hosts all start at offset 0', () => {
  assert.deepEqual(waitTimes(['a.com', 'b.com', 'c.com'], 2000), [0, 0, 0]);
});

test('waitTimes: repeated host paced by interval', () => {
  assert.deepEqual(waitTimes(['a.com', 'a.com', 'a.com'], 2000), [0, 2000, 4000]);
});

test('waitTimes: interleaved hosts pace independently', () => {
  // a, b, a, b -> a:0, b:0, a:2000, b:2000
  assert.deepEqual(
    waitTimes(['a.com', 'b.com', 'a.com', 'b.com'], 2000),
    [0, 0, 2000, 2000],
  );
});

test('waitTimes: URL/bare-host forms share a bucket for pacing', () => {
  assert.deepEqual(
    waitTimes(['https://a.com/x', 'a.com', 'http://a.com:80/y'], 1000),
    [0, 1000, 2000],
  );
});

test('waitTimes: empty / non-array input -> empty array', () => {
  assert.deepEqual(waitTimes([], 2000), []);
  assert.deepEqual(waitTimes(undefined, 2000), []);
  assert.deepEqual(waitTimes(null), []);
});

test('waitTimes: bad interval falls back to default', () => {
  assert.deepEqual(waitTimes(['a.com', 'a.com'], -1), [0, 2000]);
});
