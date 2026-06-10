// private-mail.test.mjs — offline tests for the MELEK private-mail module + relay handler (task #279).
//
// Fully offline: a DETERMINISTIC stub crypto (base64 envelope, NOT real ECIES) stands in for dhive
// Memo so encrypt→decrypt round-trips without any key infrastructure or network. No fetch, no chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  composeMessage, readInbox, threadFromFlag, canMessage, threadId,
  PM_CUSTOM_JSON_ID, __setCrypto, __setClock,
} from './private-mail.mjs';

import {
  handler, normalizeSendPayload, createMemoryStore,
  __setStore, __setRoleResolver, __setSendLimiter,
} from './private-mail-server.mjs';

import { Limiter } from './rate-limit.mjs';

// ── deterministic stub crypto ────────────────────────────────────────────────
// Envelope: base64(JSON{ to: recipientPub, m: message }). decrypt checks the recipient "key" matches.
// This is NOT secure — it exists only to exercise the round-trip + sealing logic offline.
const stubCrypto = {
  encrypt({ message, recipientPub }) {
    return 'stub:' + Buffer.from(JSON.stringify({ to: recipientPub, m: message })).toString('base64');
  },
  decrypt({ ciphertext, recipientWif }) {
    if (!String(ciphertext).startsWith('stub:')) throw new Error('not a stub envelope');
    const obj = JSON.parse(Buffer.from(String(ciphertext).slice(5), 'base64').toString('utf8'));
    // The recipientWif in the stub is the matching pub (we keep it symmetric for the test).
    if (recipientWif !== obj.to) throw new Error('wrong key');
    return obj.m;
  },
};

// A decryptor closure for readInbox that uses the stub + the recipient's "key".
function makeDecryptor(recipientKey) {
  return (msg) => {
    const plain = stubCrypto.decrypt({ ciphertext: msg.ct, recipientWif: recipientKey });
    const parsed = JSON.parse(plain); // composeMessage packs { s, b }
    return { subject: parsed.s, body: parsed.b };
  };
}

__setClock(() => '2026-06-10T00:00:00.000Z');

// ── compose + round-trip ─────────────────────────────────────────────────────
test('composeMessage produces an encrypted melek_pm custom_json op (no plaintext on the op)', async () => {
  const r = await composeMessage({
    from: 'hathor', to: 'alice', subject: 'hello', body: 'private words',
    recipientMemoPub: 'ALICEPUB', senderMemoWif: 'HATHORWIF', crypto: stubCrypto,
  });
  assert.equal(r.ok, true);
  assert.equal(r.op[0], 'custom_json');
  assert.equal(r.op[1].id, PM_CUSTOM_JSON_ID);
  assert.deepEqual(r.op[1].required_posting_auths, ['hathor']);

  const json = JSON.parse(r.op[1].json);
  assert.equal(json.from, 'hathor');
  assert.equal(json.to, 'alice');
  assert.ok(json.ct && typeof json.ct === 'string', 'has ciphertext');
  // CRITICAL: no plaintext leaks onto the op.
  const blob = r.op[1].json;
  assert.ok(!blob.includes('private words'), 'body must not appear in cleartext');
  assert.ok(!blob.includes('hello'), 'subject must not appear in cleartext');
  assert.ok(!blob.includes('HATHORWIF'), 'sender key must never be on the op');
});

test('encrypt -> decrypt round-trips subject + body via the stub', async () => {
  const r = await composeMessage({
    from: 'hathor', to: 'alice', subject: 'subj', body: 'the body',
    recipientMemoPub: 'ALICEPUB', senderMemoWif: 'HATHORWIF', crypto: stubCrypto,
  });
  const inbox = readInbox('alice', { ops: [r.op], decrypt: makeDecryptor('ALICEPUB') });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].subject, 'subj');
  assert.equal(inbox[0].body, 'the body');
  assert.equal(inbox[0].from, 'hathor');
  assert.equal(inbox[0].sealed, undefined);
});

test('composeMessage uses the default crypto seam override via __setCrypto', async () => {
  __setCrypto(stubCrypto);
  try {
    const r = await composeMessage({
      from: 'bob', to: 'alice', body: 'hi',
      recipientMemoPub: 'ALICEPUB', senderMemoWif: 'BOBWIF', // no per-call crypto: uses the seam
    });
    assert.equal(r.ok, true);
    assert.ok(JSON.parse(r.op[1].json).ct.startsWith('stub:'));
  } finally {
    __setCrypto(null);
  }
});

test('composeMessage rejects bad input', async () => {
  assert.equal((await composeMessage({ to: 'a', recipientMemoPub: 'x', senderMemoWif: 'y' })).reason, 'missing-from-or-to');
  assert.equal((await composeMessage({ from: 'a', to: 'a', recipientMemoPub: 'x', senderMemoWif: 'y' })).reason, 'cannot-message-self');
  assert.equal((await composeMessage({ from: 'a', to: 'b', senderMemoWif: 'y', crypto: stubCrypto, body: 'x' })).reason, 'missing-recipient-memo-pub');
  assert.equal((await composeMessage({ from: 'a', to: 'b', recipientMemoPub: 'x', crypto: stubCrypto, body: 'x' })).reason, 'missing-sender-memo-wif');
  assert.equal((await composeMessage({ from: 'a', to: 'b', recipientMemoPub: 'x', senderMemoWif: 'y', crypto: stubCrypto })).reason, 'empty-message');
});

// ── inbox filtering ──────────────────────────────────────────────────────────
test('readInbox filters to the addressee only and decrypts each', async () => {
  const m1 = (await composeMessage({ from: 'hathor', to: 'alice', body: 'for alice', recipientMemoPub: 'ALICEPUB', senderMemoWif: 'w', crypto: stubCrypto })).op;
  const m2 = (await composeMessage({ from: 'hathor', to: 'bob', body: 'for bob', recipientMemoPub: 'BOBPUB', senderMemoWif: 'w', crypto: stubCrypto })).op;
  const m3 = (await composeMessage({ from: 'cheetah', to: 'alice', body: 'also alice', recipientMemoPub: 'ALICEPUB', senderMemoWif: 'w', crypto: stubCrypto })).op;

  const aliceInbox = readInbox('alice', { ops: [m1, m2, m3], decrypt: makeDecryptor('ALICEPUB') });
  assert.equal(aliceInbox.length, 2);
  assert.ok(aliceInbox.every((m) => m.to === 'alice'));
  assert.deepEqual(aliceInbox.map((m) => m.body).sort(), ['also alice', 'for alice']);
});

test('readInbox keeps a message sealed when the key is wrong (no throw)', async () => {
  const m = (await composeMessage({ from: 'hathor', to: 'alice', body: 'secret', recipientMemoPub: 'ALICEPUB', senderMemoWif: 'w', crypto: stubCrypto })).op;
  // Decryptor with the WRONG key → throws inside → message stays sealed and is excluded by default.
  const excluded = readInbox('alice', { ops: [m], decrypt: makeDecryptor('WRONGKEY') });
  assert.equal(excluded.length, 0);
  // includeSealed surfaces it with sealed:true and no body.
  const sealed = readInbox('alice', { ops: [m], decrypt: makeDecryptor('WRONGKEY'), includeSealed: true });
  assert.equal(sealed.length, 1);
  assert.equal(sealed[0].sealed, true);
  assert.equal(sealed[0].body, '');
});

test('readInbox accepts parsed json + inner-op forms too', async () => {
  const full = (await composeMessage({ from: 'hathor', to: 'alice', body: 'x', recipientMemoPub: 'ALICEPUB', senderMemoWif: 'w', crypto: stubCrypto })).op;
  const innerOp = full[1];                    // { id, json }
  const parsedJson = JSON.parse(full[1].json); // { from, to, ct, ... }
  const inbox = readInbox('alice', { ops: [innerOp, parsedJson], decrypt: makeDecryptor('ALICEPUB') });
  assert.equal(inbox.length, 2);
});

// ── threadId ─────────────────────────────────────────────────────────────────
test('threadId is order-independent and salt-scoped', () => {
  assert.equal(threadId('alice', 'bob'), threadId('bob', 'alice'));
  assert.notEqual(threadId('alice', 'bob'), threadId('alice', 'bob', 'flag:1'));
});

// ── threadFromFlag ───────────────────────────────────────────────────────────
function fakeFlagStore(reports) {
  return { listReports: () => reports.slice() };
}

test('threadFromFlag opens a private thread tied to a flag (reporter side)', () => {
  const store = fakeFlagStore([{ id: 'mod_1', target: '@spammer/post', reporter: 'alice', status: 'open' }]);
  const r = threadFromFlag('mod_1', { store, agent: 'hathor' });
  assert.equal(r.ok, true);
  assert.equal(r.agent, 'hathor');
  assert.equal(r.user, 'alice');
  assert.equal(r.flag.id, 'mod_1');
  // Salted by the flag id so it differs from the parties' generic thread.
  assert.equal(r.threadId, threadId('hathor', 'alice', 'flag:mod_1'));
  assert.notEqual(r.threadId, threadId('hathor', 'alice'));
});

test('threadFromFlag falls back to the target @account when no reporter', () => {
  const store = fakeFlagStore([{ id: 'mod_2', target: '@badactor/some-post', reporter: '', status: 'open' }]);
  const r = threadFromFlag('mod_2', { store });
  assert.equal(r.ok, true);
  assert.equal(r.user, 'badactor');
});

test('threadFromFlag soft-fails on missing/unknown flag or no store', () => {
  assert.equal(threadFromFlag('', { store: fakeFlagStore([]) }).reason, 'missing-flag-id');
  assert.equal(threadFromFlag('x', {}).reason, 'no-store');
  assert.equal(threadFromFlag('nope', { store: fakeFlagStore([]) }).reason, 'flag-not-found');
});

// ── canMessage tiers ─────────────────────────────────────────────────────────
test('canMessage: staff tier by default (bot<->admin ok, user<->* off)', () => {
  assert.equal(canMessage('bot', 'admin'), true);
  assert.equal(canMessage('admin', 'bot'), true);
  assert.equal(canMessage('admin', 'admin'), true);
  assert.equal(canMessage('bot', 'bot'), true);
  // any user side is OFF by default
  assert.equal(canMessage('user', 'admin'), false);
  assert.equal(canMessage('admin', 'user'), false);
  assert.equal(canMessage('user', 'user'), false);
  // unknown role → treated as user → off
  assert.equal(canMessage('wizard', 'admin'), false);
});

test('canMessage: allowAllUsers flag enables everyone', () => {
  assert.equal(canMessage('user', 'user', { allowAllUsers: true }), true);
  assert.equal(canMessage('user', 'admin', { allowAllUsers: true }), true);
});

// ── normalizeSendPayload (server) ────────────────────────────────────────────
test('normalizeSendPayload accepts an op, a message, and a bare json; refuses plaintext', async () => {
  const built = await composeMessage({ from: 'hathor', to: 'alice', body: 'x', recipientMemoPub: 'ALICEPUB', senderMemoWif: 'w', crypto: stubCrypto });
  assert.ok(normalizeSendPayload({ op: built.op }).msg);
  assert.ok(normalizeSendPayload({ message: JSON.parse(built.op[1].json) }).msg);
  assert.ok(normalizeSendPayload(JSON.parse(built.op[1].json)).msg);

  // plaintext refused
  assert.equal(normalizeSendPayload({ from: 'a', to: 'b', subject: 'leak', ct: 'x' }).error, 'plaintext-refused');
  assert.equal(normalizeSendPayload({ from: 'a', to: 'b', body: 'leak', ct: 'x' }).error, 'plaintext-refused');
  // missing pieces
  assert.equal(normalizeSendPayload({ from: 'hathor', to: 'alice' }).error, 'no-message');
  assert.equal(normalizeSendPayload({ from: 'hathor', to: 'hathor', ct: 'x' }).error, 'cannot-message-self');
  // message form with an empty ct reaches the ciphertext check explicitly
  assert.equal(normalizeSendPayload({ message: { from: 'hathor', to: 'alice', ct: '' } }).error, 'missing-ciphertext');
  // a bare json with no ct is indistinguishable from "no message"
  assert.equal(normalizeSendPayload({ from: 'hathor', to: 'alice', ct: '' }).error, 'no-message');
});

// ── handler: a tiny mock req/res ─────────────────────────────────────────────
function mockReq({ method = 'GET', url = '/', body = null, origin = 'https://alpha.melek.salon' } = {}) {
  const handlers = {};
  const req = {
    method, url,
    headers: { origin, 'x-forwarded-for': '1.2.3.4' },
    socket: { remoteAddress: '1.2.3.4' },
    on(ev, cb) { handlers[ev] = cb; return req; },
    destroy() { if (handlers.error) handlers.error(new Error('destroyed')); },
    _emit() {
      if (body != null && handlers.data) handlers.data(Buffer.from(body));
      if (handlers.end) handlers.end();
    },
  };
  return req;
}
function mockRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; return this; },
    end(data) { if (data) this.body += data; this._done = true; return this; },
    json() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}
async function call(reqOpts) {
  const req = mockReq(reqOpts);
  const res = mockRes();
  const p = handler(req, res);
  req._emit();
  await p;
  return res;
}

// Fresh, non-persistent rate limiter + memory store + role resolver per handler test.
function resetServer() {
  __setStore(createMemoryStore());
  __setSendLimiter(new Limiter({ scope: 'pm-test', path: '/tmp/pm-rl-test.json', ipMax: 100, fpMax: 100, windowSec: 60, now: () => Date.now() }));
  __setRoleResolver((a) => (['hathor', 'cheetah'].includes(a) ? 'bot' : (a === 'admin1' ? 'admin' : 'user')));
}

test('handler: POST /pm/send (bot->admin) stored, then GET /pm/inbox returns the sealed envelope', async () => {
  resetServer();
  const built = await composeMessage({ from: 'hathor', to: 'admin1', subject: 's', body: 'b', recipientMemoPub: 'ADMINPUB', senderMemoWif: 'w', crypto: stubCrypto });

  const sent = await call({ method: 'POST', url: '/pm/send', body: JSON.stringify({ op: built.op }) });
  assert.equal(sent.statusCode, 200);
  assert.equal(sent.json().ok, true);

  const inbox = await call({ method: 'GET', url: '/pm/inbox?account=admin1' });
  assert.equal(inbox.statusCode, 200);
  const j = inbox.json();
  assert.equal(j.ok, true);
  assert.equal(j.count, 1);
  assert.equal(j.messages[0].to, 'admin1');
  assert.equal(j.messages[0].sealed, true);
  assert.ok(j.messages[0].ct.startsWith('stub:'), 'inbox relays ciphertext');
  // server never returns plaintext
  assert.ok(!inbox.body.includes('"body":"b"'));
});

test('handler: tier guard blocks user<->user by default (403)', async () => {
  resetServer();
  const built = await composeMessage({ from: 'carol', to: 'dave', body: 'hey', recipientMemoPub: 'DAVEPUB', senderMemoWif: 'w', crypto: stubCrypto });
  const res = await call({ method: 'POST', url: '/pm/send', body: JSON.stringify({ op: built.op }) });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().reason, 'not-permitted-by-tier');
});

test('handler: POST /pm/send refuses plaintext payloads (400)', async () => {
  resetServer();
  const res = await call({ method: 'POST', url: '/pm/send', body: JSON.stringify({ from: 'hathor', to: 'admin1', body: 'plaintext leak' }) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().reason, 'plaintext-refused');
});

test('handler: bad inputs', async () => {
  resetServer();
  assert.equal((await call({ method: 'GET', url: '/pm/inbox?account=' })).statusCode, 400);
  assert.equal((await call({ method: 'GET', url: '/pm/inbox?account=Bad_Name!' })).statusCode, 400);
  assert.equal((await call({ method: 'POST', url: '/pm/send', body: 'not-json' })).statusCode, 400);
  assert.equal((await call({ method: 'GET', url: '/nope' })).statusCode, 404);
});

test('handler: empty inbox is ok with count 0', async () => {
  resetServer();
  const res = await call({ method: 'GET', url: '/pm/inbox?account=admin1' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().count, 0);
});

test('handler: CORS only for the allowed origin; OPTIONS preflight 204', async () => {
  resetServer();
  const good = await call({ method: 'OPTIONS', url: '/pm/send', origin: 'https://alpha.melek.salon' });
  assert.equal(good.statusCode, 204);
  assert.equal(good.headers['access-control-allow-origin'], 'https://alpha.melek.salon');

  const bad = await call({ method: 'GET', url: '/pm/inbox?account=admin1', origin: 'https://evil.example' });
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});

test('handler: GET /health -> ok', async () => {
  resetServer();
  const res = await call({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});
