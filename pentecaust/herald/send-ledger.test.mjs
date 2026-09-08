// send-ledger.test.mjs — OFFLINE. In-memory fs, injected clock. Nothing touches disk or the network.
import { test } from 'node:test';
import assert from 'node:assert';
import { ledgerFor, recordSend, capFor, schedule, dayIndex } from './send-ledger.mjs';

const DAY = 86400000;
function mem() {
  const m = new Map();
  return { fs: { read: (p) => (m.has(p) ? m.get(p) : null), write: (p, s) => m.set(p, s) }, file: 'mem://ledger.json' };
}
const at = (o, day) => ({ ...o, now: day * DAY });

test('day one is 10, not 218', () => {
  const o = mem();
  assert.equal(capFor('ray', at(o, 20000)), 10);
  const l = ledgerFor('ray', at(o, 20000));
  assert.equal(l.sentToday, 0);
  assert.equal(l.remainingToday, 10);
  assert.equal(l.warmupDay, 0);
});

test('ten sends fill day one and the eleventh has nothing left', () => {
  const o = mem();
  for (let i = 0; i < 10; i += 1) assert.equal(recordSend('ray', {}, at(o, 20000)).ok, true);
  const l = ledgerFor('ray', at(o, 20000));
  assert.equal(l.sentToday, 10);
  assert.equal(l.remainingToday, 0);
  assert.equal(l.sent, 10);
});

test('the count resets with the day and the cap climbs with the ramp', () => {
  const o = mem();
  for (let i = 0; i < 10; i += 1) recordSend('ray', {}, at(o, 20000));
  const d2 = ledgerFor('ray', at(o, 20001));
  assert.equal(d2.sentToday, 0, 'a new day is a fresh count');
  assert.equal(d2.warmupDay, 1);
  assert.ok(d2.cap > 10, 'the ramp climbs');
  const d29 = ledgerFor('ray', at(o, 20028));
  assert.equal(d29.cap, 50, 'four weeks in, the ramp is done');
});

test('warmup is measured from the FIRST send, not from when the mailbox appeared', () => {
  const o = mem();
  recordSend('ray', {}, at(o, 30000));          // first send is day 30000
  assert.equal(ledgerFor('ray', at(o, 30003)).warmupDay, 3);
  // a mailbox that has never sent is on day 0 whatever the clock says
  assert.equal(ledgerFor('never-sent', at(o, 99999)).warmupDay, 0);
});

test('a failed attempt still counts against the day', () => {
  const o = mem();
  recordSend('ray', { ok: false }, at(o, 20000));
  assert.equal(ledgerFor('ray', at(o, 20000)).sentToday, 1);
});

test('bounces and complaints accumulate for the deliverability read', () => {
  const o = mem();
  recordSend('ray', { bounced: true }, at(o, 20000));
  recordSend('ray', { complained: true }, at(o, 20000));
  recordSend('ray', {}, at(o, 20000));
  const l = ledgerFor('ray', at(o, 20000));
  assert.equal(l.sent, 3); assert.equal(l.bounces, 1); assert.equal(l.complaints, 1);
});

test('two mailboxes do not share a cap', () => {
  const o = mem();
  for (let i = 0; i < 10; i += 1) recordSend('ray', {}, at(o, 20000));
  assert.equal(ledgerFor('ray', at(o, 20000)).remainingToday, 0);
  assert.equal(ledgerFor('erin', at(o, 20000)).remainingToday, 10);
});

test('the account key is normalised — @Ray and ray are one mailbox', () => {
  const o = mem();
  recordSend('@Ray', {}, at(o, 20000));
  assert.equal(ledgerFor('ray', at(o, 20000)).sentToday, 1);
});

test('an established inbox sits in the 25-65 band instead of ramping', () => {
  const o = mem();
  process.env.HERALD_INBOX_ESTABLISHED = '1';
  try {
    const l = ledgerFor('ray', at(o, 20000));
    assert.ok(l.cap >= 25 && l.cap <= 65, `cap ${l.cap} outside the established band`);
    assert.equal(l.established, true);
  } finally { delete process.env.HERALD_INBOX_ESTABLISHED; }
});

test('the whole ramp can be read before starting rather than after', () => {
  const s = schedule(29);
  assert.equal(s[0].cap, 10);
  assert.equal(s[27].cap, 49, 'the ramp reaches the ceiling on the day AFTER rampDays, not the day before');
  assert.equal(s[28].cap, 50);
  assert.ok(s[9].cumulative < 218, 'ten days is NOT enough for 218 — that is the point of the number');
  assert.ok(s[28].cumulative > 218, 'four weeks of ramp does clear the list');
});

test('day boundaries are UTC, so the cap does not reset twice a year', () => {
  assert.equal(dayIndex(0), 0);
  assert.equal(dayIndex(DAY - 1), 0);
  assert.equal(dayIndex(DAY), 1);
});

test('a corrupt or missing ledger file is an empty ledger, never a throw', () => {
  const bad = { fs: { read: () => '{{{not json', write: () => {} }, file: 'mem://bad.json', now: 0 };
  assert.equal(ledgerFor('ray', bad).sent, 0);
  const unwritable = { fs: { read: () => null, write: () => { throw new Error('read-only fs'); } }, file: 'x', now: 0 };
  assert.equal(recordSend('ray', {}, unwritable).ok, false);
  assert.equal(recordSend('', {}, mem()).ok, false);
});
