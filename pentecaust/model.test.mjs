// model.test.mjs — MELEK Teams roster. OFFLINE. A temp JSON file isolates the store; deterministic now.
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  createTeam, joinTeam, approve, invite, leaveTeam, kick, setRole, setMotd,
  getTeam, isMember, teamsForAccount, listTeams, KINDS, OPENNESS,
} from './model.mjs';

const roleIn = (o, id, account) => { const t = getTeam(id, o); const m = t && t.members.find((x) => x.account === account); return m ? m.role : null; };

let _n = 0;
function store() {
  const file = join(tmpdir(), `teams-test-${process.pid}-${_n++}.json`);
  return { file, now: 1000, cleanup: () => { try { unlinkSync(file); } catch {} } };
}

test('create: founder becomes leader; defaults to an OPEN team', () => {
  const o = store();
  const r = createTeam({ name: 'Sky Sentinels', owner: 'alice' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.team.kind, 'team');          // default cosmetic label
  assert.equal(r.team.openness, 'open');      // open-join by default (operator)
  assert.equal(r.team.members[0].account, 'alice');
  assert.equal(r.team.members[0].role, 'leader');
  assert.equal(roleIn(o, r.team.id, 'alice'), 'leader');
  o.cleanup();
});

test('labels are free: alliance/clan/crew/etc; bad label falls back to team', () => {
  const o = store();
  assert.equal(createTeam({ name: 'Aces', owner: 'alice', kind: 'alliance' }, o).team.kind, 'alliance');
  assert.equal(createTeam({ name: 'Bees', owner: 'bob', kind: 'clan' }, o).team.kind, 'clan');
  assert.equal(createTeam({ name: 'Cats', owner: 'carol', kind: 'frobnicate' }, o).team.kind, 'team');
  for (const k of KINDS) assert.equal(createTeam({ name: 'k' + k, owner: 'dave', kind: k }, o).team.kind, k);
  o.cleanup();
});

test('open team: anyone joins instantly', () => {
  const o = store();
  const t = createTeam({ name: 'Open Squad', owner: 'alice', kind: 'squad' }, o).team;
  const j = joinTeam(t.id, 'bob', o);
  assert.equal(j.status, 'joined');
  assert.equal(isMember(t.id, 'bob', o), true);
  assert.equal(j.team.memberCount, 2);
  o.cleanup();
});

test('apply team: join queues a request; officer approves', () => {
  const o = store();
  const t = createTeam({ name: 'Apply Clan', owner: 'alice', kind: 'clan', openness: 'apply' }, o).team;
  const j = joinTeam(t.id, 'bob', o);
  assert.equal(j.status, 'applied');
  assert.equal(isMember(t.id, 'bob', o), false);            // not in yet
  const a = approve(t.id, 'alice', 'bob', o);               // leader approves
  assert.equal(a.status, 'joined');
  assert.equal(isMember(t.id, 'bob', o), true);
  // a non-officer cannot approve
  joinTeam(t.id, 'carol', o);
  assert.equal(approve(t.id, 'bob', 'carol', o).ok, false); // bob is only a member
  o.cleanup();
});

test('invite-only: join refused unless invited; invited account then joins', () => {
  const o = store();
  const t = createTeam({ name: 'Secret', owner: 'alice', openness: 'invite' }, o).team;
  assert.equal(joinTeam(t.id, 'bob', o).ok, false);
  invite(t.id, 'alice', 'bob', o);
  assert.equal(joinTeam(t.id, 'bob', o).status, 'joined');
  // invite-only teams are hidden from the public directory
  assert.ok(!listTeams(o).some((x) => x.id === t.id));
  o.cleanup();
});

test('roles: leader promotes; officer can kick a member but not a peer/leader', () => {
  const o = store();
  const t = createTeam({ name: 'Ranks', owner: 'alice' }, o).team;
  joinTeam(t.id, 'bob', o); joinTeam(t.id, 'carol', o);
  assert.equal(setRole(t.id, 'alice', 'bob', 'officer', o).ok, true);
  assert.equal(kick(t.id, 'bob', 'carol', o).status, 'kicked');     // officer bob kicks member carol
  joinTeam(t.id, 'carol', o);
  assert.equal(kick(t.id, 'bob', 'alice', o).ok, false);            // officer cannot kick leader
  assert.equal(setRole(t.id, 'bob', 'carol', 'officer', o).ok, false); // only leader sets roles
  o.cleanup();
});

test('leader leaving promotes the most senior remaining member', () => {
  const o = store();
  const t = createTeam({ name: 'Succession', owner: 'alice' }, o).team;
  joinTeam(t.id, 'bob', o); joinTeam(t.id, 'carol', o);
  setRole(t.id, 'alice', 'carol', 'officer', o);                    // carol outranks bob
  const r = leaveTeam(t.id, 'alice', o);
  assert.equal(r.status, 'left');
  assert.equal(r.newLeader, 'carol');
  assert.equal(roleIn(o, t.id, 'carol'), 'leader');
  o.cleanup();
});

test('last member leaving disbands the team', () => {
  const o = store();
  const t = createTeam({ name: 'Solo', owner: 'alice' }, o).team;
  assert.equal(leaveTeam(t.id, 'alice', o).status, 'disbanded');
  assert.equal(getTeam(t.id, o), null);
  o.cleanup();
});

test('cross-game identity: one account, many teams', () => {
  const o = store();
  const a = createTeam({ name: 'Miners', owner: 'alice', game: 'minecraft' }, o).team;
  const b = createTeam({ name: 'Walkers', owner: 'bob', game: 'move' }, o).team;
  joinTeam(a.id, 'steve', o); joinTeam(b.id, 'steve', o);
  const mine = teamsForAccount('steve', o);
  assert.equal(mine.length, 2);
  assert.deepEqual(mine.map((t) => t.name).sort(), ['Miners', 'Walkers']);
  o.cleanup();
});

test('motd: officer+ sets it', () => {
  const o = store();
  const t = createTeam({ name: 'Motd Crew', owner: 'alice' }, o).team;
  assert.equal(setMotd(t.id, 'alice', 'raid at 8', o).team.motd, 'raid at 8');
  joinTeam(t.id, 'bob', o);
  assert.equal(setMotd(t.id, 'bob', 'nope', o).ok, false);
  o.cleanup();
});

test('rejects non-MELEK account names; full team refuses joins', () => {
  const o = store();
  assert.equal(createTeam({ name: 'X', owner: '0xabc' }, o).ok, false);
  const t = createTeam({ name: 'Tiny', owner: 'alice', maxMembers: 2 }, o).team;
  joinTeam(t.id, 'bob', o);
  assert.equal(joinTeam(t.id, 'carol', o).reason, 'team is full');
  o.cleanup();
});

test('OPENNESS list is the supported set', () => {
  assert.deepEqual(OPENNESS, ['open', 'apply', 'invite']);
});
