// resource-center-chat.test.mjs — offline tests for the NL → Resource-Center chat layer.
// node:test, fully OFFLINE: we inject a canned resource-center via __setResourceCenter so nothing
// touches the network or disk. Run: node --test integrations/resource-center-chat.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ask,
  handleChat,
  formatForChat,
  toBrief,
  RateLimiter,
  __setResourceCenter,
} from './resource-center-chat.mjs';

// A canned snapshot in the engine's shape. Enough to match a few queries.
const SNAPSHOT = {
  ts: '2026-06-03T12:00:00.000Z',
  metrics: {
    hiveEngine: {
      totalTokens: 1264,
      activeMarkets: 412,
      totalVolumeHive: 98765,
      topVolume: [{ symbol: 'SWAP.HIVE', volume: 50000 }, { symbol: 'LEO', volume: 12000 }],
      topGainers: [{ symbol: 'PIZZA', change: 14.2 }],
      topLosers: [{ symbol: 'BEE', change: -8.1 }],
    },
    metals: { gold: { price: 2345.67, change: 0.83 }, silver: { price: 29.4, change: -1.1 } },
    indices: { dow: { price: 39000, change: 0.2 }, vix: { price: 14.5, change: -2.0 } },
    forex: [{ pair: 'EUR/USD', rate: 1.0823, change: 0.05 }],
    dxy: { price: 104.2, change: -0.1 },
    riskOn: 'risk-on (VIX<20)',
  },
  marketEntries: [
    { market: 'SWAP.LTC/SWAP.HIVE', venue: 'TribalDEX', chain: 'hive', edgePct: 2.4, reason: 'persistent spread' },
  ],
  firstTrade: { account: 'angelicalist', hiveBuyingPower: 120, edge: 'SWAP.DOGE arbitrage', suggested: 'buy on HE, sell external' },
  news: { assets: [{ topic: 'gold', sentimentHint: 'bullish', sentimentScore: 0.6, headlineCount: 9, themes: [{ word: 'inflation' }] }] },
};

function withSnapshot() {
  __setResourceCenter(async () => SNAPSHOT);
}

test('ask returns a cited answer from the injected RC', async () => {
  withSnapshot();
  const r = await ask('what is the gold price');
  assert.equal(typeof r.answer, 'string');
  assert.ok(r.answer.length > 0);
  assert.ok(Array.isArray(r.sources) && r.sources.length >= 1, 'has sources');
  // every source is cited with a title + url
  for (const s of r.sources) {
    assert.ok(s.title, 'source has title');
    assert.ok(typeof s.url === 'string', 'source has url field');
  }
  assert.ok(/gold/i.test(r.sources[0].title) || /gold/i.test(r.answer), 'answer is about gold');
  assert.ok(r.confidence > 0 && r.confidence <= 1, 'confidence in (0,1]');
});

test('ask matches Hive-Engine token queries', async () => {
  withSnapshot();
  const r = await ask('hive-engine token volume');
  assert.ok(r.sources.length >= 1);
  assert.ok(r.sources.some((s) => /hive-engine/i.test(s.title)));
});

test('ask honestly reports "nothing found" on an empty snapshot', async () => {
  __setResourceCenter(async () => null);
  const r = await ask('gold price');
  assert.equal(r.sources.length, 0);
  assert.equal(r.confidence, 0);
  assert.ok(/nothing found/i.test(r.answer), `honest miss, got: ${r.answer}`);
});

test('ask honestly reports a miss when data exists but nothing matches', async () => {
  withSnapshot();
  const r = await ask('zzzqqq unrelated nonsense termxyz');
  assert.equal(r.sources.length, 0);
  assert.equal(r.confidence, 0);
  assert.ok(/couldn't find|could not find/i.test(r.answer));
});

test('ask never makes an unsourced positive claim', async () => {
  withSnapshot();
  const r = await ask('silver');
  // any non-empty source list, OR an explicit honest no-data message
  if (r.sources.length === 0) {
    assert.ok(/nothing found|couldn't find|could not find|unavailable/i.test(r.answer));
  } else {
    assert.ok(r.confidence > 0);
  }
});

test('ask respects topK', async () => {
  withSnapshot();
  const r = await ask('gold silver dow vix forex hive token market trade', { topK: 2 });
  assert.ok(r.sources.length <= 2, `topK honored, got ${r.sources.length}`);
});

test('ask passes through a pre-built RC result', async () => {
  __setResourceCenter(async () => ({
    answer: 'pre-built answer',
    sources: [{ title: 'T', url: 'http://x', snippet: 'snip' }],
    confidence: 0.9,
  }));
  const r = await ask('anything');
  assert.equal(r.answer, 'pre-built answer');
  assert.equal(r.confidence, 0.9);
  assert.equal(r.sources[0].title, 'T');
});

test('handleChat routes !resource and formats with citations', async () => {
  withSnapshot();
  const out = await handleChat({ user: 'u1', text: '!resource gold price' });
  assert.equal(out.kind, 'resource');
  assert.ok(/Sources:/.test(out.reply), 'reply includes a Sources block');
  assert.ok(/\[1\]/.test(out.reply), 'reply numbers the sources');
});

test('handleChat routes the !rc alias', async () => {
  withSnapshot();
  const out = await handleChat({ user: 'u1', text: '!rc hive-engine tokens' });
  assert.equal(out.kind, 'resource');
  assert.ok(/Sources:/.test(out.reply));
});

test('handleChat nudges on a bare !resource with no question', async () => {
  withSnapshot();
  const out = await handleChat({ user: 'u1', text: '!resource' });
  assert.equal(out.kind, 'nudge');
  assert.ok(/Usage/i.test(out.reply));
});

test('handleChat nudges on empty text', async () => {
  withSnapshot();
  const out = await handleChat({ user: 'u1', text: '   ' });
  assert.equal(out.kind, 'nudge');
});

test('formatForChat includes source links', () => {
  const result = {
    answer: 'Gold is up.',
    sources: [{ title: 'Gold (spot)', url: 'https://www.kitco.com/', snippet: 'x' }],
    confidence: 0.8,
  };
  const s = formatForChat(result);
  assert.ok(s.includes('https://www.kitco.com/'), 'link present');
  assert.ok(s.includes('Gold (spot)'), 'title present');
  assert.ok(s.includes('Gold is up.'), 'synthesis present');
});

test('formatForChat is honest when there are no sources', () => {
  const s = formatForChat({ answer: 'Nothing found.', sources: [], confidence: 0 });
  assert.ok(/Nothing found/.test(s));
  assert.ok(!/Sources:/.test(s));
});

test('toBrief produces a brief snippet with linked sources', () => {
  const result = {
    answer: 'Gold $2345.67 (+0.83%).',
    sources: [{ title: 'Gold (spot)', url: 'https://www.kitco.com/', snippet: 'gold spot' }],
    confidence: 0.7,
  };
  const b = toBrief(result, 'gold price');
  assert.ok(b.includes('### Resource Center'), 'has heading');
  assert.ok(b.includes('gold price'), 'includes the query');
  assert.ok(b.includes('Gold (spot)'), 'includes source title');
  assert.ok(b.includes('https://www.kitco.com/'), 'includes source link');
  assert.ok(/Confidence/i.test(b), 'includes confidence');
});

test('toBrief is honest with no sources', () => {
  const b = toBrief({ answer: 'Nothing found.', sources: [], confidence: 0 });
  assert.ok(/No sources/i.test(b));
});

test('a thrown RC soft-fails to an honest reply (no throw)', async () => {
  __setResourceCenter(async () => { throw new Error('engine boom'); });
  // ask() must not throw
  const r = await ask('gold');
  assert.equal(r.sources.length, 0);
  assert.ok(/unavailable/i.test(r.answer));
  // handleChat must not throw either
  const out = await handleChat({ user: 'u1', text: '!resource gold' });
  assert.equal(out.kind, 'resource');
  assert.ok(/unavailable/i.test(out.reply));
});

test('rate limiter blocks after a burst', () => {
  let t = 0;
  const rl = new RateLimiter({ capacity: 2, windowMs: 1000, now: () => t });
  assert.equal(rl.allow('u'), true);
  assert.equal(rl.allow('u'), true);
  assert.equal(rl.allow('u'), false, 'blocked after capacity exhausted');
  // refill after the window
  t = 1000;
  assert.equal(rl.allow('u'), true, 'refilled after window');
});

test('handleChat returns rate-limited after a burst via shared limiter', async () => {
  withSnapshot();
  let t = 0;
  const limiter = new RateLimiter({ capacity: 1, windowMs: 1000, now: () => t });
  const first = await handleChat({ user: 'u9', text: '!resource gold' }, { limiter });
  assert.equal(first.kind, 'resource');
  const second = await handleChat({ user: 'u9', text: '!resource gold' }, { limiter });
  assert.equal(second.kind, 'rate-limited');
});
