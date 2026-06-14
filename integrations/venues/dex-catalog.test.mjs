// dex-catalog.test.mjs — FULLY OFFLINE. Injected fetch, no real network. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEX_CATALOG, collectDexCatalog, byChain, topByVolume, chainsCovered, catalogStats,
  handler, __setFetch,
} from './dex-catalog.mjs';

const ALLOWED_KINDS = new Set(['dex', 'perp', 'aggregator', 'options', 'rwa']);

// Build a fake fetch that maps a set of "live" slugs to data; everything else returns the
// DefiLlama unknown-slug shape (dexs/derivatives) or a non-numeric string (/tvl).
function fakeFetch(live = {}) {
  return async (url) => {
    const u = String(url);
    // /summary/dexs|derivatives|...|/<slug>?...
    const sm = u.match(/\/summary\/[^/]+\/([^?]+)/);
    if (sm) {
      const slug = decodeURIComponent(sm[1]);
      const hit = live[slug];
      if (hit && hit.total24h != null) {
        return { ok: true, json: async () => ({ total24h: hit.total24h, total7d: hit.total7d ?? null, total30d: null, change_1d: hit.change_1d ?? null }) };
      }
      return { ok: true, json: async () => ({ message: `protocol '${slug}' not found` }) };
    }
    const tv = u.match(/\/tvl\/([^?]+)/);
    if (tv) {
      const slug = decodeURIComponent(tv[1]);
      const hit = live[slug];
      if (hit && hit.tvl != null) return { ok: true, json: async () => hit.tvl };
      return { ok: true, json: async () => 'Protocol not found' };
    }
    return { ok: false, json: async () => ({}) };
  };
}

test('registry shape: id/name/chain/kind/confidence + a defillamaSlug; kinds allowed; ids unique', () => {
  const ids = new Set();
  for (const e of DEX_CATALOG) {
    assert.ok(e.id && typeof e.id === 'string', `id on ${e.name}`);
    assert.ok(e.name && typeof e.name === 'string', `name on ${e.id}`);
    assert.ok(e.chain && typeof e.chain === 'string', `chain on ${e.id}`);
    assert.ok(ALLOWED_KINDS.has(e.kind), `kind ${e.kind} on ${e.id}`);
    assert.ok(['high', 'medium', 'verify'].includes(e.confidence), `confidence on ${e.id}`);
    assert.ok(e.defillamaSlug && typeof e.defillamaSlug === 'string', `defillamaSlug on ${e.id}`);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
  }
  assert.ok(DEX_CATALOG.length >= 100, `expected >=100 venues, got ${DEX_CATALOG.length}`);
});

test('collectDexCatalog normalizes venues; unknown slug -> alive:false vol null; live slug -> alive:true with volume', async () => {
  __setFetch(fakeFetch({ thena: { total24h: 12345678, total7d: 80000000, change_1d: 3.2, tvl: 5000000 } }));
  try {
    const { ok, asOf, venues } = await collectDexCatalog({ ids: ['thena', 'biswap'] });
    assert.equal(ok, true);
    assert.ok(asOf);
    const thena = venues.find((v) => v.id === 'thena');
    const biswap = venues.find((v) => v.id === 'biswap');
    assert.equal(thena.alive, true);
    assert.equal(thena.volume24hUsd, 12345678);
    assert.equal(thena.tvlUsd, 5000000);
    assert.equal(thena.change1d, 3.2);
    // biswap slug is not in `live` -> { message } -> a MISS, not a number
    assert.equal(biswap.alive, false);
    assert.equal(biswap.volume24hUsd, null);
    assert.equal(biswap.tvlUsd, null);
  } finally { __setFetch(); }
});

test('one throwing fetch does NOT break the whole collection (soft-fail)', async () => {
  let calls = 0;
  __setFetch(async (url) => {
    calls++;
    // throw on the first matching summary, normal otherwise
    if (calls === 1) throw new Error('boom');
    const u = String(url);
    if (u.includes('/summary/')) return { ok: true, json: async () => ({ total24h: 999, total7d: 1000, change_1d: 0 }) };
    if (u.includes('/tvl/')) return { ok: true, json: async () => 42 };
    return { ok: false, json: async () => ({}) };
  });
  try {
    const { venues } = await collectDexCatalog({ ids: ['thena', 'biswap', 'wombat'] });
    assert.equal(venues.length, 3); // none missing despite the throw
    assert.ok(venues.every((v) => 'alive' in v));
  } finally { __setFetch(); }
});

test('byChain / topByVolume / catalogStats pure helpers behave', () => {
  const sample = [
    { id: 'a', name: 'A', chain: 'bsc', kind: 'dex', volume24hUsd: 100, tvlUsd: 10 },
    { id: 'b', name: 'B', chain: 'bsc', kind: 'dex', volume24hUsd: 300, tvlUsd: 30 },
    { id: 'c', name: 'C', chain: 'solana', kind: 'dex', volume24hUsd: null, tvlUsd: null },
    { id: 'd', name: 'D', chain: 'solana', kind: 'perp', volume24hUsd: 200, tvlUsd: null },
  ];
  const bc = byChain(sample);
  assert.equal(bc.bsc.count, 2);
  assert.equal(bc.bsc.volume24hUsd, 400);
  assert.equal(bc.bsc.tvlUsd, 40);
  assert.equal(bc.solana.count, 2);
  assert.equal(bc.solana.volume24hUsd, 200); // null skipped
  assert.equal(bc.solana.tvlUsd, 0);

  const top = topByVolume(sample, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].id, 'b'); // 300
  assert.equal(top[1].id, 'd'); // 200
  assert.ok(!top.some((v) => v.volume24hUsd == null)); // nulls excluded

  const stats = catalogStats();
  assert.equal(stats.venues, DEX_CATALOG.length);
  assert.equal(stats.chains, chainsCovered().length);
  assert.ok(stats.byKind.dex > 0);
  assert.ok(stats.byKind.perp > 0);
  // byKind counts sum to total
  const sum = Object.values(stats.byKind).reduce((s, n) => s + n, 0);
  assert.equal(sum, DEX_CATALOG.length);
});

test('coverage: named samples present across chains', () => {
  const by = (id) => DEX_CATALOG.find((e) => e.id === id);
  const expect = [
    ['thena', 'bsc'],
    ['phoenix', 'solana'],
    ['synthetix', 'optimism'],
    ['minswap', 'cardano'],
    ['ref-finance', 'near'],
    ['astroport', 'cosmos'],
    ['turbos', 'sui'],
    ['gains-network', 'polygon'],
    ['hyperswap', 'hyperevm'],
  ];
  for (const [id, chain] of expect) {
    const e = by(id);
    assert.ok(e, `missing venue ${id}`);
    assert.equal(e.chain, chain, `${id} chain expected ${chain}, got ${e && e.chain}`);
  }
  // gTrade/Gains is a perp; Synthetix is a perp; Derive is options
  assert.equal(by('gains-network').kind, 'perp');
  assert.equal(by('synthetix').kind, 'perp');
  assert.equal(by('derive').kind, 'options');
  assert.equal(by('ostium').kind, 'rwa');
});

test('handler returns a soft-failing JSON payload (GET /api/venues/catalog)', async () => {
  __setFetch(fakeFetch({ thena: { total24h: 5, total7d: 6, change_1d: 1, tvl: 7 } }));
  try {
    let code, body;
    const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b; } };
    await handler({ url: '/api/venues/catalog?ids=thena,biswap', method: 'GET' }, res);
    assert.equal(code, 200);
    const j = JSON.parse(body);
    assert.equal(j.surface, 'dex-catalog');
    assert.equal(j.readOnly, true);
    assert.equal(j.signer, null);
    assert.equal(j.count, 2);
    assert.ok(j.stats && j.stats.venues >= 100);
  } finally { __setFetch(); }
});
