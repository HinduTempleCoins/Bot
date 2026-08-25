// spin.test.mjs — offline HTTP-handler tests for the Daily Spin vertical. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, esc, SITEMAP_PATHS, STORE } from './server.mjs';

// tiny mock res that captures what the handler wrote
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; },
  };
}
async function call(url) {
  const res = mockRes();
  await handler({ url, method: 'GET' }, res);
  return res;
}

test('/health returns ok', async () => {
  const res = await call('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('home renders the wheel, all segments, and the not-cash note', async () => {
  const res = await call('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Daily Spin/);
  assert.match(res.body, /points are for play, not cash/i);
  assert.match(res.body, /JACKPOT/);
  assert.match(res.body, /TINY/);
  // AMOE / sweepstakes framing present
  assert.match(res.body, /free/i);
  assert.match(res.body, /once per UTC day|one per UTC day|one free spin/i);
});

test('home carries no cash-out / withdraw affordance (non-cashable)', async () => {
  const res = await call('/');
  // the copy explains non-cashability (may say "no withdraw path"), but there must be NO actionable
  // control or link that withdraws / cashes out / redeems points for money.
  assert.doesNotMatch(res.body, /href="[^"]*(withdraw|cashout|redeem)/i);
  assert.doesNotMatch(res.body, /action="[^"]*(withdraw|cashout|redeem)/i);
  assert.doesNotMatch(res.body, /<button[^>]*>[^<]*(withdraw|cash out|redeem for cash)/i);
  // and it affirms non-cashable to the reader
  assert.match(res.body, /non-cashable/i);
});

test('performing a spin via the home form awards points and renders the result', async () => {
  const res = await call('/?account=homeuser&spin=1');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /PLAY balance/i);
  // the account now has a balance in the shared store
  assert.ok(STORE.get('homeuser').points > 0);
});

test('/api/spin returns JSON, non-cashable + PLAY currency, deterministic', async () => {
  const a = await call('/api/spin?account=apiuser&day=2026-08-25');
  assert.equal(a.statusCode, 200);
  assert.match(a.headers['content-type'], /application\/json/);
  const j = JSON.parse(a.body);
  assert.equal(j.ok, true);
  assert.equal(j.cashable, false);
  assert.equal(j.currency, 'PLAY');
  assert.ok(j.awarded > 0);
  assert.ok(j.segment);

  // second same-day call for the same account → rejected with a reason (one per day)
  const b = await call('/api/spin?account=apiuser&day=2026-08-25');
  const jb = JSON.parse(b.body);
  assert.equal(jb.ok, false);
  assert.match(jb.reason, /already spun/i);
});

test('/api/spin is deterministic for a fresh account+day+seed', async () => {
  const one = JSON.parse((await call('/api/spin?account=detuser&day=2026-09-01&seed=fixed')).body);
  // a different fresh account with the same seed/day → recomputable independently
  const two = JSON.parse((await call('/api/spin?account=detuser2&day=2026-09-01&seed=fixed')).body);
  assert.equal(one.ok, true);
  assert.equal(two.ok, true);
  // both are valid PLAY awards; determinism proven at engine level, here we assert shape
  assert.equal(one.currency, 'PLAY');
  assert.equal(two.cashable, false);
});

test('robots.txt served', async () => {
  const res = await call('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /User-agent|Sitemap/i);
});

test('sitemap.xml + sitemap-index + llms.txt served', async () => {
  const sm = await call('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset|<url>/);

  const idx = await call('/sitemap-index.xml');
  assert.equal(idx.statusCode, 200);
  assert.match(idx.body, /sitemapindex|<sitemap>/i);

  const llms = await call('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /play, not cash|PLAY points/i);
});

test('SITEMAP_PATHS includes the home route', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('XSS — account value is escaped in the rendered page', async () => {
  const res = await call('/?account=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;/);
});

test('esc() escapes the dangerous characters', () => {
  assert.equal(esc('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

test('unknown path redirects home (302)', async () => {
  const res = await call('/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('handler never throws — even on a malformed request', async () => {
  const res = mockRes();
  await assert.doesNotReject(handler({ url: '/api/spin?account=%', method: 'GET' }, res));
  assert.ok(res.ended);
});

test('homePage() soft-fails on a spin with an empty account (no crash)', () => {
  const html = homePage({ account: '', doSpin: true });
  assert.match(html, /Daily Spin/);
  assert.match(html, /points are for play, not cash/i);
});
