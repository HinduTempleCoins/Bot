// search-quality.test.mjs — guards for the metasearch quality + digestibility layer (task #132).
// Pure ranking math; no network. Run: node --test integrations/soapbox/search-quality.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, rankResults, cluster, digest } from './search-quality.mjs';

const Q = 'alexander shulgin pihkal';

// A representative raw multi-engine result set (the shape searchAll's providers emit):
// - the SAME wikipedia page found by 3 engines with different tracking params + http/https
// - a scholarly DOI hit, an ecosystem hit, an SEO-farm listicle, plain web pages.
function fixture() {
  return [
    { title: 'Alexander Shulgin', url: 'https://en.wikipedia.org/wiki/Alexander_Shulgin', snippet: 'American chemist', provider: 'wikipedia' },
    { title: 'Alexander Shulgin', url: 'http://en.wikipedia.org/wiki/Alexander_Shulgin?utm_source=ddg', snippet: 'chemist, author of PiHKAL and TiHKAL', provider: 'duckduckgo' },
    { title: 'Alexander Shulgin', url: 'https://www.en.wikipedia.org/wiki/Alexander_Shulgin#bio', snippet: '', provider: 'marginalia' },
    { title: 'PiHKAL: phenethylamine synthesis review', url: 'https://doi.org/10.1021/abc123', snippet: 'peer-reviewed study', provider: 'crossref' },
    { title: 'Shulgin entry on the SoapBox Library', url: 'https://wiki.soapbox.community/library/shulgin', snippet: 'our corpus', provider: 'wikipedia' },
    { title: 'Top 10 Shulgin Facts You Won\'t Believe', url: 'https://listverse.com/2019/shulgin-facts', snippet: 'listicle spam', provider: 'duckduckgo' },
    { title: 'Random blog about chemistry', url: 'https://someguy.wordpress.com/shulgin', snippet: 'a blog', provider: 'duckduckgo' },
  ];
}

test('dedupe collapses the same page found by multiple engines into one row', () => {
  const out = dedupe(fixture());
  const wiki = out.filter((r) => r.url.includes('en.wikipedia.org/wiki/Alexander_Shulgin'));
  assert.equal(wiki.length, 1, 'three wikipedia variants must collapse to one');
  // providers combine (corroboration preserved)
  assert.ok(wiki[0].providers.length >= 3, `expected >=3 providers, got ${wiki[0].providers.join(',')}`);
  assert.ok(['wikipedia', 'duckduckgo', 'marginalia'].every((p) => wiki[0].providers.includes(p)));
  // richest snippet wins
  assert.match(wiki[0].snippet, /PiHKAL and TiHKAL/);
  // total rows shrank by the two duplicates
  assert.equal(out.length, fixture().length - 2);
});

test('dedupe is robust to empty/garbage rows', () => {
  const out = dedupe([null, {}, { url: '' }, { url: 'not a url', title: 'x' }, ...fixture()]);
  assert.ok(out.length >= 1);
  assert.ok(out.every((r) => r.url && Array.isArray(r.providers)));
});

test('ranking: ecosystem + scholarly + authoritative sources outrank SEO-farm spam', () => {
  const ranked = rankResults(fixture(), Q);
  const idx = (frag) => ranked.findIndex((r) => r.url.includes(frag));
  const eco = idx('soapbox.community');
  const scholar = idx('doi.org');
  const authority = idx('en.wikipedia.org');
  const spam = idx('listverse.com');
  const blog = idx('wordpress.com');

  assert.ok(eco !== -1 && spam !== -1, 'both ecosystem and spam rows present');
  assert.ok(eco < spam, 'ecosystem must outrank the listicle farm');
  assert.ok(scholar < spam, 'scholarly DOI must outrank the listicle farm');
  assert.ok(authority < spam, 'wikipedia must outrank the listicle farm');
  // spam + wordpress blog should sink to the bottom (negative or lowest scores)
  assert.ok(ranked[spam].score < ranked[authority].score);
  assert.ok(ranked[blog].score < ranked[authority].score);
  // every row carries an explainable reason string
  assert.ok(ranked.every((r) => typeof r.why === 'string' && r.why.length));
});

test('ranking folds in injected domain-authority (Tranco rank / RDAP age) and degrades without it', () => {
  const raw = [
    { title: 'Established popular site', url: 'https://example-popular.com/a', snippet: 'x', provider: 'duckduckgo' },
    { title: 'Established popular site mirror', url: 'https://example-obscure.com/a', snippet: 'x', provider: 'duckduckgo' },
  ];
  const noAuth = rankResults(raw, 'established');
  // tie (same heuristics) → deterministic url order, scores equal
  assert.equal(noAuth[0].score, noAuth[1].score);

  const authority = {
    'example-popular.com': { rank: 500, ageYears: 15 },
    'example-obscure.com': { rank: 9_000_000, ageYears: 0.2 },
  };
  const withAuth = rankResults(raw, 'established', { authority });
  const popular = withAuth.find((r) => r.url.includes('example-popular'));
  const obscure = withAuth.find((r) => r.url.includes('example-obscure'));
  assert.ok(popular.score > obscure.score, 'the popular, established domain must rank higher with authority signals');
  assert.match(popular.why, /Tranco|established/);
});

test('clustering groups same-host near-duplicates', () => {
  const ranked = rankResults(fixture(), Q);
  const clusters = cluster(ranked);
  // the 3 wikipedia variants already deduped to one row; ensure same-host rows would group
  const sameHost = cluster(rankResults([
    { title: 'Shulgin page one', url: 'https://example.org/one', snippet: 'a', provider: 'duckduckgo' },
    { title: 'Shulgin page two', url: 'https://example.org/two', snippet: 'b', provider: 'marginalia' },
    { title: 'Different topic entirely', url: 'https://other.net/x', snippet: 'c', provider: 'mojeek' },
  ], Q));
  const exampleCluster = sameHost.find((c) => c.host === 'example.org');
  assert.ok(exampleCluster, 'example.org cluster exists');
  assert.equal(exampleCluster.members.length, 2, 'both example.org pages cluster together');
  assert.ok(clusters.length >= 1);
});

test('digest returns a non-empty summary and clusters with plain-English lines', () => {
  const d = digest(fixture(), Q);
  assert.equal(typeof d.summary, 'string');
  assert.ok(d.summary.length > 0, 'summary must be non-empty');
  assert.match(d.summary, /result/i);
  assert.ok(Array.isArray(d.clusters) && d.clusters.length > 0, 'clusters must be non-empty');
  for (const c of d.clusters) {
    assert.ok(c.lead && c.lead.url, 'each cluster has a lead result');
    assert.equal(typeof c.summary, 'string');
    assert.ok(c.summary.length > 0, 'each cluster summary is non-empty plain English');
    assert.ok(Array.isArray(c.members) && c.members.length >= 1);
    assert.ok(Array.isArray(c.hosts));
  }
  // the top cluster should be a high-quality source (ecosystem/scholarly/authoritative), not the spam.
  assert.ok(!d.clusters[0].lead.url.includes('listverse.com'), 'spam must not lead the digest');
});

test('digest handles the empty case gracefully', () => {
  const d = digest([], 'nothing');
  assert.equal(d.count, 0);
  assert.match(d.summary, /No results/i);
  assert.deepEqual(d.clusters, []);
});

test('rankResults accepts already-merged rows (providers[] shape) too', () => {
  const merged = [
    { title: 'A', url: 'https://en.wikipedia.org/wiki/A', snippet: 's', providers: ['wikipedia', 'duckduckgo'] },
    { title: 'B spam', url: 'https://listverse.com/b', snippet: 's', providers: ['duckduckgo'] },
  ];
  const ranked = rankResults(merged, 'a');
  assert.equal(ranked[0].url, 'https://en.wikipedia.org/wiki/A');
  assert.ok(ranked[0].providers.includes('wikipedia') && ranked[0].providers.includes('duckduckgo'));
});
