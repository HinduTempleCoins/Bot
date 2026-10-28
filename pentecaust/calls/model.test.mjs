// pentecaust/calls/model.test.mjs — OFFLINE. Presence, the signalling mailbox, rooms, roulette
// pairing and the block rules that pairing must respect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __reset, heartbeat, goOffline, online, isOnline, sweep,
  signal, drain, pending, MAX_MAIL_PER_ACCOUNT,
  block, unblock, blocked, blocklist, report, reports,
  createRoom, joinRoom, leaveRoom, getRoom, roomsFor, MESH_SOFT_LIMIT,
  joinQueue, leaveQueue, queueLength, pair,
  iceConfig, turnCredentials, PRESENCE_TTL_MS, MAIL_TTL_MS,
} from './model.mjs';

const clock = (start = 1_000_000) => { let t = start; return { now: () => t, tick: (ms) => { t += ms; } }; };

test('presence: heartbeat registers, invisible hides, offline removes', () => {
  __reset();
  heartbeat('alice', 'calls');
  heartbeat('bob', 'roulette');
  heartbeat('ghost', 'invisible');
  const names = online().map((p) => p.account).sort();
  assert.deepEqual(names, ['alice', 'bob'], 'invisible must not be listed');
  assert.ok(isOnline('ghost'), 'invisible is still online, just unlisted');
  goOffline('alice');
  assert.ok(!isOnline('alice'));
});

test('presence expires without a heartbeat', () => {
  __reset();
  const c = clock();
  heartbeat('alice', 'calls', c);
  assert.ok(isOnline('alice', c));
  c.tick(PRESENCE_TTL_MS + 1);
  assert.ok(!isOnline('alice', c), 'a tab that stopped beating is gone');
});

test('signalling: delivered once, to the right person', () => {
  __reset();
  assert.equal(signal('alice', 'bob', { type: 'offer', sdp: 'x' }).ok, true);
  assert.equal(pending('bob'), 1);
  assert.equal(pending('alice'), 0, 'the sender gets nothing');
  const got = drain('bob');
  assert.equal(got.length, 1);
  assert.equal(got[0].from, 'alice');
  assert.deepEqual(got[0].payload, { type: 'offer', sdp: 'x' });
  assert.deepEqual(drain('bob'), [], 'draining is destructive — no double delivery');
});

test('signalling refuses self-addressing, bad addresses, and blocked pairs', () => {
  __reset();
  assert.equal(signal('alice', 'alice', {}).ok, false);
  assert.equal(signal('', 'bob', {}).ok, false);
  block('bob', 'mallory');
  assert.equal(signal('mallory', 'bob', { type: 'offer' }).ok, false, 'a block stops signalling, not just pairing');
  assert.equal(pending('bob'), 0);
});

test('a mailbox cannot be used to exhaust memory', () => {
  __reset();
  for (let i = 0; i < MAX_MAIL_PER_ACCOUNT; i += 1) assert.equal(signal('alice', 'bob', { i }).ok, true);
  assert.equal(signal('alice', 'bob', { over: true }).ok, false, 'the cap holds');
  assert.equal(pending('bob'), MAX_MAIL_PER_ACCOUNT);
});

test('stale signals are swept', () => {
  __reset();
  const c = clock();
  signal('alice', 'bob', { type: 'offer' }, c);
  c.tick(MAIL_TTL_MS + 1);
  sweep(c);
  assert.equal(pending('bob', c), 0);
});

test('blocks are symmetric for pairing, and a report implies a block', () => {
  __reset();
  block('alice', 'bob');
  assert.ok(blocked('alice', 'bob'));
  assert.ok(blocked('bob', 'alice'), 'either direction prevents a match');
  assert.deepEqual(blocklist('alice'), ['bob']);
  unblock('alice', 'bob');
  assert.ok(!blocked('alice', 'bob'));

  report('carol', 'mallory', 'abusive');
  assert.ok(blocked('carol', 'mallory'), 'reporting someone must never pair you again');
  assert.equal(reports().length, 1);
  assert.equal(reports()[0].about, 'mallory');
});

test('rooms: join, peers, leave, and the mesh limit is enforced', () => {
  __reset();
  const r = createRoom('alice', { name: 'standup' });
  assert.equal(r.ok, true);
  const j = joinRoom(r.id, 'bob');
  assert.equal(j.ok, true);
  assert.deepEqual(j.peers, ['alice'], 'a joiner is told who to call');
  assert.deepEqual(getRoom(r.id).members, ['alice', 'bob']);

  for (let i = 0; i < MESH_SOFT_LIMIT - 2; i += 1) assert.equal(joinRoom(r.id, `extra${i}`).ok, true);
  const over = joinRoom(r.id, 'one-too-many');
  assert.equal(over.ok, false);
  assert.match(over.reason, /SFU/, 'the limit explains itself rather than failing silently');

  leaveRoom(r.id, 'bob');
  assert.ok(!getRoom(r.id).members.includes('bob'));
  assert.deepEqual(roomsFor('alice').map((x) => x.id), [r.id]);
});

test('a locked room admits only who is already in it, and blocks are honoured', () => {
  __reset();
  const r = createRoom('alice', { locked: true });
  assert.equal(joinRoom(r.id, 'bob').ok, false);
  const open = createRoom('alice', {});
  block('alice', 'mallory');
  assert.equal(joinRoom(open.id, 'mallory').ok, false, 'cannot join a room containing someone who blocked you');
});

test('an emptied room disappears', () => {
  __reset();
  const r = createRoom('alice', {});
  leaveRoom(r.id, 'alice');
  assert.equal(getRoom(r.id), null, 'a call that is over leaves nothing behind');
});

test('roulette pairs the two longest-waiting, and puts them in a room together', () => {
  __reset();
  heartbeat('alice'); heartbeat('bob'); heartbeat('carol');
  joinQueue('alice'); joinQueue('bob'); joinQueue('carol');
  assert.equal(queueLength(), 3);
  const m = pair();
  assert.deepEqual([m.a, m.b], ['alice', 'bob'], 'longest-waiting first');
  const room = getRoom(m.roomId);
  assert.deepEqual(room.members.sort(), ['alice', 'bob']);
  assert.equal(queueLength(), 1, 'the matched pair left the queue');
  assert.equal(pair(), null, 'one person alone cannot be paired');
});

test('roulette SKIPS a blocked pair and matches past it', () => {
  __reset();
  for (const a of ['alice', 'bob', 'carol']) { heartbeat(a); joinQueue(a); }
  block('alice', 'bob');
  const m = pair();
  assert.deepEqual([m.a, m.b], ['alice', 'carol'], 'blocked pair skipped, next eligible matched');
  assert.equal(queueLength(), 1);
});

test('a queue of mutually blocked people matches nobody rather than pairing them anyway', () => {
  __reset();
  for (const a of ['alice', 'bob']) { heartbeat(a); joinQueue(a); }
  block('alice', 'bob');
  assert.equal(pair(), null);
  assert.equal(queueLength(), 2, 'both stay queued');
});

test('leaving the queue and going offline both remove you', () => {
  __reset();
  heartbeat('alice'); joinQueue('alice');
  leaveQueue('alice');
  assert.equal(queueLength(), 0);
  heartbeat('bob'); joinQueue('bob');
  goOffline('bob');
  assert.equal(queueLength(), 0, 'going offline must not leave a ghost in the queue');
});

test('ICE config is honest about whether a relay exists', () => {
  const noTurn = iceConfig({});
  assert.equal(noTurn.relay, false);
  assert.equal(noTurn.mode, 'none');
  assert.match(noTurn.note, /STUN only/);
  assert.ok(noTurn.iceServers.length >= 1);

  const partial = iceConfig({ PENTECAUST_TURN_URL: 'turn:t.example:3478' });
  assert.equal(partial.relay, false, 'a half-configured TURN must not claim a relay');
});

test('a static TURN credential works but says it is the lesser option', () => {
  const c = iceConfig({ PENTECAUST_TURN_URL: 'turn:t.example:3478', PENTECAUST_TURN_USER: 'u', PENTECAUST_TURN_PASS: 'p' });
  assert.equal(c.relay, true);
  assert.equal(c.mode, 'static');
  assert.match(c.note, /prefer PENTECAUST_TURN_SECRET/);
  assert.ok(c.iceServers.find((s) => s.username === 'u'));
});

test('EPHEMERAL credentials: per-account, time-limited, and the secret never ships', () => {
  const c = clock(1_700_000_000_000);
  const env = { PENTECAUST_TURN_URL: 'turn:t.example:3478', PENTECAUST_TURN_SECRET: 'sh4red', PENTECAUST_TURN_TTL: 3600 };
  const alice = iceConfig(env, 'alice', c);
  assert.equal(alice.relay, true);
  assert.equal(alice.mode, 'ephemeral');
  const entry = alice.iceServers.find((s) => s.username);
  assert.match(entry.username, /^\d+:alice$/, 'username is <expiry>:<account>');
  assert.equal(entry.username.split(':')[0], String(1_700_000_000 + 3600));
  assert.ok(entry.credential && entry.credential.length > 10);
  assert.ok(!JSON.stringify(alice).includes('sh4red'), 'the shared secret must never reach the browser');

  const bob = iceConfig(env, 'bob', c);
  assert.notEqual(bob.iceServers.find((s) => s.username).credential, entry.credential, 'credentials are per-account');
});

test('ephemeral beats static when both are configured', () => {
  const c = iceConfig({
    PENTECAUST_TURN_URL: 'turn:t.example:3478',
    PENTECAUST_TURN_SECRET: 's', PENTECAUST_TURN_USER: 'u', PENTECAUST_TURN_PASS: 'p',
  }, 'alice');
  assert.equal(c.mode, 'ephemeral');
});

test('turnCredentials matches coturn: base64 HMAC-SHA1 of the username under the secret', async () => {
  const { createHmac } = await import('node:crypto');
  const c = clock(1_700_000_000_000);
  const got = turnCredentials('sh4red', 'alice', 600, c);
  assert.equal(got.username, `${1_700_000_000 + 600}:alice`);
  const want = createHmac('sha1', 'sh4red').update(got.username).digest('base64');
  assert.equal(got.credential, want);
  assert.equal(turnCredentials('s', 'a:b', 600, c).username.split(':').length, 2, 'a colon in an account cannot forge the expiry field');
  assert.ok(turnCredentials('s', 'a', 1, c).expiresAt >= Math.floor(c.now() / 1000) + 60, 'a silly TTL is floored, not honoured');
});
