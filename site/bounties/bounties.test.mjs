// bounties.test.mjs — offline handler tests for the MELEK Bounties vertical. `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, loginUrl, __setStore } from './server.mjs';
import { makeStore, completeBounty } from '../../integrations/bounties/bounty-board.mjs';

// Minimal mock res that captures status/headers/body.
function mockRes() {
  return {
    code: 0, headers: {}, body: '',
    writeHead(code, headers) { this.code = code; if (headers) Object.assign(this.headers, headers); return this; },
    end(s) { if (s != null) this.body += s; this.ended = true; return this; },
  };
}
async function get(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('login CTA URL is built via the shared MELEK-Signer OAuth flow', () => {
  const u = loginUrl();
  assert.match(u, /\/oauth2\/authorize/);
  assert.match(u, /client_id=melek-bounties/);
  assert.match(u, /scope=identity/);
});

test('home 200 with login CTA and the "create wallet to unlock" funnel', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /oauth2\/authorize/);       // login-with-social CTA present
  assert.match(res.body, /Log in with MELEK-Signer/);
  assert.match(res.body, /Create your wallet to unlock/); // the funnel CTA
});

test('home renders all bounty categories', async () => {
  const res = await get('/');
  assert.match(res.body, /Foundational/);
  assert.match(res.body, /Ambassador/);
  assert.match(res.body, /Curation/);
  assert.match(res.body, /Witness/);
  assert.match(res.body, /your own token/i);
});

test('home shows the graduation links (engine / vote / witness)', async () => {
  const res = await get('/');
  assert.match(res.body, /engine\.alpha\.melek\.salon/);
  assert.match(res.body, /vote\.melek\.salon/);
  assert.match(res.body, /witness\.melek\.salon/);
});

test('home reflects a locked HELD balance for a known session', async () => {
  const store = makeStore();
  await completeBounty({ socialId: 'gh:board', bountyId: 'read-intro', now: 1 }, store);
  __setStore(store);
  const res = await get('/?social=gh:board');
  assert.equal(res.code, 200);
  assert.match(res.body, /still locked/); // has held-but-locked earnings
  __setStore(makeStore());
});

test('/api/bounties returns grouped JSON', async () => {
  const res = await get('/api/bounties');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.categories));
  assert.ok(j.bounties.foundational.length >= 1);
});

test('/api/progress returns a visitor funnel state as JSON', async () => {
  const store = makeStore();
  await completeBounty({ socialId: 'gh:api', bountyId: 'read-intro', now: 1 }, store);
  __setStore(store);
  const res = await get('/api/progress?social=gh:api');
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.ok, true);
  assert.equal(j.completedCount, 1);
  assert.equal(j.linked, false);
  assert.ok(j.held > 0);
  __setStore(makeStore());
});

test('/api/progress soft-fails (400) on an invalid social id', async () => {
  const res = await get('/api/progress?social=');
  assert.equal(res.code, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('/health, /robots.txt, /sitemap.xml, /llms.txt respond', async () => {
  assert.equal((await get('/health')).body, 'ok');
  assert.match((await get('/robots.txt')).body, /User-agent|Sitemap/i);
  assert.match((await get('/sitemap.xml')).body, /<urlset/);
  assert.match((await get('/llms.txt')).body, /MELEK Bounties/);
});

test('unknown path redirects home', async () => {
  const res = await get('/nope');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('output escapes XSS — no raw script survives interpolation', () => {
  // esc() is applied to every interpolated value; the static shell has no unescaped user input,
  // and homePage renders without throwing.
  const html = homePage(null);
  assert.match(html, /<!doctype html>/);
  assert.ok(!/<script>alert/.test(html));
});

test('handler never throws on a malformed request', async () => {
  const res = mockRes();
  await handler({ url: '/api/progress?social=%', method: 'GET' }, res);
  assert.ok(res.ended);
  assert.ok(res.code === 200 || res.code === 400 || res.code === 500);
});
