// lodge.test.mjs — OFFLINE tests for the club ladder: Tyler/Prospect ranks, title sets, offices,
// publishing rank and the private board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, setRole, invite, addMember, approve, postToGroup, boardPost, listBoard, approveBoardPost,
  setPublishRole, setTitleSet, setOffice, getGroup, publishRoleOf } from './model.mjs';

function mem() { let b = null; return { fs: { read: () => b, write: (_p, s) => { b = s; } }, file: 'm.json' }; }
function club(o) {
  const g = createGroup({ owner: 'ceo', name: 'Lodge One', joinPolicy: 'dues', dues: { amount: 1000, currency: 'MELEK', rail: 'wallet' } }, o).group;
  for (const [a, r] of [['tyl', 'tyler'], ['mem', 'member'], ['off', 'mod']]) { invite(g.id, 'ceo', a, o); addMember(g.id, a, o); setRole(g.id, 'ceo', a, r, o); }
  return g.id;
}

test('a Tyler can invite and admit people; a plain member cannot', () => {
  const o = mem(); const id = club(o);
  assert.equal(invite(id, 'mem', 'newbie', o).ok, false);
  assert.equal(invite(id, 'tyl', 'newbie', o).ok, true);
});

test('clubs need the mod rank to publish into the feed; members use the board, and an approved draft may be published', () => {
  const o = mem(); const id = club(o);
  assert.equal(publishRoleOf(getGroup(id, o)), 'mod');
  const r = postToGroup(id, { author: 'mem', permlink: 'x' }, o);
  assert.equal(r.ok, false); assert.equal(r.status, 'needs-rank');
  assert.equal(postToGroup(id, { author: 'off', permlink: 'y' }, o).ok, true);
  const d = boardPost(id, 'mem', { title: 'Draft', body: 'Members only for now' }, o).post;
  assert.equal(approveBoardPost(id, 'tyl', d.id, o).ok, false);          // Tyler is below the publish rank
  assert.equal(approveBoardPost(id, 'off', d.id, o).ok, true);
  assert.equal(postToGroup(id, { author: 'mem', permlink: 'z', boardId: d.id }, o).ok, true);
  assert.equal(listBoard(id, 'mem', o).board[0].status, 'published');
});

test('the board is members only', () => {
  const o = mem(); const id = club(o);
  assert.equal(listBoard(id, 'stranger', o).ok, false);
  assert.equal(boardPost(id, 'stranger', { body: 'hi' }, o).ok, false);
});

test('the owner can lower the publish rank; plain groups default to member', () => {
  const o = mem(); const id = club(o);
  setPublishRole(id, 'ceo', 'member', o);
  assert.equal(postToGroup(id, { author: 'mem', permlink: 'w' }, o).ok, true);
  const open = createGroup({ owner: 'alice', name: 'Open Group' }, o).group;
  assert.equal(publishRoleOf(getGroup(open.id, o)), 'member');
});

test('title sets rename ranks — Tyler in every set — and offices sit on top of rank', () => {
  const o = mem(); const id = club(o);
  const title = (g, a) => g.members.find((m) => m.account === a).title;
  assert.equal(title(getGroup(id, o), 'ceo'), 'President');
  setTitleSet(id, 'ceo', 'lodge', o);
  let g = getGroup(id, o);
  assert.equal(title(g, 'ceo'), 'Worshipful Master'); assert.equal(title(g, 'tyl'), 'Tyler');
  setTitleSet(id, 'ceo', 'corporate', o);
  assert.equal(setOffice(id, 'ceo', 'off', 'CFO', o).ok, true);
  g = getGroup(id, o);
  assert.equal(title(g, 'ceo'), 'CEO');
  assert.equal(g.members.find((m) => m.account === 'off').office, 'CFO');
  assert.equal(setOffice(id, 'mem', 'off', 'CIO', o).ok, false);
});

test('club setup: custom names per rank, optional ranks switched off, a named space; held ranks cannot be switched off', async () => {
  const { setupClub, RANK_GUIDE } = await import('./model.mjs');
  const o = mem(); const id = club(o);
  assert.ok(RANK_GUIDE.find((r) => r.role === 'tyler').names.includes('Tyler'));
  // tyl currently holds 'tyler', so switching it off is refused
  assert.equal(setupClub(id, 'ceo', { disabled: ['tyler'] }, o).ok, false);
  setRole(id, 'ceo', 'tyl', 'member', o);
  const r = setupClub(id, 'ceo', { titles: { owner: 'High Priestess', tyler: 'Doorkeeper' }, disabled: ['tyler', 'prospect', 'owner'], spaceName: 'Inner Sanctum' }, o);
  assert.equal(r.ok, true);
  assert.equal(r.group.titles.owner, 'High Priestess');
  assert.deepEqual(r.group.disabledRanks, ['tyler', 'prospect']);       // owner can never be switched off
  assert.equal(r.group.spaceName, 'Inner Sanctum');
  assert.equal(setRole(id, 'ceo', 'mem', 'tyler', o).ok, false);          // switched-off ranks cannot be given
  assert.equal(setupClub(id, 'mem', { spaceName: 'x' }, o).ok, false);    // admins and owners only
});
