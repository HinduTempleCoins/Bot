// coin-link-finder.test.mjs — offline. Run: node --test integrations/soapbox/coin-link-finder.test.mjs
// All network is stubbed via __setFetch; the review queue uses an in-memory fs via __setFs, so this
// touches nothing real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateSlugs, bitcointalkSearchUrl, probeReddit, probeGithubOrg,
  findCandidates, enqueueCandidates, listCandidates,
  __setFetch, __setClock, __setFs,
} from './coin-link-finder.mjs';

// --- in-memory fs stub (covers the small surface load()/save() use) -----------
function memFs(initial = {}) {
  const files = { ...initial };
  return {
    _files: files,
    readFileSync(p) { if (!(p in files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync(p, data) { files[p] = data; },
    mkdirSync() { /* no-op */ },
  };
}

// helper: a fetch stub keyed by URL substring → { ok, status, json }
function fetchStub(routes) {
  return async (url) => {
    for (const [needle, resp] of routes) {
      if (String(url).includes(needle)) {
        return {
          ok: resp.ok !== undefined ? resp.ok : (resp.status >= 200 && resp.status < 400),
          status: resp.status ?? 200,
          json: async () => (typeof resp.json === 'function' ? resp.json() : resp.json),
        };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('candidateSlugs builds compact + dashed forms, de-duped, min length', () => {
  const s = candidateSlugs({ id: 'foo-coin', symbol: 'FOO', name: 'Foo Coin' });
  assert.ok(s.includes('foocoin'), 'compact form');
  assert.ok(s.includes('foo-coin'), 'dashed form');
  assert.ok(s.includes('foo'), 'symbol');
  assert.equal(new Set(s).size, s.length, 'no dupes');
  assert.ok(s.every((x) => x.length >= 2));
});

test('bitcointalkSearchUrl builds a scoped, encoded ANN search URL (no fetch)', () => {
  const u = bitcointalkSearchUrl({ name: 'Foo Coin' });
  assert.match(u, /^https:\/\/bitcointalk\.org\/index\.php\?action=search2/);
  assert.match(u, /Foo%20Coin%20ANN/);
  assert.match(u, /brd%5B159%5D=159|brd\[159\]=159/);
  assert.equal(bitcointalkSearchUrl({}), null, 'no term → null');
});

test('probeReddit confirms existence from about.json and is soft on misses', async () => {
  __setFetch(fetchStub([
    ['/r/realsub/about.json', { ok: true, status: 200, json: { data: { display_name: 'realsub', subscribers: 4200 } } }],
    ['/r/nope/about.json', { ok: false, status: 404, json: {} }],
  ]));
  const hit = await probeReddit('realsub');
  assert.equal(hit.exists, true);
  assert.equal(hit.url, 'https://www.reddit.com/r/realsub');
  assert.equal(hit.subscribers, 4200);
  const miss = await probeReddit('nope');
  assert.equal(miss.exists, false);
  __setFetch(null);
});

test('probeReddit soft-fails on a thrown fetch', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await probeReddit('whatever');
  assert.equal(r.exists, false);
  assert.match(r.error, /network down|Error/);
  __setFetch(null);
});

test('probeGithubOrg confirms a 200 org and treats 403 as inconclusive', async () => {
  __setFetch(fetchStub([
    ['/orgs/realorg', { ok: true, status: 200, json: { login: 'realorg', html_url: 'https://github.com/realorg', public_repos: 12 } }],
    ['/orgs/limited', { ok: false, status: 403, json: {} }],
    ['/orgs/missing', { ok: false, status: 404, json: {} }],
  ]));
  const hit = await probeGithubOrg('realorg');
  assert.equal(hit.exists, true);
  assert.equal(hit.url, 'https://github.com/realorg');
  assert.equal(hit.public_repos, 12);
  const limited = await probeGithubOrg('limited');
  assert.equal(limited.exists, false);
  assert.equal(limited.inconclusive, true);
  const missing = await probeGithubOrg('missing');
  assert.equal(missing.exists, false);
  assert.equal(missing.inconclusive, undefined);
  __setFetch(null);
});

test('findCandidates skips coins that already have socials (phase-1 territory)', async () => {
  const coin = {
    id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin',
    links: { website: 'https://bitcoin.org', social: ['https://twitter.com/Bitcoin'] },
    official: {},
  };
  const r = await findCandidates(coin);
  assert.equal(r.skipped, true);
  assert.equal(r.candidates.length, 0);
});

test('findCandidates produces scored candidates with evidence for a link-less coin', async () => {
  __setClock(() => '2026-06-03T00:00:00.000Z');
  __setFetch(fetchStub([
    ['/r/foocoin/about.json', { ok: true, status: 200, json: { data: { display_name: 'foocoin', subscribers: 5000 } } }],
    ['/orgs/foocoin', { ok: true, status: 200, json: { login: 'foocoin', html_url: 'https://github.com/foocoin', public_repos: 3 } }],
  ]));
  const coin = { id: 'foocoin', symbol: 'FOO', name: 'Foo Coin', links: {}, official: {} };
  const r = await findCandidates(coin);
  assert.equal(r.skipped, false);
  const platforms = r.candidates.map((c) => c.platform).sort();
  assert.deepEqual(platforms, ['bitcointalk', 'github', 'reddit']);
  const reddit = r.candidates.find((c) => c.platform === 'reddit');
  assert.equal(reddit.url, 'https://www.reddit.com/r/foocoin');
  assert.ok(reddit.confidence >= 0.7, 'big sub bumps confidence');
  assert.match(reddit.evidence, /about\.json/);
  assert.equal(reddit.foundAt, '2026-06-03T00:00:00.000Z');
  const bt = r.candidates.find((c) => c.platform === 'bitcointalk');
  assert.equal(bt.confidence, 0.25);
  __setFetch(null); __setClock(null);
});

test('enqueueCandidates writes pending rows and de-dupes on re-run (never auto-publishes)', async () => {
  const fs = memFs();
  __setFs(fs);
  __setClock(() => '2026-06-03T00:00:00.000Z');
  __setFetch(fetchStub([
    ['/r/foocoin/about.json', { ok: true, status: 200, json: { data: { display_name: 'foocoin', subscribers: 5000 } } }],
    ['/orgs/foocoin', { ok: false, status: 404, json: {} }],
  ]));
  const coin = { id: 'foocoin', symbol: 'FOO', name: 'Foo Coin', links: {}, official: {} };
  const r1 = await findCandidates(coin);
  const e1 = await enqueueCandidates(r1);
  assert.ok(e1.added >= 2, 'reddit + bitcointalk queued');
  const pending = listCandidates();
  assert.ok(pending.every((p) => p.status === 'pending'), 'always pending — no auto-publish');
  assert.ok(pending.every((p) => p.coin === 'foocoin'));

  // re-run: same candidates → all skipped, nothing duplicated.
  const r2 = await findCandidates(coin);
  const e2 = await enqueueCandidates(r2);
  assert.equal(e2.added, 0);
  assert.equal(e2.skipped, e1.added);
  assert.equal(listCandidates().length, e1.added);
  __setFetch(null); __setClock(null); __setFs(null);
});

test('listCandidates filters by status and coin', async () => {
  const fs = memFs({
    ['x']: JSON.stringify([
      { id: 'a', coin: 'foo', platform: 'reddit', url: 'u1', status: 'pending' },
      { id: 'b', coin: 'foo', platform: 'github', url: 'u2', status: 'approved' },
      { id: 'c', coin: 'bar', platform: 'reddit', url: 'u3', status: 'pending' },
    ]),
  });
  // point STORE at our in-memory key by overriding the env-derived path indirectly:
  // load() reads from the module STORE constant, so we instead stub fs.readFileSync to always return our rows.
  __setFs({
    readFileSync: () => fs._files['x'],
    writeFileSync: () => {},
    mkdirSync: () => {},
  });
  assert.equal(listCandidates({ status: 'pending' }).length, 2);
  assert.equal(listCandidates({ status: 'approved' }).length, 1);
  assert.equal(listCandidates({ status: null }).length, 3);
  assert.equal(listCandidates({ coin: 'bar' }).length, 1);
  __setFs(null);
});
