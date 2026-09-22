// server.test.mjs — Soapy console. Fully offline: no network, no disk, no brain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadTranscript, send, handler, createServer, esc, __setFetch, __setReader, __setAuth,
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
    on(ev, cb) {
      if (ev === 'data' && body) cb(body);
      if (ev === 'end') cb();
      return this;
    },
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
  assert.equal(turns[0].text, 'are you there');      // the "person: " prefix is stripped for display
  assert.equal(turns[0].self, false);
  assert.equal(turns[1].who, 'Hathor');
  assert.equal(turns[1].text, 'I am here.');
  assert.equal(turns[1].self, true);
});

test('loadTranscript falls back to the prefix when meta.role is absent', async () => {
  __setReader(async () => JSON.stringify({ text: 'Hathor: an older record' }));
  const [turn] = await loadTranscript({ dir: '/brain' });
  assert.equal(turn.self, true);
  assert.equal(turn.who, 'Hathor');
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
  assert.doesNotMatch(asked, /\.\./);                 // path traversal cannot escape the brain dir

  __setReader(async () => LINES);
  assert.equal((await loadTranscript({ dir: '/brain', limit: 1 })).length, 1);
});

test('send relays to the one Hathor and returns her reply', async () => {
  let seen = null;
  __setFetch(async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ ok: true, reply: 'I remember.', drewFrom: ['knowledge/rule_1'] }) };
  });
  const r = await send('do you remember', { agencyUrl: 'http://brain', from: 'ryan' });
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'I remember.');
  assert.deepEqual(r.drewFrom, ['knowledge/rule_1']);
  assert.equal(seen.url, 'http://brain/perceive');
  assert.equal(seen.body.surface, 'soapy');
  assert.equal(seen.body.from, 'ryan');
});

test('send soft-fails on a dead or unhappy brain', async () => {
  __setFetch(async () => ({ ok: false, status: 503 }));
  assert.equal((await send('x')).ok, false);

  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const down = await send('x');
  assert.equal(down.ok, false);
  assert.match(down.error, /ECONNREFUSED/);
});

test('handler is fail-closed until auth is wired', async () => {
  __setAuth(() => false);
  const res = fakeRes();
  await handler(fakeReq('/'), res);
  assert.equal(res.code, 401);

  const health = fakeRes();                            // healthz stays open for the box probe
  await handler(fakeReq('/healthz'), health);
  assert.equal(health.code, 200);
});

test('GET / renders the resumed transcript, escaped', async () => {
  __setAuth(() => true);
  __setReader(async () => JSON.stringify({ text: 'ryan: <script>alert(1)</script>', meta: { role: 'them' } }));
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/'), res);
  assert.equal(res.code, 200);
  assert.match(res.body, /Resumed — 1 turn\(s\) of memory/);
  assert.match(res.body, /&lt;script&gt;/);
  assert.doesNotMatch(res.body, /<script>alert/);
});

test('GET / says so plainly when there is no memory yet', async () => {
  __setAuth(() => true);
  __setReader(async () => '');
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/'), res);
  assert.match(res.body, /No memory on this surface yet/);
});

test('POST /send accepts a form post and re-reads memory afterwards', async () => {
  __setAuth(() => true);
  let reads = 0;
  __setReader(async () => { reads++; return LINES; });
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, reply: 'noted' }) }));
  const res = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/send', 'POST', 'text=hello+there'), res);
  assert.equal(res.code, 200);
  assert.equal(reads, 1);                              // her store, not the response, is the source of truth
  assert.match(res.body, /Soapy/);
});

test('POST /send answers JSON when asked, and ignores an empty message', async () => {
  __setAuth(() => true);
  __setReader(async () => LINES);
  __setFetch(async () => ({ ok: true, json: async () => ({ ok: true, reply: 'json reply' }) }));

  const asJson = fakeRes();
  await createServer({ dir: '/brain' }).handler(
    fakeReq('/send?format=json', 'POST', JSON.stringify({ text: 'hi' })), asJson,
  );
  assert.equal(JSON.parse(asJson.body).reply, 'json reply');

  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  const blank = fakeRes();
  await createServer({ dir: '/brain' }).handler(fakeReq('/send', 'POST', 'text=%20'), blank);
  assert.equal(called, false);                         // whitespace never wakes the brain
  assert.equal(blank.code, 200);
});

test('handler: unknown route, and never throwing', async () => {
  __setAuth(() => true);
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
