import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';

const DIR = mkdtempSync(tmpdir() + '/films-test-');
process.env.FILMS_DATA_DIR = DIR;
delete process.env.TMDB_API_KEY;
process.env.FILMS_ADMIN_TOKEN = 'admintok';

const FILMS = [
  { id: 'Q151599', t: 'Metropolis', y: 1927, d: ['Fritz Lang'], c: ['Brigitte Helm'], g: ['science fiction', 'drama'], co: ['Germany'], sl: 68, rt: 153,
    w: { netflix: '60026474', archive: 'metropolis_20201015', tubi: '199555' }, r: { imdb: 'tt0017136', tmdb: '19' }, wiki: 'Metropolis (1927 film)' },
  { id: 'Q25188', t: 'Inception', y: 2010, d: ['Christopher Nolan'], c: ['Leonardo DiCaprio'], g: ['science fiction'], sl: 97, r: { imdb: 'tt1375666' } },
  { id: 'Q666', t: '<script>alert(1)</script>', y: 1999, d: [], c: [], g: ['drama'], sl: 1 },
];
writeFileSync(DIR + '/films.ndjson', FILMS.map((f) => JSON.stringify(f)).join('\n') + '\n{torn line\n');
writeFileSync(DIR + '/originals.json', JSON.stringify([{ slug: 'hathor-test-1', title: 'Hathor at the Banquet', by: 'Hathor', video: 'https://hathor.soapbox.community/anim/1.mp4' }, { slug: 'BAD SLUG', title: 'x' }]));

const S = await import('./server.mjs');
const store = await import('./reviews-store.mjs');
const E = 'http://www.wikidata.org/entity/';

// Test reviewer keys: valid 25-symbol keys built at runtime (fixed literals trip the secret scanner).
const KEY_A = 'A'.repeat(25);
const KEY_B = '7'.repeat(25);

function call(method, url, body, headers = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(body ? [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))] : []);
    Object.assign(req, { method, url, headers: { 'x-forwarded-for': '203.0.113.9', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
    const res = { status: 0, headers: {}, body: '',
      writeHead(s, h) { this.status = s; Object.assign(this.headers, h || {}); },
      end(b) { this.body = String(b == null ? '' : b); resolve(this); } };
    S.handler(req, res);
  });
}
const j = (r) => JSON.parse(r.body);

beforeEach(() => {
  writeFileSync(DIR + '/reviews.jsonl', '');
  writeFileSync(DIR + '/films-extra.ndjson', '');
  S.__resetCatalog();
  S.__setFetch(async () => { throw new Error('offline'); });
});

test('home, film page and where-to-watch', async () => {
  const home = await call('GET', '/films');
  assert.equal(home.status, 200);
  assert.match(home.body, /3 films|3<\/?/);
  assert.match(home.body, /Hathor at the Banquet/);
  assert.doesNotMatch(home.body, /<script>alert/);
  const page = await call('GET', '/films/Q151599');
  assert.equal(page.status, 200);
  assert.match(page.body, /Metropolis/);
  assert.match(page.body, /https:\/\/www\.netflix\.com\/title\/60026474/);
  assert.match(page.body, /tubitv\.com\/movies\/199555/);
  assert.match(page.body, /\/watch\?src=ia&amp;id=metropolis-1927-english-titles/); // the verified curated copy beats a dead Wikidata-listed upload
  assert.match(page.body, /justwatch\.com\/us\/search\?q=Metropolis/);
  assert.match(page.body, /imdb\.com\/title\/tt0017136/);
  assert.match(page.body, /availability varies by region/);
  const xss = await call('GET', '/films/Q666');
  assert.doesNotMatch(xss.body, /<script>alert/);
  assert.match(xss.body, /&lt;script&gt;/);
});

test('search: local ranking, people search, live fallback remembered', async () => {
  const a = j(await call('GET', '/films/api/search?q=metropolis'));
  assert.equal(a.results[0].id, 'Q151599');
  const b = j(await call('GET', '/films/api/search?q=nolan'));
  assert.equal(b.results[0].id, 'Q25188');
  S.__setFetch(async (url) => {
    const u = String(url);
    if (u.includes('wbsearchentities')) return { ok: true, json: async () => ({ search: [{ id: 'Q42' }] }) };
    if (u.includes('sparql')) return { ok: true, json: async () => ({ results: { bindings: [
      { f: { value: E + 'Q42' }, p: { value: 'label' }, v: { value: 'Nosferatu' } },
      { f: { value: E + 'Q42' }, p: { value: 'P31' }, v: { value: E + 'Q11424' } },
      { f: { value: E + 'Q42' }, p: { value: 'P577' }, v: { value: '1922-03-04T00:00:00Z' } },
    ] } }) };
    return { ok: false };
  });
  const c = j(await call('GET', '/films/api/search?q=nosferatu'));
  assert.equal(c.results[0].id, 'Q42');
  assert.match(readFileSync(DIR + '/films-extra.ndjson', 'utf8'), /Nosferatu/);
  S.__setFetch(async () => { throw new Error('offline'); });
  S.__resetCatalog();
  const page = await call('GET', '/films/Q42');
  assert.equal(page.status, 200);
  assert.match(page.body, /Nosferatu/);
  const miss = await call('GET', '/films/Q999999');
  assert.equal(miss.status, 404);
});

test('reviews: post, one current review per reviewer, aggregate, delete, report, moderate', async () => {
  let r = await call('POST', '/films/api/review', { film: 'Q151599', stars: 5, title: 'Masterpiece', text: 'Still astonishing.', name: 'Ada', key: KEY_A });
  assert.equal(r.status, 200, r.body);
  const first = j(r).review;
  assert.equal(first.stars, 5);
  assert.equal(first.rid, undefined);
  r = await call('POST', '/films/api/review', { film: 'Q151599', stars: 2, key: KEY_B });
  assert.equal(r.status, 200);
  // editing: same reviewer again → supersedes
  r = await call('POST', '/films/api/review', { film: 'Q151599', stars: 4.5, text: 'On rewatch, even better.', key: KEY_A });
  const second = j(r).review;
  const list = j(await call('GET', '/films/api/reviews?film=Q151599')).reviews;
  assert.equal(list.length, 2);
  assert.ok(list.every((x) => x.id !== first.id));
  const api = j(await call('GET', '/films/api/film/Q151599'));
  assert.deepEqual({ count: api.stats.count, avg: api.stats.avg, score: api.stats.score, verdict: api.stats.verdict }, { count: 2, avg: 3.3, score: 50, verdict: 'wilted' });
  const page = await call('GET', '/films/Q151599');
  assert.match(page.body, /On rewatch, even better\./);
  assert.match(page.body, /50%/);
  // raw key never stored
  const raw = readFileSync(DIR + '/reviews.jsonl', 'utf8');
  assert.ok(!raw.includes(KEY_A) && !raw.includes(KEY_B));
  // mine
  assert.deepEqual(j(await call('POST', '/films/api/mine', { key: KEY_A })).ids, [second.id]);
  // delete: wrong key refused, right key works
  assert.equal((await call('POST', '/films/api/delete', { id: second.id, key: KEY_B })).status, 403);
  assert.equal((await call('POST', '/films/api/delete', { id: second.id, key: KEY_A })).status, 200);
  assert.equal(j(await call('GET', '/films/api/reviews?film=Q151599')).reviews.length, 1);
  // reports: 3 distinct reporters hide it
  const target = j(await call('GET', '/films/api/reviews')).reviews[0].id;
  for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) await call('POST', '/films/api/report', { id: target, reason: 'spam' }, { 'x-forwarded-for': ip });
  assert.equal(j(await call('GET', '/films/api/reviews')).reviews.length, 0);
  // moderator restores
  assert.equal((await call('POST', '/films/api/moderate', { id: target, status: 'published' }, { 'x-admin-token': 'nope' })).status, 403);
  assert.equal((await call('POST', '/films/api/moderate', { id: target, status: 'published' }, { 'x-admin-token': 'admintok' })).status, 200);
  assert.equal(j(await call('GET', '/films/api/reviews')).reviews.length, 1);
});

test('review validation and rate limit', async () => {
  assert.equal((await call('POST', '/films/api/review', { film: 'Q151599', stars: 4, key: 'short' })).status, 400);
  assert.equal((await call('POST', '/films/api/review', { film: 'Q151599', stars: 9, key: KEY_A })).status, 400);
  assert.equal((await call('POST', '/films/api/review', { film: 'Q999999', stars: 4, key: KEY_A })).status, 404);
  assert.equal((await call('POST', '/films/api/review', '{not json')).status, 400);
  const long = 'x'.repeat(10000);
  const ok = j(await call('POST', '/films/api/review', { film: 'o-hathor-test-1', stars: 3, text: long, name: '<b>Eve</b>', key: KEY_A }));
  assert.equal(ok.review.text.length, S.LIMITS.text);
  assert.equal(ok.review.name, 'bEve/b');
  let last;
  for (let i = 0; i < 8; i++) last = await call('POST', '/films/api/review', { film: 'Q25188', stars: 4, key: KEY_B }, { 'x-forwarded-for': '198.51.100.7' });
  assert.equal(last.status, 429);
});

test('originals page, genre/decade/top/reviews pages, health', async () => {
  const o = await call('GET', '/films/o/hathor-test-1');
  assert.equal(o.status, 200);
  assert.match(o.body, /<video[^>]+anim\/1\.mp4/);
  assert.equal((await call('GET', '/films/o/BAD SLUG')).status, 404);
  assert.match((await call('GET', '/films/genre/science-fiction')).body, /Inception/);
  assert.match((await call('GET', '/films/decade/1920s')).body, /Metropolis/);
  assert.equal((await call('GET', '/films/top')).status, 200);
  assert.equal((await call('GET', '/films/reviews')).status, 200);
  assert.equal((await call('GET', '/films/genres')).status, 200);
  const h = j(await call('GET', '/films/health'));
  assert.equal(h.films, 3);
  assert.equal(h.originals, 1);
});

test('TMDB providers used only with a key; soft-fail', async () => {
  process.env.TMDB_API_KEY = 'k';
  S.__setFetch(async (url) => (String(url).includes('themoviedb') ? { ok: true, json: async () => ({ results: { US: { link: 'https://www.themoviedb.org/movie/19/watch', flatrate: [{ provider_name: 'Kanopy' }], rent: [{ provider_name: 'Apple TV' }] } } }) } : { ok: false }));
  const page = await call('GET', '/films/Q151599');
  assert.match(page.body, /Available in US/);
  assert.match(page.body, /Kanopy/);
  S.__resetCatalog();
  S.__setFetch(async () => { throw new Error('offline'); });
  const page2 = await call('GET', '/films/Q151599');
  assert.equal(page2.status, 200);
  assert.doesNotMatch(page2.body, /Available in US/);
  delete process.env.TMDB_API_KEY;
});

test('store fold + aggregate', () => {
  const raw = [
    { kind: 'review', id: 'a1', film: 'Q1', rid: 'r1', stars: 4, at: '2026-01-01' },
    { kind: 'review', id: 'a2', film: 'Q1', rid: 'r2', stars: 1, at: '2026-01-02' },
    { kind: 'delete', id: 'a2', rid: 'someone-else', at: '2026-01-03' },
  ].map((x) => JSON.stringify(x)).join('\n');
  const all = store.foldReviews(raw + '\ngarbage\n');
  assert.equal(all.filter((r) => r.status === 'published').length, 2);
  const agg = store.aggregate(all).get('Q1');
  assert.deepEqual({ count: agg.count, score: agg.score, few: agg.few }, { count: 2, score: 50, few: true });
});

test('free play is offered only for US-public-domain years; "the" is ignored in exact matches', () => {
  assert.equal(S.watchLinks({ id: 'Q1', t: 'Old', y: 1925, w: { archive: 'old' } }).ours.length, 1);
  assert.equal(S.watchLinks({ id: 'Q2', t: 'New', y: 1972, w: { archive: 'new' } }).ours.length, 0);
  assert.equal(S.watchLinks({ id: 'Q2', t: 'New', y: 1972, w: { archive: 'new' } }).listed[0].name, 'Internet Archive');
  writeFileSync(DIR + '/films-extra.ndjson', [
    { id: 'Q900', t: 'Godfather', y: 2022, sl: 5 }, { id: 'Q901', t: 'The Godfather', y: 1972, sl: 150 },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  S.__resetCatalog();
  assert.equal(S.searchLocal('godfather')[0].id, 'Q901');
});

test('search: a trailing year picks between same-titled films instead of matching nothing', async () => {
  const { splitYear } = await import('./server.mjs');
  assert.deepEqual(splitYear('Martyrs 2008'), { q: 'Martyrs', year: 2008 });
  assert.deepEqual(splitYear('Martyrs (2016)'), { q: 'Martyrs', year: 2016 });
  assert.deepEqual(splitYear('2001: A Space Odyssey'), { q: '2001: A Space Odyssey', year: 0 });
  assert.deepEqual(splitYear('Blade Runner 2049'), { q: 'Blade Runner 2049', year: 0 }); // not a release year
});

test('bridge: a Stream-curated public-domain copy gives a film "Watch free", and a Stream item finds its film + review link', async () => {
  const f = await import('./server.mjs');
  const tax = await import('../../integrations/soapbox/horror-taxonomy.mjs');
  const pd = tax.PD_HORROR_FILMS.find((x) => x.year > 1930) || tax.PD_HORROR_FILMS[0];
  const rec = { id: 'Q999001', t: pd.title, y: pd.year, w: {} };
  const copy = f.freeCopyFor(rec);
  assert.equal(copy && copy.id, pd.id);
  const links = f.watchLinks(rec);
  assert.equal(links.ours[0].name, 'Watch free on SoapBox Stream');
  assert.match(links.ours[0].href, new RegExp(`id=${encodeURIComponent(pd.id)}`));
  assert.equal(f.freeCopyFor({ id: 'Q1', t: pd.title, y: pd.year + 30, w: {} }), null); // same title, other film
  assert.equal(f.filmForStream({ ia: 'no-such-item', title: '', year: '' }), null);
});

test('books: a film based on a public-domain book links to Gutenberg + the Library; a copyrighted one says so; /?q= redirects to search', async () => {
  const bo = await import('./based-on.mjs');
  const pd = { id: 'Q150827', t: 'Frankenstein', a: ['Mary Shelley'], y: 1818, kind: ['novel'], gut: ['84'] };
  const hp = { id: 'Q46751', t: 'Harry Potter and the Goblet of Fire', a: ['J. K. Rowling'], y: 2000, kind: ['literary work'], gut: [] };
  assert.equal(bo.bookStatus(pd, 1930).free, true);
  assert.equal(bo.bookStatus(hp, 1930).free, false);
  assert.match(bo.bookStatus(hp, 1930).label, /Not public domain \(published 2000\)/);
  const box = bo.basedOnBox([pd], { r: { y: 1931 }, freeHref: '/watch?src=ia&id=x', filmFree: true, pdYear: 1930 });
  assert.match(box, /gutenberg\.org\/ebooks\/84/);
  assert.match(box, /library\.soapbox\.community\/\?q=Frankenstein%20Mary%20Shelley/);
  assert.match(box, /watch it free on SoapBox Stream/);
  const hpBox = bo.basedOnBox([hp], { r: { y: 2005 }, filmFree: false, pdYear: 1930 });
  assert.match(hpBox, /Book:<\/b> Not public domain/);
  assert.match(hpBox, /Film:<\/b> not public domain/);
  assert.match(hpBox, /Find it on SoapBox Library/); // always
  assert.doesNotMatch(hpBox, /gutenberg\.org/);
  const data = { byFilm: { Q1: [pd], Q2: [pd] }, byGutenberg: { 84: ['Q1', 'Q2'] }, byBook: { Q150827: ['Q1', 'Q2'] } };
  assert.deepEqual(bo.filmsForBook(data, { gutenberg: '84' }).filmIds, ['Q1', 'Q2']);
  assert.equal(bo.filmsForBook(data, { book: 'Q150827' }).book.t, 'Frankenstein');
});

test('library: filmed Gutenberg books get a "films of this book" link', async () => {
  const bo = await import('../../integrations/soapbox/books-open.mjs');
  bo.__setFilmed(['84']);
  const html = bo.renderList([{ id: 'gutenberg-84', title: 'Frankenstein', author: 'Shelley', posture: 'host', source: 'gutenberg', license: 'PD', formats: {} }, { id: 'gutenberg-99999', title: 'Unfilmed', author: 'x', posture: 'host', source: 'gutenberg', license: 'PD', formats: {} }]);
  assert.match(html, /\/films\/book\?gutenberg=84/);
  assert.doesNotMatch(html, /gutenberg=99999/);
});

test('relations: series in order with prev/next, universes, studios and remakes; studio page groups by brand', async () => {
  const rel = await import('./relations.mjs');
  const byFilm = {
    A: { series: [{ id: 'S', t: 'Toy Story', n: 1 }], universe: [{ id: 'U', t: 'Toy Story universe' }], studio: [{ id: 'P', t: 'Pixar' }], next: 'B' },
    B: { series: [{ id: 'S', t: 'Toy Story', n: 2 }], universe: [{ id: 'U', t: 'Toy Story universe' }], studio: [{ id: 'P', t: 'Pixar' }], prev: 'A' },
    C: { remakeOf: ['A'], studio: [{ id: 'P', t: 'Pixar' }] },
  };
  const groups = { S: { t: 'Toy Story', kind: 'series', films: ['B', 'A'] }, U: { t: 'Toy Story universe', kind: 'universe', films: ['A', 'B'] }, P: { t: 'Pixar', kind: 'studio', films: ['A', 'B', 'C'] } };
  const data = rel.derive(byFilm, groups);
  const titleOf = (id) => ({ A: { t: 'Toy Story', y: 1995 }, B: { t: 'Toy Story 2', y: 1999 }, C: { t: 'Toy <Story> Remake', y: 2030 } }[id] || null);
  assert.deepEqual(rel.orderedFilms(data, 'S', titleOf).map((f) => f.id), ['A', 'B']);
  const boxA = rel.relationsBox(data, 'A', titleOf);
  assert.match(boxA, /Next: <a href="\/films\/B">Toy Story 2 \(1999\)<\/a>/);
  assert.match(boxA, /Remade as:<\/b>.*Toy &lt;Story&gt; Remake/);
  assert.match(boxA, /\/films\/studio\/P/);
  assert.match(rel.relationsBox(data, 'C', titleOf), /Remake of:<\/b> <a href="\/films\/A">/);
  const studio = rel.studioBody(data, 'P', titleOf, (id) => `<card ${id}>`);
  assert.match(studio, /<h2>Universes<\/h2>[\s\S]*Toy Story universe[\s\S]*<h2>Series<\/h2>/);
  assert.equal(rel.studioBody(data, 'S', titleOf, () => ''), null); // a series is not a studio
});

test('videos: without a key every section is a YouTube search link; with a key, one cached search per kind and a daily budget', async () => {
  const vid = await import('./videos.mjs');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'yt-'));
  delete process.env.YOUTUBE_API_KEY;
  vid.__resetVideos();
  let html = vid.videosBox({ t: 'Martyrs', y: 2008 }, await vid.videosFor(dir, { id: 'Q1', t: 'Martyrs', y: 2008 }));
  assert.match(html, /Watch the trailer on YouTube/);
  assert.match(html, /Theory videos <span class=spoil>⚠ may contain spoilers/);
  assert.ok(html.indexOf('Theory videos') < html.indexOf('Review videos'), 'theories first, reviews second');
  process.env.YOUTUBE_API_KEY = 'k'; process.env.YOUTUBE_DAILY_SEARCHES = '4';
  vid.__resetVideos();
  let calls = 0;
  vid.__setFetch(async () => { calls += 1; return { ok: true, json: async () => ({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'T <b>', channelTitle: 'C' } }] }) }; });
  const v = await vid.videosFor(dir, { id: 'Q2', t: 'Raze', y: 2013 });
  assert.equal(calls, 3);
  html = vid.videosBox({ t: 'Raze', y: 2013 }, v);
  assert.match(html, /youtube-nocookie\.com\/embed\/abcdefghijk/);
  assert.match(html, /T &lt;b&gt;/);
  await vid.videosFor(dir, { id: 'Q2', t: 'Raze', y: 2013 });
  assert.equal(calls, 3); // cached
  await vid.videosFor(dir, { id: 'Q3', t: 'Fresh', y: 2022 });
  assert.equal(calls, 4); // budget of 4 reached: remaining kinds fall back to links
  delete process.env.YOUTUBE_API_KEY; delete process.env.YOUTUBE_DAILY_SEARCHES; vid.__setFetch(null);
});

test('bridge: a public-domain classic on the Stream gives its film "Watch free on SoapBox Stream"', async () => {
  const f = await import('./server.mjs');
  const { PD_CLASSICS } = await import('../../integrations/soapbox/classic-films.mjs');
  const c = PD_CLASSICS.find((x) => x.title === 'His Girl Friday');
  const links = f.watchLinks({ id: 'Q999002', t: 'His Girl Friday', y: 1940, w: {} });
  assert.equal(links.ours[0].name, 'Watch free on SoapBox Stream');
  assert.match(links.ours[0].href, new RegExp(`id=${c.id}`));
});
