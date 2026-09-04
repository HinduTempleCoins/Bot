// pentecaust/herald/deliverability-hud.test.mjs — offline node --test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hudRow, buildHud, renderHud, summary } from './deliverability-hud.mjs';

test('hudRow: clean domain grades ok/green', () => {
  const r = hudRow({ domain: 'go.pentecaust.com', sent: 1000, bounces: 5, complaints: 0, warmupDay: 40 });
  assert.equal(r.status, 'ok');
  assert.equal(r.light, 'green');
  assert.equal(r.warming, false);       // day 40 >= 28
  assert.equal(r.dailyCap, 50);         // warmupCap max
  assert.equal(r.bounceRate, 0.005);    // 0.5% < 1.5% warn
  assert.equal(r.complaintRate, 0);
});

test('hudRow: high bounce trips stop/red with a reason', () => {
  const r = hudRow({ domain: 'blast.example.com', sent: 500, bounces: 20, complaints: 0, warmupDay: 60 });
  assert.equal(r.status, 'stop');       // 4% >= 2%
  assert.equal(r.light, 'red');
  assert.ok(r.reasons.some((x) => /bounce/.test(x)));
});

test('hudRow: complaint over 0.3% trips stop', () => {
  const r = hudRow({ domain: 'x.com', sent: 1000, bounces: 0, complaints: 5, warmupDay: 30 });
  assert.equal(r.status, 'stop');       // 0.5% >= 0.3%
  assert.equal(r.light, 'red');
});

test('hudRow: mid-warmup shows a reduced cap and warming flag', () => {
  const r = hudRow({ domain: 'new.melek.salon', sent: 100, bounces: 0, complaints: 0, warmupDay: 0 });
  assert.equal(r.warming, true);
  assert.equal(r.dailyCap, 10);         // first day of ramp
  assert.equal(r.status, 'ok');
});

test('hudRow: soft-fail on garbage input, no throw', () => {
  const r = hudRow({});
  assert.equal(r.domain, '(unknown)');
  assert.equal(r.sent, 0);
  assert.equal(r.bounceRate, 0);
  assert.equal(r.status, 'ok');
  const r2 = hudRow({ domain: 'a', sent: 'x', bounces: -5, complaints: null, warmupDay: 'q' });
  assert.equal(r2.sent, 0);
  assert.equal(r2.bounces, 0);          // negative clamped
  assert.equal(r2.warmupDay, 0);
});

test('buildHud: non-array input yields empty fleet', () => {
  assert.deepEqual(buildHud(null), []);
  assert.deepEqual(buildHud(undefined), []);
  assert.equal(buildHud([{ domain: 'a', sent: 1 }]).length, 1);
});

test('summary: counts by disposition (raw rows)', () => {
  const rows = [
    { domain: 'ok1', sent: 1000, bounces: 1, complaints: 0, warmupDay: 40 },
    { domain: 'ok2', sent: 100, bounces: 0, complaints: 0, warmupDay: 0 },   // warming, ok
    { domain: 'thr', sent: 1000, bounces: 16, complaints: 0, warmupDay: 40 }, // 1.6% -> throttle
    { domain: 'bad', sent: 1000, bounces: 30, complaints: 0, warmupDay: 40 }, // 3% -> stop
  ];
  const s = summary(rows);
  assert.equal(s.total, 4);
  assert.equal(s.ok, 2);
  assert.equal(s.throttle, 1);
  assert.equal(s.stop, 1);
  assert.equal(s.warming, 1);
  assert.equal(s.sent, 3100);
});

test('summary: accepts already-graded rows without re-grading wrong', () => {
  const graded = buildHud([{ domain: 'ok1', sent: 1000, bounces: 1, complaints: 0, warmupDay: 40 }]);
  const s = summary(graded);
  assert.equal(s.ok, 1);
  assert.equal(s.total, 1);
});

test('renderHud: escapes domain, emits bands and summary', () => {
  const html = renderHud([
    { domain: '<script>x</script>&evil', sent: 1000, bounces: 30, complaints: 0, warmupDay: 40 },
  ]);
  assert.ok(!html.includes('<script>x</script>'));      // escaped
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;evil'));
  assert.ok(html.includes('data-light="red"'));
  assert.ok(html.includes('STOP'));
  assert.ok(html.includes('deliverability-hud'));
  assert.ok(html.includes('dh-summary'));
});

test('renderHud: empty fleet renders a friendly empty board', () => {
  const html = renderHud([]);
  assert.ok(html.includes('dh-empty'));
  assert.ok(html.includes('GO 0'));
});

test('renderHud: warming domain shows a warmup badge', () => {
  const html = renderHud([{ domain: 'new.io', sent: 10, bounces: 0, complaints: 0, warmupDay: 5 }]);
  assert.ok(html.includes('warmup 5/28'));
});
