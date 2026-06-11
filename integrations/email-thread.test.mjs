// email-thread.test.mjs — offline tests for the email/mbox thread parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEmailText,
  parseHeaders,
  sortByDate,
  extractParticipants,
} from './email-thread.mjs';

// ── parseHeaders ────────────────────────────────────────────────────────────────────────────
test('parseHeaders: pulls from/to/subject/date/messageId and ISO-normalizes the date', () => {
  const block = [
    'From: Alice Example <alice@example.com>',
    'To: bob@example.com',
    'Subject: Hello there',
    'Date: Mon, 01 Jan 2020 09:00:00 +0000',
    'Message-ID: <abc123@example.com>',
    '',
    'body starts here',
  ].join('\n');
  const h = parseHeaders(block);
  assert.equal(h.from, 'Alice Example <alice@example.com>');
  assert.equal(h.to, 'bob@example.com');
  assert.equal(h.subject, 'Hello there');
  assert.equal(h.messageId, '<abc123@example.com>');
  assert.equal(h.date, new Date('Mon, 01 Jan 2020 09:00:00 +0000').toISOString());
});

test('parseHeaders: Cc merges into to; unparseable date -> null', () => {
  const h = parseHeaders('From: x@y.z\nCc: c@y.z\nTo: t@y.z\nDate: not a date\n\nbody');
  assert.equal(h.to, 'c@y.z, t@y.z'); // merged in header order
  assert.match(h.to, /t@y\.z/);
  assert.equal(h.date, null);
});

test('parseHeaders: folded continuation line appends to previous header', () => {
  const h = parseHeaders('Subject: Long subject\n that continues\n\nbody');
  assert.equal(h.subject, 'Long subject that continues');
});

test('parseHeaders: soft-fail on null / non-string', () => {
  assert.deepEqual(parseHeaders(null), { from: '', to: '', subject: '', date: null, messageId: '' });
  assert.deepEqual(parseHeaders(undefined).from, '');
});

// ── parseEmailText ──────────────────────────────────────────────────────────────────────────
test('parseEmailText: splits two RFC-header messages with date + body', () => {
  const raw = [
    'From: alice@example.com',
    'Subject: First',
    'Date: Mon, 01 Jan 2020 09:00:00 +0000',
    '',
    'Hello Bob.',
    '',
    'From: bob@example.com',
    'Subject: Re: First',
    'Date: Tue, 02 Jan 2020 10:00:00 +0000',
    '',
    'Hi Alice.',
  ].join('\n');
  const recs = parseEmailText(raw);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].from, 'alice@example.com');
  assert.equal(recs[0].subject, 'First');
  assert.equal(recs[0].body, 'Hello Bob.');
  assert.equal(recs[1].from, 'bob@example.com');
  assert.equal(recs[1].body, 'Hi Alice.');
  assert.ok(recs[0].date && recs[1].date);
});

test('parseEmailText: strips quoted reply lines into quotedDepth, keeps fresh body', () => {
  const raw = [
    'From: bob@example.com',
    'Subject: Re: Hello',
    'Date: Tue, 02 Jan 2020 10:00:00 +0000',
    '',
    'Thanks, that helps.',
    '',
    'On Mon, 01 Jan 2020, alice@example.com wrote:',
    '> original question line one',
    '>> deeper nested quote',
  ].join('\n');
  const recs = parseEmailText(raw);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].body, 'Thanks, that helps.');
  assert.equal(recs[0].quotedDepth, 2);
});

test('parseEmailText: splits an inline "On ... wrote:" reply chain into separate records', () => {
  const raw = [
    'From: bob@example.com',
    'Subject: Re: Plan',
    'Date: Wed, 03 Jan 2020 08:00:00 +0000',
    '',
    'Sounds good to me.',
    '',
    'On Tue, 02 Jan 2020, Alice <alice@example.com> wrote:',
    'Here is the plan.',
  ].join('\n');
  const recs = parseEmailText(raw);
  assert.equal(recs.length, 2);
  assert.equal(recs[0].body, 'Sounds good to me.');
  assert.match(recs[1].from, /alice@example\.com/);
  assert.equal(recs[1].body, 'Here is the plan.');
});

test('parseEmailText: mbox "From " envelope line is a boundary', () => {
  const raw = [
    'From alice@example.com Mon Jan 1 09:00:00 2020',
    'From: alice@example.com',
    'Subject: Mbox one',
    'Date: Mon, 01 Jan 2020 09:00:00 +0000',
    '',
    'mbox body',
  ].join('\n');
  const recs = parseEmailText(raw);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].subject, 'Mbox one');
  assert.equal(recs[0].body, 'mbox body');
});

test('parseEmailText: no headers at all -> single bodied record', () => {
  const recs = parseEmailText('just some loose text\nwith two lines');
  assert.equal(recs.length, 1);
  assert.equal(recs[0].from, '');
  assert.equal(recs[0].body, 'just some loose text\nwith two lines');
});

test('parseEmailText: soft-fail on empty / null / non-string', () => {
  assert.deepEqual(parseEmailText(''), []);
  assert.deepEqual(parseEmailText('   \n  '), []);
  assert.deepEqual(parseEmailText(null), []);
  assert.deepEqual(parseEmailText(undefined), []);
  assert.deepEqual(parseEmailText(42), []);
});

test('parseEmailText: to/cc surfaces as optional to field', () => {
  const raw = 'From: a@x.z\nTo: b@x.z\nSubject: S\nDate: Mon, 01 Jan 2020 09:00:00 +0000\n\nhi';
  const recs = parseEmailText(raw);
  assert.equal(recs[0].to, 'b@x.z');
});

// ── sortByDate ──────────────────────────────────────────────────────────────────────────────
test('sortByDate: chronological, undated last, stable for ties/undated', () => {
  const recs = [
    { from: 'c', date: '2020-03-01T00:00:00.000Z', body: 'c' },
    { from: 'u1', date: null, body: 'u1' },
    { from: 'a', date: '2020-01-01T00:00:00.000Z', body: 'a' },
    { from: 'u2', date: null, body: 'u2' },
    { from: 'b', date: '2020-02-01T00:00:00.000Z', body: 'b' },
  ];
  const sorted = sortByDate(recs);
  assert.deepEqual(sorted.map((r) => r.from), ['a', 'b', 'c', 'u1', 'u2']);
});

test('sortByDate: does not mutate input; soft-fail on non-array', () => {
  const recs = [{ from: 'x', date: '2020-01-01T00:00:00.000Z', body: 'x' }];
  const copy = [...recs];
  sortByDate(recs);
  assert.deepEqual(recs, copy);
  assert.deepEqual(sortByDate(null), []);
  assert.deepEqual(sortByDate('nope'), []);
});

// ── extractParticipants ─────────────────────────────────────────────────────────────────────
test('extractParticipants: deduped (case-insensitive), sorted, across from+to', () => {
  const recs = [
    { from: 'Alice <alice@x.z>', to: 'bob@x.z, carol@x.z', body: '' },
    { from: 'bob@x.z', to: 'Alice <alice@x.z>', body: '' },
    { from: 'ALICE <ALICE@X.Z>', body: '' }, // dupe by case
  ];
  const people = extractParticipants(recs);
  assert.deepEqual(people, ['Alice <alice@x.z>', 'bob@x.z', 'carol@x.z']);
});

test('extractParticipants: handles semicolon-separated recipients and blanks', () => {
  const recs = [{ from: '', to: 'a@x.z; b@x.z ;; c@x.z', body: '' }];
  assert.deepEqual(extractParticipants(recs), ['a@x.z', 'b@x.z', 'c@x.z']);
});

test('extractParticipants: soft-fail on non-array / junk entries', () => {
  assert.deepEqual(extractParticipants(null), []);
  assert.deepEqual(extractParticipants([null, 42, {}]), []);
});

// ── integration smoke: parse -> sort -> participants ──────────────────────────────────────────
test('integration: parse then sort then extract participants', () => {
  const raw = [
    'From: bob@example.com',
    'Subject: Re: Welcome',
    'Date: Tue, 02 Jan 2020 10:00:00 +0000',
    '',
    'Thanks!',
    '',
    'From: alice@example.com',
    'To: bob@example.com',
    'Subject: Welcome',
    'Date: Mon, 01 Jan 2020 09:00:00 +0000',
    '',
    'Welcome aboard.',
  ].join('\n');
  const sorted = sortByDate(parseEmailText(raw));
  assert.equal(sorted.length, 2);
  assert.equal(sorted[0].from, 'alice@example.com'); // earlier date first
  const people = extractParticipants(sorted);
  assert.ok(people.includes('alice@example.com'));
  assert.ok(people.includes('bob@example.com'));
});
