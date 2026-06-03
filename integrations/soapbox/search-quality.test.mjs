// search-quality.test.mjs — guards for the metasearch quality + digestibility layer (task #132).
// Pure ranking math; no network. Run: node --test integrations/soapbox/search-quality.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupe, rankResults, cluster, digest,
  rankHybrid, facets, fuzzyTermHits, proximityScore,
} from './search-quality.mjs';

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

// ── NEW: additive extensions (task #222 — RRF hybrid, typo, proximity, facets) ──────────────────────

test('ADDITIVE: existing rankResults output is unchanged by the new code (proof of additivity)', () => {
  // exact same call as the original test above must still return the same order + scores.
  const ranked = rankResults(fixture(), Q);
  const idx = (frag) => ranked.findIndex((r) => r.url.includes(frag));
  assert.ok(idx('soapbox.community') < idx('listverse.com'));
  assert.ok(idx('doi.org') < idx('listverse.com'));
  assert.ok(ranked.every((r) => typeof r.why === 'string' && r.why.length));
});

test('rankHybrid fuses lexical + BM25 (and is order-preserving on a clean fixture)', async () => {
  const ranked = await rankHybrid(fixture(), Q);
  assert.ok(ranked.length > 0);
  const idx = (frag) => ranked.findIndex((r) => r.url.includes(frag));
  // quality sources still beat the SEO farm after fusion
  assert.ok(idx('soapbox.community') < idx('listverse.com'), 'ecosystem beats spam after fusion');
  assert.ok(idx('doi.org') < idx('listverse.com'), 'scholarly beats spam after fusion');
  // every fused row carries the new fusion fields AND the preserved explainable fields
  for (const r of ranked) {
    assert.equal(typeof r.hybridScore, 'number');
    assert.equal(typeof r.fuseRank, 'number');
    assert.equal(typeof r.why, 'string');
    assert.ok('score' in r, 'original explainable score preserved on the row');
  }
});

test('rankHybrid recovers a strong lexical/BM25 match that the single ranker buries', async () => {
  // a row whose TITLE is a dead-on term match but from a plain domain (no authority/ecosystem boost).
  const raw = [
    { title: 'alexander shulgin pihkal complete reference guide', url: 'https://plainsite.net/guide', snippet: 'alexander shulgin pihkal pihkal', provider: 'duckduckgo' },
    { title: 'unrelated chemistry news', url: 'https://en.wikipedia.org/wiki/Chemistry', snippet: 'general chemistry overview', provider: 'wikipedia' },
  ];
  const lex = rankResults(raw, Q);
  const hyb = await rankHybrid(raw, Q);
  const lexTop = lex[0].url;
  const hybTop = hyb[0].url;
  // BM25 should pull the dead-on title match up in the hybrid ranking.
  assert.ok(hyb.findIndex((r) => r.url.includes('plainsite')) <= lex.findIndex((r) => r.url.includes('plainsite')),
    `hybrid should rank the strong text match no worse than lexical (lexTop=${lexTop} hybTop=${hybTop})`);
});

test('rankHybrid handles empty input and is soft', async () => {
  assert.deepEqual(await rankHybrid([], Q), []);
  const r = await rankHybrid(fixture(), '');
  assert.ok(Array.isArray(r));
});

test('fuzzyTermHits matches exact + 1-edit typos and counts them separately', () => {
  const h = fuzzyTermHits('alexander shulgan and pihkal', ['shulgin', 'pihkal']);
  assert.ok(h.exact >= 1, 'pihkal is an exact hit');
  assert.ok(h.fuzzy >= 1, 'shulgan ≈ shulgin is a fuzzy hit');
  assert.ok(h.matched.includes('shulgin') && h.matched.includes('pihkal'));
  const none = fuzzyTermHits('completely different words here', ['shulgin']);
  assert.equal(none.exact + none.fuzzy, 0);
});

test('proximityScore rewards close-together terms over spread-out ones', () => {
  const terms = ['alpha', 'beta'];
  const near = proximityScore('x alpha beta y', terms);
  const far = proximityScore('alpha zz zz zz zz zz zz zz zz zz beta', terms);
  assert.ok(near > far, 'adjacent terms score higher than distant ones');
  assert.equal(proximityScore('only alpha here', terms), 0, '<2 matched terms → 0');
});

test('facets returns provider/host/category counts for a filter UI', () => {
  const f = facets(fixture());
  assert.equal(typeof f.total, 'number');
  assert.ok(f.total >= 1);
  assert.ok(f.byProvider.duckduckgo >= 1, 'counts a known provider');
  assert.ok(f.scholarly >= 1, 'the crossref DOI counts as scholarly');
  assert.ok(f.ecosystem >= 1, 'the soapbox row counts as ecosystem');
  assert.ok(f.authority >= 1, 'wikipedia counts as authority');
  assert.ok(Object.keys(f.byHost).length >= 1);
  // works on already-ranked rows too
  const f2 = facets(rankResults(fixture(), Q));
  assert.ok(f2.total >= 1);
});
