import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_FIELDS, gradeReport, isSuccessful, STATES, createLedger, clockFor,
  triage, lateNotice, classifyMessage, GMAIL_QUERIES, report, handler,
} from './fax-receipts.mjs';

const GOOD = {
  atISO: '2026-09-08T14:12:00Z', toFax: '+12146533420', result: 'OK', pages: 3,
  durationSec: 74, remoteId: 'DALLAS CO SHERIFF', fromFax: '+12145550000', provider: 'machine',
};
const openRow = (l, over = {}) => l.open({
  id: 'fax_tx-dallas-sheriff_1', to: "Dallas County Sheriff's Department",
  fax: '+12146533420', subject: 'PIA', pages: 3, ...over,
});

test('a thin report is not evidence and the grader says which field is missing', () => {
  const g = gradeReport({ result: 'OK' });
  assert.equal(g.usable, false);
  assert.match(g.verdict, /Not yet evidence/);
  const missing = g.missing.map((m) => m.key);
  assert.ok(missing.includes('atISO') && missing.includes('pages') && missing.includes('toFax'));
});

test('a complete report is usable and says so', () => {
  const g = gradeReport(GOOD);
  assert.equal(g.usable, true);
  assert.equal(g.complete, true);
  assert.equal(g.verdict, 'Complete.');
});

test('a usable-but-thin report is accepted and told how to be stronger', () => {
  const g = gradeReport({ atISO: 'x', toFax: '+1', result: 'ok', pages: 2 });
  assert.equal(g.usable, true);
  assert.equal(g.complete, false);
  assert.match(g.verdict, /Stronger with.*CSID/s);
});

test('a FAILED report is kept, because it is the basis for resending', () => {
  const g = gradeReport({ ...GOOD, result: 'no answer' });
  assert.equal(g.usable, false);
  assert.match(g.verdict, /proof the send FAILED/);
  assert.match(g.verdict, /without losing the earlier attempt/);
});

test('isSuccessful is not fooled by a busy signal', () => {
  assert.equal(isSuccessful('OK'), true);
  assert.equal(isSuccessful('delivered'), true);
  assert.equal(isSuccessful('busy'), false);
  assert.equal(isSuccessful(''), false);
});

test('a new row is awaiting transmission and has no clock — nothing has been sent', () => {
  const l = createLedger();
  const r = openRow(l);
  assert.equal(r.state, STATES.AWAITING);
  assert.equal(r.clock, null);
  assert.equal(l.size, 1);
  assert.equal(openRow(l).id, r.id, 'opening twice does not duplicate');
});

test('a transmission moves the row to SENT-UNACKNOWLEDGED, not to done', () => {
  const l = createLedger();
  openRow(l);
  const r = l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD, method: 'walk-in' });
  assert.equal(r.state, STATES.SENT, 'pages left; nobody has confirmed receipt');
  assert.equal(r.sentAt, '2026-09-08T14:12:00Z');
  assert.equal(r.report.method, 'walk-in', 'a fax walked to a machine is a real send');
  assert.equal(r.clock.due, '2026-09-22');
  assert.equal(r.clock.basis, 'our transmission report');
});

test('a failed transmission does not start a clock', () => {
  const l = createLedger();
  openRow(l);
  const r = l.recordTransmission('fax_tx-dallas-sheriff_1', { report: { ...GOOD, result: 'busy' } });
  assert.equal(r.state, STATES.FAILED);
  assert.equal(r.clock, null);
  assert.equal(r.attempts, 1);
});

test("the body's own stated receipt date GOVERNS the clock over ours", () => {
  const l = createLedger();
  openRow(l);
  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD });
  const r = l.recordAcknowledgement('fax_tx-dallas-sheriff_1', {
    receivedISO: '2026-09-09', ref: 'PIR-2026-1234', from: 'records@dallascounty.org',
  });
  assert.equal(r.state, STATES.ACKED);
  assert.equal(r.ack.disputesOurDate, true, 'they say the 9th, we sent the 8th — flag it');
  assert.equal(r.clock.from, '2026-09-09');
  assert.equal(r.clock.basis, "the body's own stated receipt date");
  assert.equal(r.clock.due, '2026-09-23');
});

test('an acknowledgement matching our date does not raise a dispute', () => {
  const l = createLedger();
  openRow(l);
  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD });
  const r = l.recordAcknowledgement('fax_tx-dallas-sheriff_1', { receivedISO: '2026-09-08' });
  assert.equal(r.ack.disputesOurDate, false);
});

test('the clock skips Texas statutory holidays', () => {
  const c = clockFor({ regime: 'TX_PIA', days: 10, sentAt: '2026-12-18' });
  assert.equal(c.due, '2027-01-06');
  assert.ok(c.skipped.some((s) => s.date === '2026-12-24'));
  assert.equal(c.exact, false);
  assert.match(c.caveat, /552\.0031\(f\)/);
});

test('a federal regime counts on the federal calendar', () => {
  const c = clockFor({ regime: 'US_FOIA', days: 20, sentAt: '2026-10-08' });
  assert.equal(c.due, '2026-11-06', 'Columbus Day skipped');
});

test('triage separates what is provable from what is merely late', () => {
  const l = createLedger();
  openRow(l, { id: 'a' }); openRow(l, { id: 'b' }); openRow(l, { id: 'c' });
  l.recordTransmission('b', { report: GOOD });
  l.recordTransmission('c', { report: GOOD });
  l.recordAcknowledgement('c', { receivedISO: '2026-09-08', ref: 'R1' });

  const early = triage(l, '2026-09-10');
  assert.equal(early.awaitingTransmission.length, 1);
  assert.equal(early.sentUnacknowledged.length, 1);
  assert.equal(early.acknowledged.length, 1);
  assert.equal(early.overdue.length, 0);

  const late = triage(l, '2026-09-30');
  assert.equal(late.overdue.length, 2);
  assert.equal(late.awaitingTransmission.length, 1, 'unsent is never overdue');
});

test('lateNotice refuses to arm § 552.302 without a provable receipt date', () => {
  const l = createLedger();
  openRow(l);
  const row = l.find('fax_tx-dallas-sheriff_1');
  assert.equal(lateNotice(row, '2026-09-30'), null, 'no clock, no notice');

  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: { atISO: '2026-09-08', toFax: '+1', result: 'busy', pages: 1 } });
  assert.equal(lateNotice(l.find('fax_tx-dallas-sheriff_1'), '2026-09-30'), null);

  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD });
  const n = lateNotice(l.find('fax_tx-dallas-sheriff_1'), '2026-09-30');
  assert.equal(n.provable, true);
  assert.equal(n.proof, 'the transmission report');
  assert.match(n.argument, /§ 552\.302/);
  assert.match(n.argument, /presumed public/);
});

test('lateNotice is silent before the deadline', () => {
  const l = createLedger();
  openRow(l);
  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD });
  assert.equal(lateNotice(l.find('fax_tx-dallas-sheriff_1'), '2026-09-15'), null);
});

test('a response closes the row', () => {
  const l = createLedger();
  openRow(l);
  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD });
  const r = l.recordResponse('fax_tx-dallas-sheriff_1', { kind: 'records', atISO: '2026-09-19' });
  assert.equal(r.state, STATES.ANSWERED);
  assert.equal(triage(l, '2026-09-30').overdue.length, 0, 'answered is not overdue');
});

test('the ledger round-trips through JSON and rebuilds its clocks', () => {
  const l = createLedger();
  openRow(l);
  l.recordTransmission('fax_tx-dallas-sheriff_1', { report: GOOD });
  const back = createLedger(JSON.parse(JSON.stringify(l.toJSON())));
  assert.equal(back.size, 1);
  assert.equal(back.find('fax_tx-dallas-sheriff_1').clock.due, '2026-09-22');
  assert.equal(createLedger([null, {}, 5]).size, 0);
  assert.equal(createLedger().open({}), null);
});

test('classifyMessage recognises a provider confirmation', () => {
  const c = classifyMessage({
    from: 'noreply@telnyx.com', subject: 'Your fax was delivered',
    body: 'Fax to (214) 653-3420 delivered. Pages: 3', date: '2026-09-08T14:20:00Z',
  });
  assert.equal(c.kind, 'transmission-confirmation');
  assert.equal(c.provider, 'telnyx');
  assert.equal(c.result, 'ok');
  assert.equal(c.pages, 3);
  assert.equal(c.confidence, 'high');
  assert.match(c.toFax, /214/);
});

test('classifyMessage catches a failure as a failure', () => {
  const c = classifyMessage({
    from: 'noreply@phaxio.com', subject: 'Fax transmission report',
    body: 'Status: failed — no answer after 3 attempts', date: '2026-09-08T14:20:00Z',
  });
  assert.equal(c.kind, 'transmission-confirmation');
  assert.equal(c.result, 'failed');
});

test('classifyMessage recognises an agency acknowledgement and pulls its reference', () => {
  const c = classifyMessage({
    from: 'openrecords@dallascounty.org', subject: 'Public Information Act request received',
    body: 'We have received your records request. Reference number PIR-20260908-441.',
    date: '2026-09-09T15:00:00Z',
  });
  assert.equal(c.kind, 'agency-acknowledgement');
  assert.equal(c.ref, 'PIR-20260908-441');
  assert.equal(c.receivedISO, '2026-09-09');
  assert.equal(c.confidence, 'high');
});

test('classifyMessage does not claim ordinary mail is a receipt', () => {
  assert.equal(classifyMessage({ from: 'a@b.com', subject: 'lunch', body: 'hi' }).kind, 'other');
  assert.equal(classifyMessage({}).kind, 'other');
});

test('the gmail queries name the providers and the acknowledgement vocabulary', () => {
  assert.match(GMAIL_QUERIES.transmissions, /telnyx/);
  assert.match(GMAIL_QUERIES.transmissions, /transmission report/);
  assert.match(GMAIL_QUERIES.acknowledgements, /public information act/);
});

test('report() prints the states that need action first', () => {
  const l = createLedger();
  openRow(l, { id: 'a', to: 'Sheriff' });
  openRow(l, { id: 'b', to: 'City' });
  l.recordTransmission('b', { report: GOOD });
  const txt = report(l, '2026-09-30');
  assert.match(txt, /OVERDUE/);
  assert.match(txt, /NOT YET SENT/);
  assert.ok(txt.indexOf('OVERDUE') < txt.indexOf('NOT YET SENT'), 'action first');
  assert.match(report(createLedger()), /ledger is empty/);
});

test('handler exposes the field list and the search vocabulary', () => {
  const call = (url) => {
    const res = { statusCode: 0, headers: {}, body: '',
      setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
    handler({ url }, res);
    return JSON.parse(res.body);
  };
  assert.equal(call('/r/fields').fields.length, REPORT_FIELDS.length);
  assert.match(call('/r/queries').queries.transmissions, /fax/);
  assert.match(call('/r').note, /caller-held state/);
});
