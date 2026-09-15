// rss.test.mjs — OFFLINE. Injected fetch, in-memory store, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, itemToEvents, addFeeds, importOpml, listFeeds, removeFeed, pollFeed, pollAll, handler } from './rss.mjs';

// in-memory store so nothing touches disk
function memStore() {
  let buf = null;
  return { fs: { read: () => buf, write: (_p, s) => { buf = s; } }, file: 'mem.json' };
}
const cap = () => { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; };
const J = (o) => JSON.parse(o.body);

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Van Kush Feed</title>
<item><title>First &amp; Best</title><link>https://ex.test/1</link><guid>g1</guid>
  <dc:creator>hathor</dc:creator><category>MELEK</category><category>PRANA</category>
  <description><![CDATA[<p>Body <b>html</b> here</p>]]></description></item>
<item><title>Second</title><link>https://ex.test/2</link><guid>g2</guid><category>melek</category></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>Atom One</title><link href="https://ex.test/a1"/><id>a1</id>
  <category term="Witness"/><summary>Sum</summary><updated>2026-09-15T00:00:00Z</updated></entry></feed>`;

test('parses RSS 2.0 — entities decoded, CDATA unwrapped, html stripped, categories to tags', () => {
  const f = parseFeed(RSS);
  assert.equal(f.title, 'Van Kush Feed');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'First & Best');
  assert.equal(f.items[0].author, 'hathor');
  assert.deepEqual(f.items[0].tags, ['melek', 'prana']);
  assert.equal(f.items[0].summary, 'Body html here', 'markup must not survive into a trigger payload');
});

test('parses Atom — href links and term= categories', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].link, 'https://ex.test/a1');
  assert.deepEqual(f.items[0].tags, ['witness']);
});

test('malformed and empty input degrade instead of throwing', () => {
  for (const junk of ['', '   ', 'not xml', '<rss><channel><item><title>x', null, undefined, 42]) {
    const f = parseFeed(junk);
    assert.ok(Array.isArray(f.items), 'a feed you do not control is not guaranteed well-formed');
  }
});

test('an item becomes ordinary tag events — no new trigger dialect', () => {
  const [e1, e2] = itemToEvents({ title: 'T', tags: ['melek', 'prana'], author: 'h' }, 'https://ex.test/f');
  assert.equal(e1.type, 'tag', 'the existing engine must match this unchanged');
  assert.equal(e1.tag, 'melek');
  assert.equal(e2.tag, 'prana');
  assert.deepEqual(e1.tags, ['melek', 'prana']);
  assert.equal(e1.feed, 'https://ex.test/f');
  const [none] = itemToEvents({ title: 'no tags' });
  assert.equal(none.tag, '');
});

test('⚠️ a feed URL is fetched by the server, so it takes the SSRF guard', () => {
  const s = memStore();
  const r = addFeeds([
    'https://good.test/feed.xml',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8080/feed',
    'http://10.0.0.5/feed',
    'file:///etc/passwd',
    'https://user:pw@evil.test/feed',
  ], s);
  assert.deepEqual(r.added, ['https://good.test/feed.xml']);
  assert.equal(r.rejected.length, 5, 'every private/dangerous target must be refused at ADD time');
  assert.ok(r.rejected.some((x) => /metadata/i.test(x.reason)));
});

test('⭐ the first poll seeds and fires NOTHING — you subscribe to what happens next', async () => {
  const s = memStore();
  addFeeds(['https://good.test/feed.xml'], s);
  const fetchOk = async () => ({ status: 200, text: async () => RSS });

  const first = await pollFeed('https://good.test/feed.xml', { ...s, fetch: fetchOk });
  assert.equal(first.firstRun, true);
  assert.equal(first.items.length, 0, 'adding a feed with 200 items must not fan 200 triggers out');
  assert.equal(first.seeded, 2);

  const second = await pollFeed('https://good.test/feed.xml', { ...s, fetch: fetchOk });
  assert.equal(second.items.length, 0, 'nothing new means nothing fires');

  const grown = RSS.replace('</channel>', '<item><title>Third</title><guid>g3</guid><category>kula</category></item></channel>');
  const third = await pollFeed('https://good.test/feed.xml', { ...s, fetch: async () => ({ status: 200, text: async () => grown }) });
  assert.equal(third.items.length, 1);
  assert.equal(third.items[0].id, 'g3');
});

test('a dead or hostile feed is shaped, never thrown', async () => {
  const s = memStore();
  addFeeds(['https://good.test/feed.xml'], s);
  assert.equal((await pollFeed('https://good.test/feed.xml', { ...s, fetch: async () => { throw new Error('boom'); } })).reason, 'feed unreachable');
  assert.match((await pollFeed('https://good.test/feed.xml', { ...s, fetch: async () => ({ status: 503, text: async () => '' }) })).reason, /feed http 503/);
  assert.match((await pollFeed('http://127.0.0.1/feed', s)).reason, /localhost|private/i);
});

test('OPML import pulls the feed list and still applies the guard', () => {
  const s = memStore();
  const opml = `<opml version="1.0"><head><title>My Subs</title></head><body>
    <outline text="News"><outline type="rss" text="A" xmlUrl="https://a.test/rss"/>
    <outline type="rss" text="B" xmlUrl="http://192.168.1.9/rss"/></outline></body></opml>`;
  const r = importOpml(opml, s);
  assert.equal(r.title, 'My Subs');
  assert.equal(r.found, 2);
  assert.deepEqual(r.added, ['https://a.test/rss']);
  assert.equal(r.rejected.length, 1, 'a private address inside an OPML is still a private address');
});

test('feeds can be listed and removed', () => {
  const s = memStore();
  addFeeds(['https://a.test/rss', 'https://b.test/rss'], s);
  assert.equal(listFeeds(s).length, 2);
  assert.equal(removeFeed('https://a.test/rss', s).ok, true);
  assert.equal(listFeeds(s).length, 1);
  assert.equal(removeFeed('https://nope.test/rss', s).ok, false);
});

test('handler routes, and poll hands events to an injected trigger sink', async () => {
  const s = memStore();
  let { res, o } = cap();
  await handler({ method: 'POST', url: '/api/rss/feeds', body: { urls: ['https://good.test/feed.xml'] } }, res, s);
  assert.equal(J(o).added.length, 1);

  // seed
  await pollFeed('https://good.test/feed.xml', { ...s, fetch: async () => ({ status: 200, text: async () => RSS }) });

  const grown = RSS.replace('</channel>', '<item><title>New</title><guid>g9</guid><category>melek</category></item></channel>');
  const seen = [];
  ({ res, o } = cap());
  await handler({ method: 'POST', url: '/api/rss/poll' }, res,
    { ...s, fetch: async () => ({ status: 200, text: async () => grown }), fire: async (ev) => { seen.push(ev); return 1; } });
  const j = J(o);
  assert.equal(j.fired, 1, 'a new item must reach the trigger engine');
  assert.equal(seen[0].type, 'tag');
  assert.equal(seen[0].tag, 'melek');

  ({ res, o } = cap());
  await handler({ method: 'GET', url: '/api/rss/feeds' }, res, s);
  assert.equal(J(o).feeds.length, 1);

  ({ res, o } = cap());
  await handler({ method: 'GET', url: '/api/rss/nope' }, res, s);
  assert.equal(o.code, 404);
});

test('poll without a sink returns the events and says so rather than silently dropping them', async () => {
  const s = memStore();
  addFeeds(['https://good.test/feed.xml'], s);
  await pollFeed('https://good.test/feed.xml', { ...s, fetch: async () => ({ status: 200, text: async () => RSS }) });
  const grown = RSS.replace('</channel>', '<item><title>N</title><guid>gz</guid><category>prana</category></item></channel>');
  const { res, o } = cap();
  await handler({ method: 'POST', url: '/api/rss/poll' }, res, { ...s, fetch: async () => ({ status: 200, text: async () => grown }) });
  const j = J(o);
  assert.equal(j.fired, null);
  assert.equal(j.events.length, 1);
  assert.match(j.note, /no trigger sink/);
});
