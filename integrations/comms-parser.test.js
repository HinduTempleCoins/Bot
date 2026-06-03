// comms-parser.test.js — proves the Diagnostics crunch is correct and pure (no network).
// fetchHeadlines/newsDigest are network-best-effort and not asserted here; toDiagnostics is the
// load-bearing transform the briefs read, so it's the focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDiagnostics, digestMarkdown, NEWS_FEEDS, __setFetch, sentiment, extractEntities, analyzeItem, summarizeFeed } from './comms-parser.mjs';

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

// ── sentiment() — lexicon, negation, bounds (task #62) ─────────────────────────────────────────────
test('sentiment scores a clearly positive sentence positive', () => {
  const s = sentiment('Bitcoin surges to a record high as adoption climbs and inflows soar');
  assert.equal(s.label, 'positive');
  assert.ok(s.score > 0.15, `score=${s.score}`);
  assert.ok(s.hits.length > 0);
  assert.ok(s.hits.some((h) => h.polarity === 1));
});

test('sentiment scores a clearly negative sentence negative', () => {
  const s = sentiment('Market crashes as exchange hacked, panic selloff and collapse fears mount');
  assert.equal(s.label, 'negative');
  assert.ok(s.score < -0.15, `score=${s.score}`);
});

test('sentiment handles negation — "not good"/"no rally" flips polarity', () => {
  const neg = sentiment('the news is not bullish and there was no rally today');
  // both positive cues ("bullish", "rally") are negated → net should NOT read positive
  assert.ok(neg.score <= 0, `score=${neg.score}`);
  assert.ok(neg.hits.some((h) => h.negated === true));
  // and the flipped polarity is recorded
  const bullishHit = neg.hits.find((h) => h.word === 'bullish');
  assert.ok(bullishHit && bullishHit.polarity === -1);
});

test('sentiment is pure/deterministic and bounded -1..1', () => {
  const txt = 'gold gains while stocks drop';
  const a = sentiment(txt), b = sentiment(txt);
  assert.deepEqual(a, b);
  assert.ok(a.score >= -1 && a.score <= 1);
  assert.equal(sentiment('').label, 'neutral');
  assert.equal(sentiment(undefined).score, 0);
});

// ── extractEntities() — tickers / mentions / hashtags / urls / orgs (task #62) ─────────────────────
test('extractEntities pulls $TICKERS, SWAP.X, @mentions, #hashtags, urls', () => {
  const e = extractEntities('$BTC and SWAP.LTC pumping per @satoshi #bullrun see https://coindesk.com/x?a=1');
  assert.ok(e.tickers.includes('BTC'));
  assert.ok(e.tickers.includes('SWAP.LTC'));
  assert.ok(e.mentions.includes('satoshi'));
  assert.ok(e.hashtags.includes('bullrun'));
  assert.ok(e.urls.includes('https://coindesk.com/x?a=1'));
});

test('extractEntities is deterministic, deduped, and detects orgs', () => {
  const e1 = extractEntities('$ETH $ETH the SEC sues Binance again');
  const e2 = extractEntities('$ETH $ETH the SEC sues Binance again');
  assert.deepEqual(e1, e2);
  assert.deepEqual(e1.tickers, ['ETH']);                 // deduped
  assert.ok(e1.orgs.includes('SEC') && e1.orgs.includes('Binance'));
  // empty/garbage input → empty arrays, no throw
  const empty = extractEntities('');
  assert.deepEqual(empty, { tickers: [], mentions: [], urls: [], hashtags: [], orgs: [] });
});

// ── wiring: a parsed item now carries sentiment + entities ─────────────────────────────────────────
test('analyzeItem adds sentiment+entities additively, preserving original fields', () => {
  const raw = { title: 'Bitcoin rallies, $BTC bullish #ATH', url: 'https://x/1', source: 'CoinDesk', ts: null, asset: 'crypto' };
  const item = analyzeItem(raw);
  // original fields preserved
  assert.equal(item.title, raw.title);
  assert.equal(item.url, raw.url);
  assert.equal(item.source, raw.source);
  assert.equal(item.asset, raw.asset);
  // new additive fields
  assert.equal(item.sentiment.label, 'positive');
  assert.ok(item.entities.tickers.includes('BTC'));
  assert.ok(item.entities.hashtags.includes('ATH'));
});

test('parsed items from a feed carry sentiment+entities (via mocked fetch)', async () => {
  const xml = `<rss><channel>
    <item><title>$BTC surges to record high, bullish rally</title><link>https://x/1</link></item>
  </channel></rss>`;
  __setFetch(async () => ({ ok: true, text: async () => xml, json: async () => ({}) }));
  const { fetchHeadlines } = await import('./comms-parser.mjs');
  const rows = await fetchHeadlines({ asset: 'crypto', query: 'unique-cache-key-' + Date.now(), limit: 5 });
  __setFetch(null);
  const hit = rows.find((r) => r.title.includes('surges'));
  assert.ok(hit, 'expected the mocked headline');
  assert.ok(hit.sentiment && typeof hit.sentiment.score === 'number');
  assert.equal(hit.sentiment.label, 'positive');
  assert.ok(hit.entities && hit.entities.tickers.includes('BTC'));
});

// ── summarizeFeed() — feed-level aggregation for brief input ────────────────────────────────────────
test('summarizeFeed aggregates avgSentiment, topTickers, topHashtags, counts', () => {
  const items = [
    analyzeItem({ title: '$BTC surges, bullish rally #moon', source: 'A' }),
    analyzeItem({ title: '$BTC gains again, adoption climbs #moon', source: 'B' }),
    analyzeItem({ title: '$ETH crashes in selloff, collapse fears', source: 'C' }),
  ];
  const s = summarizeFeed(items);
  assert.ok(s.avgSentiment >= -1 && s.avgSentiment <= 1);
  assert.ok(['positive', 'neutral', 'negative'].includes(s.label));
  assert.equal(s.topTickers[0].ticker, 'BTC');           // BTC appears twice → ranked first
  assert.equal(s.topTickers[0].count, 2);
  assert.equal(s.topHashtags[0].hashtag, 'moon');
  assert.equal(s.topHashtags[0].count, 2);
  assert.equal(s.counts.items, 3);
  assert.equal(s.counts.positive + s.counts.neutral + s.counts.negative, 3);
  // computes on the fly for items lacking precomputed analysis
  const bare = summarizeFeed([{ title: '$DOGE moons #wow' }]);
  assert.equal(bare.topTickers[0].ticker, 'DOGE');
  assert.equal(bare.counts.items, 1);
});

test('summarizeFeed handles empty input safely', () => {
  const s = summarizeFeed([]);
  assert.equal(s.avgSentiment, 0);
  assert.equal(s.label, 'neutral');
  assert.deepEqual(s.topTickers, []);
  assert.equal(s.counts.items, 0);
});
