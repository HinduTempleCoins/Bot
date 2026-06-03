// search-ribbon.test.mjs — OFFLINE tests for the Search.SoapBox ribbon storefront (queue #130).
// A canned searcher is injected via __setSearcher so NO network is touched. Verifies: the tab set,
// query routing to the searcher, AI Mode, the Clarity-score filter (both via search() and the pure
// clarityFilter helper), and that the renderers highlight the active tab + escape hostile input.
// Run: node --test integrations/soapbox/search-ribbon.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RIBBON_TABS, search, renderRibbon, renderResults, clarityFilter, __setSearcher,
} from './search-ribbon.mjs';

// Canned results with a range of clarity scores. The searcher echoes the tab so we can assert routing.
const CANNED = [
  { title: 'High clarity coin', url: 'https://example.com/high', snippet: 'transparent', clarity: 82 },
  { title: 'Mid clarity coin', url: 'https://example.com/mid', snippet: 'partly open', clarity: 50 },
  { title: 'Low clarity coin', url: 'https://example.com/low', snippet: 'opaque', clarity: 12 },
];

function installSearcher() {
  __setSearcher(async (query, opts) => ({
    results: CANNED.map((r) => ({ ...r, snippet: `[${opts.tab}] ${r.snippet}` })),
    ai: opts.aiMode ? `Synthesized answer for ${query} on ${opts.tab}.` : '',
  }));
}

// ── RIBBON_TABS ──────────────────────────────────────────────────────────────────────────────────

test('RIBBON_TABS includes the core verticals and each has key/label/route', () => {
  const keys = RIBBON_TABS.map((t) => t.key);
  for (const k of ['web', 'crypto', 'library', 'gov']) {
    assert.ok(keys.includes(k), `ribbon includes "${k}" tab`);
  }
  for (const t of RIBBON_TABS) {
    assert.equal(typeof t.key, 'string');
    assert.equal(typeof t.label, 'string');
    assert.match(t.route, /^\//, 'route is an absolute path');
  }
});

// ── search routing ───────────────────────────────────────────────────────────────────────────────

test('search routes the query to the injected searcher and returns results for the chosen tab', async () => {
  installSearcher();
  const res = await search('blockchain', { tab: 'crypto' });
  assert.equal(res.query, 'blockchain');
  assert.equal(res.tab, 'crypto');
  assert.equal(res.results.length, 3);
  // searcher echoed the tab into each snippet → proves the tab was passed through
  assert.ok(res.results.every((r) => r.snippet.startsWith('[crypto]')), 'tab routed to searcher');
  assert.equal(res.aiAnswer, undefined, 'no aiAnswer unless aiMode');
});

test('search soft-fails to empty results when the searcher throws (no network, no throw)', async () => {
  __setSearcher(async () => { throw new Error('upstream down'); });
  const res = await search('anything', { tab: 'web' });
  assert.deepEqual(res.results, []);
  assert.equal(res.tab, 'web');
});

test('search with no searcher / empty query yields empty results', async () => {
  __setSearcher(null);
  const res = await search('', { tab: 'web' });
  assert.deepEqual(res.results, []);
});

// ── AI Mode ──────────────────────────────────────────────────────────────────────────────────────

test('aiMode true yields an aiAnswer (from the searcher ai field)', async () => {
  installSearcher();
  const res = await search('zk proofs', { tab: 'crypto', aiMode: true });
  assert.equal(typeof res.aiAnswer, 'string');
  assert.ok(res.aiAnswer.length > 0);
  assert.match(res.aiAnswer, /zk proofs/, 'uses the searcher-supplied synthesis');
});

test('aiMode true still yields a stub aiAnswer when the searcher gives no ai field', async () => {
  __setSearcher(async () => ({ results: CANNED }));   // no `ai`
  const res = await search('temple tech', { tab: 'library', aiMode: true });
  assert.equal(typeof res.aiAnswer, 'string');
  assert.match(res.aiAnswer, /Hathor AI Mode/);
});

// ── Clarity filter ───────────────────────────────────────────────────────────────────────────────

test('minClarity filters out low-clarity results in search()', async () => {
  installSearcher();
  const res = await search('coin', { tab: 'crypto', minClarity: 55 });
  assert.equal(res.results.length, 1, 'only the 82-clarity result clears 55');
  assert.equal(res.results[0].title, 'High clarity coin');
});

test('clarityFilter (pure): keeps >= floor, drops unscored when floor > 0, passes all at 0', () => {
  const rows = [
    { clarity: 90 }, { clarity: 40 }, { clarity: 60 }, { /* unscored */ },
  ];
  assert.equal(clarityFilter(rows, 0).length, 4, 'floor 0 passes everything');
  const kept = clarityFilter(rows, 60);
  assert.equal(kept.length, 2, 'only 90 and 60 clear a 60 floor');
  assert.ok(kept.every((r) => r.clarity >= 60));
  assert.deepEqual(clarityFilter(null, 50), [], 'non-array input is safe');
});

// ── renderRibbon ─────────────────────────────────────────────────────────────────────────────────

test('renderRibbon highlights the active tab and escapes a hostile query', () => {
  const html = renderRibbon({ active: 'crypto', query: '<script>alert(1)</script>' });
  // active tab marked
  assert.match(html, /class="ribbon-tab active"[^>]*data-tab="crypto"/, 'active tab highlighted');
  // a non-active tab is NOT marked active
  assert.match(html, /class="ribbon-tab"[^>]*data-tab="web"/, 'inactive tab not highlighted');
  // the raw script tag must NOT appear; it must be escaped in the value attribute
  assert.ok(!html.includes('<script>alert(1)</script>'), 'no raw script tag');
  assert.match(html, /&lt;script&gt;/, 'query HTML-escaped in the search box');
  // controls present
  assert.match(html, /Hathor AI Mode/, 'AI-Mode toggle present');
  assert.match(html, /type="range"[^>]*name="minClarity"/, 'Clarity slider present');
});

test('renderRibbon defaults to web tab for an unknown active key', () => {
  const html = renderRibbon({ active: 'does-not-exist', query: '' });
  assert.match(html, /class="ribbon-tab active"[^>]*data-tab="web"/);
});

// ── renderResults ────────────────────────────────────────────────────────────────────────────────

test('renderResults escapes a malicious title and renders clarity badges', () => {
  const sr = {
    query: 'x', tab: 'web',
    results: [
      { title: '<img src=x onerror=alert(1)>', url: 'https://evil.example/p', snippet: 'pwn', clarity: 82 },
      { title: 'Plain', url: 'https://ok.example/q', snippet: 'fine', clarity: 20 },
    ],
  };
  const html = renderResults(sr);
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'), 'malicious title not rendered raw');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/, 'title HTML-escaped');
  // clarity badges with band labels
  assert.match(html, /clarity-badge clarity-high/, 'high-clarity badge');
  assert.match(html, /clarity-badge clarity-opaque/, 'opaque badge for the low score');
  assert.match(html, /Clarity 82/, 'badge shows the score');
});

test('renderResults shows the AI answer box when present and a no-results line when empty', () => {
  const withAi = renderResults({ query: 'q', tab: 'web', results: [], aiAnswer: 'Hathor says hi.' });
  assert.match(withAi, /ai-answer/, 'AI answer box rendered');
  assert.match(withAi, /Hathor says hi\./);
  assert.match(withAi, /No results for/, 'empty state shown');

  const empty = renderResults({ query: '', tab: 'web', results: [] });
  assert.match(empty, /Enter a query/, 'prompt when no query');
});

test('renderResults escapes the AI answer text too', () => {
  const html = renderResults({ query: 'q', tab: 'web', results: [], aiAnswer: '<b>boom</b>' });
  assert.ok(!html.includes('<b>boom</b>'), 'AI answer not rendered raw');
  assert.match(html, /&lt;b&gt;boom&lt;\/b&gt;/);
});
