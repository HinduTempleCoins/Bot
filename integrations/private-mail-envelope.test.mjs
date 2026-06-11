// private-mail-envelope.test.mjs — offline tests for the #279 pure mail-envelope API.
// node:test + node:assert/strict. NO network, NO real keys: encrypt/decrypt/broadcast are fakes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIL_CUSTOM_JSON_ID,
  ROLES,
  threadId,
  canMessage,
  send,
  open,
  inbox,
  outbox,
  threadOf,
  esc,
  __setClock,
} from './private-mail-envelope.mjs';

// ── fake injected deps ─────────────────────────────────────────────────────────
// Reversible "seal": base64 inside SEALED(...). Deterministic, offline, key-free.
const fakeEncrypt = async ({ plaintext }) => `SEALED(${Buffer.from(plaintext).toString('base64')})`;
const fakeDecrypt = async ({ sealed }) => {
  const m = /^SEALED\((.*)\)$/.exec(sealed);
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
};
function makeBroadcast() {
  const sent = [];
  const broadcast = async (op) => {
    sent.push(JSON.parse(op[1].json));
    return { id: 'tx-' + sent.length };
  };
  return { sent, broadcast };
}

test('constants + esc shape', () => {
  assert.equal(MAIL_CUSTOM_JSON_ID, 'melek_mail');
  assert.deepEqual(ROLES, ['bot', 'admin', 'user']);
  assert.equal(esc('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
});

test('threadId is deterministic + order-independent + salt-scoped', () => {
  const a = threadId('hathor', 'admin1');
  const b = threadId('admin1', 'hathor');
  assert.equal(a, b);
  assert.match(a, /^mail_[0-9a-f]{24}$/);
  assert.notEqual(threadId('hathor', 'admin1', 'flag9'), a);
});

test('canMessage: staff pilot by default (bot<->admin / admin<->admin only)', () => {
  assert.equal(canMessage('bot', 'admin'), true);
  assert.equal(canMessage('admin', 'bot'), true);
  assert.equal(canMessage('admin', 'admin'), true);
  assert.equal(canMessage('bot', 'bot'), false); // no admin on either side
  assert.equal(canMessage('user', 'admin'), false);
  assert.equal(canMessage('user', 'user'), false);
});

test('canMessage: allowAllUsers opens it to everyone', () => {
  assert.equal(canMessage('user', 'user', { allowAllUsers: true }), true);
  assert.equal(canMessage('user', 'bot', { allowAllUsers: true }), true);
});

test('canMessage: unknown roles degrade to user (restrictive)', () => {
  assert.equal(canMessage('wizard', 'admin'), false);
  assert.equal(canMessage(undefined, null), false);
});

test('send: builds a melek_mail custom_json, seals subject+body, broadcasts', async () => {
  __setClock(() => '2026-06-11T00:00:00.000Z');
  const { sent, broadcast } = makeBroadcast();
  const r = await send(
    { from: 'Hathor', to: 'Admin1', subject: 'hi', body: 'secret note' },
    { encrypt: fakeEncrypt, broadcast },
  );
  assert.equal(r.ok, true);
  assert.equal(r.op[0], 'custom_json');
  assert.equal(r.op[1].id, 'melek_mail');
  assert.deepEqual(r.op[1].required_posting_auths, ['hathor']); // lowercased
  assert.equal(r.op[1].required_auths.length, 0);
  // routing metadata in the clear; NO plaintext anywhere in the op json.
  assert.equal(r.message.from, 'hathor');
  assert.equal(r.message.to, 'admin1');
  assert.match(r.message.thread, /^mail_/);
  assert.equal(sent.length, 1);
  const raw = JSON.stringify(r.op[1].json);
  assert.ok(!raw.includes('secret note'), 'plaintext body must not be in the op');
  assert.ok(!raw.includes('"subject":"hi"'), 'plaintext subject must not be in the op');
  __setClock();
});

test('send: round-trips through open() to recover subject+body', async () => {
  const { sent, broadcast } = makeBroadcast();
  await send(
    { from: 'alice', to: 'bob', subject: 'meeting', body: 'at noon' },
    { encrypt: fakeEncrypt, broadcast },
  );
  const opened = await open(sent[0], { decrypt: fakeDecrypt });
  assert.equal(opened.ok, true);
  assert.equal(opened.subject, 'meeting');
  assert.equal(opened.body, 'at noon');
});

test('send: role gate blocks a disallowed pair, allows a staff pair', async () => {
  const { broadcast } = makeBroadcast();
  const blocked = await send(
    { from: 'u1', to: 'u2', subject: 's', body: 'b' },
    { encrypt: fakeEncrypt, broadcast, roles: { sender: 'user', recipient: 'user' } },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'role not permitted');

  const ok = await send(
    { from: 'u1', to: 'u2', subject: 's', body: 'b' },
    { encrypt: fakeEncrypt, broadcast, roles: { sender: 'bot', recipient: 'admin' } },
  );
  assert.equal(ok.ok, true);
});

test('send: soft-fails on bad input + missing deps (never throws)', async () => {
  const { broadcast } = makeBroadcast();
  assert.equal((await send({ from: '', to: 'x' }, { encrypt: fakeEncrypt, broadcast })).ok, false);
  assert.equal((await send({ from: 'a', to: 'a' }, { encrypt: fakeEncrypt, broadcast })).reason, 'cannot message self');
  assert.equal((await send({ from: 'a', to: 'b' }, { broadcast })).reason, 'no encrypt dep');
  assert.equal((await send({ from: 'a', to: 'b' }, { encrypt: fakeEncrypt })).reason, 'no broadcast dep');
  assert.equal((await send(null, {})).ok, false);
});

test('send: refuses to broadcast if encrypt returns plaintext-bearing output', async () => {
  const { broadcast } = makeBroadcast();
  const leaky = async ({ plaintext }) => `PREFIX ${plaintext}`; // ciphertext that still contains the plaintext
  const r = await send({ from: 'a', to: 'b', subject: 's', body: 'leak' }, { encrypt: leaky, broadcast });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'refusing to send plaintext');
});

test('send: surfaces encrypt + broadcast errors as soft failures', async () => {
  const boomEnc = async () => { throw new Error('enc-boom'); };
  const okBcast = makeBroadcast().broadcast;
  const re = await send({ from: 'a', to: 'b', subject: 's', body: 'x' }, { encrypt: boomEnc, broadcast: okBcast });
  assert.equal(re.ok, false);
  assert.match(re.reason, /encrypt failed/);

  const boomB = async () => { throw new Error('bc-boom'); };
  const rb = await send({ from: 'a', to: 'b', subject: 's', body: 'x' }, { encrypt: fakeEncrypt, broadcast: boomB });
  assert.equal(rb.ok, false);
  assert.match(rb.reason, /broadcast failed/);
});

test('open: soft-fails on missing dep / no payload / bad ciphertext', async () => {
  assert.equal((await open({ sealed: 'SEALED(x)' }, {})).reason, 'no decrypt dep');
  assert.equal((await open({}, { decrypt: fakeDecrypt })).reason, 'no sealed payload');
  const bad = await open({ sealed: 'not-a-sealed-thing' }, { decrypt: fakeDecrypt });
  assert.equal(bad.ok, false); // fakeDecrypt returns '' -> "decrypt produced nothing"
});

test('open: foreign (non-JSON) plaintext comes back as body', async () => {
  const sealed = `SEALED(${Buffer.from('just a string').toString('base64')})`;
  const r = await open({ sealed }, { decrypt: fakeDecrypt });
  assert.equal(r.ok, true);
  assert.equal(r.subject, '');
  assert.equal(r.body, 'just a string');
});

// shared fixture for inbox/outbox/thread
function fixture() {
  const t1 = threadId('alice', 'bob');
  const t2 = threadId('alice', 'carol');
  return [
    { from: 'alice', to: 'bob', thread: t1, ts: '2026-06-11T00:00:01.000Z', id: 'm1', sealed: 'SEALED(x)' },
    { from: 'bob', to: 'alice', thread: t1, ts: '2026-06-11T00:00:03.000Z', id: 'm2', sealed: 'SEALED(x)' },
    { from: 'alice', to: 'bob', thread: t1, ts: '2026-06-11T00:00:02.000Z', id: 'm3', sealed: 'SEALED(x)' },
    { from: 'alice', to: 'carol', thread: t2, ts: '2026-06-11T00:00:05.000Z', id: 'm4', sealed: 'SEALED(x)' },
    null, // junk
    { nope: true }, // junk
  ];
}

test('inbox: messages TO account, newest-first', () => {
  const got = inbox('alice', fixture());
  assert.deepEqual(got.map((m) => m.id), ['m2']); // only bob->alice is addressed to alice
  const bobIn = inbox('BOB', fixture()); // case-insensitive
  assert.deepEqual(bobIn.map((m) => m.id), ['m3', 'm1']); // newest-first (00:02 before 00:01)
});

test('outbox: messages BY account, newest-first', () => {
  const got = outbox('alice', fixture());
  assert.deepEqual(got.map((m) => m.id), ['m4', 'm3', 'm1']); // 00:05, 00:02, 00:01
});

test('threadOf: messages in a thread, oldest-first (chronological)', () => {
  const t1 = threadId('alice', 'bob');
  const got = threadOf(fixture(), t1);
  assert.deepEqual(got.map((m) => m.id), ['m1', 'm3', 'm2']); // 00:01, 00:02, 00:03
});

test('inbox/outbox/threadOf: soft on empty/bad input', () => {
  assert.deepEqual(inbox('', fixture()), []);
  assert.deepEqual(outbox('alice', null), []);
  assert.deepEqual(threadOf(fixture(), ''), []);
  assert.deepEqual(threadOf('not-an-array', 'mail_x'), []);
});
