// model.test.mjs — OFFLINE tests for Pact channels (IRC-style rooms). In-memory fs; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChannel, listChannels, getChannel, joinChannel, roster, postMessage, readMessages, runCommand,
  normName, PRESENCE_MS } from './model.mjs';

function memFs() { let data = null; return { read: () => data, write: (_p, s) => { data = s; } }; }
const T = 1_800_000_000_000;
const ctx = (fs, t = T) => ({ fs, file: 'mem', now: t });

test('channel names: #-prefix optional, lowercased, 2–30 of a-z 0-9 -', () => {
  assert.equal(normName('#Botanica'), 'botanica');
  assert.equal(normName('melek-dev'), 'melek-dev');
  assert.equal(normName('#a'), null);
  assert.equal(normName('has space'), null);
  assert.equal(normName('#' + 'x'.repeat(31)), null);
});

test('starting a channel makes the founder its op; duplicates are refused', () => {
  const fs = memFs();
  const r = createChannel({ name: '#botanica', topic: 'Plants', founder: 'Alice' }, ctx(fs));
  assert.equal(r.ok, true);
  assert.equal(getChannel('botanica', ctx(fs)).founder, 'alice');
  assert.deepEqual(roster('botanica', ctx(fs)), [{ who: 'alice', mark: '@' }]);
  assert.equal(createChannel({ name: 'Botanica', founder: 'bob' }, ctx(fs)).ok, false);
});

test('messages, /me, and reading since a sequence number', () => {
  const fs = memFs();
  createChannel({ name: 'chat', founder: 'alice' }, ctx(fs));
  joinChannel('chat', 'bob', ctx(fs));
  assert.equal(postMessage('chat', 'bob', 'hello', ctx(fs)).ok, true);
  const a = postMessage('chat', 'bob', '/me waves', ctx(fs));
  assert.equal(a.message.kind, 'action');
  const all = readMessages('chat', {}, ctx(fs));
  assert.deepEqual(all.map((m) => m.text), ['hello', 'waves']);
  assert.deepEqual(readMessages('chat', { since: all[0].seq }, ctx(fs)).map((m) => m.text), ['waves']);
});

test('only ops can run op commands; op/voice/topic work and post a notice', () => {
  const fs = memFs();
  createChannel({ name: 'chat', founder: 'alice' }, ctx(fs));
  joinChannel('chat', 'bob', ctx(fs));
  assert.equal(runCommand('chat', 'bob', '/topic mine now', ctx(fs)).ok, false);
  assert.equal(runCommand('chat', 'alice', '/topic Welcome', ctx(fs)).ok, true);
  assert.equal(getChannel('chat', ctx(fs)).topic, 'Welcome');
  runCommand('chat', 'alice', '/op bob', ctx(fs));
  assert.equal(runCommand('chat', 'bob', '/voice carol', ctx(fs)).ok, true);
  assert.equal(readMessages('chat', {}, ctx(fs)).at(-1).kind, 'notice');
});

test('+m moderated: only ops and voiced people can talk', () => {
  const fs = memFs();
  createChannel({ name: 'stage', founder: 'alice', moderated: true }, ctx(fs));
  joinChannel('stage', 'bob', ctx(fs));
  assert.equal(postMessage('stage', 'bob', 'hi', ctx(fs)).ok, false);
  runCommand('stage', 'alice', '/voice bob', ctx(fs));
  assert.equal(postMessage('stage', 'bob', 'hi', ctx(fs)).ok, true);
});

test('+i invite-only: uninvited people cannot join until invited', () => {
  const fs = memFs();
  createChannel({ name: 'club', founder: 'alice', inviteOnly: true }, ctx(fs));
  assert.equal(joinChannel('club', 'bob', ctx(fs)).ok, false);
  runCommand('club', 'alice', '/invite bob', ctx(fs));
  assert.equal(joinChannel('club', 'bob', ctx(fs)).ok, true);
});

test('kick removes from the room; ban keeps them out; the founder cannot be kicked, banned or de-opped', () => {
  const fs = memFs();
  createChannel({ name: 'chat', founder: 'alice' }, ctx(fs));
  joinChannel('chat', 'bob', ctx(fs)); joinChannel('chat', 'mallory', ctx(fs));
  runCommand('chat', 'alice', '/op bob', ctx(fs));
  runCommand('chat', 'bob', '/kick mallory spamming', ctx(fs));
  assert.ok(!roster('chat', ctx(fs)).some((u) => u.who === 'mallory'));
  runCommand('chat', 'bob', '/ban mallory', ctx(fs));
  assert.equal(joinChannel('chat', 'mallory', ctx(fs)).ok, false);
  for (const c of ['/kick alice', '/ban alice', '/deop alice']) assert.equal(runCommand('chat', 'bob', c, ctx(fs)).ok, false);
});

test('presence: the roster and list only count people seen in the last few minutes', () => {
  const fs = memFs();
  createChannel({ name: 'chat', founder: 'alice' }, ctx(fs, T));
  joinChannel('chat', 'bob', ctx(fs, T + PRESENCE_MS - 1000));
  assert.deepEqual(roster('chat', ctx(fs, T + PRESENCE_MS + 1)).map((u) => u.who), ['bob']);
  assert.equal(listChannels(ctx(fs, T + PRESENCE_MS + 1))[0].online, 1);
});

test('unknown commands explain what exists', () => {
  const fs = memFs();
  createChannel({ name: 'chat', founder: 'alice' }, ctx(fs));
  assert.match(runCommand('chat', 'alice', '/nick bob', ctx(fs)).reason, /Try:/);
});
