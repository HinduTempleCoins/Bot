// seo-crawler-exclusion.test.js — the cross-cutting crawler-SEO additions: admin-disallow robots,
// sitemap + sitemap-index validity + admin-absence, llms.txt (no admin), the new structured-data
// head helpers (shape + escaping), and the IndexNow admin-URL backstop. All offline, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// throwaway IndexNow key file so importing crawlers.mjs never touches the real one.
process.env.INDEXNOW_KEY_FILE = join(tmpdir(), `indexnow-key-seoexcl-${process.pid}.txt`);
delete process.env.INDEXNOW_KEY;

const {
  robotsTxtDisallowAll, sitemapXml, sitemapIndexXml, publicSitemapIndexXml,
  PUBLIC_SITES, llmsTxt, submitIndexNow, _adminGuard,
} = await import('./crawlers.mjs');
const {
  breadcrumbJsonLd, datasetJsonLd, articleJsonLd, productAggregateOfferJsonLd, jsonLdScript,
} = await import('./seo.mjs');

const ADMIN = 'https://soapy.blog';
const DATA = 'https://data.soapbox.community';

// ── robots: admin blocks everything, never advertises a sitemap ──────────────────────────────────
test('robotsTxtDisallowAll blocks every crawler and advertises no sitemap', () => {
  const txt = robotsTxtDisallowAll();
  assert.match(txt, /User-agent:\s*\*/);
  assert.match(txt, /Disallow:\s*\//);
  assert.ok(!/Allow:\s*\//.test(txt), 'must not Allow anything');
  assert.ok(!/Sitemap:/i.test(txt), 'must not advertise a sitemap');
});

// ── sitemap validity + admin absence ─────────────────────────────────────────────────────────────
test('sitemapXml emits a valid urlset with resolved, escaped locs', () => {
  const xml = sitemapXml(DATA, [
    '/',
    { path: '/coins/btc', lastmod: '2026-06-04', changefreq: 'daily', priority: '0.8' },
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/data\.soapbox\.community\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/data\.soapbox\.community\/coins\/btc<\/loc>/);
  assert.match(xml, /<lastmod>2026-06-04<\/lastmod>/);
  assert.match(xml, /<\/urlset>\s*$/);
});

test('sitemapXml drops any admin URL even if a caller passes one (backstop)', () => {
  const xml = sitemapXml(DATA, ['/', `${ADMIN}/`, `${ADMIN}/connect`, 'https://admin.soapy.blog/x']);
  assert.ok(!/soapy\.blog/.test(xml), 'no admin host may appear in a sitemap');
  assert.match(xml, /<loc>https:\/\/data\.soapbox\.community\/<\/loc>/);
});

test('sitemapXml escapes special characters in a loc', () => {
  const xml = sitemapXml(DATA, ['/search?q=a&b=<c>']);
  assert.ok(!/[^&]&[^a]/.test(xml.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, '')), 'raw & should be encoded');
  assert.match(xml, /&amp;/);
  assert.ok(!/<c>/.test(xml), 'raw angle brackets must be escaped');
});

// ── sitemap-index: links per-site sitemaps, admin never present ───────────────────────────────────
test('sitemapIndexXml emits a valid sitemapindex and excludes admin', () => {
  const xml = sitemapIndexXml([DATA, { url: 'https://law.soapbox.community', lastmod: '2026-06-04' }, ADMIN]);
  assert.match(xml, /<sitemapindex xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(xml, /<loc>https:\/\/data\.soapbox\.community\/sitemap\.xml<\/loc>/);
  assert.match(xml, /<loc>https:\/\/law\.soapbox\.community\/sitemap\.xml<\/loc>/);
  assert.ok(!/soapy\.blog/.test(xml), 'admin must never be in the sitemap-index');
});

test('publicSitemapIndexXml lists every public site and never soapy.blog', () => {
  const xml = publicSitemapIndexXml('2026-06-04');
  for (const s of PUBLIC_SITES) assert.match(xml, new RegExp(`<loc>${s.url}/sitemap\\.xml</loc>`));
  assert.ok(!/soapy\.blog/.test(xml));
  assert.ok(!PUBLIC_SITES.some((s) => /soapy\.blog/.test(s.url)), 'PUBLIC_SITES must not contain the admin');
});

// ── llms.txt: public index, never references the admin ───────────────────────────────────────────
test('llmsTxt produces a markdown index and drops admin links', () => {
  const txt = llmsTxt({
    name: 'SoapBox Data', baseUrl: DATA, summary: 'crypto data',
    links: [{ label: 'Home', path: '/' }, { label: 'Admin', url: `${ADMIN}/` }],
  });
  assert.match(txt, /^# SoapBox Data/);
  assert.match(txt, /> crypto data/);
  assert.match(txt, /\[Home\]\(https:\/\/data\.soapbox\.community\/\)/);
  assert.ok(!/soapy\.blog/.test(txt), 'llms.txt must never advertise the admin');
});

// ── the admin-URL guard itself ───────────────────────────────────────────────────────────────────
test('isAdminUrl recognizes soapy.blog and subdomains, not the public sites', () => {
  assert.equal(_adminGuard.isAdminUrl('https://soapy.blog/'), true);
  assert.equal(_adminGuard.isAdminUrl('https://admin.soapy.blog/x'), true);
  assert.equal(_adminGuard.isAdminUrl('https://data.soapbox.community/'), false);
  assert.equal(_adminGuard.isAdminUrl('not a url'), false);
});

// ── IndexNow never submits an admin URL ──────────────────────────────────────────────────────────
test('submitIndexNow for a public host never carries an admin URL in the payload', async () => {
  const out = await submitIndexNow(DATA, ['/', '/coins/btc'], { dryRun: true });
  assert.ok(out.ok && out.dryRun);
  assert.equal(out.body.host, 'data.soapbox.community');
  assert.ok(!out.body.urlList.some((u) => /soapy\.blog/.test(u)), 'no admin URL in the IndexNow batch');
  assert.ok(!/soapy\.blog/.test(out.body.host), 'IndexNow host must never be the admin');
});

// ── structured data: shape + JSON-safe escaping ──────────────────────────────────────────────────
test('breadcrumbJsonLd builds an ordered ItemList', () => {
  const o = breadcrumbJsonLd([
    { name: 'SoapBox', url: DATA }, { name: 'Coins', url: `${DATA}/coins` }, { name: 'BTC', url: `${DATA}/coins/btc` },
  ]);
  assert.equal(o['@type'], 'BreadcrumbList');
  assert.equal(o.itemListElement.length, 3);
  assert.deepEqual(o.itemListElement.map((i) => i.position), [1, 2, 3]);
  assert.equal(o.itemListElement[2].name, 'BTC');
});

test('breadcrumbJsonLd returns null for an empty trail', () => {
  assert.equal(breadcrumbJsonLd([]), null);
});

test('datasetJsonLd emits a Dataset with variableMeasured PropertyValues', () => {
  const o = datasetJsonLd({
    name: 'Markets', description: 'live prices', url: DATA,
    keywords: ['crypto'], variableMeasured: [{ name: 'Price', unitText: 'USD' }],
  });
  assert.equal(o['@type'], 'Dataset');
  assert.equal(o.variableMeasured[0]['@type'], 'PropertyValue');
  assert.equal(o.variableMeasured[0].unitText, 'USD');
});

test('articleJsonLd emits an Article with the publisher reference', () => {
  const o = articleJsonLd({ headline: 'Hi', description: 'd', url: `${DATA}/x`, datePublished: '2026-06-04' });
  assert.equal(o['@type'], 'Article');
  assert.ok(o.publisher['@id']);
  assert.equal(o.datePublished, '2026-06-04');
});

test('productAggregateOfferJsonLd only emits offers when honest data is present', () => {
  const withOffers = productAggregateOfferJsonLd({
    name: 'Flower', url: `${DATA}/flower`, offers: { count: 5, lowPrice: 10, highPrice: 40 },
  });
  assert.equal(withOffers.offers['@type'], 'AggregateOffer');
  assert.equal(withOffers.offers.offerCount, 5);
  const noOffers = productAggregateOfferJsonLd({ name: 'Flower', url: `${DATA}/flower`, offers: { count: 0 } });
  assert.equal(noOffers.offers, undefined, 'no offers block without real aggregate data');
});

test('jsonLdScript neutralizes a </script> break-out attempt', () => {
  const s = jsonLdScript(articleJsonLd({ headline: '</script><script>alert(1)</script>', description: 'x', url: DATA }));
  assert.ok(!s.includes('</script><script>alert'), 'must not let a name break out of the script tag');
  assert.match(s, /<script type="application\/ld\+json">/);
});
