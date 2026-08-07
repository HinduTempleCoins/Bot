import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSitemap, fetchPostUrls, __setFetch } from './melek-sitemap.mjs';

test('buildSitemap emits valid urlset, dedupes, escapes', () => {
  const xml = buildSitemap([
    { loc: 'https://melek.salon/', priority: '1.0' },
    { loc: 'https://melek.salon/@a/p', lastmod: '2026-08-01' },
    { loc: 'https://melek.salon/@a/p' },                 // dup
    { loc: 'https://melek.salon/@b/x?q=1&y' },           // needs escaping
  ]);
  assert.match(xml, /^<\?xml/);
  assert.match(xml, /<urlset/);
  assert.equal((xml.match(/<loc>/g) || []).length, 3);   // dup removed
  assert.match(xml, /q=1&amp;y/);
  assert.match(xml, /<lastmod>2026-08-01<\/lastmod>/);
});

test('fetchPostUrls builds @author/permlink URLs, soft-fails on bad fetch', async () => {
  __setFetch(async () => ({ json: async () => ({ result: [{ author: 'hathor', permlink: 'hi', created: '2026-08-07T00:00:00' }] }) }));
  const urls = await fetchPostUrls({ perTag: 5 });
  assert.ok(urls.some((u) => u.loc === 'https://melek.salon/@hathor/hi'));
  __setFetch(async () => { throw new Error('down'); });
  assert.deepEqual(await fetchPostUrls({}), []);
  __setFetch(null);
});
