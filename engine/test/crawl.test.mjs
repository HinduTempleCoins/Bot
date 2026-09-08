// crawl.test.mjs — engine.alpha.melek.salon served neither robots.txt nor sitemap.xml (both 404 on
// 2026-09-08), so the four HTML pages the engine serves were undiscoverable. This drives the REAL
// makeHandler() through crawl-audit.mjs — the same grader that found the fault — entirely in-process.
//
// Run: node --test engine/test/crawl.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { makeHandler, SITEMAP_PATHS } from '../api/server.mjs';
import { auditHost, __setFetch } from '../../integrations/crawl-audit.mjs';

const HOST = 'engine.alpha.melek.salon';

function freshHandler() {
  const s = new State(null); // in-memory, no file
  bootstrapGenesis(s);
  return makeHandler(s);
}

function call(fn, path) {
  return new Promise((resolve) => {
    const res = {
      code: 0, hdrs: {}, body: '',
      writeHead(c, h) { this.code = c; this.hdrs = h || {}; return this; },
      end(b) { this.body = b == null ? '' : String(b); resolve({ status: this.code || 200, hdrs: this.hdrs, body: this.body }); },
    };
    fn({ url: path, method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res);
  });
}

test('the engine host grades ok — robots.txt, a Sitemap: line, and a real urlset behind it', async () => {
  const fn = freshHandler();
  __setFetch(async (url) => {
    const u = new URL(String(url));
    assert.equal(u.host, HOST, 'offline: only the engine host is mapped');
    const r = await call(fn, u.pathname + u.search);
    return { status: r.status, headers: { get: (k) => r.hdrs[k] || '' }, async text() { return r.body; } };
  });
  const a = await auditHost(HOST);
  __setFetch(null);
  assert.equal(a.verdict, 'ok', a.problems.join('; '));
  assert.equal(a.sitemapOk, true);
  assert.equal(a.urlCount, SITEMAP_PATHS.length);
  assert.deepEqual(a.sitemapsDeclared, [`https://${HOST}/sitemap.xml`]);
});

test('robots.txt is text/plain and welcomes the named crawlers', async () => {
  const r = await call(freshHandler(), '/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.hdrs['content-type'], /text\/plain/);
  for (const ua of ['Googlebot', 'Bingbot', 'YandexBot', 'GPTBot', 'ClaudeBot']) {
    assert.ok(r.body.includes(`User-agent: ${ua}`), `${ua} not welcomed`);
  }
});

test('the sitemap lists the HTML pages the engine actually serves, and nothing else', async () => {
  const fn = freshHandler();
  const r = await call(fn, '/sitemap.xml');
  assert.equal(r.status, 200);
  assert.match(r.hdrs['content-type'], /application\/xml/);
  assert.match(r.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(r.body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(r.body, /<\/urlset>\s*$/);
  for (const p of SITEMAP_PATHS) {
    const page = await call(fn, p);
    assert.equal(page.status, 200, `${p} is sitemapped but answers ${page.status}`);
    assert.match(page.hdrs['content-type'], /text\/html/, `${p} is sitemapped but is not an HTML page`);
    assert.ok(r.body.includes(`<loc>https://${HOST}${p}</loc>`), `missing ${p}`);
  }
  assert.ok(!/\/contracts\//.test(r.body), 'JSON contract endpoints are not pages');
});
