// gridcoin.test.mjs — OFFLINE tests for the SoapBox distributed-research feed (queue #112). No network:
// a fake fetch is injected via __setFetch. We assert the curated directory shape, the stats
// normalizers, and that every reader soft-fails (null/[]) on error / non-OK / garbage.
// Run: node --test integrations/soapbox/gridcoin.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { invalidate } from './cache.mjs';
import {
  __setFetch, PROJECTS, findProject,
  normalizeBoinc, normalizeFah, normalizeGridcoin,
  projectStats, gridcoinStats, researchFeed, gridcoinSummary,
} from './gridcoin.mjs';

// route by URL substring → JSON body (or a sentinel to simulate failure).
function mockFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [frag, body] of Object.entries(routes)) {
      if (u.includes(frag)) {
        if (body === '__NETWORK_ERROR__') throw new Error('boom');
        if (body === '__NOT_OK__') return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// caches are 5-min; clear between tests so injected fetch is actually exercised.
afterEach(() => { __setFetch(null); invalidate(); });

// ---- fixtures ------------------------------------------------------------------------------------
const WCG = { team: { total_credit: 1234567, expavg_credit: 8901, nhosts: 4200, nusers: 950 } };
const FAH = { credit: 99887766, active_cpus: 12000, active_gpus: 3400, teams: 250 };
const GRC = { difficulty: 0.123, netstakeweight: 4500000, moneysupply: 470000000, total_magnitude: 115000, blocks: 3200000, projects: 31 };

// ---- directory shape -----------------------------------------------------------------------------
test('PROJECTS is a curated directory with the required fields + the four expected projects', () => {
  assert.ok(Array.isArray(PROJECTS) && PROJECTS.length >= 4);
  for (const p of PROJECTS) {
    assert.ok(p.id, 'id');
    assert.ok(p.name, 'name');
    assert.ok(['boinc', 'fah', 'coin'].includes(p.kind), 'kind');
    assert.ok(p.focus && p.focus.length > 0, 'research focus');
    assert.match(p.url, /^https:\/\//, 'public URL');
    assert.match(p.stats, /^https:\/\//, 'stats URL');
    assert.ok(p.statsKind, 'statsKind');
  }
  const ids = PROJECTS.map((p) => p.id);
  for (const want of ['wcg', 'rosetta', 'folding', 'gridcoin']) {
    assert.ok(ids.includes(want), `directory includes ${want}`);
  }
});

test('GridCoin entry is the coin kind and names itself the PRANA precedent', () => {
  const grc = findProject('GridCoin'); // case-insensitive
  assert.equal(grc.id, 'gridcoin');
  assert.equal(grc.kind, 'coin');
  assert.match(grc.focus, /PRANA/);
});

test('findProject is case-insensitive and returns null for unknowns', () => {
  assert.equal(findProject('WCG').id, 'wcg');
  assert.equal(findProject('nope'), null);
  assert.equal(findProject(''), null);
  assert.equal(findProject(undefined), null);
});

// ---- normalizers ---------------------------------------------------------------------------------
test('normalizeBoinc maps team totals and tags the source', () => {
  const out = normalizeBoinc(WCG, findProject('wcg'));
  assert.equal(out.kind, 'boinc');
  assert.equal(out.totalCredit, 1234567);
  assert.equal(out.avgCredit, 8901);
  assert.equal(out.hosts, 4200);
  assert.equal(out.users, 950);
  assert.equal(out.source, 'World Community Grid');
});

test('normalizeBoinc tolerates flat + alternate shapes and junk numbers', () => {
  const flat = normalizeBoinc({ totalCredit: '500', host_count: 'NaN' }, null);
  assert.equal(flat.totalCredit, 500);
  assert.equal(flat.hosts, null); // 'NaN' → null, not a crash
  const empty = normalizeBoinc(undefined, null);
  assert.equal(empty.totalCredit, null);
});

test('normalizeFah maps Folding@home fields', () => {
  const out = normalizeFah(FAH, findProject('folding'));
  assert.equal(out.kind, 'fah');
  assert.equal(out.totalCredit, 99887766);
  assert.equal(out.activeCpus, 12000);
  assert.equal(out.activeGpus, 3400);
  assert.equal(out.teams, 250);
  assert.equal(out.source, 'Folding@home');
});

test('normalizeGridcoin maps network snapshot fields', () => {
  const out = normalizeGridcoin(GRC);
  assert.equal(out.symbol, 'GRC');
  assert.equal(out.difficulty, 0.123);
  assert.equal(out.netWeight, 4500000);
  assert.equal(out.moneySupply, 470000000);
  assert.equal(out.totalMagnitude, 115000);
  assert.equal(out.blocks, 3200000);
  assert.equal(out.activeProjects, 31);
  assert.equal(out.source, 'GridCoin');
});

// ---- readers (with fake fetch) -------------------------------------------------------------------
test('projectStats reads a BOINC project and normalizes', async () => {
  __setFetch(mockFetch({ 'worldcommunitygrid.org/boinc/stats': WCG }));
  const out = await projectStats('wcg');
  assert.equal(out.totalCredit, 1234567);
  assert.equal(out.source, 'World Community Grid');
});

test('projectStats reads a Folding@home project via the fah parser', async () => {
  __setFetch(mockFetch({ 'api2.foldingathome.org': FAH }));
  const out = await projectStats(findProject('folding'));
  assert.equal(out.kind, 'fah');
  assert.equal(out.activeGpus, 3400);
});

test('projectStats for the grc entry routes to gridcoinStats', async () => {
  __setFetch(mockFetch({ 'grcpool.com': GRC }));
  const out = await projectStats('gridcoin');
  assert.equal(out.symbol, 'GRC');
  assert.equal(out.activeProjects, 31);
});

test('gridcoinStats reads + normalizes the network snapshot', async () => {
  __setFetch(mockFetch({ 'grcpool.com': GRC }));
  const out = await gridcoinStats();
  assert.equal(out.difficulty, 0.123);
});

test('researchFeed returns one row per project, with stats where available', async () => {
  __setFetch(mockFetch({
    'worldcommunitygrid.org/boinc/stats': WCG,
    'api2.foldingathome.org': FAH,
    'grcpool.com': GRC,
    // rosetta intentionally not routed → its stats read fails → directory-only row
  }));
  const feed = await researchFeed();
  assert.equal(feed.length, PROJECTS.length);
  const wcg = feed.find((r) => r.id === 'wcg');
  assert.ok(wcg.hasLiveStats);
  assert.equal(wcg.stats.totalCredit, 1234567);
  const rosetta = feed.find((r) => r.id === 'rosetta');
  assert.equal(rosetta.hasLiveStats, false);
  assert.equal(rosetta.stats, null);
  // every row still carries directory metadata
  for (const r of feed) { assert.ok(r.name); assert.ok(r.focus); assert.match(r.url, /^https:\/\//); }
});

test('gridcoinSummary reports counts + the GRC line + PRANA note', async () => {
  __setFetch(mockFetch({
    'worldcommunitygrid.org/boinc/stats': WCG,
    'api2.foldingathome.org': FAH,
    'grcpool.com': GRC,
  }));
  const s = await gridcoinSummary();
  assert.equal(s.projects, PROJECTS.length);
  assert.ok(s.boincProjects >= 3); // wcg + rosetta + folding
  assert.ok(s.liveStats >= 1);
  assert.equal(s.gridcoin.symbol, 'GRC');
  assert.match(s.note, /PRANA/);
});

// ---- soft-fail: never throw ----------------------------------------------------------------------
test('projectStats soft-fails to null on network error', async () => {
  __setFetch(mockFetch({ 'worldcommunitygrid.org': '__NETWORK_ERROR__' }));
  assert.equal(await projectStats('wcg'), null);
});

test('projectStats soft-fails to null on non-OK status', async () => {
  __setFetch(mockFetch({ 'api2.foldingathome.org': '__NOT_OK__' }));
  assert.equal(await projectStats('folding'), null);
});

test('projectStats returns null for unknown id without calling network', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  assert.equal(await projectStats('does-not-exist'), null);
});

test('gridcoinStats soft-fails to null on garbage / error', async () => {
  __setFetch(mockFetch({ 'grcpool.com': '__NETWORK_ERROR__' }));
  assert.equal(await gridcoinStats(), null);
});

test('researchFeed still returns all rows when every stats read dies', async () => {
  __setFetch(() => { throw new Error('all down'); });
  const feed = await researchFeed();
  assert.equal(feed.length, PROJECTS.length);
  assert.ok(feed.every((r) => r.hasLiveStats === false && r.stats === null));
});

test('gridcoinSummary degrades to the directory when everything is down', async () => {
  __setFetch(() => { throw new Error('all down'); });
  const s = await gridcoinSummary();
  assert.equal(s.projects, PROJECTS.length);
  assert.equal(s.liveStats, 0);
  assert.equal(s.gridcoin, null);
});
