// doorkeeper.test.mjs — the Tyler as doorkeeper, Tyler credit, lapsed dues. OFFLINE: in-memory store, injected clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGroup, addMember, approve, decline, invite, removeMember, setRole, getGroup, isMember,
  recordDuesPayment, sweepLapsed, listApplicants, setupClub,
} from './model.mjs';
import { handler } from './server.mjs';

function mem(now = 1000) {
  let buf = null;
  return { fs: { read: () => buf, write: (_p, s) => { buf = s; } }, file: 'mem.json', now };
}
const roleIn = (o, id, a) => { const m = getGroup(id, o).members.find((x) => x.account === a); return m ? m.role : null; };

// owner alice; tyler tom; mod mia; member bob; prospect pat
function club(o, joinPolicy = 'apply') {
  const id = createGroup({ name: 'Door Club', owner: 'alice', joinPolicy }, o).group.id;
  for (const a of ['tom', 'mia', 'bob', 'pat']) { invite(id, 'alice', a, o); addMember(id, a, o); }
  setRole(id, 'alice', 'tom', 'tyler', o);
  setRole(id, 'alice', 'mia', 'mod', o);
  setRole(id, 'alice', 'pat', 'prospect', o);
  return id;
}

test('a Tyler may remove a prospect but not a full member or above', () => {
  const o = mem(); const id = club(o);
  const r = removeMember(id, 'tom', 'bob', o);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Tyler may only remove prospects/);
  assert.equal(removeMember(id, 'tom', 'mia', o).ok, false);
  assert.equal(removeMember(id, 'tom', 'pat', o).status, 'removed');
  assert.equal(roleIn(o, id, 'pat'), null);
  // a mod still removes full members; a plain member removes nobody
  assert.equal(removeMember(id, 'bob', 'tom', o).ok, false);
  assert.equal(removeMember(id, 'mia', 'bob', o).status, 'removed');
});

test('a Tyler declines an applicant; members cannot; applicants list is Tyler+', () => {
  const o = mem(); const id = club(o);
  addMember(id, 'zed', o); addMember(id, 'yan', o);
  assert.equal(listApplicants(id, 'bob', o).ok, false);
  assert.deepEqual(listApplicants(id, 'tom', o).applicants.map((x) => x.account).sort(), ['yan', 'zed']);
  assert.equal(decline(id, 'bob', 'zed', o).ok, false);
  assert.equal(decline(id, 'tom', 'zed', o).status, 'declined');
  assert.equal(decline(id, 'tom', 'zed', o).reason, 'no such applicant');
  assert.equal(isMember(id, 'zed', o), false);
  assert.deepEqual(listApplicants(id, 'tom', o).applicants.map((x) => x.account), ['yan']);
});

test('Tyler credit: admittedBy on approve and redeemed invite; admitted vs retained counts', () => {
  const o = mem(); const id = club(o);
  for (const a of ['user1', 'user2', 'user3']) addMember(id, a, o);
  approve(id, 'tom', 'user1', o); approve(id, 'tom', 'user2', o);
  invite(id, 'tom', 'user4', o); addMember(id, 'user4', o);         // redeemed invite credits the inviter
  approve(id, 'mia', 'user3', o);
  let g = getGroup(id, o);
  assert.equal(g.members.find((m) => m.account === 'user1').admittedBy, 'tom');
  assert.equal(g.members.find((m) => m.account === 'user4').admittedBy, 'tom');
  assert.deepEqual(g.admissions.tom, { admitted: 3, retained: 3 });
  assert.deepEqual(g.admissions.mia, { admitted: 1, retained: 1 });
  removeMember(id, 'user2', 'user2', o);                             // user2 leaves
  g = getGroup(id, o);
  assert.deepEqual(g.admissions.tom, { admitted: 3, retained: 2 });
});

test('lapsed dues: view flag, isMember false, officers and comped exempt, sweep demotes and renewal restores', () => {
  const o = mem(1000); const id = club(o, 'dues');
  recordDuesPayment(id, 'bob', { paidAt: 900, until: 2000 }, o);
  recordDuesPayment(id, 'tom', { paidAt: 900, until: 2000 }, o);
  recordDuesPayment(id, 'mia', { paidAt: 900, until: 2000 }, o);   // mod: exempt
  recordDuesPayment(id, 'carl', { paidAt: 900, until: null }, o);  // one-time: never lapses
  assert.equal(isMember(id, 'bob', o), true);

  const later = { ...o, now: 5000 };
  const g = getGroup(id, later);
  const flag = (a) => g.members.find((m) => m.account === a).lapsed;
  assert.equal(flag('bob'), true);
  assert.equal(flag('tom'), true);
  assert.equal(flag('mia'), false);
  assert.equal(flag('pat'), false, 'comped (no duesPaid entry) is not lapsed');
  assert.equal(flag('carl'), false);
  assert.equal(isMember(id, 'bob', later), false);
  assert.equal(isMember(id, 'mia', later), true);
  assert.equal(isMember(id, 'pat', later), true);

  const s = sweepLapsed(id, later);
  assert.deepEqual(s.changed.map((c) => c.account).sort(), ['bob', 'tom']);
  assert.equal(roleIn(later, id, 'tom'), 'prospect');
  assert.equal(roleIn(later, id, 'bob'), 'prospect');
  assert.deepEqual(sweepLapsed(id, later).changed, [], 'idempotent');

  recordDuesPayment(id, 'tom', { paidAt: 5000, until: 9000 }, later);
  assert.equal(roleIn(later, id, 'tom'), 'tyler', 'renewal gives back the rank');
  assert.equal(isMember(id, 'tom', later), true);
});

test('sweep drops to muted when the club switched prospect off; non-dues clubs never lapse', () => {
  const o = mem(1000);
  const id = createGroup({ name: 'No Prospects', owner: 'alice', joinPolicy: 'dues' }, o).group.id;
  setupClub(id, 'alice', { disabled: ['prospect'] }, o);
  recordDuesPayment(id, 'bob', { paidAt: 900, until: 2000 }, o);
  assert.equal(sweepLapsed(id, { ...o, now: 5000 }).changed[0].to, 'muted');
  const open = createGroup({ name: 'Open One', owner: 'alice' }, o).group.id;
  recordDuesPayment(open, 'bob', { paidAt: 900, until: 2000 }, o);
  assert.equal(isMember(open, 'bob', { ...o, now: 5000 }), true);
  assert.equal(sweepLapsed('nope', o).ok, false);
});

// ── routes ──
const cap = () => { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; };
const call = async (who, method, url, body, opts) => {
  const { res, o } = cap();
  await handler({ method, url, body }, res, { whoami: () => who, opts });
  let j = {}; try { j = JSON.parse(o.body); } catch {}
  return { code: o.code, body: j };
};

test('routes: decline, applicants (Tyler+), Tyler kick limited to prospects', async () => {
  const o = mem(); const id = club(o);
  addMember(id, 'zed', o);
  assert.equal((await call('bob', 'GET', `/groups/${id}/applicants`, null, o)).code, 403);
  assert.equal((await call(null, 'GET', `/groups/${id}/applicants`, null, o)).code, 401);
  const list = await call('tom', 'GET', `/groups/${id}/applicants`, null, o);
  assert.deepEqual(list.body.applicants.map((x) => x.account), ['zed']);
  assert.equal((await call('tom', 'POST', `/groups/${id}/decline`, { account: 'zed' }, o)).body.status, 'declined');
  assert.equal((await call('tom', 'POST', `/groups/${id}/kick`, { account: 'bob' }, o)).body.ok, false);
  assert.equal((await call('tom', 'POST', `/groups/${id}/kick`, { account: 'pat' }, o)).body.status, 'removed');
  const guide = await call(null, 'GET', '/groups/setup-guide', null, o);
  assert.ok(guide.body.titleSets.lodge);
});

test('routes: a board read sweeps lapsed members', async () => {
  const o = mem(1000); const id = club(o, 'dues');
  recordDuesPayment(id, 'bob', { paidAt: 900, until: 2000 }, o);
  const later = { ...o, now: 5000 };
  const r = await call('alice', 'GET', `/groups/${id}/board`, null, later);
  assert.equal(r.body.ok, true);
  assert.equal(roleIn(later, id, 'bob'), 'prospect');
});
