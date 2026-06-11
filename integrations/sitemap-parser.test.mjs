// integrations/sitemap-parser.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSitemap,
  parseSitemapIndex,
  filterByDate,
  sortByPriority,
  toFrontier,
  fetchSitemap,
  __setFetch,
} from './sitemap-parser.mjs';

afterEach(() => __setFetch(null));

const WELL_FORMED = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/a?x=1&amp;y=2</loc>
    <lastmod>2026-01-10</lastmod>
    <changefreq>Daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc><![CDATA[https://example.com/b]]></loc>
    <lastmod>2026-03-01T12:00:00+00:00</lastmod>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>https://blog.example.com/c</loc>
  </url>
</urlset>`;

test('parseSitemap: well-formed, with entity + CDATA + priority defaulting', () => {
  const e = parseSitemap(WELL_FORMED);
  assert.equal(e.length, 3);
  assert.equal(e[0].loc, 'https://example.com/a?x=1&y=2');
  assert.equal(e[0].changefreq, 'daily'); // lowercased
  assert.equal(e[0].priority, 0.8);
  assert.equal(e[1].loc, 'https://example.com/b'); // CDATA unwrapped
  assert.equal(e[2].priority, 0.5); // default
  assert.equal(e[2].lastmod, null);
});

test('parseSitemap: malformed entries are dropped, never throws', () => {
  const xml = `<urlset>
    <url><lastmod>2026-01-01</lastmod></url>            <!-- no loc -->
    <url><loc>/relative/path</loc></url>                <!-- relative -->
    <url><loc>ftp://example.com/x</loc></url>           <!-- non-http -->
    <url><loc>   </loc></url>                            <!-- blank -->
    <url><loc>https://ok.example.com/keep</loc></url>
  </urlset>`;
  const e = parseSitemap(xml);
  assert.equal(e.length, 1);
  assert.equal(e[0].loc, 'https://ok.example.com/keep');
  // junk / empty / non-string inputs soft-fail to []
  assert.deepEqual(parseSitemap('not xml at all'), []);
  assert.deepEqual(parseSitemap(''), []);
  assert.deepEqual(parseSitemap(null), []);
  assert.deepEqual(parseSitemap(42), []);
});

test('parseSitemap: priority clamped into 0..1', () => {
  const xml = `<urlset>
    <url><loc>https://e.com/hi</loc><priority>5</priority></url>
    <url><loc>https://e.com/lo</loc><priority>-3</priority></url>
    <url><loc>https://e.com/nan</loc><priority>abc</priority></url>
  </urlset>`;
  const e = parseSitemap(xml);
  assert.equal(e[0].priority, 1);
  assert.equal(e[1].priority, 0);
  assert.equal(e[2].priority, 0.5);
});

test('parseSitemapIndex: returns deduped child urls, drops malformed', () => {
  const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://example.com/sm1.xml</loc><lastmod>2026-01-01</lastmod></sitemap>
    <sitemap><loc>https://example.com/sm2.xml</loc></sitemap>
    <sitemap><loc>https://example.com/sm1.xml</loc></sitemap>  <!-- dup -->
    <sitemap><loc>/relative.xml</loc></sitemap>                 <!-- bad -->
    <sitemap></sitemap>                                          <!-- empty -->
  </sitemapindex>`;
  const urls = parseSitemapIndex(xml);
  assert.deepEqual(urls, ['https://example.com/sm1.xml', 'https://example.com/sm2.xml']);
  assert.deepEqual(parseSitemapIndex(''), []);
  assert.deepEqual(parseSitemapIndex(undefined), []);
});

test('filterByDate: since/until bounds, undated dropped when filtering', () => {
  const e = parseSitemap(WELL_FORMED); // a=2026-01-10, b=2026-03-01, c=undated
  // no bounds -> passthrough copy
  const all = filterByDate(e);
  assert.equal(all.length, 3);
  assert.notEqual(all, e); // copy, not same array

  const sinceFeb = filterByDate(e, { since: '2026-02-01' });
  assert.deepEqual(sinceFeb.map((x) => x.loc), ['https://example.com/b']);

  const untilFeb = filterByDate(e, { until: new Date('2026-02-01') });
  assert.deepEqual(untilFeb.map((x) => x.loc), ['https://example.com/a?x=1&y=2']);

  const window = filterByDate(e, { since: '2026-01-01', until: '2026-12-31' });
  assert.equal(window.length, 2); // a + b, c undated dropped

  assert.deepEqual(filterByDate(null, { since: '2026-01-01' }), []);
});

test('sortByPriority: high->low, stable for ties, non-mutating', () => {
  const e = [
    { loc: 'https://e.com/1', priority: 0.2 },
    { loc: 'https://e.com/2', priority: 0.9 },
    { loc: 'https://e.com/3', priority: 0.9 },
    { loc: 'https://e.com/4', priority: 0.5 },
  ];
  const sorted = sortByPriority(e);
  assert.deepEqual(sorted.map((x) => x.loc), [
    'https://e.com/2', 'https://e.com/3', 'https://e.com/4', 'https://e.com/1',
  ]);
  // original untouched
  assert.equal(e[0].loc, 'https://e.com/1');
  assert.deepEqual(sortByPriority('nope'), []);
});

test('toFrontier: dedupe + host allowlist (incl. subdomains) + limit + order', () => {
  const e = parseSitemap(WELL_FORMED); // a(.com,0.8) b(.com,0.3) c(blog.,0.5)
  // dedupe: feed a duplicate of a
  const withDup = e.concat([{ loc: 'https://example.com/a?x=1&y=2', priority: 0.99 }]);

  const all = toFrontier(withDup);
  // ordered by priority high->low, deduped to 3 unique locs
  assert.deepEqual(all, [
    'https://example.com/a?x=1&y=2',
    'https://blog.example.com/c',
    'https://example.com/b',
  ]);

  // allowlist of bare host example.com matches example.com AND blog.example.com
  const allowed = toFrontier(withDup, { hostAllowlist: ['example.com'] });
  assert.equal(allowed.length, 3);

  // allowlist excludes everything not under that host
  const none = toFrontier(withDup, { hostAllowlist: ['other.org'] });
  assert.deepEqual(none, []);

  // limit caps the queue length
  const capped = toFrontier(withDup, { limit: 1 });
  assert.deepEqual(capped, ['https://example.com/a?x=1&y=2']);

  assert.deepEqual(toFrontier(null), []);
});

test('fetchSitemap: injected fetch, parses urlset', async () => {
  __setFetch(async () => ({ ok: true, text: async () => WELL_FORMED }));
  const e = await fetchSitemap('https://example.com/sitemap.xml');
  assert.equal(e.length, 3);
  assert.equal(e[0].loc, 'https://example.com/a?x=1&y=2');
});

test('fetchSitemap: detects index and returns child urls as entries', async () => {
  const index = `<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>`;
  __setFetch(async () => ({ ok: true, text: async () => index }));
  const e = await fetchSitemap('https://example.com/sitemap_index.xml');
  assert.equal(e.length, 1);
  assert.equal(e[0].loc, 'https://example.com/child.xml');
  assert.equal(e[0].priority, 0.5);
});

test('fetchSitemap: soft-fails to [] on bad url, !ok, throw, empty body', async () => {
  assert.deepEqual(await fetchSitemap('not-a-url'), []);
  assert.deepEqual(await fetchSitemap(''), []);

  __setFetch(async () => ({ ok: false, text: async () => 'nope' }));
  assert.deepEqual(await fetchSitemap('https://example.com/s.xml'), []);

  __setFetch(async () => { throw new Error('network gone'); });
  assert.deepEqual(await fetchSitemap('https://example.com/s.xml'), []);

  __setFetch(async () => ({ ok: true, text: async () => '' }));
  assert.deepEqual(await fetchSitemap('https://example.com/s.xml'), []);
});
