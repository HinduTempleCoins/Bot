// seo.test.mjs — the pool frontend is STATIC, so its robots.txt and sitemap.xml are files on disk.
// The one way that goes wrong is drift: someone edits seo.mjs and forgets to regenerate, or edits a
// file by hand and the next `--write` silently reverts it. So the test that matters is that the
// COMMITTED files still equal the generator's output.
//
// Run: node --test pool/www/seo.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BASE_URL, PAGES, poolRobotsTxt, poolSitemapXml, handler } from './seo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => { try { return readFileSync(join(HERE, f), 'utf8'); } catch { return ''; } };

test('the committed robots.txt is exactly what the generator produces', () => {
  assert.equal(read('robots.txt'), poolRobotsTxt(), 'run: node pool/www/seo.mjs --write');
});

test('the committed sitemap.xml is exactly what the generator produces', () => {
  assert.equal(read('sitemap.xml'), poolSitemapXml(), 'run: node pool/www/seo.mjs --write');
});

test('robots.txt points at an absolute Sitemap: on this host', () => {
  const r = poolRobotsTxt();
  assert.ok(r.includes(`Sitemap: ${BASE_URL}/sitemap.xml`));
  assert.ok(!/Disallow: \/\s*$/m.test(r), 'the pool must stay crawlable');
});

test('sitemap.xml is a well-formed urlset over the pages that exist', () => {
  const x = poolSitemapXml(BASE_URL, '2026-09-08');
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(x, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(x, /<\/urlset>\s*$/);
  assert.equal((x.match(/<url>/g) || []).length, (x.match(/<\/url>/g) || []).length);
  assert.equal((x.match(/<loc>/g) || []).length, PAGES.length);
  for (const p of PAGES) assert.ok(x.includes(`<loc>${BASE_URL}${p.path}</loc>`), `missing ${p.path}`);
  assert.ok(x.includes('<lastmod>2026-09-08</lastmod>'));
  // every loc must be absolute — a relative loc is invalid per the sitemaps spec
  for (const m of x.matchAll(/<loc>([^<]*)<\/loc>/g)) assert.match(m[1], /^https:\/\//);
});

test('the pages listed are the static files that are actually deployed', () => {
  // pool/www/index.html, mycoins.html and wallet/index.html are what the rsync ships.
  assert.deepEqual(PAGES.map((p) => p.path).sort(), ['/', '/mycoins.html', '/wallet/']);
  for (const f of ['index.html', 'mycoins.html', 'wallet/index.html']) {
    assert.ok(read(f).length > 0, `${f} is sitemapped but missing from pool/www`);
  }
});

test('handler(req,res) serves both documents with the right content types', async () => {
  const call = (url) => new Promise((resolve) => {
    const res = { code: 0, hdrs: {}, writeHead(c, h) { this.code = c; this.hdrs = h; }, end(b) { resolve({ code: this.code, hdrs: this.hdrs, body: b || '' }); } };
    handler({ url }, res);
  });
  const r = await call('/robots.txt');
  assert.equal(r.code, 200);
  assert.match(r.hdrs['content-type'], /text\/plain/);
  const s = await call('/sitemap.xml');
  assert.equal(s.code, 200);
  assert.match(s.hdrs['content-type'], /application\/xml/);
  assert.match(s.body, /<urlset/);
  assert.equal((await call('/nope')).code, 404);
});
