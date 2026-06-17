// newsletter.test.mjs — offline. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyStore, addSubscriber, coldImport, confirm, unsubscribe, confirmedList,
  recordContact, validEmail, subscribeWidget, handle, __setTokenFn,
} from './newsletter.mjs';

let n = 0;
__setTokenFn(() => `tok${++n}`);

test('validEmail', () => {
  assert.ok(validEmail('a@b.co'));
  assert.ok(!validEmail('nope'));
  assert.ok(!validEmail('a@b'));
});

test('subscribe → pending; only confirmed are mailable', () => {
  const s = emptyStore();
  const r = addSubscriber(s, { email: 'A@X.com' });
  assert.equal(r.status, 'pending');
  assert.equal(r.email, 'a@x.com');               // normalized
  assert.deepEqual(confirmedList(s), []);          // not yet mailable
  const c = confirm(s, r.token);
  assert.equal(c.ok, true);
  assert.deepEqual(confirmedList(s), ['a@x.com']); // now on the list
});

test('invalid email rejected', () => {
  const s = emptyStore();
  assert.equal(addSubscriber(s, { email: 'bad' }).status, 'invalid');
});

test('cold list feeds in as pending; graduates only on confirm', () => {
  const s = emptyStore();
  const out = coldImport(s, ['one@x.com', 'two@x.com', 'garbage', 'three@x.com']);
  assert.equal(out.added, 3);
  assert.equal(out.invalid, 1);
  assert.deepEqual(confirmedList(s), []);          // cold list NOT mailable until confirmed
  // one person clicks their confirm link
  confirm(s, out.pending[0].token);
  assert.deepEqual(confirmedList(s), ['one@x.com']);
});

test('re-subscribe keeps the same token; already-confirmed is a no-op', () => {
  const s = emptyStore();
  const a = addSubscriber(s, { email: 'z@x.com' });
  const b = addSubscriber(s, { email: 'z@x.com' });
  assert.equal(a.token, b.token);
  confirm(s, a.token);
  assert.equal(addSubscriber(s, { email: 'z@x.com' }).status, 'already-confirmed');
});

test('unsubscribe is honored', () => {
  const s = emptyStore();
  const r = addSubscriber(s, { email: 'u@x.com' }); confirm(s, r.token);
  assert.deepEqual(confirmedList(s), ['u@x.com']);
  unsubscribe(s, 'u@x.com');
  assert.deepEqual(confirmedList(s), []);
});

test('contact form validation', () => {
  const s = emptyStore();
  assert.equal(recordContact(s, { email: 'a@b.co', message: 'hi' }).ok, true);
  assert.equal(recordContact(s, { email: 'a@b.co', message: '' }).ok, false);
  assert.equal(s.contacts.length, 1);
});

test('subscribeWidget renders the form + double-opt-in note', () => {
  const w = subscribeWidget({ base: 'https://soapbox.community' });
  assert.match(w, /Subscribe/);
  assert.match(w, /Double opt-in/);
  assert.match(w, /Contact us/);
  assert.match(w, /\/api\/subscribe/);
});

// ── handler (mock req/res) ──
function mockRes() { return { code: 0, body: '', headers: null, writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } }; }
async function* bodyGen(obj) { yield Buffer.from(JSON.stringify(obj)); }

test('handle /api/subscribe sends confirm + persists pending', async () => {
  let store = emptyStore(); let sent = null;
  const req = Object.assign(bodyGen({ email: 'live@x.com' }), { url: '/api/subscribe', method: 'POST' });
  const res = mockRes();
  const ok = await handle(req, res, {
    load: () => store, save: (s) => { store = s; }, baseUrl: 'https://soapbox.community',
    sendConfirm: async (d) => { sent = d; },
  });
  assert.equal(ok, true);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.equal(sent.email, 'live@x.com');
  assert.match(sent.confirmUrl, /\/api\/confirm\?token=/);
  assert.equal(store.subs['live@x.com'].status, 'pending');
});

test('handle /api/confirm graduates to confirmed', async () => {
  let store = emptyStore();
  const r = addSubscriber(store, { email: 'c@x.com' });
  const req = { url: `/api/confirm?token=${r.token}`, method: 'GET' };
  const res = mockRes();
  await handle(req, res, { load: () => store, save: (s) => { store = s; } });
  assert.equal(res.code, 200);
  assert.match(res.body, /Confirmed/);
  assert.deepEqual(confirmedList(store), ['c@x.com']);
});

test('handle returns false for unrelated paths', async () => {
  const res = mockRes();
  const ok = await handle({ url: '/something', method: 'GET' }, res, {});
  assert.equal(ok, false);
});
