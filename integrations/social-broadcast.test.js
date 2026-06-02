// social-broadcast.test.js — node:test. Pure/offline: feed parsing + per-channel formatting +
// the plan shape. No network (latestItems/broadcastPlan are best-effort; the live path is the CLI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, formatForChannel, CHANNELS, FEEDS } from './social-broadcast.mjs';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Hathor — Announcements</title>
  <item><title>The Library opens</title><link>https://data.soapbox.community/announcements</link>
    <guid isPermaLink="false">a2-2026-06-02</guid><pubDate>2026-06-02T14:52:58.744Z</pubDate>
    <description>The Library is being readied.
— Hathor 𓂀, MELEK AI Witness</description></item>
  <item><title>Markets live</title><link>https://x.co/m</link><guid>a1</guid>
    <pubDate>2026-06-02T14:00:00Z</pubDate><description>Aggregator live.</description></item>
</channel></rss>`;

const MD = `# Hathor — Announcements

### [The Library opens](https://data.soapbox.community/announcements)

The Library is being readied. — Hathor 𓂀, MELEK AI Witness

[https://data.soapbox.community/announcements](https://data.soapbox.community/announcements)

2026-06-02T14:52:58.744Z`;

test('parseFeed reads RSS XML into normalized items', () => {
  const items = parseFeed(RSS, 'https://data.soapbox.community/announcements.xml');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'The Library opens');
  assert.equal(items[0].url, 'https://data.soapbox.community/announcements');
  assert.equal(items[0].ts, '2026-06-02T14:52:58.744Z');
  assert.ok(items[0].summary.includes('readied'));
  assert.ok(!items[0].summary.includes('Hathor 𓂀'), 'signature line stripped from summary');
});

test('parseFeed falls back to the Jina-markdown shape', () => {
  const items = parseFeed(MD, 'https://data.soapbox.community/announcements.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'The Library opens');
  assert.equal(items[0].ts, '2026-06-02T14:52:58.744Z');
  assert.ok(items[0].summary.includes('readied'));
});

test('parseFeed is best-effort (no throw on junk)', () => {
  assert.deepEqual(parseFeed('', 'u'), []);
  assert.deepEqual(parseFeed('not xml at all', 'u'), []);
  assert.deepEqual(parseFeed(null, 'u'), []);
});

test('formatForChannel renders each channel appropriately', () => {
  const item = { title: 'Hello', summary: 'World news', url: 'https://x.co/a', ts: '2026-06-02T10:00:00Z' };
  const tg = formatForChannel(item, 'telegram');
  assert.ok(tg.includes('*Hello*') && tg.includes('https://x.co/a'));

  const dc = formatForChannel(item, 'discord');
  assert.ok(dc.includes('**Hello**') && dc.includes('<https://x.co/a>'));

  const hv = formatForChannel(item, 'hive');
  assert.ok(hv.startsWith('## Hello') && hv.includes('Read more: https://x.co/a'));

  const unknown = formatForChannel(item, 'myspace');
  assert.ok(unknown.includes('Hello'));
});

test('twitter/x stays within 280 chars even for long items', () => {
  const long = { title: 'A'.repeat(120), summary: 'B'.repeat(400), url: 'https://x.co/abc' };
  const tw = formatForChannel(long, 'twitter/x');
  assert.ok(tw.length <= 280, `len ${tw.length}`);
  assert.ok(tw.includes('https://x.co/abc'), 'link preserved');
});

test('FEEDS includes the primary Hathor announcements RSS; CHANNELS are the four', () => {
  assert.ok(FEEDS.some((f) => f.primary && /announcements\.xml$/.test(f.url)));
  assert.deepEqual(CHANNELS, ['telegram', 'discord', 'twitter/x', 'hive']);
});
