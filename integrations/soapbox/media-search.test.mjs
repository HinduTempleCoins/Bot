// media-search.test.mjs — offline tests for the grouped search behind search.soapbox.community.
// No network: fetch and the chain searcher are injected with canned data.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as ms from './media-search.mjs';

const json = (o) => ({ ok: true, json: async () => o, text: async () => JSON.stringify(o) });
const html = (s) => ({ ok: true, json: async () => { throw new Error('not json'); }, text: async () => s });

function fakeFetch(url, opts = {}) {
  const u = String(url);
  if (u.includes('/rpc')) {
    const body = JSON.parse(opts.body || '{}');
    if (body.method === 'condenser_api.lookup_accounts') return json({ result: ['sojol', 'sojolx'] });
    if (body.method === 'condenser_api.get_accounts') return json({ result: [{ name: 'sojol', created: '2026-01-01T00:00:00', post_count: 9, posting_json_metadata: JSON.stringify({ profile: { name: 'Sojol', about: 'Travel posts', profile_image: 'https://img.example/s.png' } }) }] });
    return json({ result: [] });
  }
  if (u.includes('wiki.soapbox.community/api/search')) return json({ results: [{ slug: 'Ukuphahla', title: 'Ukuphahla', url: 'https://wiki.soapbox.community/wiki/Ukuphahla', snippet: "'''Ukuphahla''' is a rite" }] });
  if (u.includes('/films/api/search')) return json({ results: [{ id: 'Q151895', t: 'Nosferatu', y: 1922, d: ['F. W. Murnau'], g: ['horror'], img: 'Nosferatu poster.jpg', w: { archive: 'x' } }] });
  if (u.includes('/pins.json')) return json({ pins: [{ id: 'a/pin-lotus-1', author: 'a', title: 'Blue lotus', note: '', cover: 'https://img.example/l.jpg', tags: [] }] });
  if (u.endsWith('/gallery')) return html('<div class=gcard>\n    <a href="/p/1.png"><img src="/img/1.png" alt="Nosferatu in a gothic doorway" loading=lazy></a>');
  if (u.includes('/remakes/manifest.json')) return json({ scenes: [{ key: 'cheddar', title: 'Cheddar Man', group: 'Skulls', looks: { '1_real': { face1: 'f.jpg' } } }] });
  if (u.includes('/music/catalog.json')) return json({ tracks: [{ id: 'river', title: 'Meet Me by the River Gate', artist: 'Hathor Sandalphon', genre: 'gospel', url: 'https://stream.soapbox.community/music/t/river' }] });
  if (u.includes('/pentecaust/bifrost')) return html('');
  if (u.includes('/documentaries/manifest.json')) return json({ films: [] });
  return { ok: false, json: async () => ({}), text: async () => '' };
}

beforeEach(() => {
  ms.__setFetch(fakeFetch);
  ms.__setChain(async (q) => (/sojol/.test(q)
    ? [{ kind: 'post', title: 'Sajek Valley by sojol', link: 'https://melek.salon/@sojol/sajek', author: 'sojol', tags: ['travel'], snippet: 'a trip', score: 0.6, image: 'https://img.example/p.jpg' },
       { kind: 'post', title: 'Unrelated', link: 'https://melek.salon/@x/y', author: 'x', tags: [], snippet: 'nothing', score: 0.05 }]
    : []));
  ms.__setSites([{ host: 'stream.soapbox.community', app: 'stream', purpose: 'SoapBox Stream: free films and horror.' }, { host: 'soapy.blog', app: 'admin', purpose: 'horror admin' }]);
});

test('matchScore: exact title is 1, all terms high, none 0', () => {
  assert.equal(ms.matchScore('Nosferatu', 'Nosferatu'), 1);
  assert.ok(ms.matchScore('kula bridge', 'The KULA Bridge Is Open') >= 0.8);
  assert.equal(ms.matchScore('kula', 'Something else'), 0);
});

test('a film title puts Films first, with a poster thumbnail and a free-to-watch tag', async () => {
  const g = await ms.searchGroups('Nosferatu');
  assert.equal(g[0].key, 'films');
  const f = g[0].items[0];
  assert.equal(f.url, 'https://stream.soapbox.community/films/Q151895');
  assert.match(f.thumb, /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/Nosferatu_poster\.jpg/);
  assert.equal(f.tag, 'Free to watch');
  // the Hathor gallery picture matching the prompt is in Pictures
  assert.ok(g.find((x) => x.key === 'pictures').items.some((i) => i.thumb === 'https://hathor.soapbox.community/img/1.png'));
});

test('a username finds People (with profile + avatar) first, then their posts; weak posts are dropped', async () => {
  const g = await ms.searchGroups('sojol');
  assert.equal(g[0].key, 'people');
  assert.equal(g[0].items[0].title, 'Sojol (@sojol)');
  assert.equal(g[0].items[0].thumb, 'https://img.example/s.png');
  const posts = g.find((x) => x.key === 'posts');
  assert.equal(posts.items.length, 1);
  assert.equal(posts.items[0].thumb, 'https://img.example/p.jpg');
});

test('library snippets lose wiki markup; music and remakes are found', async () => {
  const lib = (await ms.searchGroups('Ukuphahla')).find((x) => x.key === 'library');
  assert.equal(lib.items[0].snippet, 'Ukuphahla is a rite');
  const media = (await ms.searchGroups('river gate')).find((x) => x.key === 'media');
  assert.equal(media.items[0].tag, 'Music');
  const pics = (await ms.searchGroups('cheddar man')).find((x) => x.key === 'pictures');
  assert.equal(pics.items[0].thumb, 'https://hathor.soapbox.community/remakes/img/cheddar/f.jpg');
});

test('private/admin hosts never appear, from the site list or from caller extras', async () => {
  const g = await ms.searchGroups('horror', { extraSites: [{ title: 'Admin', url: 'https://soapy.blog/x', snippet: 'horror' }, { title: 'Horror month', url: 'https://stream.soapbox.community/horror', snippet: 'horror' }] });
  const urls = g.flatMap((x) => x.items.map((i) => i.url));
  assert.ok(!urls.some((u) => /soapy\.blog/.test(u)));
  assert.ok(urls.includes('https://stream.soapbox.community/horror'));
});

test('a dead source soft-fails: the other groups still come back', async () => {
  ms.__setFetch((u, o) => (String(u).includes('/films/') ? Promise.reject(new Error('down')) : fakeFetch(u, o)));
  const g = await ms.searchGroups('Ukuphahla');
  assert.ok(g.some((x) => x.key === 'library'));
  assert.deepEqual(await ms.searchGroups('   '), []);
  assert.deepEqual(await ms.searchGroups(''), []);
});
