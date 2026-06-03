// scraper.test.mjs — complementary OFFLINE tests for the resource-center fetch layer (queue #56).
// The two sibling files cover search providers/ranking (scraper.search.test.js) and translation
// (scraper.translate.test.js); this file covers the URL→markdown fetch path that they don't:
//   fetchClean (Jina primary, raw-fetch+strip fallback, invalid url, maxChars, title extraction),
//   caching (cache hit / fresh bypass / never-throws), fetchMany batching/concurrency, and research().
// Everything is OFFLINE — fetch is replaced via the module's __setFetch hook and restored after each
// test. Run: node --test integrations/scraper.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { fetchClean, fetchMany, research, __setFetch } from './scraper.mjs';

// tiny response builders matching the shape scraper.mjs reads (ok / status / text / headers.get / json)
const textResp = (body, { ok = true, status = 200 } = {}) => ({
  ok, status,
  headers: { get: () => 'text/html' },
  text: async () => body,
  json: async () => { try { return JSON.parse(body); } catch { return {}; } },
});

// unique-host helper so each test uses a fresh url and never collides with the module-level cache.
let n = 0;
const freshUrl = () => `https://example-${Date.now()}-${n++}.test/page`;

function restore() { __setFetch(null); }

// ── fetchClean: Jina primary path ──────────────────────────────────────────────────────────────
test('fetchClean uses Jina primary, extracts title, reports source=jina', async () => {
  const url = freshUrl();
  let seen = '';
  __setFetch(async (u) => { seen = String(u); return textResp('Title: Alexander Shulgin\n\n# Alexander Shulgin\nChemist.'); });
  try {
    const out = await fetchClean(url);
    assert.ok(seen.includes('r.jina.ai') && seen.endsWith(url), `expected Jina-prefixed url, got ${seen}`);
    assert.strictEqual(out.source, 'jina');
    assert.strictEqual(out.title, 'Alexander Shulgin');
    assert.ok(out.markdown.includes('Chemist.'));
    assert.strictEqual(out.chars, out.markdown.length);
    assert.strictEqual(out.url, url);
  } finally { restore(); }
});

test('fetchClean falls back to # heading when no Title: line', async () => {
  const url = freshUrl();
  __setFetch(async () => textResp('# Heading Only\n\nbody text here'));
  try {
    const out = await fetchClean(url);
    assert.strictEqual(out.source, 'jina');
    assert.strictEqual(out.title, 'Heading Only');
  } finally { restore(); }
});

test('fetchClean truncates markdown to maxChars', async () => {
  const url = freshUrl();
  __setFetch(async () => textResp('x'.repeat(5000)));
  try {
    const out = await fetchClean(url, { maxChars: 100 });
    assert.strictEqual(out.markdown.length, 100);
    assert.strictEqual(out.chars, 100);
  } finally { restore(); }
});

// ── fetchClean: fallback path (Jina down → raw fetch + tag strip) ────────────────────────────────
test('fetchClean falls back to raw fetch + htmlToText when Jina returns non-ok', async () => {
  const url = freshUrl();
  let calls = 0;
  __setFetch(async (u) => {
    calls++;
    if (String(u).includes('r.jina.ai')) return textResp('jina down', { ok: false, status: 503 });
    // raw fetch of the real url: HTML with scripts/styles that must be stripped
    return textResp('<html><head><title>Raw Page</title><style>.x{}</style></head>' +
      '<body><script>evil()</script><p>Hello&nbsp;&amp; welcome</p><div>second</div></body></html>');
  });
  try {
    const out = await fetchClean(url);
    assert.strictEqual(out.source, 'fallback');
    assert.strictEqual(out.title, 'Raw Page');
    assert.ok(!/<script|<style|<[a-z]/i.test(out.markdown), `tags should be stripped: ${out.markdown}`);
    assert.ok(out.markdown.includes('Hello & welcome'), 'entities decoded');
    assert.ok(out.markdown.includes('second'));
    assert.ok(!out.markdown.includes('evil()'), 'script body removed');
    assert.ok(calls >= 2, 'should have tried Jina then the raw url');
  } finally { restore(); }
});

test('fetchClean returns error source (never throws) when both fetches reject', async () => {
  const url = freshUrl();
  __setFetch(async () => { throw new Error('boom'); });
  try {
    const out = await fetchClean(url);
    assert.ok(out.source.startsWith('error:'), `expected error source, got ${out.source}`);
    assert.strictEqual(out.markdown, '');
    assert.strictEqual(out.chars, 0);
  } finally { restore(); }
});

// ── fetchClean: invalid url short-circuits before any fetch ──────────────────────────────────────
test('fetchClean rejects non-http(s) urls without fetching', async () => {
  let called = false;
  __setFetch(async () => { called = true; return textResp('nope'); });
  try {
    const out = await fetchClean('ftp://example.com/file');
    assert.strictEqual(out.source, 'invalid');
    assert.strictEqual(out.markdown, '');
    assert.strictEqual(called, false, 'should not fetch an invalid url');
  } finally { restore(); }
});

// ── caching: second call is served from cache; fresh:true bypasses ──────────────────────────────
test('fetchClean caches by url; fresh:true bypasses the cache', async () => {
  const url = freshUrl();
  let hits = 0;
  __setFetch(async () => { hits++; return textResp(`Title: V${hits}\n\nbody ${hits}`); });
  try {
    const a = await fetchClean(url);
    const b = await fetchClean(url);           // served from cache → no new fetch
    assert.strictEqual(hits, 1, 'second call should hit cache, not network');
    assert.strictEqual(b.title, a.title);
    assert.strictEqual(b.markdown, a.markdown);

    const c = await fetchClean(url, { fresh: true });  // bypasses cache → re-fetch
    assert.strictEqual(hits, 2, 'fresh:true should force a new fetch');
    assert.strictEqual(c.title, 'V2');
  } finally { restore(); }
});

// ── fetchMany: batches several urls, preserves results, dedups invalid gracefully ────────────────
test('fetchMany fetches every url and returns one result per url', async () => {
  const urls = [freshUrl(), freshUrl(), freshUrl(), freshUrl(), freshUrl()];
  let active = 0, maxActive = 0;
  __setFetch(async (u) => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    const url = String(u).replace('https://r.jina.ai/', '');
    return textResp(`Title: ${url}\n\ncontent`);
  });
  try {
    const out = await fetchMany(urls, { concurrency: 2 });
    assert.strictEqual(out.length, urls.length, 'one result per url');
    for (const u of urls) assert.ok(out.some((o) => o.url === u), `result for ${u} present`);
    assert.ok(out.every((o) => o.source === 'jina'), 'all via jina');
    assert.ok(maxActive <= 2, `concurrency bound respected, peaked at ${maxActive}`);
  } finally { restore(); }
});

test('fetchMany returns [] for an empty url list without fetching', async () => {
  let called = false;
  __setFetch(async () => { called = true; return textResp('x'); });
  try {
    const out = await fetchMany([]);
    assert.deepStrictEqual(out, []);
    assert.strictEqual(called, false);
  } finally { restore(); }
});

// ── research: search → fetch top results → annotate sources with markdown/fetched ────────────────
test('research returns the query plus sources annotated with fetched markdown', async () => {
  const host = `research-${Date.now()}.test`;
  __setFetch(async (u) => {
    const s = String(u);
    const json = (o) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => o, text: async () => JSON.stringify(o) });
    // one searchAll provider returns a single real hit; the rest return empty.
    if (/duckduckgo\.com/.test(s)) {
      return { ok: true, status: 200, headers: { get: () => 'text/html' }, json: async () => ({}),
        text: async () => `<a class="result__a" href="https://${host}/doc">The Doc</a><a class="result__snippet">snippet</a>` };
    }
    // Jina fetch of the discovered url → clean markdown
    if (s.includes('r.jina.ai') && s.includes(host)) {
      return { ok: true, status: 200, headers: { get: () => 'text/markdown' }, text: async () => 'Title: The Doc\n\nfetched body content', json: async () => ({}) };
    }
    return json({});
  });
  try {
    const r = await research('anything', { results: 4, fetchTop: 1, maxChars: 4000 });
    assert.strictEqual(r.query, 'anything');
    assert.ok(Array.isArray(r.sources) && r.sources.length > 0, 'expected sources');
    const doc = r.sources.find((x) => x.url.includes(host));
    assert.ok(doc, 'discovered doc present in sources');
    assert.strictEqual(doc.fetched, true, 'top result should be fetched');
    assert.ok(doc.markdown.includes('fetched body content'), 'markdown attached to fetched source');
  } finally { restore(); }
});
