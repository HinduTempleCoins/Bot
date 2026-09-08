// batch-runner.test.mjs — OFFLINE. No transport is imported; the sender is always injected.
import { test } from 'node:test';
import assert from 'node:assert';
import { planDay, runDay, rank, rampSchedule, NOT_A_FIRST_TOUCH, handler } from './batch-runner.mjs';

const OK = { postalAddress: '1 Test St, Dallas TX 75201', unsubscribeUrl: 'https://x.example/u', senderName: 'Ryan' };
const leads = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, email: `p${i}@e.example`, name: `P${i}`, stage: 'new', reach: n - i, ...extra }));

test('the day-one cap is 10, not 852', () => {
  const p = planDay({ leads: leads(852), warmupDay: 0, ...OK });
  assert.equal(p.cap, 10);
  assert.equal(p.batch.length, 10);
  assert.equal(p.counts.skipped, 842);
  assert.match(p.skipped[0].why, /over the day's cap of 10/);
});

test('the ramp climbs and can be read before starting', () => {
  const r = rampSchedule(30);
  assert.equal(r[0].cap, 10);
  assert.ok(r[29].cap > r[0].cap);
  assert.equal(r[29].cap, 50);
  assert.equal(r[0].cumulative, 10);
  assert.ok(r[13].cumulative > r[6].cumulative);
});

test('highest value first — a run cut short spends its messages on the best leads', () => {
  const p = planDay({ leads: [{ id: 'a', email: 'a@e.co', reach: 1 }, { id: 'b', email: 'b@e.co', reach: 900 }], ...OK });
  assert.equal(p.batch[0].email, 'b@e.co');
  assert.deepEqual(rank([{ email: 'z@e.co', reach: 5 }, { email: 'a@e.co', reach: 5 }]).map((x) => x.email), ['a@e.co', 'z@e.co']);
});

test('CAN-SPAM is enforced by the gate that was never called: no postal address, no batch', () => {
  const p = planDay({ leads: leads(5), unsubscribeUrl: 'https://x.example/u' });
  assert.equal(p.batch.length, 0);
  assert.equal(p.ok, false);
  assert.match(p.skipped[0].why, /postal address/);
});

test('no unsubscribe route, no batch', () => {
  const p = planDay({ leads: leads(5), postalAddress: '1 Test St' });
  assert.equal(p.batch.length, 0);
  assert.match(p.skipped[0].why, /unsubscribe/);
});

test('a suppressed address is never in a batch', () => {
  const p = planDay({ leads: leads(3), suppression: ['p1@e.example'], ...OK });
  assert.equal(p.batch.length, 2);
  assert.ok(p.skipped.some((s) => s.email === 'p1@e.example' && /suppressed/.test(s.why)));
});

test('a lead that has already been contacted is not a first touch', () => {
  for (const stage of [...NOT_A_FIRST_TOUCH]) {
    const p = planDay({ leads: [{ id: 'x', email: 'x@e.co', stage }], ...OK });
    assert.equal(p.batch.length, 0, stage);
    assert.match(p.skipped[0].why, new RegExp(stage));
  }
});

test('the same address twice in one list is written to once', () => {
  const p = planDay({ leads: [{ id: 'a', email: 'same@e.co' }, { id: 'b', email: 'SAME@e.co' }], ...OK });
  assert.equal(p.batch.length, 1);
  assert.match(p.skipped[0].why, /already in this batch/);
});

test('a bounce rate over 2% stops the day outright', () => {
  const p = planDay({ leads: leads(10), sent: 1000, bounces: 25, ...OK });
  assert.equal(p.ok, false);
  assert.equal(p.health.status, 'stop');
  assert.match(p.note, /nothing should be sent today/);
});

test('a message that will not render is not in the batch', () => {
  const p = planDay({ leads: leads(3), render: (l) => (l.id === 'l1' ? { ok: false, reason: 'merge fields left unresolved: {{signature}}' } : { ok: true, subject: 'S', body: 'B' }), ...OK });
  assert.equal(p.batch.length, 2);
  assert.ok(p.skipped.some((s) => /signature/.test(s.why)));
});

test('a render that throws is a skip, never a crash', () => {
  const p = planDay({ leads: leads(2), render: () => { throw new Error('boom'); }, ...OK });
  assert.equal(p.batch.length, 0);
  assert.match(p.skipped[0].why, /boom/);
});

test('the batch carries the actual message, so a human can read it before it goes', () => {
  const p = planDay({ leads: leads(1), render: () => ({ ok: true, subject: 'Hello there', body: 'the body' }), ...OK });
  assert.equal(p.batch[0].subject, 'Hello there');
  assert.equal(p.batch[0].body, 'the body');
  assert.match(p.batch[0].headers['List-Unsubscribe'], /x\.example/);
  assert.match(p.batch[0].footer, /1 Test St/);
});

// ── the send is opt-in twice ──────────────────────────────────────────────────────────────────────
test('called the ordinary way it sends nothing', async () => {
  const p = planDay({ leads: leads(5), ...OK });
  const r = await runDay(p);
  assert.equal(r.dryRun, true);
  assert.equal(r.sent, 0);
  assert.match(r.reason, /dry run/);
});

test('send:true without a sender still sends nothing', async () => {
  const r = await runDay(planDay({ leads: leads(5), ...OK }), { send: true });
  assert.equal(r.dryRun, true);
  assert.equal(r.sent, 0);
});

test('with both, it sends — and only what the plan allowed', async () => {
  const seen = [];
  const p = planDay({ leads: leads(852), ...OK });
  const r = await runDay(p, { send: true, sender: async (e) => { seen.push(e.email); return { ok: true, id: 'm1' }; } });
  assert.equal(r.dryRun, false);
  assert.equal(r.sent, 10);
  assert.equal(seen.length, 10);
});

test('a plan that says stop is not run', async () => {
  const p = planDay({ leads: leads(10), sent: 1000, bounces: 25, ...OK });
  let called = false;
  const r = await runDay(p, { send: true, sender: async () => { called = true; return { ok: true }; } });
  assert.equal(called, false);
  assert.equal(r.sent, 0);
});

test('three refusals in a row stops the run rather than burning the mailbox', async () => {
  const p = planDay({ leads: leads(10), ...OK });
  let n = 0;
  const r = await runDay(p, { send: true, sender: async () => { n += 1; return { ok: false, reason: 'no mailbox connected' }; } });
  assert.equal(n, 3);
  assert.equal(r.stoppedEarly, true);
  assert.equal(r.sent, 0);
  assert.match(r.reason, /stopping rather than burning/);
});

test('a sender that throws is a failure, not a crash', async () => {
  const p = planDay({ leads: leads(2), ...OK });
  const r = await runDay(p, { send: true, sender: async () => { throw new Error('network down'); }, stopAfterFailures: 99 });
  assert.equal(r.failed, 2);
  assert.match(r.results[0].reason, /network down/);
});

test('onSent runs per success and its failure does not stop the send', async () => {
  const p = planDay({ leads: leads(3), ...OK });
  let marks = 0;
  const r = await runDay(p, { send: true, sender: async () => ({ ok: true }), onSent: async () => { marks += 1; throw new Error('bookkeeping failed'); } });
  assert.equal(r.sent, 3);
  assert.equal(marks, 3);
});

test('a limit narrows the cap but never widens it', () => {
  assert.equal(planDay({ leads: leads(50), warmupDay: 27, limit: 5, ...OK }).cap, 5);
  assert.equal(planDay({ leads: leads(50), warmupDay: 0, limit: 500, ...OK }).cap, 10);
});

test('empty in, no throw', async () => {
  const p = planDay();
  assert.equal(p.batch.length, 0);
  assert.equal(p.ok, false);
  assert.equal((await runDay()).sent, 0);
});

test('handler answers and shows the ramp', () => {
  let body = ''; const res = { statusCode: 0, setHeader() {}, end(b) { body = b; } };
  handler({}, res);
  const jj = JSON.parse(body);
  assert.equal(jj.ok, true);
  assert.equal(jj.defaults.dryRun, true);
  assert.equal(jj.ramp[0].cap, 10);
});
