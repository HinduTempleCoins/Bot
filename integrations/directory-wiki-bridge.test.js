// directory-wiki-bridge.test.js — contract tests for the Directory⇄Wiki bridge (task #163).
// Runs offline: global.fetch is stubbed so no network is touched and the assertions are deterministic.
// Run: node --test integrations/directory-wiki-bridge.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Stub fetch BEFORE importing the module's functions are called (they fetch lazily at call time, so
// installing the stub here is sufficient). The wiki index lists two articles; the search API reports
// coverage for "wallet" only — so a wallet topic should NOT be proposed but others should.
const FAKE_SITE = 'https://wiki.example.test';
process.env.WIKI_SITE = FAKE_SITE;

const INDEX_HTML = `
  <a href="/wiki/Crypto_Wallets_Explainer">Crypto Wallets Explainer</a>
  <a href="/wiki/Oilahuasca">Oilahuasca</a>
`;

global.fetch = async (url) => {
  const u = String(url);
  if (u === `${FAKE_SITE}/`) {
    return { ok: true, status: 200, async text() { return INDEX_HTML; } };
  }
  if (u.includes('/api/search')) {
    const q = decodeURIComponent(new URL(u).searchParams.get('q') || '').toLowerCase();
    // pretend the Library covers anything wallet-related, nothing else
    const results = q.includes('wallet')
      ? [{ slug: 'Crypto_Wallets_Explainer', title: 'Crypto Wallets Explainer', url: `${FAKE_SITE}/wiki/Crypto_Wallets_Explainer`, score: 100 }]
      : [];
    return { ok: true, status: 200, async json() { return { q, count: results.length, results }; } };
  }
  return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; } };
};

const { bridge, directoryTopicsForWiki, wikiArticlesForDirectory } = await import('./directory-wiki-bridge.mjs');
const { invalidate } = await import('./soapbox/cache.mjs');

test('directoryTopicsForWiki: proposes uncovered topics, skips covered ones', async () => {
  const topics = await directoryTopicsForWiki();
  assert.ok(Array.isArray(topics));
  assert.ok(topics.length > 0, 'should propose at least one topic');
  // wallet coverage exists → the Wallets-category explainer (probe term "wallet") is suppressed.
  // (The Browser-Extensions topic also has "Wallet" in its title but probes "token approval", so it stays.)
  assert.ok(
    !topics.some((t) => /Custodial vs Non-Custodial/i.test(t.title)),
    'the Wallets explainer should be suppressed (covered)',
  );
  // an uncovered category (e.g. scam / explorer) should be proposed
  assert.ok(topics.some((t) => /scam|explorer|faucet|aggregator/i.test(t.title)), 'an uncovered topic should appear');
  // every topic carries BOTH the spec form and the wikiGenerator topic form
  for (const t of topics) {
    assert.equal(typeof t.title, 'string');
    assert.equal(typeof t.why, 'string');
    assert.ok(Array.isArray(t.sources) && t.sources.length, 'sources present');
    assert.ok(Array.isArray(t.searchTerms) && t.searchTerms.length, 'searchTerms present (generator form)');
    assert.ok(Array.isArray(t.primaryDomains), 'primaryDomains present (generator form)');
    assert.equal(typeof t.description, 'string');
  }
});

test('wikiArticlesForDirectory: one Directory row per live article, links resolve to wiki', async () => {
  const rows = await wikiArticlesForDirectory();
  assert.ok(rows.length >= 2, 'both index articles proposed');
  for (const r of rows) {
    assert.equal(r.cat, 'Learn');
    assert.equal(r.ours, true);
    assert.ok(r.url.startsWith(`${FAKE_SITE}/wiki/`), 'url points at the live wiki');
    assert.ok(r.name.startsWith('Library: '));
  }
  assert.ok(rows.some((r) => /Oilahuasca/.test(r.url)));
});

test('bridge: returns the combined advisory plan, never throws', async () => {
  const plan = await bridge();
  assert.equal(typeof plan.generatedAt, 'string');
  assert.equal(plan.wikiSite, FAKE_SITE);
  assert.ok(Array.isArray(plan.proposedWikiTopics));
  assert.ok(Array.isArray(plan.proposedDirectoryEntries));
  assert.equal(plan.articleSource, 'live-index');
  assert.equal(plan.articlesLive, 2);
});

test('bridge: degrades without throwing when the wiki is unreachable', async () => {
  const saved = global.fetch;
  global.fetch = async () => { throw new Error('network down'); };
  invalidate(); // clear cached live-index / search hits from prior tests so the down-path is exercised
  try {
    const plan = await bridge();
    assert.ok(Array.isArray(plan.proposedWikiTopics), 'still returns a plan');
    assert.equal(plan.articleSource, 'disk', 'falls back to on-disk article source');
  } finally {
    global.fetch = saved;
  }
});
