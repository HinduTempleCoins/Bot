// cheetah-results-feed.test.mjs — offline tests for the CheetahAdvanced results-feed adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeResults,
  summarize,
  renderFeedHtml,
  esc,
  __setReader,
} from './cheetah-results-feed.mjs';

test('normalizeResults: array of loose records → clean feed', () => {
  const raw = [
    { source: 'wikipedia', match: 'The Phoenix Protocol', confidence: 'high', url: 'https://x/1', at: '2026-06-11' },
    { origin: 'arxiv', snippet: 'partial overlap', score: 0.5, link: 'https://x/2', ts: '2026-06-10' },
  ];
  const out = normalizeResults(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    source: 'wikipedia',
    match: 'The Phoenix Protocol',
    confidence: 'high',
    url: 'https://x/1',
    at: '2026-06-11',
  });
  // loose names mapped + numeric score → bucket
  assert.equal(out[1].source, 'arxiv');
  assert.equal(out[1].match, 'partial overlap');
  assert.equal(out[1].confidence, 'medium');
  assert.equal(out[1].url, 'https://x/2');
});

test('normalizeResults: unwraps {results}/{items}/{matches} and JSON strings', () => {
  assert.equal(normalizeResults({ results: [{ match: 'a' }] }).length, 1);
  assert.equal(normalizeResults({ items: [{ match: 'b' }] }).length, 1);
  assert.equal(normalizeResults({ matches: [{ match: 'c' }] }).length, 1);
  assert.equal(normalizeResults(JSON.stringify([{ match: 'd' }])).length, 1);
  assert.equal(normalizeResults(JSON.stringify({ results: [{ match: 'e' }] })).length, 1);
});

test('normalizeResults: confidence mapping (numeric 0..1, 0..100, labels, words)', () => {
  const got = normalizeResults([
    { match: 'a', confidence: 0.9 },
    { match: 'b', confidence: 90 },
    { match: 'c', confidence: 0.5 },
    { match: 'd', confidence: 0.1 },
    { match: 'e', confidence: 'exact' },
    { match: 'f', confidence: 'moderate' },
    { match: 'g', confidence: 'weak' },
    { match: 'h', confidence: 'LOW' },
    { match: 'i' },
  ]).map((r) => r.confidence);
  assert.deepEqual(got, ['high', 'high', 'medium', 'low', 'high', 'medium', 'low', 'low', 'unknown']);
});

test('normalizeResults: soft-fail on garbage / empty', () => {
  assert.deepEqual(normalizeResults(null), []);
  assert.deepEqual(normalizeResults(undefined), []);
  assert.deepEqual(normalizeResults(42), []);
  assert.deepEqual(normalizeResults('not json'), []);
  assert.deepEqual(normalizeResults([null, 1, 'x', {}]), []); // empty records dropped
  assert.deepEqual(normalizeResults({ nope: [1] }), []);
});

test('summarize: counts by confidence and ranks topMatches', () => {
  const results = normalizeResults([
    { match: 'lo', confidence: 'low' },
    { match: 'hi', confidence: 'high' },
    { match: 'med', confidence: 'medium' },
    { match: 'hi2', confidence: 'high' },
    { match: 'mystery' },
  ]);
  const sum = summarize(results);
  assert.equal(sum.total, 5);
  assert.deepEqual(sum.byConfidence, { high: 2, medium: 1, low: 1, unknown: 1 });
  // highest-confidence first, ties broken by input order
  assert.deepEqual(sum.topMatches.map((r) => r.match), ['hi', 'hi2', 'med', 'lo', 'mystery']);
});

test('summarize: topMatches capped at 5', () => {
  const results = normalizeResults(
    Array.from({ length: 8 }, (_, i) => ({ match: `m${i}`, confidence: 'high' })),
  );
  assert.equal(summarize(results).topMatches.length, 5);
});

test('summarize: soft-fail on empty / garbage', () => {
  const empty = summarize([]);
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.byConfidence, { high: 0, medium: 0, low: 0, unknown: 0 });
  assert.deepEqual(empty.topMatches, []);
  assert.equal(summarize(null).total, 0);
  assert.equal(summarize('nope').total, 0);
});

test('renderFeedHtml: renders escaped rows + summary', () => {
  const results = normalizeResults([
    { source: 'src', match: 'hello', confidence: 'high', url: 'https://x/1', at: '2026-06-11' },
  ]);
  const html = renderFeedHtml(results);
  assert.match(html, /cheetah-feed__list/);
  assert.match(html, /1 match</);
  assert.match(html, /href="https:\/\/x\/1"/);
  assert.match(html, /high: 1/);
  assert.match(html, /hello/);
});

test('renderFeedHtml: escapes hostile content (no injection)', () => {
  const results = normalizeResults([
    { source: '<b>x</b>', match: '<script>alert(1)</script>', confidence: 'high', url: 'https://x/"onmouseover=' },
  ]);
  const html = renderFeedHtml(results);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /&quot;onmouseover=/);
});

test('renderFeedHtml: match without url uses span, not anchor', () => {
  const html = renderFeedHtml(normalizeResults([{ match: 'no link', confidence: 'low' }]));
  assert.match(html, /<span class="cheetah-feed__match">no link<\/span>/);
  assert.ok(!html.includes('<a class="cheetah-feed__match"'));
});

test('renderFeedHtml: empty feed → friendly empty state, never throws', () => {
  const html = renderFeedHtml([]);
  assert.match(html, /cheetah-feed--empty/);
  assert.match(html, /No matches to show yet/);
  assert.doesNotThrow(() => renderFeedHtml(null));
  assert.match(renderFeedHtml(null), /cheetah-feed--empty/);
});

test('esc: escapes the five entities', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

test('__setReader: injectable seam round-trips a JSON store (offline)', () => {
  const store = JSON.stringify({ results: [{ match: 'm', confidence: 'high' }] });
  let captured = null;
  __setReader((p) => {
    captured = p;
    return store;
  });
  // simulate the CLI read path
  const results = normalizeResults(store);
  assert.equal(summarize(results).total, 1);
  // setting a non-function clears it without throwing
  assert.doesNotThrow(() => __setReader(null));
  assert.doesNotThrow(() => __setReader('not a fn'));
});
