// integrations/calendar.test.mjs — offline, deterministic tests for the shared ecosystem calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendar, toMs, ymd, SOURCES, esc } from './calendar.mjs';

// A fixed clock so nothing depends on the wall clock. 2026-09-15T00:00:00Z.
const FIXED = Date.UTC(2026, 8, 15);
const fixedNow = () => FIXED;
const fresh = () => createCalendar({ storage: { events: [] }, now: fixedNow });

test('addEvent validates title + start and soft-fails (never throws)', () => {
  const cal = fresh();
  assert.equal(cal.addEvent({ start: FIXED }).ok, false);                 // no title
  assert.equal(cal.addEvent({ title: 'x', start: 'not-a-date' }).ok, false); // bad start
  assert.equal(cal.addEvent().ok, false);                                 // no args
  const r = cal.addEvent({ title: 'Block Party', start: '2026-09-20', source: 'soapbox', category: 'community' });
  assert.equal(r.ok, true);
  assert.equal(r.event.source, 'soapbox');
  assert.equal(r.event.title, 'Block Party');
  assert.equal(Number.isFinite(r.event.start), true);
  // unknown source falls back to 'melek', not a throw
  assert.equal(cal.addEvent({ title: 'y', start: FIXED, source: 'bogus' }).event.source, 'melek');
});

test('toMs parses ms numbers, digit strings and ISO deterministically', () => {
  assert.equal(toMs(1000), 1000);
  assert.equal(toMs('1000'), 1000);
  assert.equal(toMs('2026-09-01'), Date.UTC(2026, 8, 1));
  assert.equal(Number.isNaN(toMs('nope')), true);
  assert.equal(Number.isNaN(toMs(null)), true);
});

test('events() filters by range, source, category and sorts by start', () => {
  const cal = fresh();
  cal.addEvent({ title: 'A', start: Date.UTC(2026, 8, 10), source: 'melek', category: 'drop' });
  cal.addEvent({ title: 'B', start: Date.UTC(2026, 8, 5),  source: 'gtarcade', category: 'tournament' });
  cal.addEvent({ title: 'C', start: Date.UTC(2026, 8, 20), source: 'melek', category: 'community' });

  const sorted = cal.events();
  assert.deepEqual(sorted.map((e) => e.title), ['B', 'A', 'C']); // sorted by start

  const inRange = cal.events({ from: Date.UTC(2026, 8, 8), to: Date.UTC(2026, 8, 15) });
  assert.deepEqual(inRange.map((e) => e.title), ['A']);

  assert.deepEqual(cal.events({ source: 'melek' }).map((e) => e.title), ['A', 'C']);
  assert.deepEqual(cal.events({ category: 'tournament' }).map((e) => e.title), ['B']);
});

test('upcoming() returns next n events from the injected clock', () => {
  const cal = fresh();
  cal.addEvent({ title: 'past',   start: Date.UTC(2026, 7, 1) });   // before FIXED
  cal.addEvent({ title: 'soon',   start: Date.UTC(2026, 8, 16) });  // after FIXED
  cal.addEvent({ title: 'later',  start: Date.UTC(2026, 8, 25) });
  cal.addEvent({ title: 'latest', start: Date.UTC(2026, 9, 1) });

  const up = cal.upcoming(2);
  assert.deepEqual(up.map((e) => e.title), ['soon', 'later']);
  assert.equal(cal.upcoming(0).length, 3); // 0 → all upcoming
});

test('day() and month() window events; agenda() groups by day', () => {
  const cal = fresh();
  cal.addEvent({ title: 'D1', start: Date.UTC(2026, 8, 15, 9, 0) });
  cal.addEvent({ title: 'D2', start: Date.UTC(2026, 8, 15, 18, 0) });
  cal.addEvent({ title: 'other', start: Date.UTC(2026, 8, 16) });
  cal.addEvent({ title: 'octobery', start: Date.UTC(2026, 9, 3) });

  assert.deepEqual(cal.day(FIXED).map((e) => e.title).sort(), ['D1', 'D2']);
  assert.deepEqual(cal.month(2026, 9).map((e) => e.title).sort(), ['D1', 'D2', 'other']); // September
  assert.deepEqual(cal.month(2026, 10).map((e) => e.title), ['octobery']);

  const ag = cal.agenda(FIXED, 2);
  assert.equal(ag.length, 2);
  assert.equal(ag[0].date, '2026-09-15');
  assert.deepEqual(ag[0].events.map((e) => e.title).sort(), ['D1', 'D2']);
  assert.deepEqual(ag[1].events.map((e) => e.title), ['other']);
});

test('recurring() expands deterministically from the given start (not the clock)', () => {
  const cal = fresh();
  const r = cal.recurring({ title: 'Weekly Raid', source: 'gtarcade', everyDays: 7, count: 4, start: '2026-10-01' });
  assert.equal(r.ok, true);
  assert.equal(r.added, 4);
  const starts = r.events.map((e) => e.start);
  assert.deepEqual(starts, [
    Date.UTC(2026, 9, 1),
    Date.UTC(2026, 9, 8),
    Date.UTC(2026, 9, 15),
    Date.UTC(2026, 9, 22),
  ]);
  assert.equal(cal.events({ source: 'gtarcade' }).length, 4);
  // soft-fails
  assert.equal(cal.recurring({ title: 'x', everyDays: 0, count: 3, start: FIXED }).ok, false);
  assert.equal(cal.recurring({ everyDays: 1, count: 3, start: FIXED }).ok, false);
});

test('seedHarvestSeason() creates the 6 Founders-Season events as source:harvest', () => {
  const cal = fresh();
  const r = cal.seedHarvestSeason(2026);
  assert.equal(r.ok, true);
  assert.equal(r.added, 6);
  const harvest = cal.events({ source: 'harvest' });
  assert.equal(harvest.length, 6);
  assert.equal(harvest.every((e) => e.source === 'harvest'), true);
  const titles = harvest.map((e) => e.title);
  assert.ok(titles.includes('Founding Planting'));
  assert.ok(titles.includes('First Harvest Fair'));
  assert.ok(titles.includes('Hollow Harvest'));
  assert.ok(titles.some((t) => t.startsWith('Día de los Muertos')));
  assert.ok(titles.includes('Cornucopia'));
  assert.ok(titles.includes("Founders' Advent"));
  // Founding Planting = Sept 1; Advent = Dec 1 (deterministic UTC)
  const planting = harvest.find((e) => e.title === 'Founding Planting');
  assert.equal(planting.start, Date.UTC(2026, 8, 1));
  const muertos = harvest.find((e) => e.title.startsWith('Día'));
  assert.equal(muertos.allDay, true);
  assert.equal(muertos.end, Date.UTC(2026, 10, 2)); // ends Nov 2
  assert.equal(cal.seedHarvestSeason('bad').ok, false);
});

test('renderAgenda() is esc-safe and links when a url is present', () => {
  const cal = fresh();
  cal.addEvent({ title: '<script>x</script>', start: FIXED, source: 'melek', url: 'https://x/"onerror' });
  const html = cal.renderAgenda(cal.events());
  assert.ok(!html.includes('<script>'));       // title escaped
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('"onerror'));        // url attribute escaped
  assert.ok(html.includes('&quot;onerror'));
  assert.equal(cal.renderAgenda([]).includes('No events.'), true);
  assert.equal(esc('<>'), '&lt;&gt;');
  assert.deepEqual(SOURCES.includes('harvest'), true);
  assert.equal(ymd(FIXED), '2026-09-15');
});

// ── handler ──────────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return { code: 0, body: '', headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; } };
}

test('handler: /health, GET /api/events (filtered), POST /api/event, 404', async () => {
  const cal = fresh();
  cal.seedHarvestSeason(2026);

  let res = mockRes();
  await cal.handler({ url: '/health', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).service, 'melek-calendar');

  res = mockRes();
  await cal.handler({ url: '/api/events?source=harvest', method: 'GET' }, res);
  let out = JSON.parse(res.body);
  assert.equal(res.code, 200);
  assert.equal(out.count, 6);

  res = mockRes();
  await cal.handler({ url: '/api/event', method: 'POST', body: { title: 'Posted', start: '2026-09-19', source: 'seeds-farm' } }, res);
  out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.event.source, 'seeds-farm');
  assert.equal(cal.events({ source: 'seeds-farm' }).length, 1);

  // bad POST body soft-fails (no throw)
  res = mockRes();
  await cal.handler({ url: '/api/event', method: 'POST', body: { start: FIXED } }, res);
  assert.equal(JSON.parse(res.body).ok, false);

  // 404
  res = mockRes();
  await cal.handler({ url: '/nope', method: 'GET' }, res);
  assert.equal(res.code, 404);
  assert.equal(JSON.parse(res.body).ok, false);
});
