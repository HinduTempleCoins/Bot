// channels.test.mjs — OFFLINE tests for Pact's channel routes (mock req/res; temp store file).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

process.env.PACT_CHANNELS_DATA = join(mkdtempSync(join(tmpdir(), 'pact-ch-')), 'channels.json');
const { handler } = await import('./channels.mjs');

function call(method, url, who, body) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method; req.url = url;
  return new Promise((resolve) => {
    const res = { code: 0, headers: {}, writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { resolve({ code: this.code, body: String(b || '') }); } };
    handler(req, res, { whoami: () => who }).then((handled) => { if (!handled) resolve({ code: 'unhandled' }); });
  });
}

test('start a channel, talk in it, read it back with roster and topic', async () => {
  const c = await call('POST', '/channels', 'alice', { name: '#botanica', topic: 'Plants' });
  assert.equal(c.code, 200);
  assert.equal((await call('POST', '/channels/botanica/messages', 'alice', { text: 'hello' })).code, 200);
  const r = JSON.parse((await call('GET', '/channels/botanica/messages?since=0', 'bob')).body);
  assert.equal(r.topic, 'Plants');
  assert.deepEqual(r.messages.map((m) => m.text), ['hello']);
  assert.deepEqual(r.roster.map((u) => u.mark + u.who), ['@alice', 'bob']);
  const list = JSON.parse((await call('GET', '/channels', null)).body);
  assert.equal(list.channels[0].name, 'botanica');
});

test('anonymous visitors can read an open room but not talk or start one', async () => {
  assert.equal((await call('POST', '/channels', null, { name: 'x-room' })).code, 401);
  assert.equal((await call('POST', '/channels/botanica/messages', null, { text: 'hi' })).code, 401);
  assert.equal((await call('GET', '/channels/botanica/messages', null)).code, 200);
});

test('the room page renders and escapes the topic', async () => {
  await call('POST', '/channels', 'alice', { name: 'xss', topic: '<script>x</script>' });
  const p = await call('GET', '/c/xss', null);
  assert.equal(p.code, 200);
  assert.ok(!p.body.includes('<script>x</script>'));
  assert.match(p.body, /#xss/);
});

test('?op=me lists only the channels the visitor operates (for the invite panel)', async () => {
  await call('POST', '/channels', 'carol', { name: 'carols-room' });
  const mine = JSON.parse((await call('GET', '/channels?op=me', 'carol')).body).channels.map((c) => c.name);
  assert.deepEqual(mine, ['carols-room']);
  assert.deepEqual(JSON.parse((await call('GET', '/channels?op=me', null)).body).channels, []);
});
