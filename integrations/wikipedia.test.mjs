// Offline tests. Every one injects a fake fetch — this suite must never touch the network,
// which is the repo rule and also the only way the assertions stay deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, summary, links, backlinks, categories, expand, coverage, __setFetch } from './wikipedia.mjs';

const ok = (body) => ({ ok: true, json: async () => body });
function fake(routes) {
  return async (url) => {
    for (const [match, body] of routes) if (url.includes(match)) return ok(body);
    return { ok: false, json: async () => ({}) };
  };
}

test('search returns titles and strips the HTML out of snippets', async () => {
  __setFetch(fake([['list=search', { query: { search: [
    { title: 'Khepri', wordcount: 900, snippet: 'a <span class="x">scarab</span>-faced god' },
  ] } }]]));
  const r = await search('Khepri');
  assert.equal(r[0].title, 'Khepri');
  assert.equal(r[0].snippet, 'a scarab-faced god', 'snippet markup must not reach a caller');
});

test('every request carries a descriptive User-Agent — Wikimedia policy, not politeness', async () => {
  let seen = null;
  __setFetch(async (_u, init) => { seen = init?.headers?.['User-Agent']; return ok({ query: { search: [] } }); });
  await search('x');
  assert.match(seen || '', /VanKushFamilyResearchInstitute/);
  assert.match(seen || '', /https:\/\//, 'UA must carry a contact URL');
});

test('a dead network yields empty results, never a throw', async () => {
  __setFetch(async () => { throw new Error('ENOTFOUND'); });
  assert.deepEqual(await search('x'), []);
  assert.deepEqual(await links('x'), []);
  assert.deepEqual(await backlinks('x'), []);
  assert.deepEqual(await categories('x'), []);
  assert.equal((await summary('x')).size, 0);
  const e = await expand(['a', 'b']);
  assert.deepEqual(e.hubs, []);
  assert.deepEqual(e.missing, ['a', 'b'], 'unreachable seeds are reported, not silently dropped');
});

test('an HTTP error is soft-failed the same way', async () => {
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  assert.deepEqual(await search('x'), []);
});

test('summary skips missing pages instead of returning empty strings for them', async () => {
  __setFetch(fake([['prop=extracts', { query: { pages: [
    { title: 'Khepri', extract: 'A scarab-faced god.' },
    { title: 'Nope', missing: true },
  ] } }]]));
  const m = await summary(['Khepri', 'Nope']);
  assert.equal(m.get('Khepri'), 'A scarab-faced god.');
  assert.equal(m.has('Nope'), false);
});

test('expand ranks by how many of OUR seeds reach a page — that count is the product', async () => {
  // Nabta Playa is reached from both seeds; Dung beetle only from one.
  __setFetch(async (url) => {
    if (url.includes('prop=links') && url.includes('Khepri')) {
      return ok({ query: { pages: [{ links: [{ title: 'Nabta Playa' }, { title: 'Dung beetle' }] }] } });
    }
    if (url.includes('prop=links') && url.includes('Ra')) {
      return ok({ query: { pages: [{ links: [{ title: 'Nabta Playa' }] }] } });
    }
    return ok({ query: { backlinks: [] } });
  });
  const r = await expand(['Khepri', 'Ra'], { direction: 'out', minSeeds: 2 });
  assert.deepEqual(r.resolved, ['Khepri', 'Ra']);
  assert.equal(r.hubs.length, 1);
  assert.equal(r.hubs[0].title, 'Nabta Playa');
  assert.equal(r.hubs[0].count, 2);
  assert.deepEqual(r.hubs[0].seeds, ['Khepri', 'Ra']);
  assert.ok(r.all.some((x) => x.title === 'Dung beetle' && x.count === 1), 'single-seed hits stay in `all`');
});

test('expand never reports a seed as its own discovery', async () => {
  __setFetch(async (url) => (url.includes('prop=links')
    ? ok({ query: { pages: [{ links: [{ title: 'Ra' }, { title: 'Atum' }] }] } })
    : ok({ query: { backlinks: [] } })));
  const r = await expand(['Khepri', 'Ra'], { direction: 'out', minSeeds: 1 });
  assert.ok(!r.all.some((x) => x.title === 'Ra'), 'Ra is a seed, not a finding');
  assert.ok(r.all.some((x) => x.title === 'Atum'));
});

test('coverage separates real articles from terms Wikipedia does not have', async () => {
  __setFetch(async (url) => {
    if (url.includes('Punic%20wax') || url.includes('Punic+wax')) return ok({ query: { search: [{ title: 'Encaustic painting', wordcount: 10, snippet: '' }] } });
    return ok({ query: { search: [{ title: 'Khepri', wordcount: 10, snippet: '' }] } });
  });
  const c = await coverage(['Khepri', 'Punic wax']);
  assert.deepEqual(c.have, ['Khepri']);
  assert.equal(c.gaps[0].term, 'Punic wax');
  assert.equal(c.gaps[0].nearest, 'Encaustic painting', 'a near-miss is more useful than a null');
});

test('links and backlinks filter to article namespace only', async () => {
  let urls = [];
  __setFetch(async (u) => { urls.push(u); return ok({ query: { pages: [{ links: [] }], backlinks: [] } }); });
  await links('Khepri'); await backlinks('Khepri');
  assert.ok(urls[0].includes('plnamespace=0'), 'no Talk/Template/Category pages in link output');
  assert.ok(urls[1].includes('blnamespace=0'));
});
