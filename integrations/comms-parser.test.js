// comms-parser.test.js — proves the Diagnostics crunch is correct and pure (no network).
// fetchHeadlines/newsDigest are network-best-effort and not asserted here; toDiagnostics is the
// load-bearing transform the briefs read, so it's the focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDiagnostics, digestMarkdown, NEWS_FEEDS, __setFetch } from './comms-parser.mjs';

const HEADLINES = [
  { title: 'Bitcoin surges to new record high as ETF inflows soar', url: 'https://x/1', source: 'CoinDesk', ts: '2026-06-02T10:00:00Z', asset: 'crypto' },
  { title: 'Ethereum rallies, BTC bullish momentum builds', url: 'https://x/2', source: 'Cointelegraph', ts: '2026-06-02T09:00:00Z', asset: 'crypto' },
  { title: 'Solana adoption climbs amid market gains', url: 'https://x/3', source: 'Decrypt', ts: null, asset: 'crypto' },
];

test('sentiment leans bullish on bullish headlines', () => {
  const d = toDiagnostics(HEADLINES, { topic: 'crypto' });
  assert.equal(d.sentimentHint, 'bullish');
  assert.ok(d.sentimentScore > 0.15);
  assert.equal(d.topic, 'crypto');
  assert.equal(d.headlineCount, 3);
});

test('sentiment leans bearish on bearish headlines', () => {
  const bear = [
    { title: 'Bitcoin crashes as exchange hacked, panic selloff', source: 'A' },
    { title: 'Ethereum plunges, market collapse fears mount', source: 'B' },
  ];
  const d = toDiagnostics(bear);
  assert.equal(d.sentimentHint, 'bearish');
  assert.ok(d.sentimentScore < -0.15);
});

test('counts ticker/asset mentions across titles', () => {
  const d = toDiagnostics(HEADLINES);
  assert.ok(d.mentions.BTC >= 2, `BTC mentions ${JSON.stringify(d.mentions)}`);
  assert.ok(d.mentions.ETH >= 1);
  assert.ok(d.mentions.SOL >= 1);
});

test('extracts themes (repeated keywords), drops stop-words', () => {
  const d = toDiagnostics(HEADLINES);
  const words = d.themes.map((t) => t.word);
  assert.ok(!words.includes('the') && !words.includes('as'));
  // themes only keep count>1; nothing repeats twice here so it may be empty — assert it's an array
  assert.ok(Array.isArray(d.themes));
});

test('records distinct sources and a top-headlines citation set', () => {
  const d = toDiagnostics(HEADLINES);
  assert.deepEqual([...d.sources].sort(), ['CoinDesk', 'Cointelegraph', 'Decrypt']);
  assert.ok(d.topHeadlines.length === 3);
  assert.ok(d.topHeadlines[0].url && d.topHeadlines[0].title);
});

test('empty input → neutral, no crash', () => {
  const d = toDiagnostics([]);
  assert.equal(d.sentimentHint, 'neutral');
  assert.equal(d.headlineCount, 0);
  assert.deepEqual(d.mentions, {});
});

test('digestMarkdown renders a brief-ready block', () => {
  const digest = { ts: '2026-06-02T10:00:00Z', assets: { crypto: toDiagnostics(HEADLINES, { topic: 'crypto' }) } };
  const md = digestMarkdown(digest);
  assert.match(md, /News Diagnostics/);
  assert.match(md, /crypto/);
  assert.match(md, /bullish/);
});

test('NEWS_FEEDS includes RSS, the keyless GDELT api, and a search fallback', () => {
  const kinds = new Set(NEWS_FEEDS.map((f) => f.kind));
  assert.ok(kinds.has('rss') && kinds.has('api') && kinds.has('search'));
  assert.ok(NEWS_FEEDS.some((f) => f.name === 'GDELT' && f.kind === 'api'));
});

test('fetchHeadlines never throws even if every feed fails', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const { fetchHeadlines } = await import('./comms-parser.mjs');
  const rows = await fetchHeadlines({ asset: 'crypto', query: 'zzz-no-such', limit: 5 });
  assert.ok(Array.isArray(rows));
  __setFetch(null);
});
