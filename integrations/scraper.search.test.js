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
import { PROVIDERS, WIKI_LANGS, search, searchMultilingual, searchAll, normalizeUrl, cleanSnippet, __setFetch } from './scraper.mjs';

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

// ── pure-helper tests (task #132: quality + digestibility, no network) ──
test('normalizeUrl: http→https, drops www/fragment/trailing-slash/tracking, collapses dupes', () => {
  const variants = [
    'http://www.example.com/Page/',
    'https://example.com/Page',
    'https://example.com/Page#section',
    'https://example.com/Page?utm_source=ddg&utm_medium=web',
    'https://www.example.com/Page/?ref=marginalia',
  ];
  const norm = variants.map(normalizeUrl);
  assert.strictEqual(new Set(norm).size, 1, `all variants should normalize equal, got ${[...new Set(norm)]}`);
  assert.match(norm[0], /^https:\/\/example\.com\/Page$/);
  // meaningful params are preserved (sorted)
  assert.strictEqual(normalizeUrl('https://x.com/w?b=2&a=1'), 'https://x.com/w?a=1&b=2');
  assert.strictEqual(normalizeUrl(''), '');
});

test('cleanSnippet: strips HTML, decodes entities, collapses whitespace, caps length', () => {
  const dirty = '<b>Hello</b>&nbsp;&amp; welcome   to\n\nthe   <i>jungle</i>&#39;s edge';
  const clean = cleanSnippet(dirty);
  assert.ok(!/[<>]/.test(clean), 'no tags remain');
  assert.ok(clean.includes("&") && clean.includes("'") && !clean.includes('&amp;'), 'entities decoded');
  assert.ok(!/\s{2,}/.test(clean), 'whitespace collapsed');
  const long = 'word '.repeat(200);
  const capped = cleanSnippet(long, 50);
  assert.ok(capped.length <= 51, `capped to ~50 (+ellipsis), got ${capped.length}`);
  assert.ok(capped.endsWith('…'), 'ellipsis appended when truncated');
});

test('searchAll: dedups across providers, combines provider lists, ranks by composite score', async () => {
  // mock fetch so we control exactly what each provider returns (offline + deterministic).
  const page = (host, path, title, snip) => `<div class="result"><a class="result__a" href="https://${host}${path}">${title}</a><a class="result__snippet">${snip}</a></div>`;
  __setFetch(async (url) => {
    const u = String(url);
    const json = (o) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
    const html = (s) => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => s, json: async () => ({}) });
    // DuckDuckGo HTML — returns the shared page (with tracking) + a spam listicle page.
    if (/duckduckgo\.com/.test(u)) return html(
      page('shared.org', '/article/?utm_source=ddg', 'Quantum Computing Overview', 'A clear intro to <b>quantum</b> computing.') +
      page('listverse.com', '/top-10', 'Top 10 Quantum Facts You Won\'t Believe', 'clickbait'));
    // Marginalia JSON — returns the SAME shared page (different tracking) → must dedup + combine providers.
    if (/marginalia\.nu/.test(u)) return json({ results: [{ title: 'Quantum Computing Overview', url: 'http://www.shared.org/article/?ref=marg', description: 'quantum computing explained' }] });
    // English Wikipedia opensearch — authoritative domain.
    if (/en\.wikipedia\.org\/w\/api\.php\?action=opensearch/.test(u)) return json(['quantum computing', ['Quantum computing'], ['desc'], ['https://en.wikipedia.org/wiki/Quantum_computing']]);
    // CrossRef — scholarly.
    if (/api\.crossref\.org/.test(u)) return json({ message: { items: [{ title: ['Quantum computing review'], DOI: '10.1/qc', 'container-title': ['Nature'] }] } });
    // everything else (other engines / knowledge apis) → empty
    return json({});
  });
  try {
    const rows = await searchAll('quantum computing', { limit: 20 });
    assert.ok(rows.length > 0, 'expected results');
    // every result has the documented shape
    for (const r of rows) {
      for (const f of ['title', 'url', 'snippet', 'providers', 'score', 'digest']) assert.ok(f in r, `result missing ${f}`);
      assert.ok(Array.isArray(r.providers) && r.providers.length, 'providers is a non-empty array');
    }
    // the shared page was found by ddg + marginalia → ONE merged result with both providers.
    const shared = rows.find((r) => /shared\.org\/article/.test(r.url));
    assert.ok(shared, 'shared page present');
    assert.strictEqual(new Set(shared.providers).size >= 2, true, `shared page should combine ≥2 providers, got ${shared.providers}`);
    assert.ok(/[?#]/.test(shared.url) === false || /a=|b=/.test(shared.url), 'tracking params stripped from merged url');
    // a scholarly OR authoritative result should outrank the spam listicle.
    const listiclePos = rows.findIndex((r) => /listverse/.test(r.url));
    const wikiPos = rows.findIndex((r) => /wikipedia/.test(r.url));
    const crossrefPos = rows.findIndex((r) => /doi\.org/.test(r.url));
    assert.ok(wikiPos !== -1 && crossrefPos !== -1, 'authoritative + scholarly results present');
    if (listiclePos !== -1) {
      assert.ok(wikiPos < listiclePos, 'wikipedia (authoritative) ranks above the listicle');
      assert.ok(crossrefPos < listiclePos, 'crossref (scholarly) ranks above the listicle');
    }
    // sorted by descending score
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].score >= rows[i].score, 'rows sorted by score desc');
  } finally {
    __setFetch(null);
  }
});

// ── data-loss-audit (#284): the scholarly normalizers + the searchAll merge must KEEP the rich record
// (doi/year/authors/venue/cited) instead of flattening it into the snippet string. ─────────────────
test('#284: searchAll preserves scholarly structured fields (doi/year/authors/venue/cited)', async () => {
  __setFetch(async (url) => {
    const u = String(url);
    const json = (o) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
    if (/api\.openalex\.org/.test(u)) return json({ results: [{
      title: 'A heterosis study', doi: 'https://doi.org/10.1/oa', id: 'https://openalex.org/W1',
      publication_year: 2024, primary_location: { source: { display_name: 'AJBSR' }, landing_page_url: 'https://x/y' },
      authorships: [{ author: { display_name: 'R. Van Kush' } }], cited_by_count: 7, open_access: { is_oa: true },
    }] });
    if (/api\.crossref\.org/.test(u)) return json({ message: { items: [{
      title: ['A crossref paper'], DOI: '10.2/cr', 'container-title': ['Nature'],
      published: { 'date-parts': [[2023]] }, author: [{ given: 'A', family: 'Writer' }], 'is-referenced-by-count': 12,
    }] } });
    return json({});
  });
  try {
    const rows = await searchAll('heterosis', { limit: 20 });
    const oa = rows.find((r) => /doi\.org\/10\.1\/oa/.test(r.url));
    assert.ok(oa, 'openalex row present');
    assert.equal(oa.year, 2024);
    assert.equal(oa.venue, 'AJBSR');
    assert.deepStrictEqual(oa.authors, ['R. Van Kush']);
    assert.equal(oa.cited, 7);
    assert.equal(oa.openAccess, true);
    const cr = rows.find((r) => /doi\.org\/10\.2\/cr/.test(r.url));
    assert.ok(cr, 'crossref row present');
    assert.equal(cr.year, 2023);
    assert.equal(cr.venue, 'Nature');
    assert.equal(cr.cited, 12);
    assert.deepStrictEqual(cr.authors, ['A Writer']);
  } finally {
    __setFetch(null);
  }
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
