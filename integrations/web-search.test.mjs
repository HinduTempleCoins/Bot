// web-search.test.mjs — offline, injected fetch. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, fetchUrl, providersConfigured, __setFetch } from './web-search.mjs';

function mockFetch(routes) {
  return async (url, opts) => {
    for (const [frag, resp] of Object.entries(routes)) {
      if (url.includes(frag)) {
        return { ok: resp.ok !== false, json: async () => resp.body };
      }
    }
    return { ok: false, json: async () => ({}) };
  };
}

test('search uses Tavily when TAVILY_API_KEY is set, normalizes results', async () => {
  process.env.TAVILY_API_KEY = 'tvly-test';
  __setFetch(mockFetch({ 'api.tavily.com': { body: { answer: 'because consensus', results: [
    { title: 'Witnesses', url: 'https://x/1', content: 'they produce blocks' },
  ] } } }));
  const r = await search('why witnesses');
  __setFetch(); delete process.env.TAVILY_API_KEY;
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'tavily');
  assert.equal(r.answer, 'because consensus');
  assert.equal(r.results[0].url, 'https://x/1');
  assert.equal(r.results[0].title, 'Witnesses');
});

test('search falls back to Exa when only EXA key is set', async () => {
  process.env.EXA_API_KEY = 'exa-test';
  __setFetch(mockFetch({ 'api.exa.ai': { body: { results: [
    { title: 'Exa hit', url: 'https://x/2', text: 'neural result' },
  ] } } }));
  const r = await search('topic', { limit: 3 });
  __setFetch(); delete process.env.EXA_API_KEY;
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'exa');
  assert.equal(r.results[0].snippet, 'neural result');
});

test('no key configured → ok:false no-provider, never throws', async () => {
  delete process.env.TAVILY_API_KEY; delete process.env.EXA_API_KEY;
  __setFetch(mockFetch({}));
  const r = await search('anything');
  __setFetch();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-provider');
  assert.deepEqual(r.results, []);
});

test('empty query soft-fails', async () => {
  const r = await search('   ');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-query');
});

test('network error soft-fails (no throw)', async () => {
  process.env.TAVILY_API_KEY = 'tvly-test';
  __setFetch(async () => { throw new Error('network down'); });
  const r = await search('q');
  __setFetch(); delete process.env.TAVILY_API_KEY;
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-provider');
});

test('fetchUrl uses Firecrawl → markdown', async () => {
  process.env.FIRECRAWL_API_KEY = 'fc-test';
  __setFetch(mockFetch({ 'firecrawl.dev': { body: { data: { markdown: '# Title\nbody', metadata: { title: 'T' } } } } }));
  const r = await fetchUrl('https://example.com/page');
  __setFetch(); delete process.env.FIRECRAWL_API_KEY;
  assert.equal(r.ok, true);
  assert.match(r.markdown, /# Title/);
  assert.equal(r.title, 'T');
});

test('fetchUrl rejects bad url + missing key, soft', async () => {
  assert.equal((await fetchUrl('not-a-url')).ok, false);
  delete process.env.FIRECRAWL_API_KEY;
  __setFetch(mockFetch({}));
  const r = await fetchUrl('https://example.com');
  __setFetch();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-firecrawl');
});

test('providersConfigured reflects env', () => {
  process.env.TAVILY_API_KEY = 'x';
  const p = providersConfigured();
  delete process.env.TAVILY_API_KEY;
  assert.equal(p.tavily, true);
  assert.equal(typeof p.exa, 'boolean');
});
