// self-crawl.test.mjs — OFFLINE house-style tests for integrations/self-crawl.mjs (task #157).
//
// Fully offline: the only network seam is scraper.mjs's fetchClean, which crawlOurSite calls through
// the condenser cache. We inject a fake fetch via scraper's __setFetch and run crawlOurSite with
// { delayMs: 0, fresh: true } — fresh:true bypasses scraper's internal URL cache so each test sees
// its injected response, and delayMs:0 avoids real timers. The pure exports (isPublic, toAnnalRecords
// with write:false, siteStateSummary on an explicit crawl, OUR_PAGES) need no seam at all. No real
// network, no fs writes (write:false everywhere), no keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPublic,
  toAnnalRecords,
  siteStateSummary,
  crawlOurSite,
  OUR_PAGES,
} from './self-crawl.mjs';
import { __setFetch } from './scraper.mjs';

// ── a fake fetch keyed by the (decoded) target URL ────────────────────────────────────────────────
// scraper's fetchClean hits Jina first: `${JINA}${url}` → "https://r.jina.ai/https://data...".
// We answer with markdown when the underlying url matches our table, else a non-ok response (which
// drives the fallback path → also non-ok → source:error).
function fakeFetch(pagesMarkdown) {
  return async (reqUrl) => {
    const u = String(reqUrl);
    // strip the Jina prefix to recover the real page url
    const real = u.replace(/^https:\/\/r\.jina\.ai\//, '');
    const md = pagesMarkdown[real];
    if (md == null) {
      return { ok: false, status: 502, async text() { return ''; } };
    }
    return { ok: true, status: 200, async text() { return md; } };
  };
}

function restoreFetch() { __setFetch(null); }

// ── isPublic ──────────────────────────────────────────────────────────────────────────────────────
test('isPublic: accepts http(s) public urls', () => {
  assert.equal(isPublic('https://data.soapbox.community'), true);
  assert.equal(isPublic('http://wiki.soapbox.community/article'), true);
  assert.equal(isPublic('https://data.soapbox.community/coin/bitcoin'), true);
});

test('isPublic: rejects gated paths (stats/seo/admin/health)', () => {
  assert.equal(isPublic('https://data.soapbox.community/stats'), false);
  assert.equal(isPublic('https://data.soapbox.community/seo/report'), false);
  assert.equal(isPublic('https://x.soapbox.community/admin'), false);
  assert.equal(isPublic('https://x.soapbox.community/health'), false);
  assert.equal(isPublic('https://x.soapbox.community/stats?x=1'), false);
});

test('isPublic: rejects non-http schemes and junk (soft, no throw)', () => {
  assert.equal(isPublic('ftp://data.soapbox.community'), false);
  assert.equal(isPublic('file:///etc/passwd'), false);
  assert.equal(isPublic(''), false);
  assert.equal(isPublic('not a url'), false);
});

// ── OUR_PAGES allow-list ───────────────────────────────────────────────────────────────────────────
test('OUR_PAGES: every entry is public, well-formed, and never gated', () => {
  assert.ok(Array.isArray(OUR_PAGES) && OUR_PAGES.length > 0);
  for (const p of OUR_PAGES) {
    assert.equal(typeof p.url, 'string');
    assert.equal(typeof p.surface, 'string');
    assert.equal(typeof p.kind, 'string');
    assert.equal(isPublic(p.url), true, `${p.url} must be public`);
    assert.match(p.url, /^https:\/\/[a-z]+\.soapbox\.community/);
  }
});

// ── toAnnalRecords (write:false → no fs) ────────────────────────────────────────────────────────────
function sampleCrawl() {
  return {
    crawledAt: '2026-06-10T00:00:00.000Z',
    pageCount: 2,
    okCount: 1,
    pages: [
      {
        url: 'https://data.soapbox.community',
        title: 'Data Home',
        headings: ['Markets', 'Top Coins'],
        wordCount: 120,
        keyPoints: ['Bitcoin $65,000', 'Ethereum $3,200'],
        links: ['https://data.soapbox.community/coin/bitcoin'],
        surface: 'data',
        pageKind: 'home',
        source: 'jina',
        ok: true,
        fetchedAt: '2026-06-10T00:00:00.000Z',
      },
      {
        url: 'https://stocks.soapbox.community',
        title: '',
        headings: [],
        wordCount: 0,
        keyPoints: [],
        links: [],
        surface: 'stocks',
        pageKind: 'home',
        source: 'error:boom',
        ok: false,
        fetchedAt: '2026-06-10T00:00:00.000Z',
      },
    ],
  };
}

test('toAnnalRecords: one typed record per page, write:false touches no disk', () => {
  const recs = toAnnalRecords(sampleCrawl(), { write: false });
  assert.equal(recs.length, 2);
  for (const r of recs) {
    assert.equal(r.type, 'site-state');
    assert.equal(r.task, 157);
    assert.equal(typeof r.shows, 'string');
    assert.ok(r.shows.length > 0);
    assert.equal(r.crawledAt, '2026-06-10T00:00:00.000Z');
  }
  // ok page: human line names surface/kind, counts, and a heading hint
  assert.match(recs[0].shows, /data\/home/);
  assert.match(recs[0].shows, /headings:/);
  // failed page: "unreachable" with its source
  assert.match(recs[1].shows, /unreachable/);
  assert.match(recs[1].shows, /error:boom/);
});

test('toAnnalRecords: empty/missing crawl → typed empty array, never throws', () => {
  assert.deepEqual(toAnnalRecords(undefined, { write: false }), []);
  assert.deepEqual(toAnnalRecords(null, { write: false }), []);
  assert.deepEqual(toAnnalRecords({}, { write: false }), []);
  assert.deepEqual(toAnnalRecords({ pages: [] }, { write: false }), []);
});

test('toAnnalRecords: caps headings/keyPoints/links to documented limits', () => {
  const big = {
    crawledAt: '2026-06-10T00:00:00.000Z',
    pages: [{
      url: 'https://wiki.soapbox.community',
      title: 'Wiki', surface: 'wiki', pageKind: 'home', source: 'jina', ok: true,
      fetchedAt: '2026-06-10T00:00:00.000Z', wordCount: 999,
      headings: Array.from({ length: 30 }, (_, i) => `h${i}`),
      keyPoints: Array.from({ length: 30 }, (_, i) => `point number ${i}`),
      links: Array.from({ length: 40 }, (_, i) => `https://wiki.soapbox.community/a-${i}`),
    }],
  };
  const [r] = toAnnalRecords(big, { write: false });
  assert.equal(r.headings.length, 20);
  assert.equal(r.keyPoints.length, 15);
  assert.equal(r.internalLinks.length, 25);
});

// ── siteStateSummary (explicit crawl → no disk read) ────────────────────────────────────────────────
test('siteStateSummary: empty crawl with empty pages → typed "no records" line', () => {
  const s = siteStateSummary({ pages: [] });
  assert.equal(typeof s, 'string');
  assert.match(s, /no live-site records yet/i);
});

test('siteStateSummary: summarizes data/directory/wiki/stocks from an explicit crawl', () => {
  const crawl = {
    crawledAt: '2026-06-10T12:00:00.000Z',
    pages: [
      { url: 'https://data.soapbox.community', surface: 'data', pageKind: 'home', ok: true,
        title: 'Data', headings: ['BTC $65,000', 'ETH $3,200'],
        keyPoints: ['Bitcoin $65,000', 'Ethereum $3,200', 'Solana $150'], links: [] },
      { url: 'https://data.soapbox.community/macro', surface: 'data', pageKind: 'section', ok: true,
        title: 'Macro', headings: [], keyPoints: [], links: [] },
      { url: 'https://directory.soapbox.community', surface: 'directory', pageKind: 'home', ok: true,
        title: 'Top Sites Leaderboard', headings: ['Ranked'], keyPoints: [], links: [] },
      { url: 'https://wiki.soapbox.community', surface: 'wiki', pageKind: 'home', ok: true,
        title: 'Wiki', headings: [], keyPoints: ['intro line one'],
        links: ['https://wiki.soapbox.community/blockchain', 'https://wiki.soapbox.community/mining'] },
      { url: 'https://stocks.soapbox.community', surface: 'stocks', pageKind: 'home', ok: true,
        title: 'Stocks', headings: [], keyPoints: [], links: [] },
    ],
  };
  const s = siteStateSummary(crawl);
  assert.match(s, /Live product state \(as of 2026-06-10T12:00:00\.000Z\)/);
  assert.match(s, /Data lists/);
  assert.match(s, /macro pages/);
  assert.match(s, /Top-Sites leaderboard/i);
  assert.match(s, /Wiki has ~\d+ articles|Wiki is live/);
  assert.match(s, /Stocks subdomain live/);
});

test('siteStateSummary: down stocks page reported as down; never throws', () => {
  const crawl = {
    crawledAt: '2026-06-10T12:00:00.000Z',
    pages: [{ url: 'https://stocks.soapbox.community', surface: 'stocks', pageKind: 'home',
      ok: false, title: '', headings: [], keyPoints: [], links: [] }],
  };
  // ok:false filters out of bySurface, so stocks branch is skipped → still a typed string
  const s = siteStateSummary(crawl);
  assert.equal(typeof s, 'string');
  assert.match(s, /Live product state/);
});

// ── crawlOurSite (OFFLINE: scraper fetch injected) ─────────────────────────────────────────────────
test('crawlOurSite: extracts structure from injected markdown (no network)', async (t) => {
  t.after(restoreFetch);
  const md = [
    'Title: Data Home',
    'URL Source: https://data.soapbox.community',
    'Markdown Content:',
    '# Markets',
    '## Top Coins',
    '- Bitcoin $65,000',
    '- Ethereum $3,200',
    'A real sentence of body content that is long enough to count.',
    '[Bitcoin page](https://data.soapbox.community/coin/bitcoin)',
  ].join('\n');

  __setFetch(fakeFetch({ 'https://data.soapbox.community': md }));

  const crawl = await crawlOurSite({
    pages: [{ url: 'https://data.soapbox.community', surface: 'data', kind: 'home' }],
    delayMs: 0,
    fresh: true,
  });

  assert.equal(crawl.pageCount, 1);
  assert.equal(crawl.okCount, 1);
  const p = crawl.pages[0];
  assert.equal(p.ok, true);
  assert.equal(p.surface, 'data');
  assert.equal(p.pageKind, 'home');
  assert.equal(p.title, 'Data Home');
  assert.ok(p.headings.includes('Markets'));
  assert.ok(p.headings.includes('Top Coins'));
  assert.ok(p.keyPoints.some((k) => /Bitcoin \$65,000/.test(k)));
  assert.ok(p.links.includes('https://data.soapbox.community/coin/bitcoin'));
  assert.equal(typeof p.fetchedAt, 'string');
});

test('crawlOurSite: dead page yields ok:false with empty structure, never throws', async (t) => {
  t.after(restoreFetch);
  // fakeFetch returns non-ok for any url not in its table → Jina fails → fallback fetch also non-ok.
  // Unique URL so neither scraper's internal cache nor the condenser `cached()` (keyed by url, NOT
  // bypassed by `fresh`) returns a value left by another test.
  __setFetch(fakeFetch({}));

  const crawl = await crawlOurSite({
    pages: [{ url: 'https://data.soapbox.community/dead-page-xyz', surface: 'data', kind: 'home' }],
    delayMs: 0,
    fresh: true,
  });

  assert.equal(crawl.pageCount, 1);
  assert.equal(crawl.okCount, 0);
  const p = crawl.pages[0];
  assert.equal(p.ok, false);
  assert.deepEqual(p.headings, []);
  assert.deepEqual(p.keyPoints, []);
  assert.deepEqual(p.links, []);
  assert.equal(p.wordCount, 0);
});

test('crawlOurSite: drops gated pages defensively before fetching', async (t) => {
  t.after(restoreFetch);
  let fetched = 0;
  __setFetch(async (reqUrl) => {
    fetched++;
    const real = String(reqUrl).replace(/^https:\/\/r\.jina\.ai\//, '');
    return { ok: true, status: 200, async text() { return `Title: ${real}\n# H`; } };
  });

  const crawl = await crawlOurSite({
    pages: [
      { url: 'https://data.soapbox.community/stats', surface: 'data', kind: 'gated' },
      { url: 'https://data.soapbox.community/seo', surface: 'data', kind: 'gated' },
      { url: 'https://data.soapbox.community', surface: 'data', kind: 'home' },
    ],
    delayMs: 0,
    fresh: true,
  });

  assert.equal(crawl.pageCount, 1, 'only the public page survives the filter');
  assert.equal(crawl.pages[0].url, 'https://data.soapbox.community');
});

test('crawlOurSite: empty page list → typed empty result, never throws', async (t) => {
  t.after(restoreFetch);
  __setFetch(fakeFetch({}));
  const crawl = await crawlOurSite({ pages: [], delayMs: 0, fresh: true });
  assert.equal(crawl.pageCount, 0);
  assert.equal(crawl.okCount, 0);
  assert.deepEqual(crawl.pages, []);
  assert.equal(typeof crawl.crawledAt, 'string');
});

// ── round-trip: crawl → records → summary, all offline ──────────────────────────────────────────────
test('round-trip: crawlOurSite → toAnnalRecords(write:false) → siteStateSummary', async (t) => {
  t.after(restoreFetch);
  __setFetch(fakeFetch({
    'https://data.soapbox.community':
      'Title: Data\nMarkdown Content:\n# Markets\n- Bitcoin $65,000\n- Ethereum $3,200',
  }));
  const crawl = await crawlOurSite({
    pages: [{ url: 'https://data.soapbox.community', surface: 'data', kind: 'home' }],
    delayMs: 0,
    fresh: true,
  });
  const recs = toAnnalRecords(crawl, { write: false });
  assert.equal(recs.length, 1);
  assert.equal(recs[0].surface, 'data');
  const summary = siteStateSummary(crawl);
  assert.match(summary, /Live product state/);
  assert.match(summary, /Data lists/);
});
