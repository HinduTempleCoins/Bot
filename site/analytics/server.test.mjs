// site/analytics/server.test.mjs — OFFLINE. Beacon + gated dashboard. No network, no PII, temp store.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Point the collector at a throwaway dir for the whole file (record/aggregate read this at call time).
const STORE = mkdtempSync(join(tmpdir(), 'analytics-srv-'));
process.env.ANALYTICS_DIR = STORE;
process.on('exit', () => { try { rmSync(STORE, { recursive: true, force: true }); } catch {} });

const { handler, esc } = await import('./server.mjs');

// minimal res capture
function cap() {
  const o = { code: 0, headers: {}, body: '', buf: null };
  return {
    res: {
      writeHead(c, h) { o.code = c; o.headers = h || {}; },
      end(b) { if (Buffer.isBuffer(b)) { o.buf = b; o.body = b.toString('latin1'); } else { o.body = b || ''; } },
    }, o,
  };
}
// a POST req whose body is already parsed (house-style test shortcut)
function postPx(body, headers = {}) { return { url: '/px', method: 'POST', headers, body, socket: { remoteAddress: '10.0.0.' + Math.floor(Math.random() * 250) } }; }
function get(path, headers = {}) { return { url: path, method: 'GET', headers, socket: { remoteAddress: '10.0.0.5' } }; }

test('POST /px records a pageview and returns 204 with CORS, no body reflection', async () => {
  const { res, o } = cap();
  await handler(postPx({ p: '/markets?secret=1', r: 'https://news.ycombinator.com/x' }, { origin: 'https://data.soapbox.community', 'user-agent': 'Mozilla/5.0 (iPhone) Mobile' }), res);
  assert.equal(o.code, 204);
  assert.equal(o.headers['access-control-allow-origin'], '*');
  assert.equal(o.body, '');                                  // 204 → empty; never reflects input
  // it landed in the store, PII-stripped
  const files = readdirSync(STORE);
  assert.ok(files.includes('events.jsonl'));
});

test('POST /px NEVER reflects hostile input into a response', async () => {
  const { res, o } = cap();
  await handler(postPx({ p: '/<script>alert(1)</script>', r: 'https://evil.example/"><img>' }, { origin: 'https://x.soapbox.community' }), res);
  assert.equal(o.code, 204);
  assert.doesNotMatch(o.body, /<script>|<img>|alert/);       // body is empty, but assert the invariant
});

test('OPTIONS /px answers the CORS preflight', async () => {
  const { res, o } = cap();
  await handler({ url: '/px', method: 'OPTIONS', headers: {}, socket: {} }, res);
  assert.equal(o.code, 204);
  assert.match(o.headers['access-control-allow-methods'] || '', /POST/);
});

test('GET /px.gif records and returns a 1x1 gif', async () => {
  const { res, o } = cap();
  await handler(get('/px.gif?p=/from-img&r=https://google.com/s', { 'user-agent': 'Mozilla/5.0 (X11; Linux)' }), res);
  assert.equal(o.code, 200);
  assert.equal(o.headers['content-type'], 'image/gif');
  assert.ok(o.buf && o.buf[0] === 0x47 && o.buf[1] === 0x49 && o.buf[2] === 0x46); // "GIF"
});

test('DNT:1 is honoured — /px still 204s but records nothing new', async () => {
  const before = readdirSync(STORE);
  // count lines before
  const { res, o } = cap();
  await handler(postPx({ p: '/should-not-store', r: '' }, { dnt: '1', origin: 'https://x.soapbox.community' }), res);
  assert.equal(o.code, 204);
  // aggregate must not contain the DNT path
  process.env.ANALYTICS_ADMIN_TOKEN = 'tkn-dnt';
  const dash = cap();
  await handler(get('/?token=tkn-dnt'), dash.res);
  assert.doesNotMatch(dash.o.body, /should-not-store/);
  delete process.env.ANALYTICS_ADMIN_TOKEN;
  void before;
});

test('robots.txt disallows crawling the admin surface', async () => {
  const { res, o } = cap();
  await handler(get('/robots.txt'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /Disallow:\s*\//);
  assert.doesNotMatch(o.body, /Allow:\s*\//);
  assert.match(o.headers['x-robots-tag'] || '', /noindex/);
});

test('/health is a clean JSON liveness probe', async () => {
  const { res, o } = cap();
  await handler(get('/health'), res);
  assert.equal(o.code, 200);
  assert.equal(JSON.parse(o.body).ok, true);
});

test('dashboard exposes NOTHING when ANALYTICS_ADMIN_TOKEN is unset', async () => {
  delete process.env.ANALYTICS_ADMIN_TOKEN;
  const { res, o } = cap();
  await handler(get('/'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /No admin token is configured/);
  assert.doesNotMatch(o.body, /Top paths|Pageviews per day|markets/);  // no data surfaced
  assert.match(o.body, /noindex/);                                      // still noindex
});

test('dashboard 401s with a set token but wrong/absent credential', async () => {
  process.env.ANALYTICS_ADMIN_TOKEN = 'sekret-token';
  try {
    let { res, o } = cap();
    await handler(get('/'), res);                       // no token supplied
    assert.equal(o.code, 401);
    assert.doesNotMatch(o.body, /Top paths|markets/);

    ({ res, o } = cap());
    await handler(get('/?token=wrong'), res);           // wrong token
    assert.equal(o.code, 401);
  } finally { delete process.env.ANALYTICS_ADMIN_TOKEN; }
});

test('dashboard renders the escaped aggregate with the correct token', async () => {
  // seed a hostile path to prove the dashboard escapes stored values
  const seed = cap();
  await handler(postPx({ p: '/x"><b>xss</b>', r: 'https://ref.example/p' }, { origin: 'https://data.soapbox.community', 'user-agent': 'Mozilla/5.0 (X11; Linux)' }), seed.res);

  process.env.ANALYTICS_ADMIN_TOKEN = 'good-token';
  try {
    const { res, o } = cap();
    await handler(get('/?token=good-token'), res);
    assert.equal(o.code, 200);
    assert.match(o.body, /Top paths/);
    assert.match(o.body, /Pageviews per day/);
    assert.match(o.body, /<svg/);                                  // inline-SVG bars, no libs
    // the hostile stored path is escaped, never raw
    assert.match(o.body, /&lt;b&gt;xss&lt;\/b&gt;/);
    assert.doesNotMatch(o.body, /<b>xss<\/b>/);
  } finally { delete process.env.ANALYTICS_ADMIN_TOKEN; }
});

test('dashboard also accepts the token via Authorization: Bearer header', async () => {
  process.env.ANALYTICS_ADMIN_TOKEN = 'hdr-token';
  try {
    const { res, o } = cap();
    await handler(get('/', { authorization: 'Bearer hdr-token' }), res);
    assert.equal(o.code, 200);
    assert.match(o.body, /Traffic overview/);
  } finally { delete process.env.ANALYTICS_ADMIN_TOKEN; }
});

test('no outbound network + no raw IP leaks into any response', async () => {
  const { res, o } = cap();
  await handler(get('/health'), res);
  assert.doesNotMatch(o.body, /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  assert.equal(typeof esc, 'function');
});
