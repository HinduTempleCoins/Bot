// server.test.mjs — fully offline. The chain is a stubbed fetch; nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, __setFetch, esc, summarize, firstImage, rss, atom, jsonFeed, fetchBlog } from './server.mjs';

const POSTS = [
  { author: 'kalivankush', permlink: 'making-a-skin-cream', category: 'melek', title: 'Making a Skin Cream',
    created: '2026-10-27T12:00:00', body: '![IMG_1.jpeg](https://melek.salon/img/abc.jpg)\n\nWe are **testing** a cream with [hydroxyapatite](https://x.test) and papain. Visit https://example.test now.' },
  { author: 'kalivankush', permlink: 'sea-grape-collagen-peptide', category: 'melek', title: 'Sea Grape Collagen Peptide',
    created: '2026-10-26T09:30:00', body: 'Short one.' },
  { author: 'someoneelse', permlink: 'not-hers', category: 'melek', title: 'Not Hers', created: '2026-10-25T00:00:00', body: 'x' },
];

function stub(result) {
  __setFetch(async () => ({ json: async () => ({ jsonrpc: '2.0', id: 1, result }) }));
}
function drive(url) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 0, headers: {}, body: '',
      writeHead(c, h) { this.statusCode = c; this.headers = h || {}; },
      end(b) { this.body = b || ''; resolve(this); },
    };
    handler({ url, method: 'GET' }, res);
  });
}

test('esc neutralises every XML-significant character', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
});

test('summarize strips markdown, html, images and bare URLs', () => {
  const s = summarize(POSTS[0].body);
  assert.ok(!s.includes('!['), 'image markdown must go');
  assert.ok(!s.includes('**'), 'bold markers must go');
  assert.ok(!s.includes('http'), 'bare URLs must go');
  assert.match(s, /testing a cream with hydroxyapatite and papain/);
});

test('summarize truncates on a word boundary with an ellipsis', () => {
  const s = summarize('word '.repeat(300), 50);
  assert.ok(s.length <= 52, 'must respect the limit');
  assert.match(s, /…$/);
});

test('firstImage finds markdown and html images, and returns null otherwise', () => {
  assert.equal(firstImage(POSTS[0].body), 'https://melek.salon/img/abc.jpg');
  assert.equal(firstImage('<img src="https://x.test/a.png">'), 'https://x.test/a.png');
  assert.equal(firstImage('no image here'), null);
});

test('an account feed is valid RSS, and excludes other authors reblogged into the blog', async () => {
  stub(POSTS);
  const r = await drive('/rss/@kalivankush');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /application\/rss\+xml/);
  assert.match(r.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(r.body, /<rss version="2\.0"/);
  assert.equal((r.body.match(/<item>/g) || []).length, 2, 'only her two posts');
  assert.ok(!r.body.includes('not-hers'), 'a reblogged post by another author must not appear');
  assert.match(r.body, /<atom:link[^>]+rel="self"/, 'directories check for a self link');
  assert.match(r.body, /<guid isPermaLink="true">/);
});

test('item links are absolute and include the category', async () => {
  stub(POSTS);
  const r = await drive('/rss/@kalivankush');
  assert.match(r.body, /<link>https?:\/\/[^<]*\/melek\/@kalivankush\/making-a-skin-cream<\/link>/);
});

test('pubDate is RFC-822, which is what RSS readers require', async () => {
  stub(POSTS);
  const r = await drive('/rss/@kalivankush');
  assert.match(r.body, /<pubDate>\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT<\/pubDate>/);
});

test('atom and json feeds are served with their own content types', async () => {
  stub(POSTS);
  const a = await drive('/rss/@kalivankush/atom');
  assert.match(a.headers['content-type'], /application\/atom\+xml/);
  assert.match(a.body, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(a.body, /<updated>\d{4}-\d{2}-\d{2}T/);
  const j = await drive('/rss/@kalivankush/json');
  assert.match(j.headers['content-type'], /application\/feed\+json/);
  const parsed = JSON.parse(j.body);
  assert.equal(parsed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(parsed.items.length, 2);
  assert.ok(parsed.feed_url, 'JSON Feed requires feed_url');
});

test('a tag feed works', async () => {
  stub(POSTS.slice(0, 2));
  const r = await drive('/rss/tag/biohacking');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /#biohacking/);
});

test('works whether or not it is mounted under /rss', async () => {
  stub(POSTS);
  const withPrefix = await drive('/rss/@kalivankush');
  const without = await drive('/@kalivankush');
  assert.equal(withPrefix.statusCode, 200);
  assert.equal(without.statusCode, 200);
});

test('a chain failure yields an EMPTY BUT VALID feed, never a 500', async () => {
  __setFetch(async () => { throw new Error('rpc down'); });
  const r = await drive('/rss/@kalivankush');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /<rss version="2\.0"/);
  assert.equal((r.body.match(/<item>/g) || []).length, 0);
});

test('malformed rpc output does not throw', async () => {
  __setFetch(async () => ({ json: async () => ({ result: [null, {}, { author: 'x' }] }) }));
  const r = await drive('/rss/@kalivankush');
  assert.equal(r.statusCode, 200);
});

test('a hostile title or body cannot break out of the XML', async () => {
  stub([{ author: 'kalivankush', permlink: 'x', category: 'melek', created: '2026-10-27T00:00:00',
          title: '</title><script>alert(1)</script>', body: ']]> & <foo>' }]);
  const r = await drive('/rss/@kalivankush');
  assert.ok(!r.body.includes('<script>'), 'script tag must be escaped');
  assert.ok(!r.body.includes(']]>'), 'CDATA terminator must be escaped');
  assert.match(r.body, /&lt;script&gt;/);
});

test('unknown paths 404 and health is json', async () => {
  stub([]);
  assert.equal((await drive('/rss/nope')).statusCode, 404);
  const h = await drive('/rss/health');
  assert.equal(h.statusCode, 200);
  assert.equal(JSON.parse(h.body).ok, true);
});

test('the index page documents the URL shapes', async () => {
  stub([]);
  const r = await drive('/rss');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /\/rss\/@&lt;account&gt;/);
});

test('an invalid account name is rejected rather than queried', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { json: async () => ({ result: [] }) }; });
  const r = await drive('/rss/@a');          // too short for a chain account
  assert.equal(r.statusCode, 404);
  assert.equal(called, false, 'must not hit the chain for an invalid name');
});

test('fetchBlog soft-fails to an empty array', async () => {
  __setFetch(async () => { throw new Error('nope'); });
  assert.deepEqual(await fetchBlog('kalivankush'), []);
});
