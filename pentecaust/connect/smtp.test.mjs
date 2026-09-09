// smtp.test.mjs — OFFLINE. No socket is opened: every test runs in dry-run or on the pure builders.
//
// The load-bearing tests are the ones that stop this module from mailing somebody twice, mailing a
// list to itself, or sending at all by accident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAccount, buildMessage, sendOne, sendBatch, ledger } from './smtp.mjs';

const ACCT = { host: 'smtp.example.com', port: 465, user: 'sender@example.com', pass: 'x' };
const MSG = { from: 'sender@example.com', fromName: 'Sender', subject: 'S', body: 'B' };
const tmp = () => join(mkdtempSync(join(tmpdir(), 'smtp-')), 'sent.jsonl');

// --- ⚠️ the default -----------------------------------------------------------

test('⚠️ DRY RUN IS THE DEFAULT — a bare call opens no socket and sends nothing', async () => {
  const r = await sendOne(ACCT, { ...MSG, to: 'a@b.com' });
  assert.equal(r.dryRun, true);
  assert.equal(r.ok, true);
  assert.match(r.reason, /nothing was sent/);
});

test('sendBatch is dry by default too, and says so in its result', async () => {
  const out = await sendBatch(ACCT, ['a@b.com', 'c@d.com'], MSG, { ledgerFile: tmp() });
  assert.equal(out.dryRun, true);
  assert.equal(out.sent, 2);
  assert.ok(out.results.every((r) => r.dryRun));
});

test('a dry run writes NOTHING to the ledger — only real sends are recorded', async () => {
  const f = tmp();
  await sendBatch(ACCT, ['a@b.com'], MSG, { ledgerFile: f });
  assert.equal(existsSync(f), false, 'a dry run must leave no trace that would suppress a later real send');
});

// --- ⭐ the resumable ledger ---------------------------------------------------

test('⭐ an address already accepted is never sent to again', async () => {
  const f = tmp();
  writeFileSync(f, `${JSON.stringify({ ok: true, to: 'seen@example.com' })}\n`);
  const out = await sendBatch(ACCT, ['seen@example.com', 'fresh@example.com'], MSG, { ledgerFile: f });
  assert.equal(out.skippedAlreadySent, 1);
  assert.equal(out.attempted, 1);
  assert.equal(out.results[0].to, 'fresh@example.com');
});

test('a FAILED address is not treated as sent — it stays in the queue', async () => {
  const f = tmp();
  writeFileSync(f, `${JSON.stringify({ ok: false, to: 'bounced@example.com', reason: 'rcpt: 550' })}\n`);
  const out = await sendBatch(ACCT, ['bounced@example.com'], MSG, { ledgerFile: f });
  assert.equal(out.skippedAlreadySent, 0, 'a failure must be retryable');
  assert.equal(out.attempted, 1);
});

test('ledger matching is case-insensitive', async () => {
  const f = tmp();
  writeFileSync(f, `${JSON.stringify({ ok: true, to: 'Mixed@Example.COM' })}\n`);
  const out = await sendBatch(ACCT, ['mixed@example.com'], MSG, { ledgerFile: f });
  assert.equal(out.skippedAlreadySent, 1);
});

test('a torn ledger line does not cause the whole list to be re-sent', () => {
  const f = tmp();
  writeFileSync(f, `${JSON.stringify({ ok: true, to: 'a@b.com' })}\n{"ok":true,"to":"trunc\n`);
  const seen = ledger(f);
  assert.equal(seen.has('a@b.com'), true, 'good lines must survive a bad one');
});

// --- ⭐ one message per recipient ----------------------------------------------

test('⭐ the message has ONE To: and NO Bcc — a list must never leak to its own recipients', () => {
  const wire = buildMessage({ ...MSG, to: 'one@example.com' });
  assert.equal((wire.match(/^To:/gm) || []).length, 1);
  assert.ok(!/^Bcc:/mi.test(wire), 'a Bcc blast leaks the list and reads as bulk');
  assert.ok(!/^Cc:/mi.test(wire));
});

test('the message carries List-Unsubscribe so a recipient has a way out', () => {
  const wire = buildMessage({ ...MSG, to: 'one@example.com' });
  assert.match(wire, /^List-Unsubscribe: <mailto:sender@example\.com\?subject=unsubscribe>$/m);
});

test('headers and body are separated by exactly one blank line, and lines are CRLF', () => {
  const wire = buildMessage({ ...MSG, to: 'a@b.com', body: 'line one\nline two' });
  assert.match(wire, /\r\n\r\nline one\r\nline two\r\n$/);
  assert.ok(!/[^\r]\n/.test(wire), 'a bare LF in SMTP DATA is a protocol error');
});

test('a Message-ID is generated per message and is unique', () => {
  const a = buildMessage({ ...MSG, to: 'a@b.com' }).match(/^Message-ID: (.+)$/m)[1];
  const b = buildMessage({ ...MSG, to: 'a@b.com' }).match(/^Message-ID: (.+)$/m)[1];
  assert.notEqual(a, b);
});

// --- refusals -------------------------------------------------------------------

test('a missing or malformed recipient is refused before any socket is opened', async () => {
  for (const to of [undefined, '', null, 'not-an-address']) {
    const r = await sendOne(ACCT, { ...MSG, to }, { dryRun: false });
    assert.equal(r.ok, false, `accepted ${JSON.stringify(to)}`);
    assert.match(r.reason, /no recipient/);
  }
});

test('sendBatch never throws on junk input', async () => {
  for (const v of [null, undefined, 0, '', {}, [null], [123]]) {
    await assert.doesNotReject(() => sendBatch(ACCT, v, MSG, { ledgerFile: tmp() }));
  }
});

test('limit caps the batch', async () => {
  const out = await sendBatch(ACCT, ['a@b.com', 'c@d.com', 'e@f.com'], MSG, { limit: 2, ledgerFile: tmp() });
  assert.equal(out.attempted, 2);
});

// --- the account file -----------------------------------------------------------

test('loadAccount parses key=value and ignores comments', () => {
  const f = tmp();
  writeFileSync(f, '# a comment\nhost=smtp.x.com\nport=465\nuser=u@x.com\npass=secret\n');
  const a = loadAccount(f);
  assert.equal(a.host, 'smtp.x.com');
  assert.equal(a.port, 465);
  assert.equal(a.user, 'u@x.com');
});

test('loadAccount refuses a file with no credentials rather than half-configuring', () => {
  const f = tmp();
  writeFileSync(f, 'host=smtp.x.com\n');
  assert.throws(() => loadAccount(f), /needs user= and pass=/);
});

test('⚠️ the password never appears in a result object', async () => {
  const r = await sendOne({ ...ACCT, pass: 'SUPERSECRET' }, { ...MSG, to: 'a@b.com' });
  assert.ok(!JSON.stringify(r).includes('SUPERSECRET'));
  const out = await sendBatch({ ...ACCT, pass: 'SUPERSECRET' }, ['a@b.com'], MSG, { ledgerFile: tmp() });
  assert.ok(!JSON.stringify(out).includes('SUPERSECRET'));
});
