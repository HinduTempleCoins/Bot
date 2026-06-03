// server.test.mjs — offline tests for the SoapBox search server's quality-layer wiring (task: wire
// search-ranking). Proves: rankHybrid reorders raw rows by quality, ranking soft-fails to the unranked
// input on bad/empty data, the facet line summarizes a result set, and the existing HTTP routes still
// serve. No network: applyRanking/facetLine are pure over fixtures, and the handler is driven through a
// mock req/res so no port is bound and the search paths are never exercised against a live query.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyRanking, facetLine, resultRow, handler } from './server.mjs';

// A tiny mock ServerResponse capturing status, headers and the body string.
function mockRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });

async function drive(urlPath, method = 'GET') {
  const res = mockRes();
  await handler(req(urlPath, method), res);
  return res;
}

// ── ranked order is applied ─────────────────────────────────────────────────────────────────────
test('applyRanking reorders rows by quality (ecosystem/scholarly up, clickbait down)', async () => {
  const q = 'alexander shulgin pihkal';
  // Deliberately put the strongest source (our ecosystem) last and clickbait first in INPUT order.
  const raw = [
    { title: 'Top 10 Shulgin Facts You Won\'t Believe', url: 'https://listverse.com/shulgin', snippet: 'clickbait', providers: ['duckduckgo'] },
    { title: 'Random blog', url: 'https://someblog.example/post', snippet: 'a post', providers: ['marginalia'] },
    { title: 'Alexander Shulgin', url: 'https://en.wikipedia.org/wiki/Alexander_Shulgin', snippet: 'chemist, author of PiHKAL', providers: ['wikipedia', 'duckduckgo'] },
    { title: 'Shulgin on the MELEK Library', url: 'https://wiki.soapbox.community/shulgin', snippet: 'our corpus entry on Alexander Shulgin and PiHKAL', providers: ['wikipedia'] },
  ];
  const ranked = await applyRanking(raw, q);
  assert.equal(ranked.length, raw.length, 'no rows dropped');

  // the clickbait listicle must NOT be first anymore.
  assert.notEqual(ranked[0].url, 'https://listverse.com/shulgin');
  // our ecosystem + authoritative wikipedia should outrank the clickbait + the bare blog.
  const pos = (u) => ranked.findIndex((r) => r.url.replace(/\/$/, '') === u);
  const eco = ranked.findIndex((r) => /soapbox\.community/.test(r.url));
  const wiki = ranked.findIndex((r) => /wikipedia\.org/.test(r.url));
  const click = ranked.findIndex((r) => /listverse/.test(r.url));
  assert.ok(eco >= 0 && wiki >= 0 && click >= 0, 'all three present');
  assert.ok(eco < click, 'ecosystem ranks above clickbait');
  assert.ok(wiki < click, 'authoritative wikipedia ranks above clickbait');
  // rows carry the explainable signals from the quality layer.
  assert.ok('hybridScore' in ranked[0], 'hybrid fusion score attached');
  assert.ok(Array.isArray(ranked[0].reasons), 'explainable reasons attached');
});

test('applyRanking preserves the tag badge through the reorder', async () => {
  const raw = [
    { title: 'Hive', url: 'https://hive.blog/topic', snippet: 'chain', tag: 'Directory' },
    { title: 'MELEK Library: topic', url: 'https://wiki.soapbox.community/topic', snippet: 'our corpus on topic', tag: 'Library' },
  ];
  const ranked = await applyRanking(raw, 'topic');
  // ecosystem Library should come first, and its tag must have survived rankHybrid (which drops `tag`).
  assert.equal(ranked[0].tag, 'Library');
  assert.ok(ranked.every((r) => r.tag), 'every row kept its tag');
});

// ── soft-fail on bad / empty input ───────────────────────────────────────────────────────────────
test('applyRanking soft-fails: empty input returns empty, never throws', async () => {
  assert.deepEqual(await applyRanking([], 'q'), []);
  assert.deepEqual(await applyRanking(null, 'q'), []);
  assert.deepEqual(await applyRanking(undefined, 'q'), []);
});

test('applyRanking soft-fails: malformed rows fall back to the original input', async () => {
  // rows with no url / non-object members would dedupe to nothing; the wrapper must hand back the
  // original list rather than an empty page.
  const junk = [{ nope: 1 }, 'not-an-object', null];
  const out = await applyRanking(junk, 'q');
  assert.equal(out, junk, 'returns the SAME array reference on a no-op rank (soft-fail)');
});

test('resultRow renders ranked rows (providers badge + snippet)', () => {
  const html = resultRow({ title: 'T', url: 'https://x.example/a', snippet: 'S', providers: ['a', 'b'] });
  assert.match(html, /href="https:\/\/x\.example\/a"/);
  assert.match(html, /a\+b/);    // providers badge
  assert.match(html, />S</);     // snippet
});

// ── facets ────────────────────────────────────────────────────────────────────────────────────────
test('facetLine summarizes provider/host/category counts', () => {
  const rows = [
    { title: 'A', url: 'https://en.wikipedia.org/wiki/A', snippet: 's', providers: ['wikipedia', 'duckduckgo'] },
    { title: 'B', url: 'https://wiki.soapbox.community/b', snippet: 's', providers: ['wikipedia'] },
    { title: 'C', url: 'https://doi.org/10.1/x', snippet: 's', providers: ['crossref'] },
  ];
  const line = facetLine(rows);
  assert.match(line, /wikipedia/);     // provider counts present
  assert.match(line, /host/);          // host count present
  assert.match(line, /ecosystem/);     // soapbox.community counted as ecosystem
  assert.match(line, /scholarly/);     // crossref counted as scholarly
});

test('facetLine soft-fails to empty string on empty/garbage input', () => {
  assert.equal(facetLine([]), '');
  assert.equal(facetLine(null), '');
  assert.equal(facetLine([{ nope: 1 }]), '');
});

// ── existing routes still serve ─────────────────────────────────────────────────────────────────
test('GET /health serves ok', async () => {
  const res = await drive('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('GET /robots.txt serves a robots body', async () => {
  const res = await drive('/robots.txt');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.ok(res.body.length > 0);
});

test('GET /sitemap.xml serves an XML urlset', async () => {
  const res = await drive('/sitemap.xml');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/xml/);
  assert.match(res.body, /<urlset/);
});

test('GET / (no query) serves the search hero, 200', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /SoapBox/);
  assert.match(res.body, /<form/);
});

test('unknown path redirects to /', async () => {
  const res = await drive('/whatever');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('GET /api/translate returns JSON (translate soft-fails offline to passthrough)', async () => {
  const res = await drive('/api/translate?text=hello&to=es');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.equal(j.to, 'es');
  assert.equal(typeof j.translated, 'string');
});
