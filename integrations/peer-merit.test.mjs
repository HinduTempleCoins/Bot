// peer-merit.test.mjs — offline node --test for the scarce peer-merit layer.
// No network, no disk, deterministic (all `now` values injected).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPeerMerit,
  makeMemoryStore,
  esc,
  renderBadge,
  ALLOTMENT_AMOUNT,
  ALLOTMENT_INTERVAL_MS,
} from './peer-merit.mjs';

const T0 = Date.parse('2026-01-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

test('constants: allotment amount and interval are the documented defaults', () => {
  assert.equal(ALLOTMENT_AMOUNT, 1);
  assert.equal(ALLOTMENT_INTERVAL_MS, 14 * DAY);
});

test('grantAllotment adds sendable on first grant', async () => {
  const m = createPeerMerit({});
  const r = await m.grantAllotment('alice', { now: T0 });
  assert.equal(r.ok, true);
  assert.equal(r.record.sendable, ALLOTMENT_AMOUNT);
  assert.equal(r.record.lastAllotmentTs, T0);
  assert.equal(await m.sendableOf('alice'), 1);
});

test('grantAllotment is rate-limited: a second call within the interval is a no-op', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('alice', { now: T0 });
  const r2 = await m.grantAllotment('alice', { now: T0 + DAY }); // 1 day < 14 days
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'rate-limited');
  assert.equal(await m.sendableOf('alice'), 1); // unchanged
});

test('grantAllotment grants again once the interval has passed', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('alice', { now: T0 });
  const r = await m.grantAllotment('alice', { now: T0 + 15 * DAY });
  assert.equal(r.ok, true);
  assert.equal(r.record.sendable, 2);
});

test('sendMerit moves balance and raises the receiver score', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('alice', { now: T0 });
  const r = await m.sendMerit('alice', 'bob', 1, { now: T0 });
  assert.equal(r.ok, true);
  assert.equal(r.from.sendable, 0);
  assert.equal(r.from.sentTotal, 1);
  assert.equal(r.to.received, 1);
  assert.equal(await m.meritScore('bob'), 1);
});

test('self-send is rejected (cannot mint merit for yourself)', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('bob', { now: T0 });
  const r = await m.sendMerit('bob', 'bob', 1, { now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'self-send');
  assert.equal(await m.meritScore('bob'), 0); // score did NOT rise
  assert.equal(await m.sendableOf('bob'), 1); // balance untouched
});

test('over-send (more than sendable) is rejected', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('alice', { now: T0 }); // sendable = 1
  const r = await m.sendMerit('alice', 'bob', 5, { now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient-sendable');
  assert.equal(await m.sendableOf('alice'), 1);
  assert.equal(await m.meritScore('bob'), 0);
});

test('non-integer and negative amounts are rejected', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('alice', { now: T0 });
  for (const bad of [1.5, -1, 0, '1', NaN, Infinity, null, undefined]) {
    const r = await m.sendMerit('alice', 'bob', bad, { now: T0 });
    assert.equal(r.ok, false, `amount ${String(bad)} must be rejected`);
    assert.equal(r.reason, 'amount-must-be-positive-integer');
  }
  assert.equal(await m.sendableOf('alice'), 1); // nothing spent
});

test('meritScore and rank order accounts by received desc', async () => {
  const m = createPeerMerit({});
  // fund three senders, then concentrate merit on carol > bob > dave
  for (const a of ['s1', 's2', 's3']) await m.grantAllotment(a, { now: T0 });
  await m.grantAllotment('s1', { now: T0 + 15 * DAY }); // s1 gets a 2nd unit
  await m.sendMerit('s1', 'carol', 2, { now: T0 });
  await m.sendMerit('s2', 'bob', 1, { now: T0 });
  await m.sendMerit('s3', 'dave', 1, { now: T0 });
  assert.equal(await m.meritScore('carol'), 2);
  const ranked = await m.rank();
  const received = Object.fromEntries(ranked.map((r) => [r.account, r.received]));
  assert.equal(received.carol, 2);
  // top of the board is carol
  assert.equal(ranked[0].account, 'carol');
  // limit works
  assert.equal((await m.rank(1)).length, 1);
});

test('meetsThreshold gates on received score', async () => {
  const m = createPeerMerit({});
  await m.grantAllotment('alice', { now: T0 });
  assert.equal(await m.meetsThreshold('bob', 1), false);
  await m.sendMerit('alice', 'bob', 1, { now: T0 });
  assert.equal(await m.meetsThreshold('bob', 1), true);
  assert.equal(await m.meetsThreshold('bob', 2), false);
});

test('full scenario: allotment → send → scores/balances move, cannot re-send beyond balance', async () => {
  const store = makeMemoryStore();
  const m = createPeerMerit({ store });
  // Alice gets her faucet allotment
  const a = await m.grantAllotment('alice', { now: T0 });
  assert.equal(a.record.sendable, 1);
  // Alice sends it to Bob
  const s1 = await m.sendMerit('alice', 'bob', 1, { now: T0 });
  assert.equal(s1.ok, true);
  // Bob's score rises, Alice's sendable drops to 0
  assert.equal(await m.meritScore('bob'), 1);
  assert.equal(await m.sendableOf('alice'), 0);
  // Alice cannot re-send beyond her (now empty) balance
  const s2 = await m.sendMerit('alice', 'bob', 1, { now: T0 });
  assert.equal(s2.ok, false);
  assert.equal(s2.reason, 'insufficient-sendable');
  // Bob, holding only `received` (not sendable), cannot spend it — received never funds sends
  assert.equal(await m.sendableOf('bob'), 0);
  const s3 = await m.sendMerit('bob', 'carol', 1, { now: T0 });
  assert.equal(s3.ok, false);
  assert.equal(s3.reason, 'insufficient-sendable');
});

test('renderBadge escapes account names', async () => {
  const html = renderBadge('<script>x</script>', { received: 3, sendable: 1 });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('3 merit'));
  // instance method escapes too
  const m = createPeerMerit({});
  const html2 = m.renderBadge('a"b', { received: 0, sendable: 0 });
  assert.ok(html2.includes('a&quot;b'));
});

test('esc escapes the five HTML-significant chars', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

test('never throws on garbage input (soft-fail everywhere)', async () => {
  const m = createPeerMerit({});
  await assert.doesNotReject(async () => {
    await m.grantAllotment(null, {});
    await m.grantAllotment(42, { now: 'nope' });
    await m.sendMerit(undefined, {}, [], {});
    await m.sendMerit('a', 'b', { bad: 1 }, {});
    await m.meritScore(null);
    await m.sendableOf(undefined);
    await m.meetsThreshold(123, 'x');
    await m.rank('junk');
    await m.record({});
    m.renderBadge(undefined, undefined);
  });
  // invalid grant returns a soft-fail shape, not a throw
  const bad = await m.grantAllotment(null, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'invalid-account');
});

test('a broken store (throws on every op) is absorbed, never propagated', async () => {
  const boom = {
    get() { throw new Error('boom'); },
    set() { throw new Error('boom'); },
    all() { throw new Error('boom'); },
  };
  const m = createPeerMerit({ store: boom });
  await assert.doesNotReject(async () => {
    await m.grantAllotment('alice', { now: T0 });
    await m.sendMerit('alice', 'bob', 1, { now: T0 });
    await m.meritScore('bob');
    await m.rank();
  });
});
