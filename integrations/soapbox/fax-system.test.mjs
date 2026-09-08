import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAX_BOOK, recipients, recipient, coverSheet, formatFax, estimatePages, plain,
  buildJob, renderPacket, dispatch, createQueue, handler, windowFor,
} from './fax-system.mjs';
import { __setFetch } from './fax-service.mjs';

const SENDER = { name: 'Ryan Alexander Gallagher', email: 'r@example.com' };
// Tuesday 8 Sep 2026, 09:00 CDT — Dallas open. Pinned so the suite does not depend on when it runs.
const OPEN = '2026-09-08T14:00:00Z';
// Monday 7 Sep 2026, 22:35 CDT — Labor Day evening.
const SHUT = '2026-09-08T03:35:00Z';
const reset = () => __setFetch(null);

test('the recipient book carries verified numbers and their gotchas', () => {
  const sheriff = recipient('tx-dallas-sheriff');
  assert.equal(sheriff.fax, '+12146533420');
  assert.match(sheriff.note, /CITY of Dallas/);
  assert.match(sheriff.verified, /2026-09-08/);
});

test('registry offices with a fax number are merged in, book wins on conflict', () => {
  const all = recipients();
  const ids = all.map((r) => r.id);
  assert.ok(ids.includes('tx-bar-cdc'), 'registry fax numbers are picked up');
  assert.ok(ids.includes('tx-dallas-sheriff'));
  assert.equal(all.filter((r) => r.id === 'tx-bar-cdc').length, 1, 'no duplicate entries');
  assert.equal(recipient('tx-bar-cdc').source, 'fax-book', 'hand-verified side wins');
  assert.ok(all.every((r) => /^\+\d{10,}$/.test(r.fax)), 'every number normalised to E.164');
});

test('ad-hoc recipients are allowed but flagged as unverified', () => {
  const r = recipient({ name: 'Somewhere', fax: '(555) 010-1234' });
  assert.equal(r.fax, '+15550101234');
  assert.match(r.verified, /NOT verified/);
  assert.equal(recipient({ name: 'No number' }), null);
  assert.equal(recipient('nope-does-not-exist'), null);
});

test('formatFax renders NANP for humans and leaves the rest alone', () => {
  assert.equal(formatFax('+12146533420'), '(214) 653-3420');
  assert.equal(formatFax('+442071234567'), '+442071234567');
  assert.equal(formatFax(''), '');
});

test('plain() strips the markdown a fax machine would print as punctuation', () => {
  assert.equal(plain('**bold** and *ital* and `code`'), 'bold and ital and code');
  assert.equal(plain('> quoted line'), 'quoted line');
  assert.equal(plain('## Heading'), 'Heading');
  assert.equal(plain('⭐⭐ starred ⚠️ warned'), 'starred  warned'.replace(/\s+/g, ' ').replace('starred ', 'starred  '));
  assert.equal(plain('- a bullet * not italic'), '- a bullet * not italic');
  assert.equal(plain('*italic that\nwraps a line*'), 'italic that\nwraps a line');
});

test('cover sheet counts ITSELF in the page total', () => {
  const c = coverSheet({ to: recipient('tx-dallas-sheriff'), from: SENDER, subject: 'X', pages: 3 });
  assert.equal(c.pages, 4);
  assert.match(c.text, /PAGES: {13}4 \(including this cover sheet\)/);
  assert.match(c.text, /\(214\) 653-3420/);
  assert.match(c.text, /acknowledgement of receipt/);
});

test('cover sheet escapes html and omits empty rows', () => {
  const c = coverSheet({
    to: { name: '<script>x</script>', fax: '+12146533420' },
    from: { name: 'A & B' }, subject: '"quoted"',
  });
  assert.ok(!c.html.includes('<script>'), 'no raw script tag survives');
  assert.match(c.html, /&amp;/);
  assert.ok(!c.html.includes('Submitted under'), 'no statute row when no statute');
});

test('estimatePages accounts for line wrapping, never returns zero', () => {
  assert.equal(estimatePages(''), 1);
  assert.equal(estimatePages('one line'), 1);
  const long = Array.from({ length: 100 }, () => 'x'.repeat(180)).join('\n');
  assert.ok(estimatePages(long) >= 4, 'long wrapped lines cost more than one page');
});

test('buildJob refuses to build a request from nobody, to nobody, about nothing', () => {
  const none = buildJob({});
  assert.equal(none.ok, false);
  assert.equal(none.problems.length, 3);
  assert.match(none.problems.join(' '), /no recipient/);
  assert.match(none.problems.join(' '), /nothing to send/);
  assert.match(none.problems.join(' '), /a records request from nobody is not a request/);
});

test('a complete job carries a stable id, the cover, and cleaned body text', () => {
  const job = buildJob({
    to: 'tx-dallas-sheriff', from: SENDER, subject: 'PIA request',
    statute: "Tex. Gov't Code ch. 552", body: '**ALL HOUSING RECORDS**\n\n> under § 552.023',
    dateISO: '2026-09-08T12:00:00.000Z',
  });
  assert.equal(job.ok, true);
  assert.equal(job.id, 'fax_tx-dallas-sheriff_20260908120000');
  assert.equal(job.body, 'ALL HOUSING RECORDS\n\nunder § 552.023');
  assert.match(renderPacket(job), /FACSIMILE TRANSMITTAL[\s\S]*ALL HOUSING RECORDS/);
});

test('dispatch falls back to MANUAL when there are no credentials — and that is a success', async () => {
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'records please' });
  const out = await dispatch(job, { providerId: 'telnyx', credentials: {}, nowISO: OPEN });
  assert.equal(out.mode, 'manual');
  assert.equal(out.ok, true, 'manual is a real outcome, not an error');
  assert.equal(out.fax, '(214) 653-3420');
  assert.match(out.reason, /no usable telnyx credentials/);
  assert.match(out.instructions.join(' '), /KEEP THE TRANSMISSION REPORT/);
  assert.match(out.instructions.join(' '), /CITY of Dallas/, 'recipient gotcha reaches the human');
  assert.match(out.packet, /records please/);
});

test('dispatch stays manual when credentials exist but nothing is hosted to fetch', async () => {
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'text only' });
  const out = await dispatch(job, { credentials: { apiKey: 'k', connectionId: 'c' }, nowISO: OPEN });
  assert.equal(out.mode, 'manual');
  assert.match(out.reason, /do not accept raw text/);
});

test('dispatch blocks an unsendable job instead of half-sending it', async () => {
  const out = await dispatch(buildJob({}), { credentials: { apiKey: 'k', connectionId: 'c' }, nowISO: OPEN });
  assert.equal(out.mode, 'blocked');
  assert.equal(out.ok, false);
  assert.ok(out.problems.length > 0);
});

test('dispatch submits through the provider when it actually can', async (t) => {
  t.after(reset);
  __setFetch(async () => ({
    ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 'fx_1', status: 'queued' } }),
  }));
  const job = buildJob({
    to: 'tx-dallas-sheriff', from: SENDER, subject: 'PIA',
    body: 'x', mediaUrl: 'https://example.org/req.pdf',
  });
  const out = await dispatch(job, {
    providerId: 'telnyx', credentials: { apiKey: 'k', connectionId: 'c' }, fromFax: '+12145550000',
    nowISO: OPEN,
  });
  assert.equal(out.mode, 'sent');
  assert.equal(out.ok, true);
  assert.ok(out.receipt, 'a send produces a receipt');
});

test('the queue tracks a manual send as awaiting until a human confirms it', () => {
  const q = createQueue();
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'x' });
  q.enqueue(job);
  assert.equal(q.size, 1);
  assert.equal(q.pending().length, 1);

  q.record(job.id, { mode: 'manual', ok: true, reason: 'no credentials' });
  assert.equal(q.find(job.id).state, 'awaiting-manual-send');
  assert.equal(q.sent().length, 0, 'not sent until someone says it was');

  q.confirmManual(job.id, { atISO: '2026-09-08T15:00:00.000Z', note: 'walked it over' });
  assert.equal(q.find(job.id).state, 'sent');
  assert.equal(q.find(job.id).sentAt, '2026-09-08T15:00:00.000Z');
  assert.equal(q.sent().length, 1);
  assert.equal(q.find(job.id).history.length, 2);
});

test('the queue records failures and blocked jobs separately from sends', () => {
  const q = createQueue();
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'x' });
  q.enqueue(job);
  q.record(job.id, { mode: 'sent', ok: false });
  assert.equal(q.failed().length, 1);
  assert.equal(q.find(job.id).attempts, 1);
  q.record(job.id, { mode: 'sent', ok: true, receipt: { id: 'r' } });
  assert.equal(q.sent().length, 1);
  assert.equal(q.find(job.id).attempts, 2);
  assert.deepEqual(q.find(job.id).receipt, { id: 'r' });
});

test('the queue round-trips through JSON and ignores junk', () => {
  const q = createQueue();
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'x' });
  q.enqueue(job);
  const restored = createQueue(JSON.parse(JSON.stringify(q.toJSON())));
  assert.equal(restored.size, 1);
  assert.equal(restored.find(job.id).to, FAX_BOOK['tx-dallas-sheriff'].name);
  assert.equal(createQueue([null, {}, 'x']).size, 0);
  assert.equal(createQueue().enqueue(buildJob({})), null, 'a bad job never enters the queue');
});

test('handler serves recipients and covers, and refuses to send over http', () => {
  const call = (url) => {
    const res = { statusCode: 0, headers: {}, body: '',
      setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    handler({ url }, res);
    return { code: res.statusCode, json: JSON.parse(res.body) };
  };
  const list = call('/fax/recipients');
  assert.equal(list.code, 200);
  assert.ok(list.json.recipients.some((r) => r.id === 'tx-dallas-sheriff'));

  const cover = call('/fax/cover?to=tx-dallas-sheriff&from=Ryan&subject=PIA&pages=3');
  assert.equal(cover.json.cover.pages, 4);

  assert.equal(call('/fax/cover?to=nobody').code, 400);
  assert.match(call('/fax').json.note, /Dispatch is not exposed over HTTP/);
});


test('dispatch HOLDS a fax aimed at a closed office instead of burning the send', async () => {
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'records please' });
  const out = await dispatch(job, {
    credentials: { apiKey: 'k', connectionId: 'c' }, nowISO: SHUT,
    mediaUrl: 'https://example.org/x.pdf',
  });
  assert.equal(out.mode, 'held');
  assert.equal(out.ok, true, 'holding is a correct outcome, not a failure');
  assert.match(out.reason, /Labor Day/);
  assert.equal(out.resendAt, '2026-09-08T13:00:00.000Z', 'resend at 08:00 CDT');
  assert.match(out.localNow, /America\/Chicago/);
  assert.match(out.note, /transmission report/);
  assert.ok(out.packet, 'the packet is still rendered so a human could walk it over');
});

test('ignoreHours is available for the caller who really means it', async () => {
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'x' });
  const out = await dispatch(job, { credentials: {}, nowISO: SHUT, ignoreHours: true });
  assert.equal(out.mode, 'manual', 'falls through to the normal path');
});

test('windowFor gives each recipient its own zone and holiday regime', () => {
  assert.equal(windowFor(recipient('tx-dallas-sheriff')).tz, 'America/Chicago');
  assert.equal(windowFor({ regime: 'FOIA', tz: 'America/New_York' }).regime, 'FEDERAL');
  assert.equal(windowFor(recipient('tx-dallas-sheriff')).regime, 'TX_PIA');
  assert.equal(windowFor(null).tz, 'America/Chicago', 'a sane default, not a crash');
});

test('a held job does not count as an attempt against the line', () => {
  const q = createQueue();
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'x' });
  q.enqueue(job);
  q.record(job.id, { mode: 'held', ok: true, resendAt: '2026-09-08T13:00:00.000Z' });
  const e = q.find(job.id);
  assert.equal(e.state, 'held-until-business-hours');
  assert.equal(e.attempts, 0, 'nothing was dialled, so nothing was attempted');
  assert.equal(e.resendAt, '2026-09-08T13:00:00.000Z');
  assert.equal(q.held().length, 1);
  assert.equal(q.pending().length, 1);
});

test('dueNow answers per recipient clock, not the server clock', () => {
  const q = createQueue();
  const job = buildJob({ to: 'tx-dallas-sheriff', from: SENDER, body: 'x' });
  q.enqueue(job);
  assert.equal(q.dueNow(SHUT).length, 0, 'holiday evening in Dallas: nothing is due');
  assert.equal(q.dueNow(OPEN).length, 1, 'Tuesday morning in Dallas: send it');
});
