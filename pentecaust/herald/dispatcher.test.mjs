// pentecaust/herald/dispatcher.test.mjs — offline. No network: fetch, the email seam, AND the DNS resolver
// are injected. Every outbound channel unconfigured → soft no-op (never sends). Asserts fan-out, safeUrl +
// SSRF blocklist (loopback/private/link-local/metadata, literal + resolved), redirect-to-internal blocked,
// Discord host allow-list, /api/dispatch auth (fail-closed 401), the reward/post Signer boundary, esc/XSS,
// unknown 404, never-throws-on-junk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDispatcher, fromTrigger, safeUrl, isPrivateIp, esc, CHANNELS,
} from './dispatcher.mjs';

// A recording fetch stub: captures calls, returns a chosen status. No network.
function recFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url, init }); return { status, json: async () => ({}) }; };
  fn.calls = calls;
  return fn;
}
// A resolver stub → always a public IP (keeps hostname paths offline). Override per-test for SSRF cases.
const publicResolver = async () => '93.184.216.34';

test('safeUrl allows http(s), blocks hostile schemes', () => {
  assert.equal(safeUrl('https://example.com/hook'), 'https://example.com/hook');
  assert.equal(safeUrl('http://example.com'), 'http://example.com');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,<script>'), '');
  assert.equal(safeUrl('file:///etc/passwd'), '');
  assert.equal(safeUrl('mailto:a@b.com'), '');
  assert.equal(safeUrl('/relative/path'), '');
  assert.equal(safeUrl(''), '');
  assert.equal(safeUrl(null), '');
});

test('isPrivateIp blocks loopback / private / link-local / metadata / v6', () => {
  for (const ip of ['127.0.0.1', '127.5.5.5', '10.0.0.5', '10.255.1.1', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '169.254.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fd12::9',
    'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private/blocked`);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
  assert.equal(isPrivateIp(''), true);   // unknown → fail closed
  assert.equal(isPrivateIp('junk'), true);
});

test('inapp channel always delivers (no config, no network)', async () => {
  const d = createDispatcher();
  const r = await d.dispatch({ channel: 'inapp', to: '@hathor', subject: 'Hi', text: 'A trigger fired' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, true);
  assert.equal(r.channel, 'inapp');
  const inbox = d.inbox('@hathor');
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].text, 'A trigger fired');
  assert.equal(inbox[0].read, false);
});

test('inbox filters by target', async () => {
  const d = createDispatcher();
  await d.dispatch({ channel: 'inapp', to: '@hathor', text: 'one' });
  await d.dispatch({ channel: 'inapp', to: '@ops', text: 'two' });
  assert.equal(d.inbox('@hathor').length, 1);
  assert.equal(d.inbox('@ops').length, 1);
  assert.equal(d.inbox().length, 2);
});

test('telegram unconfigured → soft no-op, never sends', async () => {
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch });
  const r = await d.dispatch({ channel: 'telegram', to: '12345', text: 'hi' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'telegram-unconfigured');
  assert.equal(fetch.calls.length, 0); // NEVER hit the network unconfigured
});

test('telegram configured (env) fans out via injected fetch', async (t) => {
  const prevTok = process.env.HERALD_TELEGRAM_BOT_TOKEN;
  process.env.HERALD_TELEGRAM_BOT_TOKEN = 'test-token';
  t.after(() => { if (prevTok == null) delete process.env.HERALD_TELEGRAM_BOT_TOKEN; else process.env.HERALD_TELEGRAM_BOT_TOKEN = prevTok; });
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch });
  const r = await d.dispatch({ channel: 'telegram', to: '999', text: 'ping' });
  assert.equal(r.sent, true);
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].url, /api\.telegram\.org\/bottest-token\/sendMessage/);
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.equal(body.chat_id, '999');
  assert.equal(body.text, 'ping');
});

test('discord unconfigured → soft no-op', async () => {
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const r = await d.dispatch({ channel: 'discord', text: 'hi' });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'discord-unconfigured');
  assert.equal(fetch.calls.length, 0);
});

test('discord with a per-message discord.com url fans out; hostile scheme refused', async () => {
  const fetch = recFetch(204);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const ok = await d.dispatch({ channel: 'discord', url: 'https://discord.com/api/webhooks/x/y', text: 'hello' });
  assert.equal(ok.sent, true);
  assert.equal(fetch.calls.length, 1);
  assert.equal(JSON.parse(fetch.calls[0].init.body).content, 'hello');

  const bad = await d.dispatch({ channel: 'discord', url: 'javascript:alert(1)', text: 'x' });
  assert.equal(bad.sent, false);
  assert.equal(bad.skipped, 'discord-unconfigured'); // safeUrl stripped it → treated as unconfigured
  assert.equal(fetch.calls.length, 1); // no second call — open-dispatch refused
});

test('discord host allow-list: a non-discord host is refused (never sends)', async () => {
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const r = await d.dispatch({ channel: 'discord', url: 'https://evil.example.com/api/webhooks/x/y', text: 'x' });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'discord-host-refused');
  assert.equal(fetch.calls.length, 0);
});

test('generic webhook: valid public url posts, hostile scheme refused (open-redirect guard)', async () => {
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const ok = await d.dispatch({ channel: 'webhook', url: 'https://example.com/hook', subject: 'S', text: 'T' });
  assert.equal(ok.sent, true);
  assert.equal(fetch.calls.length, 1);

  const bad = await d.dispatch({ channel: 'webhook', url: 'data:text/html,<script>alert(1)</script>' });
  assert.equal(bad.sent, false);
  assert.equal(bad.skipped, 'webhook-no-url');
  assert.equal(fetch.calls.length, 1); // refused
});

test('SSRF: literal private/loopback/metadata IPs are rejected and NEVER hit fetch', async () => {
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  for (const url of [
    'http://127.0.0.1/hook', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/x',
    'http://192.168.0.1/x', 'http://[::1]/x', 'http://0.0.0.0/x', 'http://172.16.5.5/x',
  ]) {
    const r = await d.dispatch({ channel: 'webhook', url, text: 'probe' });
    assert.equal(r.sent, false, `${url} must not send`);
    assert.equal(r.skipped, 'ssrf-blocked-ip', `${url} → ssrf-blocked-ip`);
  }
  assert.equal(fetch.calls.length, 0); // the guard runs BEFORE any network call
});

test('SSRF: a hostname that RESOLVES to a private IP is rejected (via injected resolver)', async () => {
  const fetch = recFetch(200);
  const resolve = async (host) => (host === 'internal.corp' ? '10.0.0.9' : '93.184.216.34');
  const d = createDispatcher({ fetch, resolve });
  const bad = await d.dispatch({ channel: 'webhook', url: 'https://internal.corp/hook', text: 'x' });
  assert.equal(bad.sent, false);
  assert.equal(bad.skipped, 'ssrf-blocked-resolved');
  assert.equal(fetch.calls.length, 0);

  const good = await d.dispatch({ channel: 'webhook', url: 'https://public.example/hook', text: 'x' });
  assert.equal(good.sent, true);
  assert.equal(fetch.calls.length, 1);
});

test('SSRF: discord host that resolves to a private IP is still rejected', async () => {
  const fetch = recFetch(204);
  const resolve = async () => '127.0.0.1'; // even a discord.com hostname pinned to loopback is blocked
  const d = createDispatcher({ fetch, resolve });
  const r = await d.dispatch({ channel: 'discord', url: 'https://discord.com/api/webhooks/x/y', text: 'x' });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'ssrf-blocked-resolved');
  assert.equal(fetch.calls.length, 0);
});

test('redirect safety: a 30x response is refused, not followed', async () => {
  const fetch = recFetch(302); // simulate a redirect toward an internal hop
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const r = await d.dispatch({ channel: 'webhook', url: 'https://example.com/hook', text: 'x' });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'redirect-refused');
  assert.equal(fetch.calls.length, 1);
  // redirect:'manual' was requested so fetch could not auto-follow
  assert.equal(fetch.calls[0].init.redirect, 'manual');
});

test('webhook 4xx/5xx → ok:false, not a throw', async () => {
  const fetch = recFetch(500);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const r = await d.dispatch({ channel: 'webhook', url: 'https://example.com/hook', text: 'T' });
  assert.equal(r.ok, false);
  assert.equal(r.sent, false);
  assert.match(r.error, /webhook 500/);
});

test('email uses injected send seam; unconfigured default → soft no-op', async () => {
  const d0 = createDispatcher();
  const r0 = await d0.dispatch({ channel: 'email', to: 'ops@example.com', subject: 'S', text: 'T' });
  assert.equal(r0.ok, true);
  assert.equal(r0.sent, false);
  assert.equal(r0.skipped, 'esp-unconfigured');

  let seen = null;
  const d = createDispatcher({ sendEmail: async (m) => { seen = m; return { ok: true, sent: true, id: 'x1' }; } });
  const r = await d.dispatch({ channel: 'email', to: 'ops@example.com', subject: 'Hi', text: 'Body' });
  assert.equal(r.sent, true);
  assert.equal(seen.to, 'ops@example.com');
  assert.equal(seen.subject, 'Hi');
});

test('email with no valid recipient → soft skip (no send seam call)', async () => {
  let called = false;
  const d = createDispatcher({ sendEmail: async () => { called = true; return { ok: true, sent: true }; } });
  const r = await d.dispatch({ channel: 'email', to: 'not-an-email', text: 'x' });
  assert.equal(r.sent, false);
  assert.equal(r.skipped, 'no-recipient');
  assert.equal(called, false);
});

test('fromTrigger maps ifttt THEN-types correctly', () => {
  assert.equal(fromTrigger({ action: 'notify', target: '@hathor', name: 'r1' }).channel, 'inapp');
  assert.equal(fromTrigger({ action: 'webhook', target: 'https://x.example/h' }).channel, 'webhook');
  assert.equal(fromTrigger({ action: 'notify', target: 'a@b.com', channel: 'email' }).channel, 'email');
  const rew = fromTrigger({ action: 'reward', target: '10 MELEK' });
  assert.equal(rew.channel, 'inapp');
  assert.equal(rew.requiresSigner, true);
  const post = fromTrigger({ action: 'post', target: '@hathor/hello' });
  assert.equal(post.requiresSigner, true);
});

test('reward/post triggers are NEVER sent to network — Signer boundary', async () => {
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const results = await d.dispatchTriggers([
    { action: 'reward', target: '10 MELEK', name: 'pay' },
    { action: 'post', target: '@hathor/x', name: 'broadcast' },
  ]);
  assert.equal(results.length, 2);
  assert.equal(results[0].channel, 'inapp');
  assert.equal(results[0].requiresSigner, true);
  assert.equal(results[1].requiresSigner, true);
  assert.equal(fetch.calls.length, 0);
});

test('dispatchTriggers fans a fired recipe list out across channels', async (t) => {
  process.env.HERALD_TELEGRAM_BOT_TOKEN = 'tok';
  process.env.HERALD_TELEGRAM_CHAT_ID = 'chat-1';
  t.after(() => { delete process.env.HERALD_TELEGRAM_BOT_TOKEN; delete process.env.HERALD_TELEGRAM_CHAT_ID; });
  const fetch = recFetch(200);
  const d = createDispatcher({ fetch, resolve: publicResolver });
  const planned = [
    { action: 'notify', target: '@hathor', name: 'ping' },              // inapp
    { action: 'webhook', target: 'https://example.com/hook' },          // webhook
    { action: 'notify', target: '@ops', channel: 'telegram' },          // telegram
  ];
  const results = await d.dispatchTriggers(planned);
  assert.equal(results.length, 3);
  assert.equal(results[0].channel, 'inapp');
  assert.equal(results[0].sent, true);
  assert.equal(results[1].channel, 'webhook');
  assert.equal(results[1].sent, true);
  assert.equal(results[2].channel, 'telegram');
  assert.equal(results[2].sent, true);
  assert.equal(fetch.calls.length, 2); // one webhook + one telegram
  assert.equal(d.inbox('@hathor').length, 1);
});

test('unknown channel → soft error, no throw', async () => {
  const d = createDispatcher();
  const r = await d.dispatch({ channel: 'carrier-pigeon', text: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown-channel');
});

test('junk inputs never throw', async () => {
  const d = createDispatcher({ storage: 'not-an-object' });
  assert.deepEqual(await d.dispatchAll('nope'), []);
  assert.deepEqual(await d.dispatchTriggers(null), []);
  await d.dispatch(null);
  await d.dispatch(undefined);
  await d.dispatch(123);
  assert.equal(fromTrigger(null).channel, 'inapp');
  assert.equal(fromTrigger(undefined).channel, 'inapp');
  assert.equal(d.inbox().length >= 0, true);
});

test('esc escapes HTML-significant chars (XSS)', () => {
  assert.equal(esc('<script>alert("x")&\'</script>'), '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;');
});

// ── HTTP surface: auth is REQUIRED and FAILS CLOSED ──────────────────────────────────────────────────────
function mkReq(method, url, { body, headers } = {}) {
  const req = { method, url, body, headers: headers || {} };
  let statusCode = 0; let payload = '';
  const res = { writeHead(sc) { statusCode = sc; }, end(b) { payload = b || ''; } };
  return { req, res, get: () => ({ statusCode, payload }) };
}

test('HTTP: /api/dispatch UNAUTHENTICATED → 401 (fail-closed), never dispatches', async () => {
  const d = createDispatcher({ dispatchSecret: 'topsecret' });
  const h = mkReq('POST', '/api/dispatch', { body: { channel: 'inapp', to: '@x', text: 'sneaky' } });
  await d.handler(h.req, h.res);
  assert.equal(h.get().statusCode, 401);
  assert.equal(d.inbox('@x').length, 0); // nothing was dispatched
});

test('HTTP: /api/dispatch with WRONG secret → 401', async () => {
  const d = createDispatcher({ dispatchSecret: 'topsecret' });
  const h = mkReq('POST', '/api/dispatch', { body: { channel: 'inapp', to: '@x', text: 'x' }, headers: { 'x-herald-dispatch-secret': 'nope' } });
  await d.handler(h.req, h.res);
  assert.equal(h.get().statusCode, 401);
});

test('HTTP: secret UNSET → 401 for everyone (fail closed)', async () => {
  const d = createDispatcher({ dispatchSecret: '' });
  const h = mkReq('POST', '/api/dispatch', { body: { channel: 'inapp', to: '@x', text: 'x' }, headers: { 'x-herald-dispatch-secret': '' } });
  await d.handler(h.req, h.res);
  assert.equal(h.get().statusCode, 401);
});

test('HTTP: /health, authed /api/dispatch + /api/inbox round-trip, actions, 404', async () => {
  const d = createDispatcher({ dispatchSecret: 'topsecret' });
  const auth = { 'x-herald-dispatch-secret': 'topsecret' };

  let h = mkReq('GET', '/health');
  await d.handler(h.req, h.res);
  let out = h.get();
  assert.equal(out.statusCode, 200);
  const health = JSON.parse(out.payload);
  assert.equal(health.ok, true);
  assert.deepEqual(health.channels, CHANNELS);

  h = mkReq('POST', '/api/dispatch', { body: { channel: 'inapp', to: '@qa', text: 'via http' }, headers: auth });
  await d.handler(h.req, h.res);
  out = h.get();
  assert.equal(out.statusCode, 200);
  assert.equal(JSON.parse(out.payload).result.sent, true);

  h = mkReq('GET', '/api/inbox?target=@qa');
  await d.handler(h.req, h.res);
  out = h.get();
  assert.equal(JSON.parse(out.payload).messages.some((m) => m.text === 'via http'), true);

  h = mkReq('POST', '/api/dispatch', { body: { actions: [{ action: 'notify', target: '@qa2', name: 'r' }] }, headers: auth });
  await d.handler(h.req, h.res);
  out = h.get();
  assert.equal(JSON.parse(out.payload).results.length, 1);

  h = mkReq('GET', '/nope');
  await d.handler(h.req, h.res);
  assert.equal(h.get().statusCode, 404);
});

test('malformed HTTP request never throws', async () => {
  const d = createDispatcher();
  const res = { writeHead() {}, end() {} };
  await d.handler(null, res);
  await d.handler({}, res);
  await d.handler({ method: 'POST', url: '/api/dispatch', headers: {} }, res); // no body/stream, no auth
  assert.ok(true);
});
