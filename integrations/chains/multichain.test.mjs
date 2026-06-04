// multichain.test.mjs — OFFLINE tests for integrations/chains/multichain.mjs (queue #60).
//
// The module has NO __setFetch hook; it calls the global `fetch` directly. So these tests
// inject a fake `globalThis.fetch` (saved/restored per test) to exercise chainStatus /
// chainsTvl / nativePrices without hitting the network, plus pure tests on the CHAINS
// directory shape. No network, no keys.
//
//   node --test integrations/chains/multichain.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAINS, chainStatus, chainsTvl, nativePrices } from './multichain.mjs';

// ---- fake-fetch harness ----------------------------------------------------
const realFetch = globalThis.fetch;
function withFetch(handler, fn) {
  globalThis.fetch = handler;
  return Promise.resolve().then(fn).finally(() => { globalThis.fetch = realFetch; });
}
// build a Response-ish object the module's jsonFetch is happy with
function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}
function failResponse(status = 500) {
  return { ok: false, status, json: async () => ({}) };
}

// ===========================================================================
// 1. CHAINS directory shape (pure, no fetch)
// ===========================================================================
const KNOWN_KINDS = new Set(['evm', 'solana', 'sui', 'tron', 'ton', 'near', 'aptos', 'priceonly', 'esplora']);

test('CHAINS is a non-empty object with 20+ chains', () => {
  assert.equal(typeof CHAINS, 'object');
  const names = Object.keys(CHAINS);
  assert.ok(names.length >= 20, `expected >=20 chains, got ${names.length}`);
  // header comment promises 20 total + 2 UTXO = the set we read; just confirm a few anchors
  for (const anchor of ['ethereum', 'solana', 'bitcoin', 'tron', 'ton', 'near', 'aptos', 'cardano']) {
    assert.ok(anchor in CHAINS, `missing expected chain ${anchor}`);
  }
});

test('every chain has cg + llama strings and a known kind', () => {
  for (const [name, c] of Object.entries(CHAINS)) {
    // cg may be null for pre-market ecosystem chains (e.g. PRANA — no public coingecko id yet).
    if (c.cg !== null) {
      assert.equal(typeof c.cg, 'string', `${name}.cg should be a string or null`);
      assert.ok(c.cg.length > 0, `${name}.cg empty`);
    }
    assert.equal(typeof c.llama, 'string', `${name}.llama should be a string`);
    assert.ok(c.llama.length > 0, `${name}.llama empty`);
    assert.ok(KNOWN_KINDS.has(c.kind), `${name}.kind '${c.kind}' not in known kinds`);
  }
});

test('each kind carries the endpoint field it needs', () => {
  for (const [name, c] of Object.entries(CHAINS)) {
    switch (c.kind) {
      case 'evm':
      case 'solana':
      case 'sui':
      case 'near':
        // DORMANT chains (e.g. PRANA before PRANA_RPC_URL is set) resolve rpc to [] by design —
        // that is the soft-fail seam, not a misconfig. Just require rpc to be an array; if it has
        // entries, they must be https.
        assert.ok(Array.isArray(c.rpc), `${name} needs rpc[] (array, may be empty when dormant)`);
        for (const u of c.rpc) assert.match(u, /^https:\/\//, `${name} rpc not https: ${u}`);
        break;
      case 'tron':
        assert.match(c.trongrid, /^https:\/\//, `${name} needs trongrid url`);
        break;
      case 'ton':
        assert.match(c.toncenter, /^https:\/\//, `${name} needs toncenter url`);
        break;
      case 'aptos':
        assert.ok(Array.isArray(c.rest) && c.rest.length > 0, `${name} needs rest[]`);
        break;
      case 'esplora':
        assert.ok(Array.isArray(c.explorer) && c.explorer.length > 0, `${name} needs explorer[]`);
        break;
      case 'priceonly':
        // no endpoint needed by design
        break;
      default:
        assert.fail(`unhandled kind ${c.kind} for ${name}`);
    }
  }
});

// ===========================================================================
// 2. chainStatus normalization with injected fetch
// ===========================================================================
test('chainStatus returns null for unknown chain (no fetch)', async () => {
  const s = await chainStatus('not-a-chain');
  assert.equal(s, null);
});

test('chainStatus EVM normalizes hex height + gwei gas', async () => {
  await withFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0x10' }); // 16
    if (body.method === 'eth_gasPrice') return jsonResponse({ result: '0x77359400' }); // 2e9 wei = 2 gwei
    throw new Error('unexpected method');
  }, async () => {
    const s = await chainStatus('ethereum');
    assert.equal(s.chain, 'ethereum');
    assert.equal(s.kind, 'evm');
    assert.equal(s.height, 16);
    assert.equal(s.gasGwei, 2);
  });
});

test('chainStatus EVM soft-fails gas (gasGwei null) but keeps height', async () => {
  await withFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_blockNumber') return jsonResponse({ result: '0xff' }); // 255
    if (body.method === 'eth_gasPrice') return failResponse(); // gas call fails
    throw new Error('unexpected');
  }, async () => {
    const s = await chainStatus('base');
    assert.equal(s.height, 255);
    assert.equal(s.gasGwei, null);
  });
});

test('chainStatus solana reads getSlot as numeric height', async () => {
  await withFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    assert.equal(body.method, 'getSlot');
    return jsonResponse({ result: 123456789 });
  }, async () => {
    const s = await chainStatus('solana');
    assert.equal(s.kind, 'solana');
    assert.equal(s.height, 123456789);
    assert.equal(s.gasGwei, null);
  });
});

test('chainStatus esplora reads tip height from first explorer', async () => {
  await withFetch(async (url) => {
    assert.match(url, /\/blocks\/tip\/height$/);
    return jsonResponse(840000);
  }, async () => {
    const s = await chainStatus('bitcoin');
    assert.equal(s.kind, 'esplora');
    assert.equal(s.height, 840000);
  });
});

test('chainStatus tron reads block_header number', async () => {
  await withFetch(async () => jsonResponse({ block_header: { raw_data: { number: 60000000 } } }),
    async () => {
      const s = await chainStatus('tron');
      assert.equal(s.kind, 'tron');
      assert.equal(s.height, 60000000);
    });
});

test('chainStatus priceonly returns null height without any fetch', async () => {
  let called = false;
  await withFetch(async () => { called = true; return jsonResponse({}); }, async () => {
    const s = await chainStatus('cardano');
    assert.equal(s.kind, 'priceonly');
    assert.equal(s.height, null);
    assert.equal(s.gasGwei, null);
  });
  assert.equal(called, false, 'priceonly should not hit the network');
});

// ---- soft-fail: never throws on transport/HTTP errors ----------------------
test('chainStatus EVM returns {error} (does not throw) when all RPC fail', async () => {
  await withFetch(async () => failResponse(503), async () => {
    let s, threw = false;
    try { s = await chainStatus('polygon'); } catch { threw = true; }
    assert.equal(threw, false, 'must not throw');
    assert.equal(s.chain, 'polygon');
    assert.ok('error' in s, 'expected an error field on failure');
  });
});

test('chainStatus esplora returns null height (no throw) when all explorers fail', async () => {
  await withFetch(async () => { throw new Error('network down'); }, async () => {
    let s, threw = false;
    try { s = await chainStatus('litecoin'); } catch { threw = true; }
    assert.equal(threw, false);
    assert.equal(s.height, null);
  });
});

// ===========================================================================
// 3. chainsTvl normalization + soft-fail
// ===========================================================================
test('chainsTvl maps llama name -> tvl', async () => {
  await withFetch(async (url) => {
    assert.match(url, /llama\.fi/);
    return jsonResponse([
      { name: 'Ethereum', tvl: 50e9 },
      { name: 'Solana', tvl: 8e9 },
    ]);
  }, async () => {
    const t = await chainsTvl();
    assert.equal(t.Ethereum, 50e9);
    assert.equal(t.Solana, 8e9);
  });
});

test('chainsTvl soft-fails to {} on error (never throws)', async () => {
  await withFetch(async () => { throw new Error('boom'); }, async () => {
    let t, threw = false;
    try { t = await chainsTvl(); } catch { threw = true; }
    assert.equal(threw, false);
    assert.deepEqual(t, {});
  });
});

// ===========================================================================
// 4. nativePrices normalization + soft-fail
// ===========================================================================
test('nativePrices returns coingecko price map; URL carries unique cg ids', async () => {
  let seenUrl = '';
  await withFetch(async (url) => {
    seenUrl = url;
    return jsonResponse({ ethereum: { usd: 3000 }, solana: { usd: 150 } });
  }, async () => {
    const p = await nativePrices();
    assert.equal(p.ethereum.usd, 3000);
    assert.equal(p.solana.usd, 150);
  });
  // ids should be de-duplicated (ethereum appears as cg for several L2s)
  const idsParam = decodeURIComponent(seenUrl.split('ids=')[1].split('&')[0]);
  const ids = idsParam.split(',');
  assert.equal(new Set(ids).size, ids.length, 'cg ids should be unique in the request');
  assert.ok(ids.includes('ethereum'));
});

test('nativePrices soft-fails to {} on error (never throws)', async () => {
  await withFetch(async () => failResponse(429), async () => {
    let p, threw = false;
    try { p = await nativePrices(); } catch { threw = true; }
    assert.equal(threw, false);
    assert.deepEqual(p, {});
  });
});
