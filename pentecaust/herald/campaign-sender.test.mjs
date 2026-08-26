// pentecaust/herald/campaign-sender.test.mjs — offline, deterministic tests for Herald's sending layer.
// NO network, NO disk: an in-memory fs is injected, a counter is the injected clock, a sequence generates
// unsubscribe tokens, and the ESP send is an injected fake — so nothing ever leaves the process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCampaignSender, handler, interpolate, maskEmail, defaultSend,
  esc, safeHref, __setFetch, __setSender,
} from './campaign-sender.mjs';

// A fresh in-memory fs (one JSON blob), a monotonic clock, sequential tokens, and a recording fake sender.
function make(sender) {
  let blob = null;
  const fs = { read: () => blob, write: (_p, s) => { blob = s; } };
  let t = 0; const now = () => ++t;
  let n = 0; const genToken = () => `tok-${++n}`;
  const sent = [];
  const fake = sender || (async (m) => { sent.push(m); return { ok: true, sent: true, id: `id-${sent.length}` }; });
  return { cs: createCampaignSender({ fs, now, genToken, sender: fake, ...(arguments[1] || {}) }), sent, fs };
}

// ── lists + subscribers ────────────────────────────────────────────────────────────────────────────────
test('createList + addSubscriber (dedupe, normalize, list membership)', () => {
  const { cs } = make();
  assert.equal(cs.createList('News', { id: 'news' }).ok, true);
  const r = cs.addSubscriber({ email: '  Alice@Example.COM ', listId: 'news', attrs: { name: 'Alice' } });
  assert.equal(r.ok, true);
  assert.match(r.subscriber.email, /\*\*\*/);           // masked — no raw PII returned
  assert.ok(!('token' in r.subscriber));                // token never exposed
  // re-add same email → same subscriber, no duplicate
  cs.addSubscriber({ email: 'alice@example.com', listId: 'news' });
  assert.equal(cs.stats().subscribers, 1);
});

test('addSubscriber soft-fails on bad email / missing list (never throws)', () => {
  const { cs } = make();
  assert.equal(cs.addSubscriber({ email: 'not-an-email' }).ok, false);
  assert.equal(cs.addSubscriber({}).ok, false);
  cs.createList('news', { id: 'news' });
  assert.equal(cs.addSubscriber({ email: 'a@b.com', listId: 'ghost' }).ok, false);
});

// ── template render: XSS-safe + compliance footer + safeHref CTA ──────────────────────────────────────────
test('renderFor esc()s HTML vars (no XSS) and appends an unsubscribe link', () => {
  const { cs } = make();
  cs.createList('news', { id: 'news' });
  cs.addSubscriber({ email: 'x@y.com', listId: 'news', attrs: { name: '<script>alert(1)</script>' } });
  cs.upsertTemplate({ id: 'w', subject: 'Hi {{name}}', html: '<p>Hello {{name}}</p>' });
  const sub = cs._load().subscribers['x@y.com'];
  const r = cs.renderFor(cs.getTemplate('w'), sub);
  assert.ok(!r.html.includes('<script>alert(1)</script>'));       // the payload is escaped
  assert.ok(r.html.includes('&lt;script&gt;'));
  assert.ok(r.html.includes('Unsubscribe'));                      // CAN-SPAM footer
  assert.ok(r.unsubUrl.includes('/u/tok-'));
  // subject is a header, not HTML — raw name flows but no tags introduced by us
  assert.match(r.subject, /^Hi /);
});

test('upsertTemplate safeHref-guards ctaUrl; render only emits http(s) CTA', () => {
  const { cs } = make();
  const bad = cs.upsertTemplate({ id: 'b', subject: 's', html: '<p>hi</p>', ctaUrl: 'javascript:alert(1)' });
  assert.equal(bad.template.ctaUrl, '');                          // stripped
  const good = cs.upsertTemplate({ id: 'g', subject: 's', html: '<p>hi</p>', ctaUrl: 'https://melek.salon/x' });
  assert.equal(good.template.ctaUrl, 'https://melek.salon/x');
  cs.createList('l', { id: 'l' }); cs.addSubscriber({ email: 'a@b.com', listId: 'l' });
  const sub = cs._load().subscribers['a@b.com'];
  const rBad = cs.renderFor(cs.getTemplate('b'), sub);
  assert.ok(!rBad.html.includes('javascript:'));
  const rGood = cs.renderFor(cs.getTemplate('g'), sub);
  assert.ok(rGood.html.includes('https://melek.salon/x'));
});

// ── campaign broadcast + queued send via injected sender ──────────────────────────────────────────────────
test('sendCampaign enqueues per-subscriber; processQueue dispatches via injected sender', async () => {
  const { cs, sent } = make();
  cs.createList('news', { id: 'news' });
  cs.addSubscriber({ email: 'a@b.com', listId: 'news', attrs: { name: 'A' } });
  cs.addSubscriber({ email: 'c@d.com', listId: 'news', attrs: { name: 'C' } });
  cs.upsertTemplate({ id: 'w', subject: 'Hi {{name}}', html: '<p>{{name}}</p>' });
  cs.createCampaign({ id: 'launch', listId: 'news', templateId: 'w' });
  const s = cs.sendCampaign('launch');
  assert.equal(s.ok, true); assert.equal(s.queued, 2);
  const p = await cs.processQueue();
  assert.equal(p.sent, 2); assert.equal(p.failed, 0);
  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /^Hi /);
  // re-processing sends nothing new (queue drained)
  const p2 = await cs.processQueue();
  assert.equal(p2.sent, 0);
});

test('suppressed subscribers are never enqueued or sent', async () => {
  const { cs, sent } = make();
  cs.createList('news', { id: 'news' });
  cs.addSubscriber({ email: 'a@b.com', listId: 'news' });
  cs.addSubscriber({ email: 'bad@b.com', listId: 'news' });
  cs.unsubscribeByEmail('a@b.com');
  cs.markBounced('bad@b.com');
  cs.upsertTemplate({ id: 'w', subject: 's', html: '<p>x</p>' });
  cs.createCampaign({ id: 'c', listId: 'news', templateId: 'w' });
  const r = cs.sendCampaign('c');
  assert.equal(r.queued, 0); assert.equal(r.suppressed, 2);
  await cs.processQueue();
  assert.equal(sent.length, 0);
});

// ── unsubscribe token flow ────────────────────────────────────────────────────────────────────────────────
test('unsubscribeByToken flips status and blocks future sends', async () => {
  const { cs, sent } = make();
  cs.createList('l', { id: 'l' });
  cs.addSubscriber({ email: 'a@b.com', listId: 'l' });
  const token = cs._load().subscribers['a@b.com'].token;
  const u = cs.unsubscribeByToken(token);
  assert.equal(u.ok, true);
  assert.match(u.email, /\*\*\*/);
  assert.equal(cs.unsubscribeByToken('nope').ok, false);      // unknown token → soft-fail
  cs.upsertTemplate({ id: 'w', subject: 's', html: '<p>x</p>' });
  cs.createCampaign({ id: 'c', listId: 'l', templateId: 'w' });
  cs.sendCampaign('c');
  const p = await cs.processQueue();
  assert.equal(p.sent, 0);
});

// ── drip / journey executor ───────────────────────────────────────────────────────────────────────────────
test('journey drip: steps enqueue only when due per the injected clock', async () => {
  let blob = null;
  const fs = { read: () => blob, write: (_p, s) => { blob = s; } };
  let n = 0; const genToken = () => `tok-${++n}`;
  const sent = [];
  const clockRef = { t: 0 };
  const cs = createCampaignSender({
    fs, now: () => clockRef.t, genToken, sender: async (m) => { sent.push(m); return { ok: true, sent: true }; },
  });
  cs.createList('l', { id: 'l' });
  cs.addSubscriber({ email: 'a@b.com', listId: 'l', attrs: { name: 'A' } });
  cs.upsertTemplate({ id: 's0', subject: 'step0', html: '<p>0 {{name}}</p>' });
  cs.upsertTemplate({ id: 's1', subject: 'step1', html: '<p>1</p>' });
  cs.defineJourney({ id: 'welcome', steps: [{ templateId: 's0', delayMs: 0 }, { templateId: 's1', delayMs: 100 }] });
  clockRef.t = 10;
  assert.equal(cs.enrollSubscriber('welcome', 'a@b.com').ok, true);   // step0 due at 10
  // tick at 10 → step0 enqueues, step1 scheduled for 110
  let tk = cs.tickJourneys(10);
  assert.equal(tk.enqueued, 1);
  await cs.processQueue();
  assert.equal(sent.length, 1);
  // tick at 50 → step1 not due yet
  cs.tickJourneys(50);
  await cs.processQueue();
  assert.equal(sent.length, 1);
  // tick at 200 → step1 due
  cs.tickJourneys(200);
  await cs.processQueue();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].subject, 'step0');
  assert.equal(sent[1].subject, 'step1');
  // journey exhausted → no more
  cs.tickJourneys(1000);
  await cs.processQueue();
  assert.equal(sent.length, 2);
});

test('defineJourney/enroll soft-fail on bad input (never throws)', () => {
  const { cs } = make();
  assert.equal(cs.defineJourney({ id: 'j', steps: [] }).ok, false);
  assert.equal(cs.defineJourney({ id: 'j', steps: [{ templateId: 'ghost', delayMs: 0 }] }).ok, false);
  assert.equal(cs.enrollSubscriber('ghost', 'a@b.com').ok, false);
});

// ── unconfigured ESP send = soft no-op (never sends, never throws) ─────────────────────────────────────────
test('defaultSend with no ESP env is a soft no-op and never calls fetch', async () => {
  const saved = { r: process.env.RESEND_API_KEY, p: process.env.POSTMARK_SERVER_TOKEN, f: process.env.HERALD_SEND_FROM };
  delete process.env.RESEND_API_KEY; delete process.env.POSTMARK_SERVER_TOKEN; delete process.env.HERALD_SEND_FROM;
  let called = false;
  __setFetch(async () => { called = true; return { status: 200, json: async () => ({}) }; });
  const r = await defaultSend({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x', unsubUrl: 'https://h/u/1' });
  assert.equal(r.ok, true); assert.equal(r.sent, false); assert.equal(r.skipped, 'esp-unconfigured');
  assert.equal(called, false);
  __setFetch(null);
  if (saved.r) process.env.RESEND_API_KEY = saved.r; if (saved.p) process.env.POSTMARK_SERVER_TOKEN = saved.p; if (saved.f) process.env.HERALD_SEND_FROM = saved.f;
});

test('defaultSend hits Resend via injected fetch when configured (offline)', async () => {
  const saved = { r: process.env.RESEND_API_KEY, f: process.env.HERALD_SEND_FROM, e: process.env.HERALD_ESP };
  process.env.RESEND_API_KEY = 'test-key';
  process.env.HERALD_SEND_FROM = 'hathor@example.com';
  process.env.HERALD_ESP = 'resend';
  const seen = {};
  __setFetch(async (url, init) => { seen.url = url; seen.body = JSON.parse(init.body); return { status: 200, json: async () => ({ id: 'resend-1' }) }; });
  const r = await defaultSend({ to: 'a@b.com', subject: 's', html: '<p>x</p>', text: 'x', unsubUrl: 'https://h/u/1' });
  assert.equal(r.ok, true); assert.equal(r.sent, true); assert.equal(r.id, 'resend-1');
  assert.equal(seen.url, 'https://api.resend.com/emails');
  assert.equal(seen.body.from, 'hathor@example.com');
  assert.ok(seen.body.headers['List-Unsubscribe'].includes('https://h/u/1'));
  __setFetch(null);
  process.env.RESEND_API_KEY = saved.r || ''; if (!saved.r) delete process.env.RESEND_API_KEY;
  process.env.HERALD_SEND_FROM = saved.f || ''; if (!saved.f) delete process.env.HERALD_SEND_FROM;
  process.env.HERALD_ESP = saved.e || ''; if (!saved.e) delete process.env.HERALD_ESP;
});

test('processQueue with default (unconfigured) sender marks skipped, never throws', async () => {
  const saved = { r: process.env.RESEND_API_KEY, p: process.env.POSTMARK_SERVER_TOKEN };
  delete process.env.RESEND_API_KEY; delete process.env.POSTMARK_SERVER_TOKEN;
  // build a sender that uses the module default (no injected sender)
  let blob = null; const fs = { read: () => blob, write: (_p, s) => { blob = s; } };
  let t = 0; let n = 0;
  const cs = createCampaignSender({ fs, now: () => ++t, genToken: () => `tok-${++n}` });
  cs.createList('l', { id: 'l' }); cs.addSubscriber({ email: 'a@b.com', listId: 'l' });
  cs.upsertTemplate({ id: 'w', subject: 's', html: '<p>x</p>' });
  cs.createCampaign({ id: 'c', listId: 'l', templateId: 'w' });
  cs.sendCampaign('c');
  const p = await cs.processQueue();
  assert.equal(p.ok, true); assert.equal(p.skipped, 1); assert.equal(p.sent, 0);
  if (saved.r) process.env.RESEND_API_KEY = saved.r; if (saved.p) process.env.POSTMARK_SERVER_TOKEN = saved.p;
});

// ── a sender that throws is contained (soft-fail) ─────────────────────────────────────────────────────────
test('a throwing sender is contained → message failed, not an exception', async () => {
  const { cs } = make(async () => { throw new Error('boom'); });
  cs.createList('l', { id: 'l' }); cs.addSubscriber({ email: 'a@b.com', listId: 'l' });
  cs.upsertTemplate({ id: 'w', subject: 's', html: '<p>x</p>' });
  cs.createCampaign({ id: 'c', listId: 'l', templateId: 'w' });
  cs.sendCampaign('c');
  const p = await cs.processQueue();
  assert.equal(p.ok, true); assert.equal(p.failed, 1);
});

// ── HTTP surface ──────────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b == null ? '' : String(b); } };
}
function get(path) { return { method: 'GET', url: path, on() {} }; }
function post(path, body, headers) { return { method: 'POST', url: path, body, headers: headers || {}, on() {} }; }
// A streaming request (no pre-parsed req.body) that emits `raw` then end — exercises readJsonBody's stream path.
function postStream(path, raw) {
  const handlers = {};
  const req = { method: 'POST', url: path, on(ev, fn) { handlers[ev] = fn; return req; } };
  queueMicrotask(() => { if (raw != null && handlers.data) handlers.data(raw); if (handlers.end) handlers.end(); });
  return req;
}

test('handler: /health + /api/stats + /api/lists (no PII), unknown path 404', async () => {
  const { cs } = make();
  cs.createList('news', { id: 'news' });
  let res = mockRes(); await cs.handler(get('/health'), res);
  assert.equal(res.code, 200); assert.match(res.body, /herald-campaign-sender/);
  res = mockRes(); await cs.handler(get('/api/lists'), res);
  assert.equal(res.code, 200); assert.match(res.body, /news/);
  res = mockRes(); await cs.handler(get('/nope'), res);
  assert.equal(res.code, 404);
});

test('handler: POST /api/subscribe + safe-GET / acting-POST unsubscribe (RFC 8058)', async () => {
  const { cs } = make();
  cs.createList('l', { id: 'l' });
  let res = mockRes(); await cs.handler(post('/api/subscribe', { email: 'a@b.com', listId: 'l' }), res);
  assert.equal(res.code, 200); assert.match(res.body, /"ok":true/);
  const token = cs._load().subscribers['a@b.com'].token;
  // GET is SAFE: shows a confirm form, mutates NOTHING (prefetch/scanner can't unsubscribe).
  res = mockRes(); await cs.handler(get('/u/' + encodeURIComponent(token)), res);
  assert.equal(res.code, 200);
  assert.match(res.body, /<form method="post"/i);
  assert.notEqual(cs._load().subscribers['a@b.com'].status, 'unsubscribed');   // GET did NOT unsubscribe
  // POST performs the unsubscribe (human confirm button OR ESP one-click both POST here).
  res = mockRes(); await cs.handler(post('/u/' + encodeURIComponent(token)), res);
  assert.equal(res.code, 200);
  assert.match(res.body, /unsubscribed/i);
  assert.ok(!res.body.includes('a@b.com'));                 // raw email never echoed on the page
  assert.equal(cs._load().subscribers['a@b.com'].status, 'unsubscribed');
});

test('handler: /api/subscribe is rate-limited (anti list-stuffing)', async () => {
  const { cs } = make(undefined, { subscribeRateMax: 3 });
  cs.createList('l', { id: 'l' });
  let last = 0;
  for (let i = 0; i < 5; i++) {
    const res = mockRes();
    await cs.handler({ method: 'POST', url: '/api/subscribe', body: { email: `u${i}@b.com`, listId: 'l' }, headers: {}, socket: { remoteAddress: '9.9.9.9' }, on() {} }, res);
    last = res.code;
  }
  assert.equal(last, 429);   // over the cap of 3 → rate-limited
});

test('handler: POST /api/webhook is fail-closed then suppresses with the verified secret', async () => {
  // fail-closed: no secret configured → 401, and an unauthed call must NOT mutate suppression state.
  const nocfg = make();
  nocfg.cs.createList('l', { id: 'l' }); nocfg.cs.addSubscriber({ email: 'a@b.com', listId: 'l' });
  let res = mockRes(); await nocfg.cs.handler(post('/api/webhook', { type: 'bounce', email: 'a@b.com' }), res);
  assert.equal(res.code, 401);
  assert.notEqual(nocfg.cs._load().subscribers['a@b.com'].status, 'bounced');

  // configured secret: missing header → 401, wrong secret → 401, correct secret → 200 + suppressed.
  const { cs } = make(undefined, { webhookSecret: 's3cr3t' });
  cs.createList('l', { id: 'l' }); cs.addSubscriber({ email: 'a@b.com', listId: 'l' });
  res = mockRes(); await cs.handler(post('/api/webhook', { type: 'bounce', email: 'a@b.com' }), res);
  assert.equal(res.code, 401);
  res = mockRes(); await cs.handler(post('/api/webhook', { type: 'bounce', email: 'a@b.com' }, { 'x-webhook-secret': 'wrong-len-differs' }), res);
  assert.equal(res.code, 401);
  res = mockRes(); await cs.handler(post('/api/webhook', { type: 'bounce', email: 'a@b.com' }, { 'x-webhook-secret': 's3cr3t' }), res);
  assert.equal(res.code, 200);
  assert.equal(cs._load().subscribers['a@b.com'].status, 'bounced');
});

test('handler: bad JSON body soft-fails 400, garbage never throws', async () => {
  const { cs } = make();
  // streamed invalid JSON → readJsonBody resolves null → 400, no throw
  let res = mockRes(); await cs.handler(postStream('/api/subscribe', '{not json'), res);
  assert.equal(res.code, 400);
  // streamed valid-but-empty body → addSubscriber soft-fails 400
  res = mockRes(); await cs.handler(postStream('/api/subscribe', ''), res);
  assert.equal(res.code, 400);
});

test('module singleton handler is callable and 404s unknown', async () => {
  const res = mockRes(); await handler(get('/definitely-not-a-route'), res);
  assert.equal(res.code, 404);
});

// ── pure helpers ──────────────────────────────────────────────────────────────────────────────────────────
test('esc / safeHref / maskEmail / interpolate behave', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(safeHref('https://ok.com'), 'https://ok.com');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('/relative'), '');
  assert.equal(maskEmail('alice@example.com'), 'a***@e***.com');
  assert.equal(maskEmail('garbage'), '(hidden)');
  assert.equal(interpolate('<b>{{x}}</b>', { x: '<i>' }, { html: true }), '<b>&lt;i&gt;</b>');
  assert.equal(interpolate('{{x}}', { x: '<i>' }, { html: false }), '<i>');
  assert.equal(interpolate('{{missing}}', {}, { html: true }), '');
});

test('createCampaignSender never throws on totally broken fs', () => {
  const fs = { read: () => { throw new Error('io'); }, write: () => { throw new Error('io'); } };
  const cs = createCampaignSender({ fs });
  // every entry point must swallow the fs failure and return a shaped result
  assert.equal(cs.createList('x').ok, false);
  assert.equal(cs.addSubscriber({ email: 'a@b.com' }).ok, false);
  assert.deepEqual(cs.listLists(), []);
  assert.equal(typeof cs.stats().subscribers, 'number');
});
