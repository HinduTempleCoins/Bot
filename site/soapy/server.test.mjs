// server.test.mjs — Soapy console. Fully offline: no network, no disk, no brain.
// Two tabs: Soapy AI (local brain, OPEN) and Claude (login-gated, opt-in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTranscript, send, handler, createServer, esc,
  __setFetch, __setReader, __setAuth,
  mintSession, verifySession, passwordOk, claudeConfigured,
} from './server.mjs';

function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; },
  };
}
function fakeReq(url, method = 'GET', body = '', headers = {}) {
  return {
    url, method, headers: { host: 'soapy.test', ...headers },
    on(ev, cb) { if (ev === 'data' && body) cb(body); if (ev === 'end') cb(); return this; },
  };
}

const LINES = [
  JSON.stringify({ text: 'ryan: are you there', person: 'ryan', meta: { role: 'them' }, at: 1 }),
  JSON.stringify({ text: 'Hathor: I am here.', person: 'ryan', meta: { role: 'self' }, at: 2 }),
].join('\n');

test('loadTranscript reads her memory back as a conversation', async () => {
  __setReader(async () => LINES);
  const turns = await loadTranscript({ dir: '/brain', surface: 'soapy' });
  assert.equal(turns.length, 2);
  assert.equal(turns[0].who, 'ryan');
  assert.equal(turns[0].text, 'are you there');
  assert.equal(turns[0].self, false);
  assert.equal(turns[1].who, 'Hathor');
  assert.equal(turns[1].self, true);
});

test('loadTranscript survives a torn line and a missing file', async () => {
  __setReader(async () => `${LINES}\n{"text":"half`);
  assert.equal((await loadTranscript({ dir: '/brain' })).length, 2);
  __setReader(async () => { throw new Error('ENOENT'); });
  assert.deepEqual(await loadTranscript({ dir: '/nope' }), []);
});

test('loadTranscript sanitizes the surface name and honours limit', async () => {
  let asked = '';
  __setReader(async (p) => { asked = p; return LINES; });
  await loadTranscript({ dir: '/brain', surface: '../../etc/passwd' });
  assert.doesNotMatch(asked, /\.\./);
  __setReader(async () => LINES);
  assert.equal((await loadTranscript({ dir: '/brain', limit: 1 })).length, 1);
});

test('send relays to the local Hathor brain and returns her reply', async () => {
  let seen = null;
  __setFetch(async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ ok: true, reply: 'I remember.', drewFrom: ['knowledge/rule_1'] }) }; });
  const r = await send('do you remember', { agencyUrl: 'http://brain', from: 'ryan' });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'I remember.');
  assert.equal(seen.url, 'http://brain/perceive');
  assert.equal(seen.body.from, 'ryan');
});

test('send soft-fails on a dead or unhappy brain', async () => {
  __setFetch(async () => ({ ok: false, status: 503 }));
  assert.equal((await send('x')).ok, false);
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.match((await send('x')).error, /ECONNREFUSED/);
});

test('healthz is public; Soapy AI tab (/) is OPEN — no login', async () => {
  __setAuth(null);
  __setReader(async () => '');
  const health = fakeRes();
  await handler(fakeReq('/healthz'), health);
  assert.equal(health.code, 200);
  assert.equal(JSON.parse(health.body).ok, true);

  const home = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/'), home);
  assert.equal(home.code, 200);                          // open, not 401
  assert.match(home.body, /Soapy AI/);
  assert.match(home.body, /No memory yet/);
});

test('GET / renders the resumed transcript, escaped', async () => {
  __setAuth(null);
  __setReader(async () => JSON.stringify({ text: 'ryan: <script>alert(1)</script>', meta: { role: 'them' } }));
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/'), res);
  assert.equal(res.code, 200);
  assert.match(res.body, /Resumed — 1 turn\(s\) of memory/);
  assert.match(res.body, /&lt;script&gt;/);
  assert.doesNotMatch(res.body, /<script>alert/);
});

test('Claude tab requires login: unauthed → login form', async () => {
  __setAuth(() => false);
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/?tab=claude'), res);
  assert.equal(res.code, 200);
  assert.match(res.body, /requires login/i);
  assert.match(res.body, /type="password"/);
});

test('Claude tab authed → claude view (off unless a key is set)', async () => {
  __setAuth(() => true);
  __setReader(async () => '');
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/?tab=claude'), res);
  assert.equal(res.code, 200);
  if (claudeConfigured()) assert.match(res.body, /Anthropic/);
  else assert.match(res.body, /Claude chat is OFF/);
});

test('POST /send (Soapy AI) is open and re-reads memory afterwards', async () => {
  __setAuth(null);
  let reads = 0;
  __setReader(async () => { reads++; return LINES; });
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, reply: 'noted' }) }));
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/send', 'POST', 'text=hello+there'), res);
  assert.equal(res.code, 200);
  assert.equal(reads, 1);
  assert.match(res.body, /Soapy/);
});

test('POST /send answers JSON when asked, and ignores an empty message', async () => {
  __setAuth(null);
  __setReader(async () => LINES);
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, reply: 'json reply' }) }));
  const asJson = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/send?format=json', 'POST', JSON.stringify({ text: 'hi' })), asJson);
  assert.equal(JSON.parse(asJson.body).reply, 'json reply');

  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  const blank = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/send', 'POST', 'text=%20'), blank);
  assert.equal(called, false);
  assert.equal(blank.code, 200);
});

test('POST /claude/send is login-gated', async () => {
  __setAuth(() => false);
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/claude/send', 'POST', 'text=hi'), res);
  assert.equal(res.code, 401);
});

test('login: correct password mints a session cookie; wrong is rejected', async () => {
  const prev = process.env.SOAPY_PASSWORD;
  process.env.SOAPY_PASSWORD = 'correct-horse';
  __setAuth(null);
  try {
    const ok = fakeRes();
    await createServer({ dir: '/brain' }).handler(fakeReq('/login', 'POST', 'password=correct-horse&next=claude'), ok);
    assert.equal(ok.code, 302);
    const setCookie = String(ok.headers['set-cookie'] || '');
    assert.match(setCookie, /soapy_session=/);

    const bad = fakeRes();
    await createServer({ dir: '/brain' }).handler(fakeReq('/login', 'POST', 'password=nope'), bad);
    assert.equal(bad.code, 401);
    assert.match(bad.body, /Wrong password/);
  } finally { if (prev === undefined) delete process.env.SOAPY_PASSWORD; else process.env.SOAPY_PASSWORD = prev; }
});

test('session cookie round-trips; a forged/expired one is rejected', () => {
  const prev = process.env.SOAPY_PASSWORD;
  process.env.SOAPY_PASSWORD = 'sekret';
  try {
    const tok = mintSession(1000, 60_000);            // minted at t=1000, 60s ttl
    assert.equal(verifySession(tok, 1000), true);       // valid now
    assert.equal(verifySession(tok, 1000 + 61_000), false); // expired
    assert.equal(verifySession('forged.sig', 1000), false);
    assert.equal(verifySession(`${tok}x`, 1000), false); // tampered
  } finally { if (prev === undefined) delete process.env.SOAPY_PASSWORD; else process.env.SOAPY_PASSWORD = prev; }
});

test('passwordOk is constant-time-ish and requires a configured password', () => {
  const prev = process.env.SOAPY_PASSWORD;
  process.env.SOAPY_PASSWORD = 'abc123';
  try {
    assert.equal(passwordOk('abc123'), true);
    assert.equal(passwordOk('abc124'), false);
    assert.equal(passwordOk(''), false);
  } finally { if (prev === undefined) delete process.env.SOAPY_PASSWORD; else process.env.SOAPY_PASSWORD = prev; }
  delete process.env.SOAPY_PASSWORD;
  assert.equal(passwordOk('anything'), false);          // no password configured → always false
});

test('handler: unknown route 404s, malformed request soft-fails, never throws', async () => {
  __setAuth(null);
  const missing = fakeRes();
  await handler(fakeReq('/nope'), missing);
  assert.equal(missing.code, 404);

  const bad = fakeRes();
  await handler({ url: null, method: 'GET', headers: {} }, bad);
  assert.equal(JSON.parse(bad.body).ok, false);
});

test('esc escapes every vector', () => {
  assert.equal(esc(`<&">'`), '&lt;&amp;&quot;&gt;&#39;');
  assert.equal(esc(null), '');
});
