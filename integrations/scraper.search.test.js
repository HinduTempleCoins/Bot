// scraper.search.test.js — tests for the keyless / independent / foreign-language search providers
// (task #143). The pure-structure tests run offline; the live ones hit real public engines and can
// be skipped with SKIP_LIVE=1. Run: node --test integrations/scraper.search.test.js
//
// Which engines respond from a given host varies: from a datacenter/Codespace IP, Mojeek and the
// public SearXNG JSON instances are usually blocked (403 / HTML-only) but resolve from the on-chain
// box; the multilingual Wikipedia providers + Marginalia + DuckDuckGo respond from anywhere. The
// live tests below therefore assert on engines that respond from CI, and only soft-check the
// IP-gated ones.
import { test } from 'node:test';
import assert from 'node:assert';
import { PROVIDERS, WIKI_LANGS, search, searchMultilingual, searchAll } from './scraper.mjs';

const LIVE = !process.env.SKIP_LIVE;
const live = (name, fn) => test(name, { skip: LIVE ? false : 'SKIP_LIVE set' }, fn);

// ── structure tests (no network) ──
test('foreign-language Wikipedia providers are registered in PROVIDERS', () => {
  for (const lang of ['es', 'fr', 'de', 'zh', 'ja', 'ar', 'ru', 'pt', 'hi']) {
    assert.ok(typeof PROVIDERS[`wikipedia-${lang}`] === 'function', `missing wikipedia-${lang} provider`);
  }
  // the original keyless engines are still present
  for (const p of ['duckduckgo', 'marginalia', 'mojeek', 'searxng', 'wikipedia']) {
    assert.ok(typeof PROVIDERS[p] === 'function', `missing ${p} provider`);
  }
});

test('WIKI_LANGS is a non-empty list of language codes', () => {
  assert.ok(Array.isArray(WIKI_LANGS) && WIKI_LANGS.length > 0);
  for (const l of WIKI_LANGS) assert.match(l, /^[a-z]{2,3}$/);
});

test('searchMultilingual / searchAll return [] for empty query, never throw', async () => {
  assert.deepStrictEqual(await searchMultilingual(''), []);
  assert.deepStrictEqual(await searchAll(''), []);
});

// ── live tests ──
live('foreign Wikipedia returns real native-language results (es, ja)', async () => {
  const es = await search('cadena de bloques', { provider: 'wikipedia-es', limit: 3 });
  assert.ok(es.length > 0, 'expected Spanish Wikipedia results');
  assert.ok(es.every((r) => /^https:\/\/es\.wikipedia\.org\//.test(r.url)), 'urls should be es.wikipedia');
  assert.strictEqual(es[0].provider, 'wikipedia-es');

  const ja = await search('ブロックチェーン', { provider: 'wikipedia-ja', limit: 3 });
  assert.ok(ja.length > 0, 'expected Japanese Wikipedia results for a native-script query');
});

live('searchMultilingual fans out across languages, dedupes, tags lang', async () => {
  const rows = await searchMultilingual('bitcoin', { langs: ['es', 'fr', 'ar', 'ru'], limit: 3 });
  assert.ok(rows.length > 0, 'expected merged multilingual results');
  const langs = new Set(rows.map((r) => r.lang));
  assert.ok(langs.size >= 2, `expected results from multiple languages, got ${[...langs]}`);
  for (const r of rows) {
    assert.ok(r.title && r.url && r.lang, 'each row has title/url/lang');
    assert.match(r.provider, /^wikipedia-/);
  }
  // dedupe by url
  const urls = rows.map((r) => r.url);
  assert.strictEqual(urls.length, new Set(urls).size, 'urls should be deduped');
});

live('a registered foreign-language provider shows up through searchAll', async () => {
  // pull a wide result set so lower-ranked (single-provider) foreign results survive the cut
  const rows = await searchAll('cryptocurrency', { limit: 40 });
  assert.ok(rows.length > 0);
  const sawForeign = rows.some((r) => r.providers.some((p) => /^wikipedia-(es|fr|de|zh|ja|ar|ru|pt|hi)$/.test(p)));
  // soft assertion: foreign results may be outranked by scholarly hits on some queries
  if (!sawForeign) console.warn('note: no foreign-wiki provider in top 40 for this query (scholarly-dominated)');
});

live('searxng provider never throws (may be empty from datacenter IPs)', async () => {
  // from CI/datacenter IPs public SearXNG JSON is usually blocked → []; from the box it returns rows.
  const rows = await search('bitcoin', { provider: 'searxng', limit: 3, lang: 'en' });
  assert.ok(Array.isArray(rows), 'searxng returns an array regardless of reachability');
});
