import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNELS, REGIMES, REGISTRY, office, emailable, notEmailable,
  deadlineFor, triage, composeRequest, handler,
} from './records-requests.mjs';

test('every office carries the four fields that decide whether a request lands', () => {
  for (const o of REGISTRY) {
    assert.ok(o.id && o.name, `id/name: ${JSON.stringify(o)}`);
    assert.ok(Object.values(CHANNELS).includes(o.channel), `channel: ${o.id}`);
    assert.ok(REGIMES[o.regime], `regime: ${o.id}`);
    assert.ok(o.verified, `every channel must record HOW it was established: ${o.id}`);
  }
});

test('office ids are unique', () => {
  const ids = REGISTRY.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('emailable and notEmailable partition the registry', () => {
  assert.equal(emailable().length + notEmailable().length, REGISTRY.length);
  for (const o of emailable()) {
    assert.equal(o.channel, CHANNELS.EMAIL);
    assert.ok(o.address, `emailable must have an address: ${o.id}`);
  }
});

test('judicial-branch bodies are not filed under the PIA', () => {
  const oca = office('tx-oca');
  assert.equal(oca.regime, 'TX_RULE12');
  assert.match(REGIMES.TX_RULE12.note, /NOT subject to the PIA/);
});

test('the bodies that refuse email are never marked emailable', () => {
  for (const id of ['tx-bar-cdc', 'tx-scjc', 'tx-tidc']) {
    assert.ok(!emailable().some((o) => o.id === id), `${id} must not be emailable`);
  }
});

test('deadlineFor counts business days and skips the weekend', () => {
  // 2026-09-07 is a Monday. Ten business days lands on Monday 2026-09-21.
  assert.equal(deadlineFor('tx-dart', '2026-09-07'), '2026-09-21');
});

test('deadlineFor counts calendar days where the regime says so', () => {
  assert.equal(deadlineFor('tx-parkland', '2026-09-07'), '2026-09-21'); // PIA, business
  const d = new Date('2026-09-07T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 14);
  assert.equal(deadlineFor('tx-oca', '2026-09-07'), d.toISOString().slice(0, 10));
});

test('a regime with no fixed period returns no deadline rather than inventing one', () => {
  assert.equal(REGIMES.WI_PRL.days, null);
  assert.equal(deadlineFor('wi-doa', '2026-09-07'), null);
});

test('deadlineFor is null for an unknown office or an unparseable date', () => {
  assert.equal(deadlineFor('nope', '2026-09-07'), null);
  assert.equal(deadlineFor('tx-dart', 'not-a-date'), null);
});

test('triage separates overdue, pending, answered, no-clock and unknown', () => {
  const out = triage([
    { officeId: 'tx-dart', sentISO: '2026-08-01' },                        // overdue
    { officeId: 'tx-dps', sentISO: '2026-09-05' },                         // pending
    { officeId: 'tx-parkland', sentISO: '2026-08-01', respondedISO: '2026-08-10' },
    { officeId: 'wi-doa', sentISO: '2026-08-01' },                         // no fixed clock
    { officeId: 'ghost', sentISO: '2026-08-01' },
  ], '2026-09-07T12:00:00Z');
  assert.equal(out.overdue.length, 1);
  assert.equal(out.overdue[0].officeId, 'tx-dart');
  assert.equal(out.pending.length, 1);
  assert.equal(out.answered.length, 1);
  assert.equal(out.noClock.length, 1);
  assert.equal(out.unknownOffice.length, 1);
});

test('triage tolerates an empty log', () => {
  const out = triage([], '2026-09-07T00:00:00Z');
  assert.deepEqual(out.overdue, []);
  assert.deepEqual(out.pending, []);
});

test('composeRequest renders the statute, the items and the no-records demand', () => {
  const r = composeRequest({
    officeId: 'tx-dart',
    requester: { name: 'A. Requester', address: 'Somewhere', contact: 'a@example.com' },
    items: ['All proof-of-play logs.', 'The retention schedule.'],
    subject: 'screen content',
    periodFrom: '1 Jan 2022', periodTo: '31 Mar 2023',
  });
  assert.ok(r.ok);
  assert.ok(r.sendable);
  assert.match(r.text, /Texas Public Information Act/);
  assert.match(r.text, /1\. All proof-of-play logs\./);
  assert.match(r.text, /2\. The retention schedule\./);
  assert.match(r.text, /no responsive record/i);
  assert.match(r.text, /1 Jan 2022 through 31 Mar 2023/);
});

test('composeRequest REFUSES to mark a portal-only body sendable', () => {
  const r = composeRequest({ officeId: 'tx-bar-cdc', requester: { name: 'X' }, items: ['a'] });
  assert.ok(r.ok);
  assert.equal(r.sendable, false);
  assert.match(r.reason, /portal/);
  assert.match(r.text, /NEVER EMAIL/);
});

test('composeRequest refuses an unknown office instead of guessing', () => {
  const r = composeRequest({ officeId: 'nope' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown office/);
});

test('composeRequest is safe with no items and no requester', () => {
  const r = composeRequest({ officeId: 'tx-dps' });
  assert.ok(r.ok);
  assert.match(r.text, /none specified/);
});

test('the DART intake gotcha is carried through to the composed note', () => {
  const r = composeRequest({ officeId: 'tx-dart', requester: { name: 'X' }, items: ['a'] });
  assert.match(r.text, /WILL NOT BE PROCESSED/);
});

function fakeRes() {
  return {
    code: 0, body: '', headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b; },
  };
}

test('handler returns the roster and flags what cannot be emailed', () => {
  const res = fakeRes();
  handler({ url: '/' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.total, REGISTRY.length);
  assert.ok(j.needsAnotherChannel.some((o) => o.id === 'tx-scjc'));
});

test('handler returns one office, and 404s an unknown one', () => {
  const ok = fakeRes();
  handler({ url: '/?office=tx-dart' }, ok);
  assert.equal(ok.code, 200);
  assert.equal(JSON.parse(ok.body).office.address, 'openrecords@dart.org');

  const bad = fakeRes();
  handler({ url: '/?office=ghost' }, bad);
  assert.equal(bad.code, 404);
});

test('handler soft-fails rather than throwing', () => {
  const res = fakeRes();
  handler({ url: null }, res);
  assert.ok(res.code === 200 || res.code === 500);
});
