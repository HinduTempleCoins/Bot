// rss-feed.test.mjs — OFFLINE tests for the RSS 2.0 / Atom feed parser (#276).
// No network. Asserts: RSS 2.0 + Atom parse to the normalized shape; CDATA + entity decode;
// dedupeItems by guid||link; sortByDate newest-first + undated last + no mutation; fetchFeed via an
// injected fetch (and via __setFetch); soft-fail-never-throw on malformed / non-OK / non-string input;
// render helpers escape a malicious title.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFeed, fetchFeed, dedupeItems, sortByDate, toIso, decodeEntities,
  renderItem, renderFeed, esc, __setFetch,
} from './rss-feed.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Bones &amp; Stones</title>
  <link>https://example.com/</link>
  <item>
    <title><![CDATA[First & Foremost]]></title>
    <link>https://example.com/a</link>
    <guid>guid-a</guid>
    <pubDate>Mon, 01 Jun 2026 12:00:00 GMT</pubDate>
    <description>Hello &lt;world&gt;</description>
  </item>
  <item>
    <title>Second</title>
    <link>https://example.com/b</link>
    <guid>guid-b</guid>
    <pubDate>Tue, 02 Jun 2026 12:00:00 GMT</pubDate>
    <description>second body</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <link rel="self" href="https://ex.org/atom.xml"/>
  <link rel="alternate" href="https://ex.org/"/>
  <entry>
    <title>Entry One</title>
    <link href="https://ex.org/1"/>
    <id>urn:id:1</id>
    <updated>2026-06-03T10:00:00Z</updated>
    <summary>sum one</summary>
  </entry>
  <entry>
    <title>Entry Two</title>
    <link href="https://ex.org/2"/>
    <id>urn:id:2</id>
    <updated>2026-06-04T10:00:00Z</updated>
    <content>content two</content>
  </entry>
</feed>`;

// --- RSS 2.0 ---------------------------------------------------------------
test('parseFeed reads RSS 2.0 channel + items, decodes CDATA and entities', () => {
  const f = parseFeed(RSS);
  assert.equal(f.title, 'Bones & Stones');
  assert.equal(f.link, 'https://example.com/');
  assert.equal(f.items.length, 2);
  const a = f.items[0];
  assert.equal(a.title, 'First & Foremost');
  assert.equal(a.link, 'https://example.com/a');
  assert.equal(a.guid, 'guid-a');
  assert.equal(a.pubDate, 'Mon, 01 Jun 2026 12:00:00 GMT');
  assert.equal(a.isoDate, '2026-06-01T12:00:00.000Z');
  assert.equal(a.summary, 'Hello <world>');
});

// --- Atom ------------------------------------------------------------------
test('parseFeed reads Atom feed/entries, prefers alternate link over self', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.title, 'Atom Feed');
  assert.equal(f.link, 'https://ex.org/');           // alternate, not self
  assert.equal(f.items.length, 2);
  const e = f.items[0];
  assert.equal(e.title, 'Entry One');
  assert.equal(e.link, 'https://ex.org/1');
  assert.equal(e.guid, 'urn:id:1');
  assert.equal(e.pubDate, '2026-06-03T10:00:00Z');
  assert.equal(e.isoDate, '2026-06-03T10:00:00.000Z');
  assert.equal(e.summary, 'sum one');
  assert.equal(f.items[1].summary, 'content two');   // falls back to <content>
});

test('guid falls back to link when absent', () => {
  const xml = `<rss version="2.0"><channel><title>T</title>
    <item><title>x</title><link>https://e/x</link><pubDate>Wed, 03 Jun 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const f = parseFeed(xml);
  assert.equal(f.items[0].guid, 'https://e/x');
});

// --- entity / date helpers --------------------------------------------------
test('decodeEntities handles named + numeric (decimal/hex) refs, &amp; last', () => {
  assert.equal(decodeEntities('a &amp; b'), 'a & b');
  assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;'); // double-encoded round-trips, not decoded twice
  assert.equal(decodeEntities('&quot;q&apos;'), '"q\'');
});

test('toIso normalizes or returns empty string, never throws', () => {
  assert.equal(toIso('Mon, 01 Jun 2026 12:00:00 GMT'), '2026-06-01T12:00:00.000Z');
  assert.equal(toIso('not a date'), '');
  assert.equal(toIso(''), '');
  assert.equal(toIso(null), '');
});

// --- dedupe ----------------------------------------------------------------
test('dedupeItems drops later duplicates by guid||link, keeps first', () => {
  const items = [
    { guid: 'g1', link: 'l1', title: 'first' },
    { guid: 'g1', link: 'l1b', title: 'dup-by-guid' },
    { link: 'l2', title: 'by-link' },
    { link: 'l2', title: 'dup-by-link' },
    { guid: '', link: '', title: 'no-key-kept' },
    { guid: '', link: '', title: 'no-key-also-kept' },
  ];
  const out = dedupeItems(items);
  assert.deepEqual(out.map((x) => x.title), ['first', 'by-link', 'no-key-kept', 'no-key-also-kept']);
  assert.deepEqual(dedupeItems('nope'), []);
});

// --- sort ------------------------------------------------------------------
test('sortByDate orders newest-first, undated last, and does not mutate input', () => {
  const items = [
    { title: 'old', isoDate: '2026-06-01T00:00:00.000Z' },
    { title: 'new', isoDate: '2026-06-05T00:00:00.000Z' },
    { title: 'undated' },
    { title: 'mid', pubDate: 'Wed, 03 Jun 2026 00:00:00 GMT' },
  ];
  const snapshot = items.map((x) => x.title);
  const out = sortByDate(items);
  assert.deepEqual(out.map((x) => x.title), ['new', 'mid', 'old', 'undated']);
  assert.deepEqual(items.map((x) => x.title), snapshot); // input unchanged
  assert.deepEqual(sortByDate(null), []);
});

// --- fetchFeed via injected fetch ------------------------------------------
test('fetchFeed parses via an injected fetch option', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => RSS });
  const f = await fetchFeed('https://example.com/feed.xml', { fetch: fakeFetch });
  assert.equal(f.title, 'Bones & Stones');
  assert.equal(f.items.length, 2);
});

test('fetchFeed uses the __setFetch global seam', async () => {
  __setFetch(async () => ({ ok: true, text: async () => ATOM }));
  const f = await fetchFeed('https://ex.org/atom.xml');
  assert.equal(f.title, 'Atom Feed');
  __setFetch(); // restore
});

// --- soft-fail (never throws) ----------------------------------------------
test('parseFeed soft-fails on malformed / non-string input', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}, '<not a feed>', '<rss><channel>']) {
    const f = parseFeed(bad);
    assert.deepEqual(f, { title: '', link: '', items: [] });
  }
});

test('fetchFeed soft-fails on network error, non-OK, and bad url', async () => {
  const thrower = async () => { throw new Error('network down'); };
  assert.deepEqual(await fetchFeed('https://x/', { fetch: thrower }), { title: '', link: '', items: [] });

  const notOk = async () => ({ ok: false, status: 500, text: async () => RSS });
  assert.deepEqual(await fetchFeed('https://x/', { fetch: notOk }), { title: '', link: '', items: [] });

  assert.deepEqual(await fetchFeed(''), { title: '', link: '', items: [] });
  assert.deepEqual(await fetchFeed(null), { title: '', link: '', items: [] });
});

// --- HTML render escaping --------------------------------------------------
test('renderItem / renderFeed escape malicious titles and never emit raw markup', () => {
  const evil = { title: '<img src=x onerror=alert(1)>', link: 'javascript:void(0)"', summary: '<b>x</b>' };
  const li = renderItem(evil);
  assert.ok(!li.includes('<img src=x'));
  assert.ok(li.includes('&lt;img'));
  assert.ok(li.includes('&quot;'));

  const feed = { title: '<script>', link: '', items: [evil] };
  const html = renderFeed(feed);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('esc escapes the five characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
