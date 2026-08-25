// server.test.mjs — offline tests for the SoapBox Forum HTTP service. node --test, no network. Drives the
// exported handler through a fake req/res and asserts routing, thread views, the signable post intent
// (keyless), search, health, robots/sitemap/llms, and XSS-escaping of hostile input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, homePage, boardPage, threadPage, postIntentPage, searchPage, forum, seed, SITEMAP_PATHS } from './server.mjs';

// minimal res double capturing writeHead + end.
function mockRes() {
  return {
    statusCode: 200, headers: {}, body: '',
    writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function req(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET', headers: {} }, res);
  return res;
}

test('/health returns 200 ok', async () => {
  const res = await req('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('/ home renders 200 with boards + recent threads', async () => {
  const res = await req('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /SoapBox Forum/);
  assert.match(res.body, /General Discussion/);
  assert.match(res.body, /Welcome to the MELEK Forum/); // a seeded thread
  assert.match(res.body, /FORUM merit|FORUM<\/|FORUM /); // token surfaced
});

test('/b/<board> renders the board with its threads and a New thread button', async () => {
  const res = await req('/b/economy');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Economy &amp; Tokens/);
  assert.match(res.body, /New thread/);
  assert.match(res.body, /How FORUM merit differs from stake/); // seeded thread
});

test('/b/<unknown> redirects home', async () => {
  const res = await req('/b/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('/t/<id> renders a thread view with author signature + merit', async () => {
  await seed();
  const recent = await forum.recentThreads(20);
  const withReplies = recent.find((t) => t.replyCount > 0) || recent[0];
  const res = await req('/t/' + withReplies.id);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /class="post/);
  assert.match(res.body, /forum-sig/);         // author signature rendered
  assert.match(res.body, /merit/);             // merit shown
  assert.match(res.body, /Sign &amp; post reply/); // keyless reply form
});

test('/t/<unknown> redirects home', async () => {
  const res = await req('/t/ghostthread');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('/post renders a signable MELEK-Signer comment intent and holds NO keys', async () => {
  const res = await req('/post?board=general');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /New thread/);
  assert.match(res.body, /The exact operation you will sign/);
  assert.match(res.body, /&quot;op&quot;: &quot;comment&quot;/); // the intent object is shown (HTML-escaped)
  assert.match(res.body, /oauth2\/authorize|MELEK-Signer/); // signer, not local signing
  // no private key material anywhere in the page
  assert.doesNotMatch(res.body, /5[HJK][1-9A-HJ-NP-Za-km-z]{40,}/); // WIF-shaped string
  assert.doesNotMatch(res.body, /private[_-]?key|posting_wif|wif/i);
});

test('postIntentPage escapes hostile prefilled title/body (no raw script)', () => {
  const html = postIntentPage({ board: 'general', title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(2)>' });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;script&gt;/);
});

test('post intent tolerates an unknown board (falls back to general)', () => {
  const html = postIntentPage({ board: 'no-such-board', title: 't', body: 'b' });
  assert.match(html, /New thread/);
  assert.match(html, /melek-forum-general/);
});

test('/search with a query returns matching threads', async () => {
  const res = await req('/search?q=merit');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Search/);
  // seeded economy thread body/title mentions merit
  assert.match(res.body, /How FORUM merit differs from stake|No threads matched/);
});

test('/search escapes a hostile query', async () => {
  const res = await req('/search?q=' + encodeURIComponent('<script>alert(3)</script>'));
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(3\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;/);
});

test('/robots.txt, /sitemap.xml, /sitemap-index.xml, /llms.txt serve', async () => {
  const robots = await req('/robots.txt');
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /Sitemap|User-agent/i);

  const sm = await req('/sitemap.xml');
  assert.equal(sm.statusCode, 200);
  assert.match(sm.headers['content-type'], /xml/);
  assert.match(sm.body, /<urlset|<url>/);

  const smi = await req('/sitemap-index.xml');
  assert.equal(smi.statusCode, 200);
  assert.match(smi.headers['content-type'], /xml/);

  const llms = await req('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /FORUM|forum/i);
});

test('SITEMAP_PATHS covers home, search, and every board', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  assert.ok(SITEMAP_PATHS.includes('/search'));
  for (const g of forum.boards()) for (const b of g.boards) {
    assert.ok(SITEMAP_PATHS.includes(`/b/${b.id}`), `sitemap missing /b/${b.id}`);
  }
});

test('unknown path redirects home', async () => {
  const res = await req('/totally/unknown');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('handler never throws on a malformed url', async () => {
  const res = mockRes();
  await assert.doesNotReject(async () => handler({ url: '/t/%%%bad', method: 'GET', headers: {} }, res));
  assert.ok(res.statusCode >= 200);
});

test('exported page builders return complete HTML documents', async () => {
  await seed();
  const home = await homePage();
  assert.match(home, /^<!doctype html>/i);
  const board = await boardPage('general');
  assert.match(board.html, /<\/html>/);
  const recent = await forum.recentThreads(1);
  const thread = await threadPage(recent[0].id);
  assert.match(thread, /<\/html>/);
  const search = await searchPage('merit');
  assert.match(search, /<\/html>/);
});
