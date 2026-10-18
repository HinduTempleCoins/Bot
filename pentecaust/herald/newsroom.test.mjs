// newsroom.test.mjs — the wiki-subject news categories. OFFLINE: fetch is injected.
import { test } from 'node:test';
import assert from 'node:assert';
process.env.HERALD_NEWS_DATA = `/tmp/herald-news-test-${process.pid}.json`;
process.env.NEWS_BASE_URL = 'https://herald.example/newsroom';
const m = await import('./newsroom.mjs');
const { CATEGORIES } = await import('../../site/wiki/categories.mjs');

const rss = (n, tag) => `<?xml version="1.0"?><rss><channel>${Array.from({ length: n }, (_, i) =>
  `<item><title>${tag} story ${i}</title><link>https://src.example/${tag}/${i}</link><pubDate>Sun, 18 Oct 2026 0${i % 9}:00:00 GMT</pubDate></item>`).join('')}</channel></rss>`;

function cap() { const o = { code: 0, body: '' }; return { res: { writeHead: (c) => { o.code = c; }, end: (b) => { o.body = b || ''; } }, o }; }

test('every wiki subject is named exactly as the wiki names it', () => {
  const names = new Map(CATEGORIES.map((c) => [c.id, c.name]));
  assert.ok(m.WIKI_SUBJECTS.length >= 8);
  for (const s of m.WIKI_SUBJECTS) assert.strictEqual(s.name, names.get(s.slug));
  assert.ok(!m.WIKI_SUBJECTS.some((s) => ['start', 'posting-help', 'tools', 'verticals'].includes(s.slug)));
});

test('portal shows subjects that have headlines and hides the empty ones', async () => {
  m.__clearAggCache();
  // law returns items; every other Google News query returns an empty feed; wire sources fail
  m.__setFetch(async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes('news.google.com') && u.includes('Supreme Court')) return { ok: true, text: async () => rss(5, 'law') };
    if (u.includes('news.google.com')) return { ok: true, text: async () => rss(0, 'none') };
    return { ok: false, text: async () => '' };
  });
  const { res, o } = cap();
  await m.handler({ url: '/', method: 'GET', headers: {} }, res);
  assert.strictEqual(o.code, 200);
  assert.ok(o.body.includes('id=subjects'));
  assert.ok(o.body.includes('Law and your rights'));
  assert.ok(o.body.includes('law story'));
  assert.ok(!o.body.includes('/subject/chains'), 'empty subject must not be shown');
  assert.ok(o.body.includes('pentecaust.com/translate.js'));

  const page = cap();
  await m.handler({ url: '/subject/law', method: 'GET', headers: {} }, page.res);
  assert.strictEqual(page.o.code, 200);
  assert.ok(page.o.body.includes('wiki.soapbox.community/category/law'));

  const empty = cap();
  await m.handler({ url: '/subject/chains', method: 'GET', headers: {} }, empty.res);
  assert.strictEqual(empty.o.code, 404);

  const feed = cap();
  await m.handler({ url: '/subject/law/rss.xml', method: 'GET', headers: {} }, feed.res);
  assert.strictEqual(feed.o.code, 200);
  assert.ok(feed.o.body.includes('<item>') && feed.o.body.includes('law story'));
  m.__setFetch(null);
});
