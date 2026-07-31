// soapy-hathor-chat.test.mjs — offline. Fake fetch records the /perceive POST and returns a canned
// reply; fake auth injected. No network. Verifies this surface is a THIN LIMB: it relays to
// /perceive with the real field names and renders an esc()'d panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ask, handler, renderChat, esc, __setFetch, __setAuth,
} from './soapy-hathor-chat.mjs';

// ── a fake fetch that records the call and returns a canned /perceive response ─────────────────
function fakeFetch(canned = { ok: true, reply: 'Peace be with you.' }, { throws = false, httpOk = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (throws) throw new Error('network down');
    return {
      ok: httpOk,
      status,
      json: async () => canned,
    };
  };
  fn.calls = calls;
  return fn;
}

// ── a minimal fake res that records what the handler sent ──────────────────────────────────────
function fakeRes() {
  return {
    code: null, headers: null, body: null,
    writeHead(code, headers) { this.code = code; this.headers = headers; return this; },
    end(body) { this.body = body; return this; },
  };
}

test('ask() POSTs to /perceive with real field names and returns the reply', async () => {
  const ff = fakeFetch({ ok: true, reply: 'The chain remembers you.' });
  __setFetch(ff);

  const r = await ask('hello Hathor', { user: 'alice', surface: 'soapy', agencyUrl: 'http://brain.test:8175' });

  assert.deepEqual(r, { ok: true, reply: 'The chain remembers you.' });
  assert.equal(ff.calls.length, 1);
  assert.equal(ff.calls[0].url, 'http://brain.test:8175/perceive');
  assert.equal(ff.calls[0].init.method, 'POST');
  // the real /perceive contract: { surface, from, text }
  assert.deepEqual(ff.calls[0].body, { surface: 'soapy', from: 'alice', text: 'hello Hathor' });
});

test('ask() soft-fails (no throw) when fetch throws', async () => {
  __setFetch(fakeFetch({}, { throws: true }));
  const r = await ask('hi', { user: 'bob' });
  assert.equal(r.ok, false);
  assert.ok(typeof r.reason === 'string' && r.reason.length);
});

test('ask() soft-fails when /perceive returns non-ok', async () => {
  __setFetch(fakeFetch({}, { httpOk: false, status: 503 }));
  const r = await ask('hi', { user: 'bob' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /503/);
});

test('handler GET /chat is 401 when unauthed', async () => {
  __setAuth(() => false);
  const res = fakeRes();
  await handler({ url: '/chat', method: 'GET' }, res);
  assert.equal(res.code, 401);
});

test('handler GET /chat is 200 HTML when authed, and escapes injected values', async () => {
  __setAuth(() => true);
  const res = fakeRes();
  await handler({ url: '/chat', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.body, /<ul id="log">/);

  // esc() must neutralize a <script> in any rendered value.
  const escaped = esc('<script>alert(1)</script>');
  assert.equal(escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');
  const page = renderChat(); // title is a rendered esc() value
  assert.ok(!page.includes('<script>alert'), 'no raw injected script in page');
});

test('handler POST /chat/send relays the reply (req.body already an object)', async () => {
  __setAuth(() => true);
  __setFetch(fakeFetch({ ok: true, reply: 'Welcome, seeker.' }));
  const res = fakeRes();
  await handler({ url: '/chat/send', method: 'POST', body: { text: 'hi', user: 'carol' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, reply: 'Welcome, seeker.' });
});

test('handler POST /chat/send soft-fails to ok:false when the brain is unreachable', async () => {
  __setAuth(() => true);
  __setFetch(fakeFetch({}, { throws: true }));
  const res = fakeRes();
  await handler({ url: '/chat/send', method: 'POST', body: { text: 'hi', user: 'carol' } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: false, reply: '' });
});
