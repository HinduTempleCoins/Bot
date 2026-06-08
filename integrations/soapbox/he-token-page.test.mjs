// he-token-page.test.mjs — offline coverage for the Hive-Engine public coin-page wiring.
// Proves:
//   (1) /coins/<bare-symbol> resolves OUR ecosystem tokens (CURE/VKBT) to the HE token, NOT a
//       CoinGecko ticker collision, with holders surfaced from the PR#231 counts.holders fix.
//   (2) A THIRD-PARTY bare HE symbol (e.g. swap.gifu) resolves NORMALLY via the Hive-Engine fallback.
//   (3) isOurToken() draws the featured-vs-normal line: ours = featured, everything else = normal.
//   (4) holdersPanel() renders the headline holder COUNT (counts.holders), soft-failing to '' on null.
// Fully offline: he-client fetch is injected (body-aware), and globalThis.fetch is stubbed so the
// price-oracle's keyless adapters resolve to "no data" (price 0) without touching the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCoin, isOurToken, OUR_TOKENS, __setFetch } from './condenser.mjs';
import { __setFetch as heSetFetch } from '../he-client.mjs';
import { invalidate } from './cache.mjs';
import { holdersPanel } from '../../site/soapbox/render.mjs';

// A tiny Hive-Engine state: two tokens (CURE = ours, SWAP.GIFU = third-party) + their market metrics.
const HE_TOKENS = {
  CURE: { symbol: 'CURE', name: 'Curator Rewards Token', issuer: 'someissuer', circulatingSupply: '1000000', supply: '1000000', maxSupply: '0' },
  'SWAP.GIFU': { symbol: 'SWAP.GIFU', name: 'Wrapped GIFU', issuer: 'honey-swap', circulatingSupply: '500', supply: '500', maxSupply: '0' },
};
const HE_METRICS = {
  CURE: { symbol: 'CURE', lastPrice: '0.01', volume: '12.5', priceChangePercent: '3.20%' },
  'SWAP.GIFU': { symbol: 'SWAP.GIFU', lastPrice: '0.5', volume: '2.0' },
};

// body-aware Hive-Engine RPC stub: dispatches on (contract, table) + query.symbol.
function heStub() {
  return async (_url, opts) => {
    let body = {};
    try { body = JSON.parse(opts?.body || '{}'); } catch {}
    const { contract, table, query } = body.params || {};
    const sym = query?.symbol;
    let result = [];
    if (contract === 'tokens' && table === 'tokens' && HE_TOKENS[sym]) result = [HE_TOKENS[sym]];
    else if (contract === 'market' && table === 'metrics' && HE_METRICS[sym]) result = [HE_METRICS[sym]];
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}

function setup() {
  heSetFetch(heStub());
  // condenser's own fetch (CoinGecko Tier-1) → always "down" so the HE fallback path is what answers.
  __setFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }));
  // price-oracle's keyless adapters use globalThis.fetch directly → stub to "no data" (hiveUsd→0).
  globalThis.__origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  invalidate();
}
function teardown() {
  heSetFetch(null); __setFetch(null);
  if (globalThis.__origFetch) { globalThis.fetch = globalThis.__origFetch; delete globalThis.__origFetch; }
  invalidate();
}

test('OUR_TOKENS includes VKBT, CURE and the MELEK-family', () => {
  for (const s of ['VKBT', 'CURE', 'MELEK', 'PRANA']) assert.ok(OUR_TOKENS.includes(s), `${s} missing`);
});

test('isOurToken() is the featured-vs-normal line (case-insensitive)', () => {
  assert.equal(isOurToken('CURE'), true);
  assert.equal(isOurToken('cure'), true);
  assert.equal(isOurToken('VKBT'), true);
  assert.equal(isOurToken('prana'), true);
  // third-party HE tokens are NOT ours — they list normally, never featured.
  assert.equal(isOurToken('SWAP.GIFU'), false);
  assert.equal(isOurToken('SWAP.HIVE'), false);
  assert.equal(isOurToken(''), false);
  assert.equal(isOurToken(null), false);
});

test('/coins/cure resolves OUR token via Hive-Engine (bare-symbol slug, no CG hijack)', async () => {
  setup();
  try {
    const c = await getCoin('cure');
    assert.ok(c, 'cure should resolve');
    assert.equal(c.symbol, 'CURE');
    assert.equal(c.source, 'hive-engine');
    assert.equal(c.source_tier, 2);
    assert.equal(c.id, 'hive-engine:cure');
    assert.equal(c.name, 'Curator Rewards Token');
  } finally { teardown(); }
});

test('a third-party bare HE symbol (swap.gifu) resolves NORMALLY via the HE fallback', async () => {
  setup();
  try {
    const c = await getCoin('swap.gifu');
    assert.ok(c, 'swap.gifu should resolve normally');
    assert.equal(c.symbol, 'SWAP.GIFU');
    assert.equal(c.source, 'hive-engine');
    assert.equal(isOurToken(c.symbol), false, 'third-party token is never featured');
  } finally { teardown(); }
});

test('a bogus bare slug stays a clean 404 (null)', async () => {
  setup();
  try {
    const c = await getCoin('definitelynotarealtoken');
    assert.equal(c, null);
  } finally { teardown(); }
});

test('holdersPanel renders the headline holder COUNT from counts.holders (PR#231 fix)', () => {
  const html = holdersPanel({
    issuerPct: 10, affiliatedPct: 5, realOutsidePct: 85,
    counts: { total: 600, holders: 585, outside: 580, realOutside: 575 },
    topOutside: [{ account: 'alice', pct: 12.3, affiliated: false }],
  });
  assert.match(html, /585/, 'shows the true holder count, not 0/100');
  assert.match(html, /holders/);
  assert.match(html, /575 genuine outside holders/);
});

test('holdersPanel soft-fails: null → empty string, missing counts → no headline crash', () => {
  assert.equal(holdersPanel(null), '');
  const html = holdersPanel({ issuerPct: 0, affiliatedPct: 0, realOutsidePct: 0, topOutside: [] });
  assert.equal(typeof html, 'string'); // no throw on missing counts
});
