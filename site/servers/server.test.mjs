// server.test.mjs — servers.soapbox.community hub. OFFLINE. The live-status fetch is injected via
// minecraft.mjs __setFetch (no network). Never throws; unknown ids 404; the default page must NOT
// ship a real host (example.com only).
import { test } from 'node:test';
import assert from 'node:assert';
import { __setFetch } from '../../integrations/minecraft.mjs';
import { handler, loadServers } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const req = (path) => ({ url: path, method: 'GET' });

// fake mcsrvstat.us payloads — online server / offline server
function fakeFetch(payload) {
  return async () => ({ ok: true, json: async () => payload });
}
const ONLINE = { online: true, players: { online: 3, max: 20 }, version: '1.21.1', motd: { clean: ['Welcome to SoapBox'] } };

test('GET / serves the hub: branding, Alpha badge, cards, join info', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /SoapBox/);
  assert.match(o.body, /Alpha/);                 // standing alpha-badge convention
  assert.match(o.body, /Server address/);        // join info present
  assert.match(o.body, /Copy/);                  // copy-address button
  assert.match(o.body, /live feed/i);            // live-feed framing
  assert.match(o.body, /Multiplayer/);           // how-to-join instructions
});

test('the default page never ships a real host (example.com only)', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  // every code/address block uses an example placeholder, not a real server
  assert.match(o.body, /example\.com/);
  assert.doesNotMatch(o.body, /\.melek\.salon|soapbox\.community:|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
});

test('/api/servers returns the configured list', async () => {
  const { res, o } = cap(); await handler(req('/api/servers'), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.servers) && j.servers.length >= 1);
  assert.ok(j.servers.every((s) => s.id && s.host));
});

test('/api/status?id= returns LIVE status for a configured server (online)', async () => {
  __setFetch(fakeFetch(ONLINE));
  const id = loadServers()[0].id;
  const { res, o } = cap(); await handler(req('/api/status?id=' + id), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.equal(j.id, id);
  assert.equal(j.status.online, true);
  assert.equal(j.status.players.online, 3);
  assert.match(j.status.motd, /Welcome to SoapBox/);
  __setFetch(null);
});

test('/api/status offline server soft-fails to an offline shape (never throws)', async () => {
  __setFetch(async () => ({ ok: false }));     // status proxy down / server offline
  const id = loadServers()[0].id;
  const { res, o } = cap(); await handler(req('/api/status?id=' + id), res);
  assert.equal(o.code, 200);
  assert.equal(JSON.parse(o.body).status.online, false);
  __setFetch(null);
});

test('/api/status rejects unknown / missing id (no arbitrary-host proxy)', async () => {
  let { res, o } = cap(); await handler(req('/api/status?id=does-not-exist'), res);
  assert.equal(o.code, 404);
  ({ res, o } = cap()); await handler(req('/api/status'), res);
  assert.equal(o.code, 404);
  // there is no host= passthrough — only configured ids are reachable
  ({ res, o } = cap()); await handler(req('/api/status?host=evil.example.net'), res);
  assert.equal(o.code, 404);
});

test('MELEK_SERVERS_JSON env overrides the list; bad json falls back safely', () => {
  const prev = process.env.MELEK_SERVERS_JSON;
  process.env.MELEK_SERVERS_JSON = JSON.stringify([{ id: 'Test_1', name: 'T', host: 'h.example.com', edition: 'bedrock' }]);
  let list = loadServers();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'test_1');           // id sanitized to lowercase
  assert.equal(list[0].edition, 'bedrock');
  process.env.MELEK_SERVERS_JSON = '{not json';
  list = loadServers();
  assert.ok(list.length >= 1);                  // bad json → safe example list, not a crash
  if (prev === undefined) delete process.env.MELEK_SERVERS_JSON; else process.env.MELEK_SERVERS_JSON = prev;
});

test('/health reports server count; unknown route 404', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.ok(JSON.parse(o.body).servers >= 1);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
