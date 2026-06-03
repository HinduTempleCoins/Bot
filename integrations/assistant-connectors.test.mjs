import { test } from 'node:test';
import assert from 'node:assert';
import * as connectors from './assistant-connectors.mjs';
import {
  calendar,
  email,
  icalDate,
  icalText,
  foldLine,
  buildICalendar,
  parseICalEvents,
  filterByRange,
  buildRfc822,
  parseRfc822,
  encodeHeader,
  replySubject,
  normalizeMessage,
  parseMailbox,
} from './assistant-connectors.mjs';

// ── safety invariant: NOTHING sends ──────────────────────────────────────────────────────────────
test('no send/push capability exists anywhere in the module', () => {
  for (const k of Object.keys(connectors)) {
    assert.doesNotMatch(k, /^send/i, `unexpected send-shaped export: ${k}`);
  }
  for (const grant of [calendar, email]) {
    for (const k of Object.keys(grant)) {
      assert.doesNotMatch(k, /send|push|broadcast|deliver/i, `grant exposes a send-shaped method: ${k}`);
    }
  }
  assert.equal(typeof connectors.send, 'undefined');
  assert.equal(typeof email.send, 'undefined');
  assert.equal(typeof email.sendReply, 'undefined');
  assert.equal(typeof calendar.push, 'undefined');
});

// ── iCal builder ──────────────────────────────────────────────────────────────────────────────────
test('icalDate formats UTC basic timestamp', () => {
  assert.equal(icalDate('2026-06-10T15:04:05Z'), '20260610T150405Z');
});

test('icalText escapes special chars', () => {
  assert.equal(icalText('a; b, c\\d\ne'), 'a\\; b\\, c\\\\d\\ne');
});

test('foldLine wraps lines over 75 octets with continuation spaces', () => {
  const long = 'X'.repeat(200);
  const folded = foldLine(long);
  assert.ok(folded.includes('\r\n '), 'has a folded continuation line');
  for (const ln of folded.split('\r\n')) assert.ok(ln.length <= 75);
});

test('createEventDraft produces a valid VCALENDAR/VEVENT draft string', () => {
  const ics = calendar.createEventDraft({
    summary: 'Witness sync',
    start: '2026-06-10T15:00:00Z',
    end: '2026-06-10T16:00:00Z',
    location: 'Server 4',
    description: 'agenda; notes',
    uid: 'evt-1@melek',
  });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /VERSION:2\.0/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:evt-1@melek/);
  assert.match(ics, /DTSTART:20260610T150000Z/);
  assert.match(ics, /DTEND:20260610T160000Z/);
  assert.match(ics, /SUMMARY:Witness sync/);
  assert.match(ics, /LOCATION:Server 4/);
  assert.match(ics, /DESCRIPTION:agenda\\; notes/);
  assert.match(ics, /STATUS:TENTATIVE/, 'draft is tentative, not confirmed');
  assert.match(ics, /END:VEVENT\r\nEND:VCALENDAR\r\n$/);
});

test('buildICalendar requires a start', () => {
  assert.throws(() => buildICalendar({ summary: 'no start' }), /start is required/);
});

// ── iCal parse + range filter (calendar read side) ────────────────────────────────────────────────
test('parseICalEvents reads VEVENTs back into normalized objects', () => {
  const ics =
    'BEGIN:VCALENDAR\r\nVERSION:2.0\r\n' +
    'BEGIN:VEVENT\r\nUID:a@x\r\nSUMMARY:First\r\nDTSTART:20260601T090000Z\r\nDTEND:20260601T100000Z\r\nLOCATION:Office\r\nEND:VEVENT\r\n' +
    'BEGIN:VEVENT\r\nUID:b@x\r\nSUMMARY:Second\r\nDTSTART:20260615T120000Z\r\nEND:VEVENT\r\n' +
    'END:VCALENDAR\r\n';
  const evs = parseICalEvents(ics);
  assert.equal(evs.length, 2);
  assert.equal(evs[0].uid, 'a@x');
  assert.equal(evs[0].summary, 'First');
  assert.equal(evs[0].location, 'Office');
  assert.equal(evs[0].start, '2026-06-01T09:00:00.000Z');
  assert.equal(evs[1].summary, 'Second');
});

test('parseICalEvents unfolds folded lines and unescapes text', () => {
  const ics =
    'BEGIN:VEVENT\r\nUID:c@x\r\nSUMMARY:Long meeting about the qu\r\n arterly plan\r\nDESCRIPTION:a\\, b\\; c\r\nDTSTART:20260601T090000Z\r\nEND:VEVENT\r\n';
  const [ev] = parseICalEvents(ics);
  assert.equal(ev.summary, 'Long meeting about the quarterly plan');
  assert.equal(ev.description, 'a, b; c');
});

test('filterByRange keeps only events whose start is in range', () => {
  const evs = [
    { summary: 'before', start: '2026-05-01T00:00:00Z' },
    { summary: 'inside', start: '2026-06-10T00:00:00Z' },
    { summary: 'after', start: '2026-07-01T00:00:00Z' },
  ];
  const out = filterByRange(evs, { start: '2026-06-01T00:00:00Z', end: '2026-06-30T00:00:00Z' });
  assert.deepEqual(out.map((e) => e.summary), ['inside']);
});

test('calendar.listEvents parses injected raw iCal and applies the range (no network)', async () => {
  const raw =
    'BEGIN:VEVENT\r\nUID:a@x\r\nSUMMARY:In\r\nDTSTART:20260610T090000Z\r\nEND:VEVENT\r\n' +
    'BEGIN:VEVENT\r\nUID:b@x\r\nSUMMARY:Out\r\nDTSTART:20260801T090000Z\r\nEND:VEVENT\r\n';
  const out = await calendar.listEvents({ raw, range: { start: '2026-06-01', end: '2026-06-30' } });
  assert.equal(out.length, 1);
  assert.equal(out[0].summary, 'In');
});

test('calendar.listEvents uses an injected transport (still offline)', async () => {
  let called = null;
  const transport = async (args) => {
    called = args;
    return 'BEGIN:VEVENT\r\nUID:t@x\r\nSUMMARY:Via transport\r\nDTSTART:20260610T090000Z\r\nEND:VEVENT\r\n';
  };
  const out = await calendar.listEvents({ transport, range: { start: '2026-06-01', end: '2026-06-30' } });
  assert.equal(out[0].summary, 'Via transport');
  assert.deepEqual(called.range, { start: '2026-06-01', end: '2026-06-30' });
});

// ── RFC822 builder + reply draft ──────────────────────────────────────────────────────────────────
test('encodeHeader passes ASCII through and RFC2047-encodes non-ASCII', () => {
  assert.equal(encodeHeader('Plain Subject'), 'Plain Subject');
  assert.match(encodeHeader('café ☕'), /^=\?UTF-8\?B\?.+\?=$/);
});

test('replySubject adds Re: once', () => {
  assert.equal(replySubject('Hello'), 'Re: Hello');
  assert.equal(replySubject('Re: Hello'), 'Re: Hello');
  assert.equal(replySubject('RE: Hello'), 'RE: Hello');
});

test('buildRfc822 produces a valid message draft string', () => {
  const eml = buildRfc822({
    from: 'me@example.com',
    to: ['a@example.com', 'b@example.com'],
    cc: 'c@example.com',
    subject: 'Re: the plan',
    body: 'Line one\nLine two',
    inReplyTo: '<orig@example.com>',
    date: '2026-06-03T00:00:00Z',
  });
  assert.match(eml, /^From: me@example\.com\r\n/);
  assert.match(eml, /To: a@example\.com, b@example\.com\r\n/);
  assert.match(eml, /Cc: c@example\.com\r\n/);
  assert.match(eml, /Subject: Re: the plan\r\n/);
  assert.match(eml, /In-Reply-To: <orig@example\.com>\r\n/);
  assert.match(eml, /MIME-Version: 1\.0/);
  assert.match(eml, /\r\n\r\nLine one\r\nLine two\r\n$/, 'header/body separated by blank line, CRLF body');
  assert.match(eml, /X-MELEK-Draft: read-and-draft-only/);
});

test('buildRfc822 requires a recipient', () => {
  assert.throws(() => buildRfc822({ subject: 'x', body: 'y' }), /to is required/);
});

test('email.draftReply returns an RFC822 draft (and does NOT send)', () => {
  const eml = email.draftReply({
    to: 'sender@example.com',
    subject: 'your question',
    body: 'Here is a considered answer.',
    from: 'operator@example.com',
  });
  assert.match(eml, /Subject: Re: your question/);
  assert.match(eml, /To: sender@example\.com/);
  assert.match(eml, /Here is a considered answer\./);
  // draftReply returns a string draft, not a transport result
  assert.equal(typeof eml, 'string');
});

// ── mailbox parse / normalize (email read side) ───────────────────────────────────────────────────
test('parseRfc822 normalizes a raw message to {from,subject,date,snippet}', () => {
  const raw =
    'From: Alice <alice@example.com>\r\n' +
    'Subject: Meeting notes\r\n' +
    'Date: Tue, 03 Jun 2026 09:00:00 +0000\r\n' +
    '\r\n' +
    'Here are the notes from   today.\r\nSecond line.';
  const m = parseRfc822(raw);
  assert.equal(m.from, 'Alice <alice@example.com>');
  assert.equal(m.subject, 'Meeting notes');
  assert.match(m.date, /03 Jun 2026/);
  assert.equal(m.snippet, 'Here are the notes from today. Second line.');
});

test('parseRfc822 decodes RFC2047 encoded subject', () => {
  const raw = 'From: x@y.z\r\nSubject: =?UTF-8?B?Q2Fmw6k=?=\r\n\r\nbody';
  assert.equal(parseRfc822(raw).subject, 'Café');
});

test('normalizeMessage handles a JMAP Email shape', () => {
  const m = normalizeMessage({
    from: [{ name: 'Bob', email: 'bob@example.com' }],
    subject: 'Hi',
    receivedAt: '2026-06-03T10:00:00Z',
    preview: '  hello   there  ',
  });
  assert.deepEqual(m, { from: 'Bob <bob@example.com>', subject: 'Hi', date: '2026-06-03T10:00:00Z', snippet: 'hello there' });
});

test('email.listMessages normalizes an injected array payload (no network)', async () => {
  const out = await email.listMessages({
    folder: 'INBOX',
    raw: [
      { from: [{ name: 'A', email: 'a@x.z' }], subject: 'One', receivedAt: '2026-06-01T00:00:00Z', preview: 'first' },
      'From: B <b@x.z>\r\nSubject: Two\r\nDate: now\r\n\r\nsecond body',
    ],
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].from, 'A <a@x.z>');
  assert.equal(out[0].subject, 'One');
  assert.equal(out[1].from, 'B <b@x.z>');
  assert.equal(out[1].subject, 'Two');
  assert.equal(out[1].snippet, 'second body');
});

test('email.listMessages parses a JMAP method-response payload', async () => {
  const jmap = {
    methodResponses: [
      ['Email/get', { list: [{ from: [{ email: 'c@x.z' }], subject: 'Three', receivedAt: '2026-06-02', preview: 'third' }] }, '0'],
    ],
  };
  const out = await email.listMessages({ raw: jmap });
  assert.equal(out.length, 1);
  assert.equal(out[0].from, 'c@x.z');
  assert.equal(out[0].subject, 'Three');
});

test('email.listMessages uses an injected transport (still offline)', async () => {
  let seen = null;
  const transport = async (args) => {
    seen = args;
    return [{ from: 'z@x.z', subject: 'T', date: 'd', snippet: 's' }];
  };
  const out = await email.listMessages({ folder: 'Sent', query: 'is:unread', transport });
  assert.equal(out[0].subject, 'T');
  assert.deepEqual(seen, { folder: 'Sent', query: 'is:unread' });
});

test('parseMailbox handles a bare JMAP method-response triple array', () => {
  const payload = [['Email/get', { list: [{ from: 'q@x.z', subject: 'Q', date: 'd', snippet: 's' }] }, '0']];
  const out = parseMailbox(payload);
  assert.equal(out[0].subject, 'Q');
});
