import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  zonedParts, tzOffsetMs, zonedTimeToUtc, holidays, holidayName, isBusinessDay,
  addBusinessDays, easter, goodFriday, isOpen, nextOpen, msUntilOpen, scheduleSend,
  DEFAULT_HOURS, TX_STATE, FEDERAL, RECEIPT_NOTES, handler,
} from './business-hours.mjs';

const CHI = 'America/Chicago';

test('zonedParts reads wall clock in the named zone, not the server zone', () => {
  // 2026-09-08T03:35Z is still Monday the 7th in Dallas
  const p = zonedParts('2026-09-08T03:35:00Z', CHI);
  assert.equal(p.date, '2026-09-07');
  assert.equal(p.hour, 22);
  assert.equal(p.weekday, 1, 'Monday');
});

test('DST is handled because Intl is asked, not assumed', () => {
  // CDT (-5) in July, CST (-6) in January
  assert.equal(tzOffsetMs('2026-07-01T12:00:00Z', CHI) / 3600000, -5);
  assert.equal(tzOffsetMs('2026-01-01T12:00:00Z', CHI) / 3600000, -6);
});

test('zonedTimeToUtc round-trips across the DST boundary', () => {
  const summer = zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 8 }, CHI);
  assert.equal(summer.toISOString(), '2026-07-01T13:00:00.000Z');
  const winter = zonedTimeToUtc({ year: 2026, month: 1, day: 5, hour: 8 }, CHI);
  assert.equal(winter.toISOString(), '2026-01-05T14:00:00.000Z');
  const back = zonedParts(summer, CHI);
  assert.equal(back.hour, 8);
});

test('Texas holidays are the STATUTORY list, not the federal one', () => {
  const tx = holidays(2026, { regime: 'TX_PIA' });
  // § 662.003(b) dates that no federal calendar carries
  assert.ok(tx.has('2026-01-19'), 'Confederate Heroes Day');
  assert.ok(tx.has('2026-03-02'), 'Texas Independence Day');
  assert.ok(tx.has('2026-04-21'), 'San Jacinto Day');
  assert.ok(tx.has('2026-08-27'), 'LBJ Day');
  assert.ok(tx.has('2026-12-24') && tx.has('2026-12-26'), '24 and 26 December');
  // and NOT Columbus Day, which Texas omits
  assert.ok(!tx.has('2026-10-12'), 'no Columbus Day in the Texas list');
});

test('the federal list differs, and that difference is the point', () => {
  const fed = holidays(2026, { regime: 'FEDERAL' });
  assert.ok(fed.has('2026-10-12'), 'Columbus Day is federal');
  assert.ok(fed.has('2026-06-19'), 'Juneteenth is federal');
  assert.ok(!fed.has('2026-03-02'), 'Texas Independence Day is not federal');
  assert.ok(!fed.has('2026-12-24'), '24 December is not a federal holiday');
});

test('Labor Day 2026 is the first Monday in September', () => {
  assert.equal(holidayName('2026-09-07'), 'Labor Day');
  assert.equal(isBusinessDay('2026-09-07'), false);
  assert.equal(isBusinessDay('2026-09-08'), true);
});

test('§ 552.0031(e) — a weekend holiday moves to the observed weekday', () => {
  // 4 July 2026 is a Saturday, so Friday the 3rd is the nonbusiness day
  assert.equal(new Date('2026-07-04T12:00:00Z').getUTCDay(), 6);
  assert.match(holidayName('2026-07-03') || '', /observed Friday/);
  assert.equal(isBusinessDay('2026-07-03'), false);
  // and it can be turned off
  assert.equal(isBusinessDay('2026-07-03', { observed: false }), true);
});

test('computus: Easter and Good Friday', () => {
  assert.equal(easter(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(goodFriday(2026).toISOString().slice(0, 10), '2026-04-03');
  assert.equal(holidayName('2026-04-03', { optional: true }), 'Good Friday (optional)');
  assert.equal(holidayName('2026-04-03'), null, 'not counted unless asked for');
});

test('weekends are never business days', () => {
  assert.equal(isBusinessDay('2026-09-12'), false); // Saturday
  assert.equal(isBusinessDay('2026-09-13'), false); // Sunday
});

test('addBusinessDays skips weekends AND Texas holidays, and says which', () => {
  // From Thursday 24 Dec 2026 (itself a TX holiday) forward two business days.
  const r = addBusinessDays('2026-12-23', 2);
  const skipped = r.skipped.map((s) => s.date);
  assert.ok(skipped.includes('2026-12-24'), '24 December skipped');
  assert.ok(skipped.includes('2026-12-25'), 'Christmas skipped');
  assert.ok(r.skipped.some((s) => s.why === 'weekend'));
  assert.equal(r.date, '2026-12-29');
});

test('every deadline is returned as an estimate, because § 552.0031(f) exists', () => {
  const r = addBusinessDays('2026-09-08', 10);
  assert.equal(r.exact, false);
  assert.match(r.caveat, /552\.0031\(f\)/);
  assert.match(r.caveat, /10 additional nonbusiness days/);
});

test('caller-designated nonbusiness days are honoured when we learn them', () => {
  assert.equal(isBusinessDay('2026-09-09'), true);
  assert.equal(isBusinessDay('2026-09-09', { designated: ['2026-09-09'] }), false);
});

test('isOpen respects the zone, the weekday, the holiday and the clock', () => {
  assert.equal(isOpen('2026-09-08T14:00:00Z', { tz: CHI }), true);   // 09:00 CDT Tuesday
  assert.equal(isOpen('2026-09-08T03:35:00Z', { tz: CHI }), false);  // 22:35 Labor Day
  assert.equal(isOpen('2026-09-08T12:30:00Z', { tz: CHI }), false);  // 07:30, before opening
  assert.equal(isOpen('2026-09-08T22:00:00Z', { tz: CHI }), false);  // 17:00, after closing
  assert.equal(isOpen('2026-09-12T16:00:00Z', { tz: CHI }), false);  // Saturday
});

test('nextOpen jumps the holiday and lands on opening time', () => {
  // Labor Day evening -> 08:00 CDT Tuesday = 13:00Z
  const n = nextOpen('2026-09-08T03:35:00Z', { tz: CHI });
  assert.equal(n.toISOString(), '2026-09-08T13:00:00.000Z');
  // already open -> now
  const open = new Date('2026-09-08T14:00:00Z');
  assert.equal(nextOpen(open, { tz: CHI }).getTime(), open.getTime());
});

test('nextOpen crosses a weekend plus a Monday holiday in one hop', () => {
  // Friday 4 Sep 2026 after close -> Tuesday 8 Sep, because Mon 7th is Labor Day
  const n = nextOpen('2026-09-04T23:00:00Z', { tz: CHI });
  assert.equal(n.toISOString().slice(0, 10), '2026-09-08');
});

test('msUntilOpen is zero when open and positive when shut', () => {
  assert.equal(msUntilOpen('2026-09-08T14:00:00Z', { tz: CHI }), 0);
  assert.ok(msUntilOpen('2026-09-08T03:35:00Z', { tz: CHI }) > 0);
});

test('scheduleSend is the fix for a 3 a.m. retry storm', () => {
  const closed = scheduleSend('2026-09-08T03:35:00Z', { tz: CHI }, { backoffMs: 60000 });
  assert.equal(closed.sendNow, false);
  assert.match(closed.reason, /Labor Day/);
  assert.equal(closed.at, '2026-09-08T13:00:00.000Z');
  assert.match(closed.localNow, /2026-09-07 22:35 America\/Chicago/);

  const open = scheduleSend('2026-09-08T14:00:00Z', { tz: CHI }, { backoffMs: 60000 });
  assert.equal(open.sendNow, true);
  assert.equal(open.reason, 'office is open');
  assert.equal(open.at, '2026-09-08T14:01:00.000Z', 'inside hours the caller backoff is used');
});

test('scheduleSend names why it is closed', () => {
  assert.match(scheduleSend('2026-09-12T16:00:00Z', { tz: CHI }).reason, /weekend/);
  assert.match(scheduleSend('2026-09-08T12:30:00Z', { tz: CHI }).reason, /before opening/);
  assert.match(scheduleSend('2026-09-08T22:00:00Z', { tz: CHI }).reason, /after closing/);
});

test('a DC recipient opens an hour before a Dallas one, in real time', () => {
  const dc = nextOpen('2026-09-08T03:35:00Z', { tz: 'America/New_York' });
  const tx = nextOpen('2026-09-08T03:35:00Z', { tz: CHI });
  assert.equal(dc.toISOString(), '2026-09-08T12:00:00.000Z');
  assert.equal(tx.getTime() - dc.getTime(), 3600000);
});

test('the receipt notes carry the verified statutory reason to fax rather than mail', () => {
  assert.match(RECEIPT_NOTES.mail, /552\.301\(a-1\)/);
  assert.match(RECEIPT_NOTES.mail, /THIRD business day after the postmark/);
  assert.match(RECEIPT_NOTES.fax, /no after-hours rule/);
});

test('defaults are Dallas-shaped and the shape is declared', () => {
  assert.equal(DEFAULT_HOURS.tz, CHI);
  assert.deepEqual(DEFAULT_HOURS.days, [1, 2, 3, 4, 5]);
  assert.equal(TX_STATE.length, 8);
  assert.equal(FEDERAL.length, 11);
});

test('handler serves holidays, deadlines and the current window', () => {
  const call = (url) => {
    const res = { statusCode: 0, headers: {}, body: '',
      setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    handler({ url }, res);
    return JSON.parse(res.body);
  };
  const h = call('/bh/holidays?year=2026&regime=TX_PIA');
  assert.ok(h.holidays.some((x) => x.date === '2026-03-02'));
  assert.ok(h.holidays.every((x, i, a) => i === 0 || a[i - 1].date <= x.date), 'sorted');

  const d = call('/bh/deadline?from=2026-09-08&days=10');
  assert.equal(d.exact, false);
  assert.match(d.date, /^2026-09-2\d$/);

  const s = call('/bh/?at=2026-09-08T03:35:00Z&tz=America/Chicago');
  assert.equal(s.open, false);
  assert.match(s.schedule.reason, /Labor Day/);
});
