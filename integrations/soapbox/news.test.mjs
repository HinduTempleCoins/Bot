import { test } from 'node:test';
import assert from 'node:assert';
import { dedupCap, LIVE_STREAMS, liveEmbedHtml, gdeltItems, newsFeed, esc, __setFetch } from './news.mjs';

test('dedupCap removes normalized-duplicate titles and caps length', () => {
  const items = [
    { title: 'Bitcoin ETF approved' },
    { title: 'bitcoin etf approved!!' }, // dup (normalized)
    { title: 'Ethereum upgrade ships' },
    { title: 'War escalates in region' },
  ];
  const out = dedupCap(items, 2);
  assert.equal(out.length, 2, 'capped');
  assert.equal(out[0].title, 'Bitcoin ETF approved');
  assert.equal(out[1].title, 'Ethereum upgrade ships', 'the dup was skipped, not kept');
});

test('dedupCap drops empty/falsy titles', () => {
  const out = dedupCap([{ title: '' }, null, { title: 'Real story' }], 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Real story');
});

test('LIVE_STREAMS are link-out /live URLs (no broken embeds)', () => {
  assert.ok(LIVE_STREAMS.length >= 6);
  for (const s of LIVE_STREAMS) {
    assert.ok(s.name);
    assert.match(s.url, /^https:\/\/www\.youtube\.com\/@.+\/live$/);
  }
});

test('LIVE_STREAMS carry keyless live_stream?channel= embed URLs for verified channels', () => {
  for (const s of LIVE_STREAMS) {
    if (s.channelId && s.verified) {
      assert.equal(s.embedUrl, `https://www.youtube.com/embed/live_stream?channel=${s.channelId}`);
      assert.match(s.embedUrl, /^https:\/\/www\.youtube\.com\/embed\/live_stream\?channel=.+$/);
    } else {
      assert.equal(s.embedUrl, null, 'unverified/placeholder channels emit no embed url');
    }
  }
});

test('liveEmbedHtml renders escaped live_stream?channel= iframes for verified channels', () => {
  const html = liveEmbedHtml();
  const verified = LIVE_STREAMS.filter((s) => s.embedUrl && s.verified);
  assert.ok(verified.length >= 1, 'at least one verified stream to render');
  for (const s of verified) {
    assert.ok(html.includes(`src="${s.embedUrl}"`), `iframe for ${s.name} present`);
  }
  assert.match(html, /<iframe /);
  assert.match(html, /youtube\.com\/embed\/live_stream\?channel=/);
});

test('liveEmbedHtml escapes embed output and link-outs an unverified channel id (honest)', () => {
  const streams = [
    { name: '<b>Hax</b>', url: 'https://x/"<>', embedUrl: 'https://www.youtube.com/embed/live_stream?channel=UC"<>', verified: true },
    { name: 'Unverified Outlet', url: 'https://www.youtube.com/@u/live', embedUrl: null, verified: false },
  ];
  const html = liveEmbedHtml(streams);
  // hostile name + embed url are escaped, never emitted raw
  assert.ok(!html.includes('<b>Hax</b>'), 'name is escaped');
  assert.ok(html.includes('&lt;b&gt;Hax&lt;/b&gt;'));
  assert.ok(!html.includes('channel=UC"<>'), 'raw quote/angle not emitted in src');
  assert.ok(html.includes('channel=UC&quot;&lt;&gt;'), 'embed url is escaped');
  // the unverified-only entry link-outs honestly (no fabricated embed)
  assert.ok(html.includes('channel id unverified'), 'unverified channel link-outs honestly');
});

test('liveEmbedHtml emits NO iframe when every channel is unverified/placeholder', () => {
  const streams = [
    { name: 'Placeholder One', url: 'https://www.youtube.com/@one/live', embedUrl: null, verified: false },
    { name: 'Placeholder Two', url: 'https://www.youtube.com/@two/live', embedUrl: null, verified: false },
  ];
  const html = liveEmbedHtml(streams);
  assert.ok(!html.includes('<iframe'), 'no iframe for an all-unverified set');
  assert.ok(html.includes('channel id unverified'));
});

test('esc escapes the five HTML-significant chars', () => {
  assert.equal(esc(`<a href="x" id='y'>&</a>`), '&lt;a href=&quot;x&quot; id=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('gdeltItems renders from a canned injected response', async () => {
  __setFetch(async () => ({
    ok: true,
    json: async () => ({
      articles: [
        { title: 'Major event unfolds', url: 'https://news.example/1', domain: 'news.example', seendate: '20260603T120000Z' },
        { title: '', url: 'https://x/blank', domain: 'x' }, // dropped (no title)
      ],
    }),
  }));
  const items = await gdeltItems();
  __setFetch(null);
  assert.equal(items.length, 1, 'titleless article dropped');
  assert.equal(items[0].title, 'Major event unfolds');
  assert.equal(items[0].url, 'https://news.example/1');
  assert.equal(items[0].source, 'GDELT · news.example');
});

test('gdeltItems soft-fails to [] on a non-ok / throwing fetch', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await gdeltItems(), []);
  __setFetch(async () => { throw new Error('network down'); });
  assert.deepEqual(await gdeltItems(), []);
  __setFetch(null);
});

test('newsFeed includes a gdelt section additively and keeps existing sections', async () => {
  // keep the whole feed offline + fast: inject fetch on news.mjs and the modules it pulls from
  // (comms-parser for crypto/world headlines, chyron for quakes/weather). Only the test file does this.
  const stub = async (u) => {
    const s = String(u);
    if (s.includes('gdeltproject.org')) {
      return { ok: true, json: async () => ({ articles: [{ title: 'Global headline', url: 'https://g/1', domain: 'g.example', seendate: '20260603T010000Z' }] }) };
    }
    return { ok: true, text: async () => '', json: async () => ({ results: [], articles: [], features: [] }) };
  };
  __setFetch(stub);
  const cp = await import('../comms-parser.mjs');
  const chy = await import('./chyron.mjs');
  cp.__setFetch?.(stub);
  chy.__setFetch?.(stub);
  const feed = await newsFeed();
  __setFetch(null);
  cp.__setFetch?.(null);
  chy.__setFetch?.(null);
  // existing sections still present
  for (const k of ['crypto', 'world', 'gov', 'disasters', 'live']) {
    assert.ok(k in feed, `section ${k} present`);
  }
  // new section present and populated from the canned GDELT response
  assert.ok(Array.isArray(feed.gdelt));
  assert.equal(feed.gdelt[0].title, 'Global headline');
  // live still the curated list
  assert.ok(feed.live.length >= 6);
});
