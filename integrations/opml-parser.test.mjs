// opml-parser.test.mjs — offline tests for the OPML subscription-list parser/serializer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml, buildOpml, mergeOpml, esc, decodeEntities } from './opml-parser.mjs';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Subscriptions</title></head>
  <body>
    <outline text="News" title="News">
      <outline type="rss" text="Site A" xmlUrl="https://a.example/feed.xml" htmlUrl="https://a.example/"/>
      <outline text="Tech" title="Tech">
        <outline type="rss" text="Site B" xmlUrl="https://b.example/feed.xml" htmlUrl="https://b.example/"/>
      </outline>
    </outline>
    <outline type="rss" text="Loose" xmlUrl="https://c.example/feed.xml"/>
  </body>
</opml>`;

test('parseOpml: title + flattened categories', () => {
  const r = parseOpml(SAMPLE);
  assert.equal(r.title, 'My Subscriptions');
  assert.equal(r.feeds.length, 3);

  const a = r.feeds.find((f) => f.xmlUrl === 'https://a.example/feed.xml');
  assert.equal(a.title, 'Site A');
  assert.equal(a.htmlUrl, 'https://a.example/');
  assert.equal(a.category, 'News');

  const b = r.feeds.find((f) => f.xmlUrl === 'https://b.example/feed.xml');
  assert.equal(b.category, 'News/Tech'); // nested grouping flattened

  const c = r.feeds.find((f) => f.xmlUrl === 'https://c.example/feed.xml');
  assert.equal(c.category, ''); // top-level loose feed, no category
  assert.equal(c.htmlUrl, '');
});

test('parseOpml: title-attr fallback when text missing', () => {
  const xml = `<opml><head><title>T</title></head><body>
    <outline title="Only Title" xmlUrl="https://x.example/f.xml"/>
  </body></opml>`;
  const r = parseOpml(xml);
  assert.equal(r.feeds.length, 1);
  assert.equal(r.feeds[0].title, 'Only Title');
});

test('parseOpml: decodes entities in attributes', () => {
  const xml = `<opml><head><title>A &amp; B</title></head><body>
    <outline text="Tom &amp; Jerry" xmlUrl="https://e.example/feed.xml?a=1&amp;b=2"/>
  </body></opml>`;
  const r = parseOpml(xml);
  assert.equal(r.title, 'A & B');
  assert.equal(r.feeds[0].title, 'Tom & Jerry');
  assert.equal(r.feeds[0].xmlUrl, 'https://e.example/feed.xml?a=1&b=2');
});

test('parseOpml: soft-fail on garbage / non-string', () => {
  for (const bad of [null, undefined, 42, {}, [], '', '   ', 'not xml at all', '<opml>']) {
    const r = parseOpml(bad);
    assert.deepEqual(r, { title: '', feeds: [] });
  }
});

test('buildOpml: empty list -> valid minimal OPML with <body/>', () => {
  const xml = buildOpml({ title: 'Empty', feeds: [] });
  assert.match(xml, /<opml version="2\.0">/);
  assert.match(xml, /<body\/>/);
  assert.match(xml, /<\/opml>/);
  // and parses back to zero feeds
  assert.deepEqual(parseOpml(xml).feeds, []);
});

test('buildOpml: garbage input still yields valid empty OPML', () => {
  for (const bad of [null, undefined, 42, 'x', {}]) {
    const xml = buildOpml(bad);
    assert.match(xml, /<opml version="2\.0">/);
    assert.match(xml, /<body\/>/);
    assert.match(xml, /<\/opml>/);
  }
});

test('buildOpml: esc() escapes attribute values', () => {
  const xml = buildOpml({
    title: 'x',
    feeds: [{ title: 'Quote"& <tag>', xmlUrl: 'https://q.example/f.xml?a=1&b=2', htmlUrl: '', category: '' }],
  });
  assert.match(xml, /&amp;/);
  assert.match(xml, /&quot;/);
  assert.match(xml, /&lt;tag&gt;/);
  assert.ok(!/<tag>/.test(xml.replace(/<outline[^>]*>/g, ''))); // no raw injected tag
});

test('buildOpml: drops entries without xmlUrl', () => {
  const xml = buildOpml({ title: 't', feeds: [{ title: 'no url' }, { title: 'ok', xmlUrl: 'https://o.example/f.xml' }] });
  const r = parseOpml(xml);
  assert.equal(r.feeds.length, 1);
  assert.equal(r.feeds[0].xmlUrl, 'https://o.example/f.xml');
});

test('round-trip: build then parse preserves feeds + categories', () => {
  const doc = {
    title: 'Roster',
    feeds: [
      { title: 'A', xmlUrl: 'https://a.example/feed.xml', htmlUrl: 'https://a.example/', category: 'News' },
      { title: 'B', xmlUrl: 'https://b.example/feed.xml', htmlUrl: 'https://b.example/', category: 'News/Tech' },
    ],
  };
  const r = parseOpml(buildOpml(doc));
  assert.equal(r.title, 'Roster');
  assert.equal(r.feeds.length, 2);
  const byUrl = Object.fromEntries(r.feeds.map((f) => [f.xmlUrl, f]));
  assert.equal(byUrl['https://a.example/feed.xml'].category, 'News');
  assert.equal(byUrl['https://b.example/feed.xml'].category, 'News/Tech');
});

test('mergeOpml: deduped union by xmlUrl, a wins', () => {
  const a = { title: 'A', feeds: [{ title: 'A-one', xmlUrl: 'https://1.example/f.xml', category: 'a' }] };
  const b = {
    title: 'B',
    feeds: [
      { title: 'B-one', xmlUrl: 'https://1.example/f.xml', category: 'b' }, // dup of a
      { title: 'B-two', xmlUrl: 'https://2.example/f.xml', category: 'b' },
    ],
  };
  const m = mergeOpml(a, b);
  assert.equal(m.title, 'A');
  assert.equal(m.feeds.length, 2);
  const one = m.feeds.find((f) => f.xmlUrl === 'https://1.example/f.xml');
  assert.equal(one.title, 'A-one'); // a wins on collision
  assert.equal(one.category, 'a');
});

test('mergeOpml: accepts XML strings on either side', () => {
  const m = mergeOpml(SAMPLE, '<opml><body><outline xmlUrl="https://d.example/f.xml" text="D"/></body></opml>');
  const urls = m.feeds.map((f) => f.xmlUrl).sort();
  assert.deepEqual(urls, [
    'https://a.example/feed.xml',
    'https://b.example/feed.xml',
    'https://c.example/feed.xml',
    'https://d.example/f.xml',
  ]);
});

test('mergeOpml: soft-fail on garbage operands', () => {
  assert.deepEqual(mergeOpml(null, undefined), { title: '', feeds: [] });
  assert.deepEqual(mergeOpml(42, 'garbage'), { title: '', feeds: [] });
  const m = mergeOpml({ feeds: [{ xmlUrl: 'https://z.example/f.xml' }] }, null);
  assert.equal(m.feeds.length, 1);
});

test('esc + decodeEntities helpers', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42;'), 'a & b <c> A B');
  assert.equal(esc(null), '');
});
