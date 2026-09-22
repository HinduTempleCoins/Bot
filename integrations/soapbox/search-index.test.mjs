// search-index.test.mjs — offline tests for the all-internals search index. No network: a fake fetch
// returns fixture sitemaps per surface. Proves: surfaces are derived (not hand-maintained), sitemaps
// aggregate into docs, a sitemap-index is followed, off-network URLs are rejected, search scores +
// scopes, the home URL seeds even with no sitemap, and the cached index single-flights + refreshes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  internalSurfaces, INTERNAL_SURFACES, buildIndex, searchIndex, getIndex, clearIndexCache,
  startAutoRefresh, titleFromUrl, surfaceKey, isOurHost, __setFetch,
} from './search-index.mjs';

// ── a fake network: map a sitemap URL → its XML body ──────────────────────────────────────────────
function fakeFetch(map) {
  return async (url) => {
    const body = map[String(url)];
    if (body == null) return { ok: false, status: 404, async text() { return ''; } };
    return { ok: true, status: 200, async text() { return body; } };
  };
}
const urlset = (...paths) => `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>${p}</loc><lastmod>2026-09-01</lastmod></url>`).join('')}</urlset>`;

test('internalSurfaces derives from the registries and includes law + wiki (our hosts only)', () => {
  const surfaces = internalSurfaces();
  assert.ok(surfaces.length >= 8, 'expected many surfaces');
  const keys = surfaces.map((s) => s.surface);
  assert.ok(keys.includes('law'), 'law surface present');
  assert.ok(keys.includes('wiki'), 'wiki surface present');
  // every surface is one of our hosts — admin (soapy.blog) can never appear
  for (const s of surfaces) assert.ok(isOurHost(s.host), `${s.host} is our host`);
  assert.ok(!surfaces.some((s) => /soapy\.blog/.test(s.host)), 'admin host excluded');
  assert.ok(INTERNAL_SURFACES.length >= 1, 'eager snapshot populated');
});

test('titleFromUrl / surfaceKey derive readable metadata', () => {
  assert.equal(titleFromUrl('https://law.soapbox.community/privacy'), 'Privacy');
  assert.equal(titleFromUrl('https://law.soapbox.community/us/cases'), 'Cases');
  assert.equal(titleFromUrl('https://law.soapbox.community/'), '');
  assert.equal(surfaceKey('law.soapbox.community'), 'law');
  assert.equal(surfaceKey('melek.salon'), 'melek');
});

test('buildIndex aggregates per-surface sitemaps into one flat index', async () => {
  __setFetch(fakeFetch({
    'https://law.soapbox.community/sitemap.xml': urlset(
      'https://law.soapbox.community/privacy',
      'https://law.soapbox.community/rights',
      'https://law.soapbox.community/constitution',
    ),
    'https://wiki.soapbox.community/sitemap.xml': urlset(
      'https://wiki.soapbox.community/what-is-a-blockchain',
    ),
  }));
  const surfaces = [
    { base: 'https://law.soapbox.community', host: 'law.soapbox.community', surface: 'law', label: 'Law', live: true },
    { base: 'https://wiki.soapbox.community', host: 'wiki.soapbox.community', surface: 'wiki', label: 'Wiki', live: true },
  ];
  const index = await buildIndex({ surfaces });
  const urls = index.docs.map((d) => d.url);
  assert.ok(urls.includes('https://law.soapbox.community/privacy'));
  assert.ok(urls.includes('https://law.soapbox.community/rights'));
  assert.ok(urls.includes('https://wiki.soapbox.community/what-is-a-blockchain'));
  // homes are seeded too
  assert.ok(urls.includes('https://law.soapbox.community'));
  assert.equal(index.surfaces, 2);
  __setFetch(null);
});

test('a sitemap-INDEX is followed one level into its child sitemaps', async () => {
  __setFetch(fakeFetch({
    'https://data.soapbox.community/sitemap.xml':
      `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://data.soapbox.community/sitemap-coins.xml</loc></sitemap></sitemapindex>`,
    'https://data.soapbox.community/sitemap-coins.xml': urlset(
      'https://data.soapbox.community/coin/bitcoin',
      'https://data.soapbox.community/coin/ethereum',
    ),
  }));
  const index = await buildIndex({ surfaces: [
    { base: 'https://data.soapbox.community', host: 'data.soapbox.community', surface: 'data', label: 'Data', live: true },
  ] });
  const urls = index.docs.map((d) => d.url);
  assert.ok(urls.includes('https://data.soapbox.community/coin/bitcoin'));
  assert.ok(urls.includes('https://data.soapbox.community/coin/ethereum'));
  __setFetch(null);
});

test('off-network URLs listed in a sitemap are never indexed', async () => {
  __setFetch(fakeFetch({
    'https://law.soapbox.community/sitemap.xml': urlset(
      'https://law.soapbox.community/privacy',
      'https://evil.example.com/inject',      // must be dropped
      'https://soapy.blog/admin',              // admin must be dropped
    ),
  }));
  const index = await buildIndex({ surfaces: [
    { base: 'https://law.soapbox.community', host: 'law.soapbox.community', surface: 'law', label: 'Law', live: true },
  ] });
  const urls = index.docs.map((d) => d.url);
  assert.ok(urls.includes('https://law.soapbox.community/privacy'));
  assert.ok(!urls.some((u) => /evil\.example\.com/.test(u)), 'off-network url dropped');
  assert.ok(!urls.some((u) => /soapy\.blog/.test(u)), 'admin url dropped');
  __setFetch(null);
});

test('a surface with no reachable sitemap still contributes its home (findable by name)', async () => {
  __setFetch(fakeFetch({}));            // every fetch 404s
  const index = await buildIndex({ surfaces: [
    { base: 'https://stocks.soapbox.community', host: 'stocks.soapbox.community', surface: 'stocks', label: 'Stocks', live: true },
  ] });
  assert.equal(index.docs.length, 1);
  assert.equal(index.docs[0].url, 'https://stocks.soapbox.community');
  __setFetch(null);
});

test('searchIndex scores by term overlap and returns the right pages', async () => {
  __setFetch(fakeFetch({
    'https://law.soapbox.community/sitemap.xml': urlset(
      'https://law.soapbox.community/privacy',
      'https://law.soapbox.community/rights',
      'https://law.soapbox.community/treaties',
    ),
    'https://wiki.soapbox.community/sitemap.xml': urlset('https://wiki.soapbox.community/privacy-tools'),
  }));
  const index = await buildIndex({ surfaces: [
    { base: 'https://law.soapbox.community', host: 'law.soapbox.community', surface: 'law', label: 'Law', live: true },
    { base: 'https://wiki.soapbox.community', host: 'wiki.soapbox.community', surface: 'wiki', label: 'Wiki', live: true },
  ] });
  const hits = searchIndex(index, 'privacy', { k: 5 });
  assert.ok(hits.length >= 2);
  assert.ok(hits.some((h) => h.url === 'https://law.soapbox.community/privacy'));
  assert.ok(hits.every((h) => h.score > 0));
  // a nonsense query returns nothing
  assert.equal(searchIndex(index, 'zzznotathing', { k: 5 }).length, 0);
  __setFetch(null);
});

test('scope narrows to one surface (the "our legal corpus" doorway)', async () => {
  __setFetch(fakeFetch({
    'https://law.soapbox.community/sitemap.xml': urlset('https://law.soapbox.community/privacy'),
    'https://wiki.soapbox.community/sitemap.xml': urlset('https://wiki.soapbox.community/privacy-tools'),
  }));
  const index = await buildIndex({ surfaces: [
    { base: 'https://law.soapbox.community', host: 'law.soapbox.community', surface: 'law', label: 'Law', live: true },
    { base: 'https://wiki.soapbox.community', host: 'wiki.soapbox.community', surface: 'wiki', label: 'Wiki', live: true },
  ] });
  const scoped = searchIndex(index, 'privacy', { k: 5, scope: 'law' });
  assert.ok(scoped.length >= 1);
  assert.ok(scoped.every((h) => h.surface === 'law'), 'only law surface returned');
  // empty query + scope = browse that surface
  const browse = searchIndex(index, '', { k: 5, scope: 'law' });
  assert.ok(browse.length >= 1 && browse.every((h) => h.surface === 'law'));
  __setFetch(null);
});

test('getIndex caches, single-flights, and refreshes on force', async () => {
  clearIndexCache();
  let builds = 0;
  __setFetch(async (url) => {
    if (String(url).endsWith('/sitemap.xml')) builds++;
    return { ok: true, status: 200, async text() { return urlset('https://law.soapbox.community/privacy'); } };
  });
  const a = getIndex({ force: true });
  const b = getIndex();                 // should join the in-flight build, not start another
  const [ia] = await Promise.all([a, b]);
  const buildsAfterFirst = builds;
  assert.ok(ia.docs.length >= 1);
  await getIndex();                     // cached — no new fetches
  assert.equal(builds, buildsAfterFirst, 'cached read did not re-fetch');
  await getIndex({ force: true });      // forced — refetches
  assert.ok(builds > buildsAfterFirst, 'force rebuilt the index');
  clearIndexCache();
  __setFetch(null);
});

test('startAutoRefresh returns a stop() and never throws', async () => {
  clearIndexCache();
  __setFetch(async () => ({ ok: true, status: 200, async text() { return urlset('https://law.soapbox.community/privacy'); } }));
  const stop = startAutoRefresh({ intervalMs: 60_000, immediate: true });
  assert.equal(typeof stop, 'function');
  stop();
  clearIndexCache();
  __setFetch(null);
});
