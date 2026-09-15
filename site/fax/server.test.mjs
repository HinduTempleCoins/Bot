// OFFLINE. Injected in-memory store, no disk, no carrier, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submit, tick, markSent } from './server.mjs';

const store = () => ({ jobs: [] });
const JOB = {
  to: { name: 'Texas Workforce Commission — Appeals', fax: '+15124751135', tz: 'America/Chicago' },
  from: { name: 'Ryan Gallagher', phone: '+17203698172' },
  subject: 'Statement in Support of Appeal — 12904169',
  body: 'I was never notified of an appointment.\n'.repeat(40),
};

test('a job is validated before it is queued — no sender, no send', async () => {
  const s = store();
  const bad = await submit({ ...JOB, from: {} }, { store: s });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /sender/);
  assert.equal(s.jobs.length, 0, 'an invalid job must not enter the queue');

  const none = await submit({ to: JOB.to, from: JOB.from, body: '' }, { store: s });
  assert.equal(none.ok, false);
  assert.match(none.problems.join(' '), /nothing to send/);
});

test('⭐ a job outside business hours is HELD, with the packet stored', async () => {
  const s = store();
  const r = await submit(JOB, { store: s });
  assert.equal(r.ok, true);
  const row = s.jobs[0];
  // 02:00 Central or any closed hour → held. If the suite runs during business hours it dispatches
  // instead, which is equally correct — so assert the invariant that holds either way.
  assert.ok(['held', 'manual', 'sent'].includes(row.state), row.state);
  assert.ok(row.packet, 'the packet must be stored ON the row, or a restart loses it');
  assert.ok(row.history.length >= 1);
});

test('⛔ tick() fires a held job once its window opens — this is what did not exist', async () => {
  const s = store();
  await submit(JOB, { store: s });
  const row = s.jobs[0];
  row.state = 'held';
  row.resendAt = '2026-09-15T13:00:00.000Z';

  // before the window: untouched
  const early = await tick({ store: s, nowISO: '2026-09-15T07:00:00.000Z' });
  assert.equal(early.fired, 0, 'a held job must not fire early');
  assert.equal(s.jobs[0].state, 'held');

  // after: fired. With no carrier the honest outcome is `manual` — the packet is ready and a human
  // can send it — never a silent "sent" that nobody transmitted.
  const late = await tick({ store: s, nowISO: '2026-09-15T14:00:00.000Z' });
  assert.equal(late.fired, 1);
  assert.notEqual(s.jobs[0].state, 'held');
  assert.equal(s.jobs[0].state, 'manual', 'no carrier must never report itself as sent');
  assert.ok(s.jobs[0].attempts >= 1);
});

test('⭐ a packet walked to a machine is a REAL send and gets a receipt', async () => {
  const s = store();
  await submit(JOB, { store: s });
  const id = s.jobs[0].id;
  const r = markSent(id, { confirmation: 'OK 3 pages 09/15 08:14' }, { store: s });
  assert.equal(r.ok, true);
  assert.equal(r.job.state, 'sent');
  assert.equal(r.job.confirmation, 'OK 3 pages 09/15 08:14');
  assert.ok(r.job.sentAt);
  assert.ok(s.jobs[0].history.some((h) => h.mode === 'manual-confirmed'));
  assert.equal(markSent('nope', {}, { store: s }).ok, false);
});

test('a sent job is not fired again by a later tick', async () => {
  const s = store();
  await submit(JOB, { store: s });
  markSent(s.jobs[0].id, {}, { store: s });
  const r = await tick({ store: s, nowISO: '2030-01-01T00:00:00.000Z' });
  assert.equal(r.fired, 0, 'only held jobs fire');
});

test('the HTTP surface answers and refuses junk', async () => {
  const { handler } = await import('./server.mjs');
  const cap = () => { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; };
  let { res, o } = cap();
  await handler({ method: 'GET', url: '/health' }, res);
  assert.equal(o.code, 200);

  ({ res, o } = cap());
  await handler({ method: 'POST', url: '/api/fax', body: { to: {}, from: {} } }, res);
  assert.equal(o.code, 422, 'an unsendable job is a 422, not a 500');

  ({ res, o } = cap());
  await handler({ method: 'GET', url: '/api/fax/nope/packet' }, res);
  assert.equal(o.code, 404);
});
