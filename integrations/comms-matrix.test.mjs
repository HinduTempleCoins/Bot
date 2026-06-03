import { test } from 'node:test';
import assert from 'node:assert';
import {
  dm, clan, partyVoice, sendMessage, tokenGateCheck, hathorBot,
  HATHOR_BOT, HOMESERVER, VOICE_BACKEND,
} from './comms-matrix.mjs';

// ── DM: 1:1 room spec well-formed ────────────────────────────────────────────────────────────────────
test('dm produces a well-formed 1:1 room spec', () => {
  const r = dm('@alice:melek', '@bob:melek');
  assert.equal(r.hat, 'dm');
  assert.equal(r.type, 'room');
  assert.equal(r.scope, 'direct');
  assert.equal(r.isDirect, true);
  assert.equal(r.visibility, 'private');
  assert.equal(r.tokenGate, null, 'DMs are never token-gated');
  assert.equal(r.members.length, 2);
  assert.ok(r.alias.startsWith('#dm-'));
  assert.ok(r.alias.endsWith(`:${HOMESERVER}`));
});

test('dm is symmetric — same alias regardless of arg order', () => {
  assert.equal(dm('@a:melek', '@b:melek').alias, dm('@b:melek', '@a:melek').alias);
});

test('dm requires two users', () => {
  assert.throws(() => dm('@a:melek'));
});

test('dm can include the Hathor bot when requested', () => {
  const r = dm('@a:melek', '@b:melek', { withHathor: true });
  assert.equal(r.members.length, 3);
  assert.ok(r.members.includes(HATHOR_BOT.userId));
});

// ── CLAN: Matrix Space spec well-formed ──────────────────────────────────────────────────────────────
test('clan produces a well-formed Matrix Space spec (ungated by default)', () => {
  const c = clan('Phoenix Guard');
  assert.equal(c.hat, 'clan');
  assert.equal(c.type, 'space');
  assert.equal(c.roomType, 'm.space');
  assert.equal(c.scope, 'clan');
  assert.equal(c.joinRule, 'public');
  assert.equal(c.tokenGate, null);
  assert.equal(c.visibility, 'public');
  assert.ok(c.alias.startsWith('#clan-phoenix-guard'));
  assert.ok(Array.isArray(c.children));
});

test('clan with a token gate is private + restricted with a normalized gate', () => {
  const c = clan('Holders Only', { tokenGate: { token: 'MELEK', minHold: 100 } });
  assert.equal(c.joinRule, 'restricted');
  assert.equal(c.visibility, 'private');
  assert.deepEqual(c.tokenGate, { token: 'MELEK', minHold: 100 });
});

test('clan gate accepts the `amount` alias for minHold and defaults to 1', () => {
  assert.equal(clan('A', { tokenGate: { token: 'X', amount: 5 } }).tokenGate.minHold, 5);
  assert.equal(clan('B', { tokenGate: { token: 'X' } }).tokenGate.minHold, 1);
});

test('clan always contains the Hathor bot, labeled AI', () => {
  const c = clan('Anything');
  assert.ok(c.members.includes(HATHOR_BOT.userId));
  const h = c.participants.find((p) => p.userId === HATHOR_BOT.userId);
  assert.ok(h && h.isBot && h.ai);
});

test('clan requires a name', () => {
  assert.throws(() => clan());
});

// ── PARTY-VOICE: voice room spec well-formed ─────────────────────────────────────────────────────────
test('partyVoice produces a well-formed voice room spec', () => {
  const v = partyVoice('raid-42');
  assert.equal(v.hat, 'party-voice');
  assert.equal(v.scope, 'voice');
  assert.equal(v.voice, true);
  assert.equal(v.voiceBackend, VOICE_BACKEND);
  assert.equal(v.sfu, 'livekit');
  assert.equal(v.sessionId, 'raid-42');
  assert.equal(v.callWidget.type, 'm.call');
  assert.ok(v.callWidget.url.includes('raid-42'));
  assert.ok(v.alias.startsWith('#party-raid-42'));
});

test('partyVoice can nest under a clan Space', () => {
  const c = clan('Guild');
  const v = partyVoice('sess1', { clanAlias: c.alias });
  assert.equal(v.parentSpace, c.alias);
});

test('partyVoice requires a sessionId', () => {
  assert.throws(() => partyVoice());
});

// ── token gate: gates clan join by holdings ──────────────────────────────────────────────────────────
test('tokenGateCheck allows ungated clans', () => {
  const c = clan('Open');
  assert.equal(tokenGateCheck('@a:melek', c, { holds: {} }).allowed, true);
});

test('tokenGateCheck allows holders with enough, blocks those without', () => {
  const c = clan('Gated', { tokenGate: { token: 'MELEK', minHold: 100 } });
  assert.equal(tokenGateCheck('@a:melek', c, { holds: { MELEK: 250 } }).allowed, true);
  const blocked = tokenGateCheck('@b:melek', c, { holds: { MELEK: 10 } });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'insufficient-holdings');
  assert.equal(blocked.have, 10);
  assert.equal(blocked.minHold, 100);
});

test('tokenGateCheck blocks a missing user on a gated clan', () => {
  const c = clan('Gated', { tokenGate: { token: 'MELEK', minHold: 1 } });
  assert.equal(tokenGateCheck(null, c, { holds: { MELEK: 99 } }).allowed, false);
});

// ── sendMessage: uses the injected client, soft-fails ────────────────────────────────────────────────
test('sendMessage calls the injected client and returns ok', async () => {
  const calls = [];
  const client = {
    sendTextMessage: async (room, text) => { calls.push({ room, text }); return { event_id: '$evt1' }; },
  };
  const res = await sendMessage({ room: '#dm-x:melek.community', text: 'hello' }, { client });
  assert.equal(res.ok, true);
  assert.equal(res.eventId, '$evt1');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { room: '#dm-x:melek.community', text: 'hello' });
});

test('sendMessage falls back to client.send / client.sendMessage', async () => {
  const r1 = await sendMessage({ room: 'r', text: 't' }, { client: { send: async () => 'ev' } });
  assert.equal(r1.ok, true);
  const r2 = await sendMessage({ room: 'r', text: 't' }, { client: { sendMessage: async () => ({ eventId: 'e2' }) } });
  assert.equal(r2.eventId, 'e2');
});

test('sendMessage soft-fails with no client / no room / empty text / no send fn', async () => {
  assert.equal((await sendMessage({ room: 'r', text: 't' }, {})).ok, false);
  assert.equal((await sendMessage({ text: 't' }, { client: {} })).ok, false);
  assert.equal((await sendMessage({ room: 'r', text: '  ' }, { client: {} })).ok, false);
  assert.equal((await sendMessage({ room: 'r', text: 't' }, { client: {} })).error, 'client-has-no-send');
});

test('sendMessage soft-fails (does not throw) when the client throws', async () => {
  const client = { sendTextMessage: async () => { throw new Error('boom'); } };
  const res = await sendMessage({ room: 'r', text: 't' }, { client });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'boom');
});

// ── Hathor bot: labeled as a bot/AI ──────────────────────────────────────────────────────────────────
test('Hathor bot participant is labeled as a bot AI', () => {
  const h = hathorBot();
  assert.equal(h, HATHOR_BOT);
  assert.equal(h.isBot, true);
  assert.equal(h.ai, true);
  assert.equal(h.kind, 'bot');
  assert.equal(h.label, 'AI');
  assert.ok(h.displayName.includes('AI'));
  assert.ok(h.userId.endsWith(`:${HOMESERVER}`));
});
