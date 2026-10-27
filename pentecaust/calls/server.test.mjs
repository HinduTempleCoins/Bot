// pentecaust/calls/server.test.mjs — OFFLINE. The HTTP boundary: deny-by-default identity, the
// signalling relay, roulette matching, per-surface storage, and that the page escapes what it renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handler, page, esc, safeJson } from './server.mjs';
import { __reset, heartbeat, joinQueue } from './model.mjs';

function call(method, url, who, body) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  req.method = method; req.url = url;
  const res = { code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b || ''; } };
  const deps = { whoami: () => who || null, ...(body && body.__deps ? body.__deps : {}) };
  return handler(req, res, deps).then(() => ({ code: res.code, json: (() => { try { return JSON.parse(res.body); } catch { return null; } })(), raw: res.body, headers: res.headers }));
}

test('every private route is deny-by-default', async () => {
  __reset();
  for (const [m, u] of [['POST', '/heartbeat'], ['GET', '/online'], ['POST', '/signal'], ['GET', '/poll'],
    ['POST', '/room'], ['POST', '/roulette/join'], ['POST', '/block'], ['POST', '/report'], ['POST', '/upload-url']]) {
    const r = await call(m, u, null, m === 'POST' ? {} : undefined);
    assert.equal(r.code, 401, `${m} ${u} must refuse an anonymous caller`);
  }
});

test('the page and /ice are public, and /ice never invents a relay', async () => {
  const pg = await call('GET', '/', null);
  assert.equal(pg.code, 200);
  assert.match(pg.raw, /Pentecaust Live/);
  const ice = await call('GET', '/ice', null);
  assert.equal(ice.code, 200);
  assert.equal(typeof ice.json.relay, 'boolean');
  assert.ok(Array.isArray(ice.json.iceServers));
});

test('identity comes from whoami, never from the body', async () => {
  __reset();
  const r = await call('POST', '/heartbeat', 'alice', { mode: 'calls', account: 'mallory' });
  assert.equal(r.json.account, 'alice', 'a body field must not be able to claim another account');
});

test('signalling relays to the addressee only, and is delivered once', async () => {
  __reset();
  const s = await call('POST', '/signal', 'alice', { to: 'bob', payload: { type: 'offer', sdp: 'x' } });
  assert.equal(s.json.ok, true);
  const mine = await call('GET', '/poll', 'alice');
  assert.equal(mine.json.signals.length, 0, 'the sender does not receive their own signal');
  const theirs = await call('GET', '/poll', 'bob');
  assert.equal(theirs.json.signals.length, 1);
  assert.equal(theirs.json.signals[0].from, 'alice');
  const again = await call('GET', '/poll', 'bob');
  assert.equal(again.json.signals.length, 0, 'drained once');
});

test('roulette matches two waiting members and tells exactly one to make the offer', async () => {
  __reset();
  heartbeat('alice'); joinQueue('alice');
  const r = await call('POST', '/roulette/join', 'bob', {});
  assert.equal(r.json.matched, true);
  assert.equal(r.json.peer, 'alice');
  assert.equal(typeof r.json.initiator, 'boolean');
  const alicesMail = await call('GET', '/poll', 'alice');
  const matched = alicesMail.json.signals.find((s) => s.payload.type === 'matched');
  assert.ok(matched, 'the other side is told too');
  assert.notEqual(matched.payload.initiator, r.json.initiator, 'exactly one side initiates — otherwise both offer and the call collides');
});

test('a lone member waits rather than being matched with themselves', async () => {
  __reset();
  const r = await call('POST', '/roulette/join', 'alice', {});
  assert.equal(r.json.matched, false);
  assert.equal(r.json.waiting, 1);
});

test('report blocks, and a blocked peer can no longer signal', async () => {
  __reset();
  await call('POST', '/report', 'alice', { account: 'mallory', reason: 'abuse' });
  const s = await call('POST', '/signal', 'mallory', { to: 'alice', payload: { type: 'offer' } });
  assert.equal(s.json.ok, false);
  const bl = await call('GET', '/blocklist', 'alice');
  assert.deepEqual(bl.json.blocklist, ['mallory']);
});

test('rooms refuse the fifth peer with a reason that names the cause', async () => {
  __reset();
  const made = await call('POST', '/room', 'alice', { name: 'standup' });
  const id = made.json.id;
  for (const who of ['bob', 'carol', 'dave']) {
    const j = await call('POST', `/room/${id}/join`, who, {});
    assert.equal(j.json.ok, true, `${who} should fit inside the mesh limit`);
  }
  const over = await call('POST', `/room/${id}/join`, 'erin', {});
  assert.equal(over.code, 403);
  assert.match(over.json.reason, /SFU/);
});

test('STORAGE IS PER-SURFACE: the drive is injected, and a missing one fails loudly', async () => {
  __reset();
  const none = await call('POST', '/upload-url', 'alice', { filename: 'r.webm' });
  assert.equal(none.code, 503);
  assert.match(none.json.reason, /no storage is configured/);

  // two surfaces, two different drives — they must never resolve to the same place
  const mk = (bucket) => ({
    storageConfig: () => ({ configured: true, bucket }),
    objectKey: (owner, name) => `${bucket}/${owner}/${name}`,
    presignPut: (cfg, key) => `https://${bucket}.example/${key}?sig=x`,
  });
  const req1 = Readable.from([JSON.stringify({ filename: 'r.webm', bytes: 10 })]);
  req1.method = 'POST'; req1.url = '/upload-url';
  const res1 = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  await handler(req1, res1, { whoami: () => 'alice', drive: mk('bifrost'), surface: 'bifrost' });
  const a = JSON.parse(res1.body);

  const req2 = Readable.from([JSON.stringify({ filename: 'r.webm', bytes: 10 })]);
  req2.method = 'POST'; req2.url = '/upload-url';
  const res2 = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  await handler(req2, res2, { whoami: () => 'alice', drive: mk('other-surface'), surface: 'other-surface' });
  const b = JSON.parse(res2.body);

  assert.equal(a.surface, 'bifrost');
  assert.equal(b.surface, 'other-surface');
  assert.notEqual(a.key, b.key, 'the two surfaces must not share an object key');
  assert.ok(a.putUrl.includes('bifrost') && b.putUrl.includes('other-surface'), 'each surface uploads to its own place');
});

test('upload filenames cannot escape their prefix', async () => {
  __reset();
  const drive = {
    storageConfig: () => ({ configured: true }),
    objectKey: (owner, name) => `${owner}/${name}`,
    presignPut: (cfg, key) => `https://x.example/${key}`,
  };
  const req = Readable.from([JSON.stringify({ filename: '../../etc/passwd' })]);
  req.method = 'POST'; req.url = '/upload-url';
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  await handler(req, res, { whoami: () => 'alice', drive, surface: 's' });
  const j = JSON.parse(res.body);
  assert.ok(!j.key.includes('..'), 'traversal is stripped');
  assert.ok(j.key.startsWith('alice/'));
});

test('the page escapes the account name it renders', () => {
  const html = page('<img src=x onerror=alert(1)>', { iceServers: [], relay: false, note: 'n' }, { surface: 's', meshLimit: 4 });
  assert.ok(!html.includes('<img src=x'), 'the raw tag must not reach the document');
  assert.ok(html.includes('&lt;img'), 'it is escaped instead');
  assert.equal(esc('<&">'), '&lt;&amp;&quot;&gt;');
});

test('a signed-out visitor is told why, and gets no poll loop', () => {
  const html = page(null, { iceServers: [], relay: true, note: '' }, { surface: 's', meshLimit: 4 });
  assert.match(html, /need to be signed in/);
  assert.ok(!html.includes('setInterval(pump'), 'no signalling loop for someone who cannot call anyone');
});

test('the page says plainly when there is no TURN relay', () => {
  const html = page('alice', { iceServers: [], relay: false, note: 'STUN only — x' }, { surface: 's', meshLimit: 4 });
  assert.match(html, /STUN only/);
  assert.match(html, /some will not connect/);
});

test('an account name cannot break out of the script block', () => {
  // social logins supply these names; they are not ours to trust
  const evil = '</script><img src=x onerror=alert(1)>';
  const html = page(evil, { iceServers: [], relay: true, note: '' }, { surface: 's', meshLimit: 4 });
  assert.ok(!html.includes('</script><img'), 'the script element must not be closed early');
  assert.ok(html.includes('\\u003c/script'), 'the angle bracket is escaped inside the JS literal');
  assert.equal(safeJson('<'), '"\\u003c"');
  assert.equal(safeJson('\u2028'), '"\\u2028"', 'a line separator cannot terminate the statement');
});

test('MOUNTED under a prefix, every route still resolves', async () => {
  __reset();
  const mk = (method, url, who, body) => {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    req.method = method; req.url = url;
    const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } };
    return handler(req, res, { whoami: () => who || null, mount: '/live' }).then(() => ({ code: res.code, raw: res.body }));
  };
  const root = await mk('GET', '/live', null);
  assert.equal(root.code, 200, 'the app itself answers at the mount root');
  assert.match(root.raw, /Pentecaust Live/);
  const ice = await mk('GET', '/live/ice', null);
  assert.equal(ice.code, 200);
  const anon = await mk('GET', '/live/poll', null);
  assert.equal(anon.code, 401, 'auth still applies under the mount');
  const ok = await mk('GET', '/live/poll', 'alice');
  assert.equal(ok.code, 200);
  assert.match(root.raw, /const MOUNT = "\/live"/, 'the client calls back through the prefix');
});
