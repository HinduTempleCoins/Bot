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
  assert.match(page.body, /\/watch\?src=ia&amp;id=metropolis_20201015/);
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
