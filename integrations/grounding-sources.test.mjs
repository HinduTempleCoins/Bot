// grounding-sources.test.mjs — OFFLINE tests for the shared evidence aggregator. No network: every
// source is INJECTED via the `sources` param with deterministic fakes. Covers:
//   1. rankSources tiering (gov > scholarly > wiki > web) + confidence tiebreak (pure).
//   2. sourcesFor fusion across injected fake sources, dedup, cap, ordering.
//   3. groundClaim shape + strongestSourceType.
//   4. soft-fail: a throwing source contributes nothing, never blows up the call.
//
// Run ONLY this file:  node --test integrations/grounding-sources.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankSources, sourcesFor, groundClaim, SOURCE_TIERS } from './grounding-sources.mjs';

// Injected fakes — same signatures the real adapters call.
const fakeGov = (topic) => [
  { title: `Federal Register: ${topic}`, url: 'https://federalregister.gov/a', agency: 'EPA', type: 'Rule', date: '2026-01-01' },
];
const fakeScholarly = (topic) => ({
  results: [
    { title: `A study of ${topic}`, url: 'https://doi.org/10.1/abc', authors: ['A. Author', 'B. Writer'], year: 2025 },
  ],
});
const fakeWiki = (topic, { provider } = {}) => {
  if (provider === 'wikipedia') return [{ title: `${topic} (Wikipedia)`, url: 'https://en.wikipedia.org/wiki/X', snippet: 'an encyclopedia entry' }];
  if (provider === 'wikidata') return [{ title: `${topic} (Wikidata)`, url: 'https://www.wikidata.org/wiki/Q1', snippet: 'a structured fact' }];
  return [];
};
const fakeWeb = (topic) => [
  { title: `Blog post about ${topic}`, url: 'https://random-blog.example/post', snippet: 'someone wrote this' },
];

const allFakes = { gov: fakeGov, scholarly: fakeScholarly, wiki: fakeWiki, web: fakeWeb };

test('rankSources orders by authority tier: gov > scholarly > wiki > web', () => {
  const mixed = [
    { title: 'w', url: 'u-web', sourceType: 'web', confidence: 99 },
    { title: 'k', url: 'u-wiki', sourceType: 'wiki', confidence: 10 },
    { title: 'g', url: 'u-gov', sourceType: 'gov', confidence: 1 },
    { title: 's', url: 'u-sch', sourceType: 'scholarly', confidence: 50 },
  ];
  const ranked = rankSources(mixed);
  assert.deepEqual(ranked.map((r) => r.sourceType), ['gov', 'scholarly', 'wiki', 'web']);
  // high-confidence web must NOT beat low-confidence gov — tier dominates.
  assert.equal(ranked[0].sourceType, 'gov');
  assert.equal(ranked[0].confidence, 1);
});

test('rankSources tiebreaks by confidence DESC within a tier', () => {
  const sameType = [
    { title: 'lo', url: 'b', sourceType: 'scholarly', confidence: 20 },
    { title: 'hi', url: 'a', sourceType: 'scholarly', confidence: 80 },
    { title: 'mid', url: 'c', sourceType: 'scholarly', confidence: 50 },
  ];
  assert.deepEqual(rankSources(sameType).map((r) => r.confidence), [80, 50, 20]);
});

test('rankSources is pure (does not mutate input) and tolerates junk', () => {
  const input = [{ title: 't', url: 'u', sourceType: 'web', confidence: 5 }];
  const copy = JSON.parse(JSON.stringify(input));
  const out = rankSources([...input, null, undefined, 42]);
  assert.deepEqual(input, copy);            // unchanged
  assert.equal(out.length, 1);              // junk filtered
  assert.equal(SOURCE_TIERS.gov > SOURCE_TIERS.web, true);
});

test('sourcesFor fuses injected fakes, ranks gov first, web last', async () => {
  const out = await sourcesFor('lithium', { sources: allFakes });
  assert.ok(out.length >= 4, `expected at least 4 results, got ${out.length}`);
  assert.equal(out[0].sourceType, 'gov');
  assert.equal(out[out.length - 1].sourceType, 'web');
  // every row carries the full evidence shape.
  for (const e of out) {
    assert.ok(e.title && e.url, 'title + url present');
    assert.ok(['gov', 'scholarly', 'wiki', 'web'].includes(e.sourceType));
    assert.equal(typeof e.confidence, 'number');
    assert.ok(e.provenance && e.provenance.source && e.provenance.freshnessClass, 'provenance envelope attached');
  }
});

test('sourcesFor computes higher confidence for gov than web', async () => {
  const out = await sourcesFor('debt', { sources: allFakes });
  const gov = out.find((e) => e.sourceType === 'gov');
  const web = out.find((e) => e.sourceType === 'web');
  assert.ok(gov && web);
  assert.ok(gov.confidence > web.confidence, `gov(${gov.confidence}) should exceed web(${web.confidence})`);
});

test('sourcesFor respects max cap', async () => {
  const out = await sourcesFor('anything', { max: 2, sources: allFakes });
  assert.equal(out.length, 2);
  assert.equal(out[0].sourceType, 'gov');     // most authoritative survives the cap
});

test('sourcesFor dedupes by url', async () => {
  const dupGov = () => [
    { title: 'dup1', url: 'https://same.example/x', agency: 'A' },
    { title: 'dup2', url: 'https://same.example/x', agency: 'B' },
  ];
  const out = await sourcesFor('dup', { sources: { gov: dupGov, scholarly: () => [], wiki: () => [], web: () => [] } });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'dup1');         // first (highest-ranked) survives
});

test('sourcesFor soft-fails: a throwing source contributes nothing', async () => {
  const boom = () => { throw new Error('source down'); };
  const out = await sourcesFor('topic', { sources: { gov: boom, scholarly: fakeScholarly, wiki: () => [], web: () => [] } });
  assert.ok(out.length >= 1);
  assert.ok(!out.some((e) => e.sourceType === 'gov'));   // gov dropped, no crash
  assert.equal(out[0].sourceType, 'scholarly');
});

test('sourcesFor empty topic returns []', async () => {
  assert.deepEqual(await sourcesFor('', { sources: allFakes }), []);
  assert.deepEqual(await sourcesFor('   ', { sources: allFakes }), []);
});

test('groundClaim returns {claim, evidence, strongestSourceType}', async () => {
  const g = await groundClaim('Lithium carbonate costs money', { sources: allFakes });
  assert.equal(g.claim, 'Lithium carbonate costs money');
  assert.ok(Array.isArray(g.evidence));
  assert.equal(g.strongestSourceType, 'gov');           // gov present → strongest tier
});

test('groundClaim strongestSourceType reflects best available tier', async () => {
  const g = await groundClaim('claim', { sources: { gov: () => [], scholarly: () => [], wiki: fakeWiki, web: fakeWeb } });
  assert.equal(g.strongestSourceType, 'wiki');           // no gov/scholarly → wiki is best
});

test('groundClaim with no evidence → strongestSourceType null', async () => {
  const none = { gov: () => [], scholarly: () => [], wiki: () => [], web: () => [] };
  const g = await groundClaim('nothing matches', { sources: none });
  assert.deepEqual(g.evidence, []);
  assert.equal(g.strongestSourceType, null);
});
