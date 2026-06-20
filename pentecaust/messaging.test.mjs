// messaging.test.mjs — MELEK Teams chat. OFFLINE. Temp chat store; membership injected or via a temp roster.
import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import {
  postTeamMessage, postDM, readTeam, readDM, readChannel, inboxFor, dmChannelId, teamChannelId,
} from './messaging.mjs';
import { createTeam, joinTeam } from './model.mjs';

let _n = 0;
function chat() {
  const file = join(tmpdir(), `teams-chat-test-${process.pid}-${_n++}.json`);
  return { file, now: 5000, cleanup: () => { try { unlinkSync(file); } catch {} } };
}
// an injected membership oracle (so most tests don't need a real roster file)
const members = (...accts) => { const s = new Set(accts); return { isMember: (id, who) => s.has(who) }; };

test('dmChannelId is order-independent (same thread either direction)', () => {
  assert.equal(dmChannelId('alex', 'steve'), dmChannelId('steve', 'alex'));
  assert.equal(teamChannelId('raiders'), 'team:raiders');
});

test('team post requires membership; members post, non-members rejected', () => {
  const o = chat();
  const opt = { ...o, ...members('steve', 'alex') };
  assert.equal(postTeamMessage({ teamId: 'raiders', from: 'steve', text: 'hi' }, opt).ok, true);
  const no = postTeamMessage({ teamId: 'raiders', from: 'mallory', text: 'sneak' }, opt);
  assert.equal(no.ok, false);
  assert.match(no.reason, /members/);
  o.cleanup();
});

test('messages carry the game + surface they came from (cross-game)', () => {
  const o = chat();
  const opt = { ...o, ...members('steve') };
  postTeamMessage({ teamId: 'r', from: 'steve', text: 'mining', game: 'minecraft', surface: 'game' }, opt);
  postTeamMessage({ teamId: 'r', from: 'steve', text: 'on web', surface: 'website' }, opt);
  const msgs = readTeam('r', {}, o).messages;
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].game, 'minecraft');
  assert.equal(msgs[0].surface, 'game');
  assert.equal(msgs[1].game, null);
  assert.equal(msgs[1].surface, 'website');
  o.cleanup();
});

test('latest-N (tail) for history, then forward catch-up by cursor', () => {
  const o = chat();
  const opt = { ...o, ...members('ada') };
  for (let i = 0; i < 5; i++) postTeamMessage({ teamId: 't', from: 'ada', text: 'm' + i }, opt);
  // open the chat: latest 2 (history view)
  const latest = readTeam('t', { limit: 2, tail: true }, o);
  assert.deepEqual(latest.messages.map((m) => m.text), ['m3', 'm4']);
  // forward paging from the start: oldest 2, then the rest after the cursor — no overlap, no skips
  const page1 = readTeam('t', { since: 0, limit: 2 }, o);
  assert.deepEqual(page1.messages.map((m) => m.text), ['m0', 'm1']);
  const page2 = readTeam('t', { since: page1.cursor }, o);
  assert.deepEqual(page2.messages.map((m) => m.text), ['m2', 'm3', 'm4']);
  assert.ok(page2.messages.every((m) => m.seq > page1.cursor));
  o.cleanup();
});

test('DM: 1:1, both directions land in one thread; cannot DM yourself', () => {
  const o = chat();
  assert.equal(postDM({ from: 'steve', to: 'steve', text: 'hi' }, o).ok, false);
  postDM({ from: 'steve', to: 'alex', text: 'portal?' }, o);
  postDM({ from: 'alex', to: 'steve', text: 'omw' }, o);
  const thread = readDM('alex', 'steve', {}, o).messages;
  assert.equal(thread.length, 2);
  assert.equal(thread[0].from, 'steve');
  assert.equal(thread[0].to, 'alex');
  assert.equal(thread[1].from, 'alex');
  o.cleanup();
});

test('inbox lists DM threads newest-first with the last line', () => {
  const o = chat();
  postDM({ from: 'steve', to: 'alex', text: 'a1' }, o);
  postDM({ from: 'steve', to: 'bob', text: 'b1' }, o);
  postDM({ from: 'bob', to: 'steve', text: 'b2 latest' }, o);
  const inbox = inboxFor('steve', o);
  assert.equal(inbox.length, 2);
  assert.equal(inbox[0].with, 'bob');                  // most-recent thread first
  assert.equal(inbox[0].last.text, 'b2 latest');
  o.cleanup();
});

test('rejects bad accounts + empty text', () => {
  const o = chat();
  assert.equal(postDM({ from: '0xabc', to: 'alex', text: 'x' }, o).ok, false);
  assert.equal(postDM({ from: 'steve', to: 'alex', text: '   ' }, o).ok, false);
  assert.equal(postTeamMessage({ teamId: 't', from: 'steve', text: '' }, { ...o, ...members('steve') }).ok, false);
  o.cleanup();
});

test('integration: real roster gates the team channel (model + messaging together)', () => {
  const o = chat();
  const teamFile = join(tmpdir(), `teams-roster-int-${process.pid}-${_n++}.json`);
  const T = { file: teamFile };
  const team = createTeam({ name: 'Integration Squad', owner: 'alice' }, T).team;
  joinTeam(team.id, 'steve', T);
  const opt = { ...o, teamOpts: T };                   // membership checked against the real roster file
  assert.equal(postTeamMessage({ teamId: team.id, from: 'steve', text: 'in' }, opt).ok, true);
  assert.equal(postTeamMessage({ teamId: team.id, from: 'mallory', text: 'no' }, opt).ok, false);
  o.cleanup(); try { unlinkSync(teamFile); } catch {}
});

test('unknown channel reads empty, never throws', () => {
  const o = chat();
  const r = readChannel('team:nope', {}, o);
  assert.equal(r.ok, true);
  assert.deepEqual(r.messages, []);
  o.cleanup();
});
