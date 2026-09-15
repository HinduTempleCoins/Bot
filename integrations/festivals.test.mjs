// OFFLINE. Pure parsing — no network, no clock in asserted logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIcs, parseLine, parseIcalDate, unfold, normalize, merge, dedupeKey, upcoming,
  toIcs, fold, escapeText, unescapeText, guessCity, normKind,
} from './festivals.mjs';

const DAY = 86400000;

test('⚠️ FOLDED LINES are unfolded before anything is read', () => {
  // RFC 5545 §3.1 folds at 75 octets with CRLF + one space. Parse without unfolding and a long
  // SUMMARY silently truncates mid-word — the failure looks like bad data, not a bad parser.
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260417',
    'SUMMARY:Psychedelic Culture 2026 - The Bay Area Annual Spring Conference on Plant',
    '  Medicines and Psychedelic Science', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const { events } = parseIcs(ics);
  assert.equal(events.length, 1);
  // The fold marker is CRLF + exactly ONE whitespace and is removed. A space that belongs to the
  // CONTENT therefore has to be the SECOND space on the continuation line. Put it in both places and
  // you get a double space; put it in neither and you get 'PlantMedicines'.
  assert.match(events[0].title, /Plant Medicines and Psychedelic Science$/,
    'the fold marker is removed and only the content space survives');
  assert.ok(!events[0].title.includes('\n'));
  assert.equal(unfold('a\r\n b'), 'ab');
  assert.equal(unfold('a\n\tb'), 'ab');
});

test('⭐ DTEND IS EXCLUSIVE for all-day events — the bug that adds a day to every festival', () => {
  // A one-day festival on the 17th is 20260417 → 20260418. Read literally, every all-day event runs
  // a day long and a 3-day festival shows the wrong closing date to everyone who looks.
  const one = parseIcs(['BEGIN:VEVENT', 'SUMMARY:One Day', 'DTSTART;VALUE=DATE:20260417',
    'DTEND;VALUE=DATE:20260418', 'END:VEVENT'].join('\r\n')).events[0];
  assert.equal(one.start, Date.UTC(2026, 3, 17));
  assert.equal(one.end, Date.UTC(2026, 3, 17), 'end must come back to the 17th, not the 18th');
  assert.equal(one.days, 1);

  const three = parseIcs(['BEGIN:VEVENT', 'SUMMARY:Three Day', 'DTSTART;VALUE=DATE:20260417',
    'DTEND;VALUE=DATE:20260420', 'END:VEVENT'].join('\r\n')).events[0];
  assert.equal(three.end, Date.UTC(2026, 3, 19));
  assert.equal(three.days, 3, 'Apr 17-19 inclusive is three days');

  // ⚠️ and a TIMED event's DTEND is INCLUSIVE — the rule must not be applied to both
  const timed = parseIcs(['BEGIN:VEVENT', 'SUMMARY:Timed', 'DTSTART:20260417T180000Z',
    'DTEND:20260417T210000Z', 'END:VEVENT'].join('\r\n')).events[0];
  assert.equal(timed.end - timed.start, 3 * 3600000);
  assert.equal(timed.allDay, false);
});

test('escaped text is unescaped, and round-trips', () => {
  const e = parseIcs(['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260101',
    'SUMMARY:Dallas\\, TX: music\; art\\nand food', 'END:VEVENT'].join('\r\n')).events[0];
  assert.equal(e.title, 'Dallas, TX: music; art\nand food');
  assert.equal(unescapeText(escapeText('a, b; c\nd')), 'a, b; c\nd');
});

test('parseLine reads params, quoted values and TZID', () => {
  assert.deepEqual(parseLine('DTSTART;TZID=America/Chicago:20260417T190000'),
    { name: 'DTSTART', params: { TZID: 'America/Chicago' }, value: '20260417T190000' });
  assert.deepEqual(parseLine('SUMMARY;X="a:b":hello'), { name: 'SUMMARY', params: { X: 'a:b' }, value: 'hello' });
  assert.equal(parseLine('no-colon-here'), null);
});

test('⚠️ a floating local time is read as UTC and SAYS SO rather than pretending', () => {
  const floating = parseIcalDate('20260417T190000', {});
  assert.equal(floating.tzApprox, true, 'a caller must be able to see the approximation');
  assert.equal(parseIcalDate('20260417T190000Z', {}).tzApprox, false);
  assert.equal(parseIcalDate('20260417', {}).allDay, true);
  assert.ok(Number.isNaN(parseIcalDate('nonsense', {}).ms));
});

test('one bad VEVENT does not cost you the other two hundred', () => {
  const ics = ['BEGIN:VEVENT', 'SUMMARY:Good', 'DTSTART;VALUE=DATE:20260417', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260418', 'END:VEVENT',                      // no SUMMARY
    'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT',                                  // no DTSTART
    'BEGIN:VEVENT', 'SUMMARY:Bad date', 'DTSTART:banana', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Also good', 'DTSTART;VALUE=DATE:20260419', 'END:VEVENT'].join('\r\n');
  const { events, skipped } = parseIcs(ics);
  assert.deepEqual(events.map((e) => e.title), ['Good', 'Also good']);
  assert.equal(skipped.length, 3);
  assert.ok(skipped.every((s) => s.reason), 'every skip must record why');
  for (const junk of ['', '   ', 'not ical', null, undefined]) assert.deepEqual(parseIcs(junk).events, []);
});

test('⚠️ the same festival on three feeds is ONE event — UID is not enough', () => {
  // The organiser's calendar, the venue's, and an aggregator's each carry their own UID.
  const a = normalize({ uid: 'org-1', title: 'The Oregon Eclipse Festival 2026', start: Date.UTC(2026, 7, 12), source: 'organiser' });
  const b = normalize({ uid: 'venue-9', title: 'Oregon Eclipse Festival', start: Date.UTC(2026, 7, 12), source: 'venue', url: 'https://x.test/e', location: 'Big Summit Prairie, OR' });
  const c = normalize({ uid: 'agg-77', title: 'oregon eclipse festival!', start: Date.UTC(2026, 7, 12), source: 'aggregator' });
  const { events, duplicates } = merge([[a], [b], [c]]);
  assert.equal(events.length, 1, 'three listings, one festival');
  assert.equal(duplicates.length, 2);
  assert.match(events[0].source, /organiser/);
  assert.equal(events[0].url, 'https://x.test/e', 'the richer listing wins the details');

  // a DIFFERENT date is a different event, same title
  const later = normalize({ title: 'Oregon Eclipse Festival', start: Date.UTC(2027, 7, 12), source: 'organiser' });
  assert.equal(merge([[a], [later]]).events.length, 2);
  assert.notEqual(dedupeKey(a), dedupeKey(later));
});

test('upcoming filters on END, so you stay listed while you are running', () => {
  const now = Date.UTC(2026, 3, 18);
  const running = normalize({ title: 'Mid-festival', start: Date.UTC(2026, 3, 17), end: Date.UTC(2026, 3, 20), allDay: true });
  const past = normalize({ title: 'Over', start: Date.UTC(2026, 3, 1), end: Date.UTC(2026, 3, 2), allDay: true });
  const future = normalize({ title: 'Later', start: Date.UTC(2026, 5, 1), allDay: true });
  const got = upcoming([past, running, future], now);
  assert.deepEqual(got.map((e) => e.title), ['Mid-festival', 'Later'],
    'a festival already under way is exactly the one somebody is searching for');
});

test('⭐ a round trip through .ics does not lose a day', () => {
  const src = normalize({ title: 'Three Day Fest', start: Date.UTC(2026, 3, 17), end: Date.UTC(2026, 3, 19), allDay: true, location: 'Austin, TX' });
  const back = parseIcs(toIcs([src], { now: 0 })).events[0];
  assert.equal(back.start, src.start);
  assert.equal(back.end, src.end, 'the exclusive-DTEND rule must invert on the way out too');
  assert.equal(back.days, 3);
  assert.equal(back.title, 'Three Day Fest');
  assert.equal(back.city, 'Austin');
});

test('emitted lines fold at 75 octets and the calendar is well-formed', () => {
  const long = normalize({ title: 'A'.repeat(200), start: Date.UTC(2026, 0, 1), allDay: true });
  const ics = toIcs([long], { now: 0 });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'no emitted line may exceed 75 octets');
  assert.equal(parseIcs(ics).events[0].title, 'A'.repeat(200), 'and it must read back whole');
  assert.equal(fold('short'), 'short');
});

test('city is a best-effort guess and kinds are closed', () => {
  assert.equal(guessCity('Brava Theater, 2781 24th St, San Francisco, CA 94110, USA'), 'San Francisco');
  assert.equal(guessCity('Somewhere'), '');
  assert.equal(normKind('FESTIVAL'), 'festival');
  assert.equal(normKind('rave'), 'other', 'an unknown kind must not invent a category');
});

test('⚠️ Luma sends NO url property — the link is inside DESCRIPTION', () => {
  // Verified against a live Denver feed: 12 events, zero URL fields. Taking only fields.URL yields
  // events nobody can click through to, which is most of the value gone.
  const ics = ['BEGIN:VEVENT', 'DTSTART:20260915T230000Z', 'DTEND:20260916T013000Z',
    'UID:evt-5Z259s3Ocw9mMQs@events.lu.ma',
    'ORGANIZER;CN="Thad":MAILTO:calendar-invite@lu.ma',
    'SUMMARY:AI Builders Denver',
    'GEO:39.7392;-104.9903',
    'DESCRIPTION:Get up-to-date information at: https://luma.com/albyi559\\n\\nAddress:\\nThe Link',
    'END:VEVENT'].join('\r\n');
  const e = parseIcs(ics, { source: 'luma' }).events[0];
  assert.equal(e.url, 'https://luma.com/albyi559', 'the canonical link must be recovered');
  assert.equal(e.lat, 39.7392);
  assert.equal(e.lon, -104.9903);
  assert.equal(e.organizer, 'Thad', 'CN is a name; the MAILTO is a platform relay and is not a contact route');
  assert.ok(!JSON.stringify(e).includes('calendar-invite@lu.ma'), 'a platform relay address must not be kept');
});

test('an explicit URL property still wins over one scraped from the description', () => {
  const ics = ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260101', 'SUMMARY:X',
    'URL:https://real.test/event', 'DESCRIPTION:see https://decoy.test/nope', 'END:VEVENT'].join('\r\n');
  assert.equal(parseIcs(ics).events[0].url, 'https://real.test/event');
});
