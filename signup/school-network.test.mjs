// school-network.test.mjs — OFFLINE. Temp data file via env; no network, never throws.
import { test } from 'node:test';
import assert from 'node:assert';

process.env.SCHOOL_NETWORK_DATA = `/tmp/school-net-${process.pid}.json`;
process.env.INVITES_DATA = `/tmp/school-net-invites-${process.pid}.json`;
process.env.SCHOOL_NETWORK_THRESHOLD = '5';

const {
  defineNetwork, getNetwork, listNetworks, join, readyToOpen, open, inviteBudget, status, handler,
  OPEN_THRESHOLD,
} = await import('./school-network.mjs');

const BOYD = { id: 'mckinney-boyd', school: 'McKinney Boyd High School', city: 'McKinney', state: 'TX', years: [2009, 2010, 2011, 2012] };

test('a network needs a school AND at least one class year — the year is the boundary', () => {
  assert.equal(defineNetwork({ school: 'Nowhere High' }).ok, false);
  assert.match(defineNetwork({ school: 'Nowhere High' }).reason, /class year/);
  assert.equal(defineNetwork({ years: [2010] }).ok, false);
});

test('define the Boyd network with the operator\'s cohorts', () => {
  const r = defineNetwork(BOYD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.network.years, [2009, 2010, 2011, 2012]);
  assert.equal(r.network.memberCount, 0);
  assert.equal(r.network.open, false);
});

test('a class year outside the network is REFUSED, not silently accepted', () => {
  const r = join('someone', { network: 'mckinney-boyd', year: 2019 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'year-outside-network');
  assert.match(r.reason, /boundary is the product/);
});

test('below threshold, signups are WAITLISTED — nobody is shown an empty room', () => {
  const r = join('alpha', { network: 'mckinney-boyd', year: 2010 });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'waitlisted', 'the first person in does NOT become a lone member');
  assert.equal(r.network.memberCount, 0);
  assert.equal(r.network.waitlistCount, 1);
  assert.equal(r.need, OPEN_THRESHOLD - 1);
  assert.match(r.why, /empty room/);
});

test('readyToOpen refuses below threshold and says how many short', () => {
  const r = readyToOpen('mckinney-boyd');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'below-threshold');
  assert.equal(r.have, 1);
  assert.equal(r.need, OPEN_THRESHOLD - 1);
});

test('open() refuses to open an under-filled network', () => {
  const r = open('mckinney-boyd');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'below-threshold');
  assert.equal(getNetwork('mckinney-boyd').open, false, 'the refusal actually held');
});

test('status() calls a waitlist a list, not a network', () => {
  const s = status();
  assert.equal(s.openCount, 0);
  assert.equal(s.totalMembers, 0);
  assert.match(s.honest, /that is a list, not a network/);
  assert.equal(s.networks[0].state, 'filling');
});

test('at threshold the network becomes ready, and opening admits everyone at once', () => {
  for (const who of ['beta', 'gamma', 'delta', 'epsilon']) {
    join(who, { network: 'mckinney-boyd', year: 2011 });
  }
  const ready = readyToOpen('mckinney-boyd');
  assert.equal(ready.ok, true, 'five of five');

  const o = open('mckinney-boyd');
  assert.equal(o.ok, true);
  assert.equal(o.admitted, 5, 'everyone who waited comes in together');
  assert.equal(o.network.memberCount, 5);
  assert.equal(o.network.waitlistCount, 0);
});

test('once open, a new classmate joins straight in — the waitlist was for the cold start only', () => {
  const r = join('zeta', { network: 'mckinney-boyd', year: 2009 });
  assert.equal(r.status, 'member');
  assert.equal(r.network.memberCount, 6);
});

test('joining twice is idempotent, not a second member', () => {
  const before = getNetwork('mckinney-boyd').memberCount;
  const r = join('zeta', { network: 'mckinney-boyd', year: 2009 });
  assert.equal(r.already, true);
  assert.equal(getNetwork('mckinney-boyd').memberCount, before);
});

test('the roster breaks down by class year', () => {
  const n = getNetwork('mckinney-boyd');
  assert.equal(n.byYear[2011], 4);
  assert.equal(n.byYear[2010], 1);
  assert.equal(n.byYear[2009], 1);
});

test('inviteBudget reads the EXISTING invite tree, and says plainly when someone cannot invite', () => {
  const b = inviteBudget('nobody-registered-here');
  assert.equal(b.registered, false);
  assert.equal(b.remaining, 0);
  assert.match(b.note, /cannot invite anyone until they have joined/);
});

test('an unknown network is a refusal, never an empty success', () => {
  assert.equal(join('x', { network: 'no-such-school', year: 2010 }).ok, false);
  assert.equal(readyToOpen('no-such-school').ok, false);
  assert.equal(getNetwork('no-such-school'), null);
});

test('listNetworks + handler report the policy and the real counts', () => {
  assert.equal(listNetworks().length, 1);
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.service, 'school-network');
  assert.match(j.policy, /never shown an empty room|nobody is ever shown an empty room/);
  assert.equal(j.openCount, 1);
  assert.equal(j.totalMembers, 6);
});
