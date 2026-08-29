// model.test.mjs — MELEK Groups roster + feed. OFFLINE. Temp JSON file per store; deterministic `now`.
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  createGroup, addMember, approve, invite, removeMember, setRole, setJoinPolicy, setAbout, setAccount,
  getGroup, isMember, roleOf, listGroups, groupsForAccount,
  postToGroup, listFeed, groupChannelId, groupCategory,
  ROLES, JOIN_POLICIES, KINDS,
} from './model.mjs';

let _n = 0;
function store() {
  const file = join(tmpdir(), `groups-test-${process.pid}-${_n++}.json`);
  return { file, now: 1000, cleanup: () => { try { unlinkSync(file); } catch {} } };
}
const roleIn = (o, id, a) => { const g = getGroup(id, o); const m = g && g.members.find((x) => x.account === a); return m ? m.role : null; };

test('create: founder becomes owner; defaults community + open', () => {
  const o = store();
  const r = createGroup({ name: 'Plant Medicine', owner: 'hathor' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.group.kind, 'community');
  assert.equal(r.group.joinPolicy, 'open');
  assert.equal(r.group.owner, 'hathor');
  assert.equal(roleIn(o, r.group.id, 'hathor'), 'owner');
  assert.equal(r.group.memberCount, 1);
  o.cleanup();
});

test('create: rejects a bad owner name and a too-short group name', () => {
  const o = store();
  assert.equal(createGroup({ name: 'Fine', owner: 'x' }, o).ok, false);
  assert.equal(createGroup({ name: 'A', owner: 'hathor' }, o).ok, false);
  o.cleanup();
});

test('create: unique ids for same-named groups', () => {
  const o = store();
  const a = createGroup({ name: 'Herbs', owner: 'hathor' }, o).group;
  const b = createGroup({ name: 'Herbs', owner: 'alice' }, o).group;
  assert.notEqual(a.id, b.id);
  o.cleanup();
});

test('open join: instant member', () => {
  const o = store();
  const g = createGroup({ name: 'Open Group', owner: 'hathor' }, o).group;
  const j = addMember(g.id, 'alice', o);
  assert.equal(j.status, 'joined');
  assert.equal(isMember(g.id, 'alice', o), true);
  o.cleanup();
});

test('open join: idempotent (already-member), and rejects bad account', () => {
  const o = store();
  const g = createGroup({ name: 'Open Group', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o);
  assert.equal(addMember(g.id, 'alice', o).status, 'already-member');
  assert.equal(addMember(g.id, 'no', o).ok, false);
  o.cleanup();
});

test('apply join: queues, then a mod approves', () => {
  const o = store();
  const g = createGroup({ name: 'Apply Group', owner: 'hathor', joinPolicy: 'apply' }, o).group;
  const j = addMember(g.id, 'alice', o);
  assert.equal(j.status, 'applied');
  assert.equal(isMember(g.id, 'alice', o), false);
  // member cannot approve
  addMember(g.id, 'bob', o); // still just an applicant
  assert.equal(approve(g.id, 'bob', 'alice', o).ok, false);
  const ap = approve(g.id, 'hathor', 'alice', o);
  assert.equal(ap.status, 'joined');
  assert.equal(isMember(g.id, 'alice', o), true);
  o.cleanup();
});

test('invite join: invite-only rejects uninvited, admits invited', () => {
  const o = store();
  const g = createGroup({ name: 'Secret', owner: 'hathor', joinPolicy: 'invite' }, o).group;
  assert.equal(addMember(g.id, 'alice', o).status, 'invite-only');
  invite(g.id, 'hathor', 'alice', o);
  assert.equal(addMember(g.id, 'alice', o).status, 'joined');
  o.cleanup();
});

test('invite: only mod+ can invite', () => {
  const o = store();
  const g = createGroup({ name: 'Secret', owner: 'hathor', joinPolicy: 'invite' }, o).group;
  invite(g.id, 'hathor', 'alice', o); addMember(g.id, 'alice', o); // alice now a member
  assert.equal(invite(g.id, 'alice', 'carol', o).ok, false); // member can't invite
  o.cleanup();
});

test('token join: gated until balances pass, invite overrides gate', () => {
  const o = store();
  const g = createGroup({
    name: 'Whales', owner: 'hathor', joinPolicy: 'token',
    tokenGate: [{ role: 'holder', token: 'VKBT', minBalance: 100 }],
  }, o).group;
  assert.equal(addMember(g.id, 'alice', o).status, 'gated');
  assert.equal(addMember(g.id, 'alice', { ...o, balances: { VKBT: 50 } }).status, 'gated');
  assert.equal(addMember(g.id, 'alice', { ...o, balances: { VKBT: 250 } }).status, 'joined');
  // invite lets bob in with no balance
  invite(g.id, 'hathor', 'bob', o);
  assert.equal(addMember(g.id, 'bob', o).status, 'joined');
  o.cleanup();
});

test('setRole: owner promotes to admin/mod; role hierarchy enforced', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o); addMember(g.id, 'bob', o);
  assert.equal(setRole(g.id, 'hathor', 'alice', 'admin', o).ok, true);
  assert.equal(roleIn(o, g.id, 'alice'), 'admin');
  // admin alice can make bob a mod (below her rank)
  assert.equal(setRole(g.id, 'alice', 'bob', 'mod', o).ok, true);
  // admin alice cannot grant admin (at her own rank)
  assert.equal(setRole(g.id, 'alice', 'bob', 'admin', o).ok, false);
  o.cleanup();
});

test('setRole: member cannot set roles; cannot change own role', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o); addMember(g.id, 'bob', o);
  assert.equal(setRole(g.id, 'alice', 'bob', 'mod', o).ok, false);
  assert.equal(setRole(g.id, 'hathor', 'hathor', 'admin', o).ok, false);
  o.cleanup();
});

test('setRole: owner transfer drops old owner to admin', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o);
  const r = setRole(g.id, 'hathor', 'alice', 'owner', o);
  assert.equal(r.ok, true);
  assert.equal(roleIn(o, g.id, 'alice'), 'owner');
  assert.equal(roleIn(o, g.id, 'hathor'), 'admin');
  assert.equal(getGroup(g.id, o).owner, 'alice');
  // non-owner cannot transfer ownership
  assert.equal(setRole(g.id, 'hathor', 'hathor', 'owner', o).ok, false);
  o.cleanup();
});

test('setRole: mute a member (role muted, below member)', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o);
  assert.equal(setRole(g.id, 'hathor', 'alice', 'muted', o).ok, true);
  assert.equal(roleIn(o, g.id, 'alice'), 'muted');
  o.cleanup();
});

test('removeMember: self-leave; kick needs a higher role', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o); addMember(g.id, 'bob', o);
  assert.equal(removeMember(g.id, 'bob', 'bob', o).status, 'left'); // self leave
  addMember(g.id, 'bob', o);
  assert.equal(removeMember(g.id, 'alice', 'bob', o).ok, false);    // peer can't kick peer
  setRole(g.id, 'hathor', 'alice', 'mod', o);
  assert.equal(removeMember(g.id, 'alice', 'bob', o).status, 'removed'); // mod kicks member
  o.cleanup();
});

test('removeMember: owner leaves → succession to most senior; empty → disbanded', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o); addMember(g.id, 'bob', o);
  setRole(g.id, 'hathor', 'alice', 'admin', o);
  const r = removeMember(g.id, 'hathor', 'hathor', o);
  assert.equal(r.status, 'left');
  assert.equal(r.newOwner, 'alice'); // admin outranks plain member
  // now drain the group
  removeMember(g.id, 'alice', 'alice', o);
  const last = removeMember(g.id, 'bob', 'bob', o);
  assert.equal(last.status, 'disbanded');
  assert.equal(getGroup(g.id, o), null);
  o.cleanup();
});

test('postToGroup: builds meta + records feed; category is account else tag', () => {
  const o = store();
  const g = createGroup({ name: 'Plant Medicine', owner: 'hathor', tag: 'plantmedicine' }, o).group;
  addMember(g.id, 'alice', o);
  const p = postToGroup(g.id, { author: 'alice', permlink: 'My First Post!', title: 'Hi', tags: ['herbs'] }, o);
  assert.equal(p.ok, true);
  assert.equal(p.meta.parent_permlink, 'plantmedicine');       // no chain account yet → tag is category
  assert.equal(p.meta.json_metadata.tags[0], 'plantmedicine'); // group tag first
  assert.ok(p.meta.json_metadata.tags.includes('herbs'));
  assert.equal(p.feedRef.permlink, 'my-first-post');           // slugified
  const feed = listFeed(g.id, {}, o);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].author, 'alice');
  o.cleanup();
});

test('postToGroup: uses on-chain account as category once linked', () => {
  const o = store();
  const g = createGroup({ name: 'PM', owner: 'hathor', tag: 'pm', account: 'hive-100200' }, o).group;
  assert.equal(g.category, 'hive-100200');        // view computes category
  assert.equal(groupCategory(getGroup(g.id, o)), 'hive-100200'); // helper agrees on the view
  const p = postToGroup(g.id, { author: 'hathor', permlink: 'x' }, o);
  assert.equal(p.meta.parent_permlink, 'hive-100200');
  assert.equal(p.meta.json_metadata.community, 'hive-100200');
  o.cleanup();
});

test('postToGroup: non-members and muted members cannot post', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  assert.equal(postToGroup(g.id, { author: 'stranger', permlink: 'p' }, o).ok, false);
  addMember(g.id, 'alice', o);
  setRole(g.id, 'hathor', 'alice', 'muted', o);
  assert.equal(postToGroup(g.id, { author: 'alice', permlink: 'p' }, o).ok, false);
  o.cleanup();
});

test('feed is ring-buffered newest-first', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  for (let i = 0; i < 5; i++) postToGroup(g.id, { author: 'hathor', permlink: `post-${i}`, now: 1000 + i }, o);
  const feed = listFeed(g.id, { limit: 3 }, o);
  assert.equal(feed.length, 3);
  assert.equal(feed[0].permlink, 'post-4'); // newest first
  o.cleanup();
});

test('setJoinPolicy + setAbout + setAccount: admin+ only', () => {
  const o = store();
  const g = createGroup({ name: 'Grp', owner: 'hathor' }, o).group;
  addMember(g.id, 'alice', o);
  assert.equal(setJoinPolicy(g.id, 'alice', 'apply', null, o).ok, false); // member denied
  assert.equal(setJoinPolicy(g.id, 'hathor', 'token', [{ role: 'h', token: 'VKBT', minBalance: 1 }], o).ok, true);
  assert.equal(getGroup(g.id, o).joinPolicy, 'token');
  assert.equal(setAbout(g.id, 'hathor', 'A group about plants', o).ok, true);
  assert.equal(getGroup(g.id, o).about, 'A group about plants');
  assert.equal(setAccount(g.id, 'hathor', 'hive-555000', o).ok, true);
  assert.equal(getGroup(g.id, o).account, 'hive-555000');
  o.cleanup();
});

test('listGroups: hides invite-only; sorts by memberCount', () => {
  const o = store();
  const a = createGroup({ name: 'Big', owner: 'hathor' }, o).group;
  addMember(a.id, 'alice', o); addMember(a.id, 'bob', o);
  createGroup({ name: 'Small', owner: 'carol' }, o);
  createGroup({ name: 'Hidden', owner: 'dave', joinPolicy: 'invite' }, o);
  const list = listGroups(o);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Big'); // most members first
  o.cleanup();
});

test('groupsForAccount: every group a member belongs to', () => {
  const o = store();
  const a = createGroup({ name: 'One', owner: 'hathor' }, o).group;
  const b = createGroup({ name: 'Two', owner: 'alice' }, o).group;
  addMember(a.id, 'alice', o);
  const mine = groupsForAccount('alice', o).map((g) => g.name).sort();
  assert.deepEqual(mine, ['One', 'Two']);
  o.cleanup();
});

test('groupChannelId + constants exported', () => {
  assert.equal(groupChannelId('plant-medicine'), 'group:plant-medicine');
  assert.ok(JOIN_POLICIES.includes('token'));
  assert.ok(KINDS.includes('community'));
  assert.equal(ROLES.owner > ROLES.admin, true);
  assert.equal(ROLES.muted < ROLES.member, true);
});

test('no-such-group: operations soft-fail', () => {
  const o = store();
  assert.equal(addMember('nope', 'alice', o).ok, false);
  assert.equal(setRole('nope', 'a', 'b', 'mod', o).ok, false);
  assert.equal(postToGroup('nope', { author: 'alice', permlink: 'p' }, o).ok, false);
  assert.equal(getGroup('nope', o), null);
  assert.deepEqual(listFeed('nope', {}, o), []);
  o.cleanup();
});
