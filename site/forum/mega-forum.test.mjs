// mega-forum.test.mjs — offline tests for the MEGA-FORUM Phase-1 extensions to the SoapBox Forum service:
// data-driven boards routed through boards.mjs, clean /c//b//t URLs, per-object JSON-LD (DiscussionForum
// Posting / QAPage / BreadcrumbList), category + board indexes, sharded sitemap-index + shards, canonical,
// noindex-on-empty, flagship boards rendering seeded threads, and XSS-escaping. node --test, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, categoryPage, boardPage, threadPage, forum, seed } from './server.mjs';

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

test('/c/<category> renders a category index with CollectionPage + BreadcrumbList JSON-LD', async () => {
  const res = await req('/c/crypto');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Crypto/);
  assert.match(res.body, /Bitcoin/);            // a board in the category
  assert.match(res.body, /"CollectionPage"/);
  assert.match(res.body, /"BreadcrumbList"/);
  assert.match(res.body, /rel="canonical" href="[^"]*\/c\/crypto"/);
});

test('/c/<unknown> redirects home', async () => {
  const res = await req('/c/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('flagship static crypto board renders seeded threads + DiscussionForumPosting-ready index', async () => {
  const res = await req('/b/crypto/bitcoin');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Bitcoin/);
  assert.match(res.body, /Self-custody basics/);  // a seeded thread title
  assert.match(res.body, /"CollectionPage"/);
  assert.match(res.body, /"BreadcrumbList"/);
  assert.match(res.body, /New thread/);
  // indexable (has content) → not noindex
  assert.match(res.body, /name="robots" content="index,follow/);
});

test('programmatic city board resolves + renders seeded threads (non-thin, slug woven)', async () => {
  const res = await req('/b/city/austin-tx');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Austin Tx/);              // humanised slug in the title
  assert.match(res.body, /Moving to Austin/);       // seeded thread
  assert.match(res.body, /rel="canonical" href="[^"]*\/b\/city\/austin-tx"/);
});

test('programmatic game board (wiki-linkout) renders + carries safeHref external links', async () => {
  const res = await req('/b/game/minecraft');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Minecraft/);
  assert.match(res.body, /villager trading/);       // seeded thread
  assert.match(res.body, /gamefaqs\.gamespot\.com/); // curated link-out
});

test('an empty programmatic board is noindex until it has content', async () => {
  const res = await req('/b/city/emptyville');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Emptyville/);
  assert.match(res.body, /No threads in this board yet/);
  assert.match(res.body, /name="robots" content="noindex/);
});

test('thread on a discussion board emits DiscussionForumPosting + BreadcrumbList', async () => {
  await seed();
  const btc = (await forum.board('crypto/bitcoin', { sort: 'new' }))[0];
  const res = await req('/t/' + btc.id);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"DiscussionForumPosting"/);
  assert.match(res.body, /"BreadcrumbList"/);
  assert.match(res.body, /"InteractionCounter"/);
  assert.match(res.body, /rel="canonical" href="[^"]*\/t\//);
  assert.match(res.body, /Related threads/);        // internal-link graph
});

test('thread on a qa board (travel) emits QAPage instead of DiscussionForumPosting', async () => {
  await seed();
  const paris = (await forum.board('travel/paris', { sort: 'new' }))[0];
  const res = await req('/t/' + paris.id);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /"QAPage"/);
  assert.match(res.body, /"Question"/);
  assert.doesNotMatch(res.body, /"DiscussionForumPosting"/);
});

test('review/classified boards are Phase-2 stubs: 200, noindex, breadcrumbed, no capture UI', async () => {
  const rev = await req('/b/reviews');
  assert.equal(rev.statusCode, 200);
  assert.match(rev.body, /Phase 2/);
  assert.match(rev.body, /name="robots" content="noindex/);
  assert.match(rev.body, /"BreadcrumbList"/);

  const cls = await req('/b/classifieds/for-sale');
  assert.equal(cls.statusCode, 200);
  assert.match(cls.body, /Phase 2/);
  assert.match(cls.body, /name="robots" content="noindex/);
});

test('sharded sitemap: /sitemap-index.xml is an index referencing board + thread shards', async () => {
  const res = await req('/sitemap-index.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /xml/);
  assert.match(res.body, /<sitemapindex/);
  assert.match(res.body, /sitemap-boards\.xml/);
  assert.match(res.body, /sitemap-threads-0\.xml/);
});

test('/sitemap-boards.xml lists boards + categories + seeded programmatic boards', async () => {
  const res = await req('/sitemap-boards.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<urlset/);
  assert.match(res.body, /\/b\/crypto\/bitcoin/);
  assert.match(res.body, /\/c\/crypto/);
  assert.match(res.body, /\/b\/city\/austin-tx/);   // a seeded programmatic board
});

test('/sitemap-threads-0.xml lists thread URLs; out-of-range shard is an empty urlset', async () => {
  const res = await req('/sitemap-threads-0.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /<urlset/);
  assert.match(res.body, /\/t\//);
  const far = await req('/sitemap-threads-99.xml');
  assert.equal(far.statusCode, 200);
  assert.match(far.body, /<urlset/);
  assert.doesNotMatch(far.body, /\/t\//);
});

test('hostile <script> in a thread title is escaped end-to-end (no raw script)', async () => {
  await seed();
  // prime an author with merit so it can post, then create a thread with a hostile title.
  await forum.grantAllotment('xsser-sponsor', { now: Date.parse('2026-08-01T00:00:00Z') });
  await forum.merit.sendMerit('xsser-sponsor', 'xsser', 1, { now: Date.parse('2026-08-01T00:00:00Z') });
  const evil = '<script>alert(1)</script>';
  const t = await forum.createThread({ board: 'general', author: 'xsser', title: evil, body: `body ${evil}`, now: Date.now() });
  assert.equal(t.ok, true);
  const res = await req('/t/' + t.thread.id);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /<script>alert\(1\)<\/script>/);
  assert.match(res.body, /&lt;script&gt;/);
});

test('hostile board/category params never 500 and never reflect raw script', async () => {
  const a = await req('/b/' + encodeURIComponent('<script>alert(2)</script>'));
  assert.ok(a.statusCode === 200 || a.statusCode === 302);
  if (a.body) assert.doesNotMatch(a.body, /<script>alert\(2\)<\/script>/);
  const b = await req('/c/' + encodeURIComponent('"><script>alert(3)</script>'));
  assert.ok(b.statusCode === 200 || b.statusCode === 302);
  if (b.body) assert.doesNotMatch(b.body, /<script>alert\(3\)<\/script>/);
});

test('/health still returns ok; unknown board redirects home', async () => {
  const h = await req('/health');
  assert.equal(h.body, 'ok');
  const u = await req('/b/nope/foo');
  assert.equal(u.statusCode, 302);
  assert.equal(u.headers.location, '/');
});

test('exported categoryPage/boardPage/threadPage builders return full HTML or null', async () => {
  await seed();
  assert.match(categoryPage('crypto'), /<\/html>/);
  assert.equal(categoryPage('nope'), null);
  const bv = await boardPage('city/austin-tx');
  assert.match(bv.html, /<\/html>/);
  assert.equal(await boardPage('nope/foo'), null);
  const city = (await forum.board('city/austin-tx', { sort: 'new' }))[0];
  assert.match(await threadPage(city.id), /<\/html>/);
  assert.equal(await threadPage('ghost'), null);
});

test('handler never throws on malformed mega-forum URLs', async () => {
  for (const p of ['/c/%%%', '/b/%E0%A4%A', '/sitemap-threads-x.xml', '/t/%%%bad', '/c/', '/b/']) {
    const res = mockRes();
    await assert.doesNotReject(async () => handler({ url: p, method: 'GET', headers: {} }, res));
    assert.ok(res.statusCode >= 200);
  }
});
