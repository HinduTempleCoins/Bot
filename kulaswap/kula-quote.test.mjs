// kula-quote.test.mjs — OFFLINE. The constant-product quote math + config + browser-safety guard.
//   node --test web/kula-quote.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAmountOut, getAmountIn, quoteSwap, priceImpact } from './kula-quote.mjs';
import { CHAIN, CHAINS, FEE_BPS, isNative, chainReady, evmChains, allChains, readyChains } from './kula-config.mjs';

test('getAmountOut matches the Uniswap-v2 / Pair 0.3% formula', () => {
  // 1000 in, reserves 1e6/1e6, 0.30% fee → ~996 out (canonical)
  const { amountOut } = getAmountOut({ amountIn: 1000, reserveIn: 1_000_000, reserveOut: 1_000_000, feeBps: 30 });
  assert.ok(amountOut > 996 && amountOut < 997, `expected ~996, got ${amountOut}`);
});

test('getAmountIn is the inverse of getAmountOut (round-trips within rounding)', () => {
  const r = { reserveIn: 5_000_000, reserveOut: 2_000_000, feeBps: FEE_BPS };
  const { amountOut } = getAmountOut({ amountIn: 10_000, ...r });
  const { amountIn } = getAmountIn({ amountOut, ...r });
  assert.ok(Math.abs(amountIn - 10_000) <= 3, `inverse should land near 10000, got ${amountIn}`);
});

test('quoteSwap reports out + price impact together; impact grows with size', () => {
  const small = quoteSwap({ amountIn: 100, reserveIn: 1_000_000, reserveOut: 1_000_000 });
  const big = quoteSwap({ amountIn: 200_000, reserveIn: 1_000_000, reserveOut: 1_000_000 });
  assert.ok(small.amountOut > 0);
  assert.ok(big.priceImpact > small.priceImpact, 'bigger trade => more price impact');
});

test('bad inputs soft-fail (amountOut 0 / impact 0), never throw', () => {
  assert.equal(getAmountOut({ amountIn: 0, reserveIn: 1, reserveOut: 1 }).amountOut, 0);
  assert.equal(getAmountOut({ amountIn: 10, reserveIn: 0, reserveOut: 1 }).amountOut, 0);
  assert.equal(priceImpact({ amountIn: -5, reserveIn: 1, reserveOut: 1 }), 0);
});

test('config: default chain is PRANA MAINNET (712217 / 0xADE19), fee 30 bps', () => {
  // kula.money defaults to PRANA mainnet — the live AMM + 4 seeded pairs (2026-08-31).
  assert.equal(CHAIN.chainId, 712217);
  assert.equal(CHAIN.chainIdHex, '0xADE19');
  assert.equal(FEE_BPS, 30);
});

test('prana-mainnet block is verified with the live AMM addrs + 8-dec tradeable tokens', () => {
  const m = CHAINS['prana-mainnet'];
  assert.equal(m.chainId, 712217);
  assert.equal(m.chainIdHex, '0xADE19');
  assert.equal(m.verified, true);
  assert.equal(m.router, '0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5');
  assert.equal(m.factory, '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6');
  assert.equal(m.wnative, '0xCAbCaAeBBF7a7312b91A92Faa635d7a32Af42a34');
  // Format guard (20-byte hex). The EIP-55 checksum itself is validated by the browser test — a bad
  // checksum makes ethers v6 throw "bad address checksum" at quote/swap time (caught pre-ship 2026-08-31).
  for (const a of [m.router, m.factory, m.wnative, ...m.tokens.map((t) => t.address)]) {
    assert.match(a, /^0x[0-9a-fA-F]{40}$/);
  }
  assert.equal(chainReady(m), true, 'live AMM → swap-ready');
  // The tradeable dropdown set, with the load-bearing decimals (wVKBT/wCURE are 8, not 18).
  const bySym = Object.fromEntries(m.tokens.map((t) => [t.symbol, t]));
  assert.deepEqual(Object.keys(bySym).sort(), ['KULA', 'WPRANA', 'wCURE', 'wVKBT']);
  assert.equal(bySym.KULA.decimals, 18);
  assert.equal(bySym.WPRANA.decimals, 18);
  assert.equal(bySym.wVKBT.decimals, 8, 'wVKBT is 8-decimal — wrong decimals = 10^10 off');
  assert.equal(bySym.wCURE.decimals, 8, 'wCURE is 8-decimal — wrong decimals = 10^10 off');
  assert.equal(bySym.WPRANA.address, m.wnative, 'WPRANA token addr == wnative');
});

test('multi-chain: a broad set across EVM + non-EVM is registered', () => {
  for (const k of ['prana', 'ethereum', 'polygon', 'bsc', 'avalanche', 'base', 'arbitrum', 'optimism',
    'fantom', 'gnosis', 'cronos', 'linea', 'zksync', 'tron', 'eos', 'solana', 'near', 'osmosis']) {
    assert.ok(CHAINS[k], `missing chain: ${k}`);
  }
  assert.equal(CHAINS.ethereum.dex, 'Uniswap V2');
  assert.equal(CHAINS.avalanche.chainId, 43114);
  assert.equal(CHAINS.bsc.feeBps, 25, 'Pancake is 0.25%, not 0.30%');
  assert.ok(evmChains().length >= 15, `expected many EVM chains, got ${evmChains().length}`);
  assert.ok(allChains().length >= 20, `expected 20+ chains total, got ${allChains().length}`);
});

test('chainReady gates on verified:true — only confirmed routers may swap; the rest list but cannot', () => {
  // verified canonical → ready
  assert.equal(chainReady(CHAINS.ethereum), true);
  assert.equal(chainReady(CHAINS.avalanche), true);
  // unverified (addresses from memory, awaiting confirmation) → gated, even if a router is present
  assert.equal(chainReady(CHAINS.base), false, 'addresses-from-memory chains stay gated until verified');
  assert.equal(chainReady(CHAINS.prana), true, 'PRANA router/factory deployed + verified (DeployAmm on testnet 2026-06-16)');
  assert.equal(chainReady(CHAINS.tron), false, 'non-EVM gated until its adapter ships');
  // the canonical EVM DEXes + PRANA (our own, deployed) are swap-ready right now
  assert.equal(chainReady(CHAINS['prana-mainnet']), true, 'PRANA mainnet AMM live + verified (2026-08-31)');
  assert.deepEqual(readyChains().map((c) => c.key).sort(), ['avalanche', 'bsc', 'ethereum', 'polygon', 'prana', 'prana-mainnet']);
});

test('isNative detects the native coin per chain', () => {
  assert.equal(isNative(CHAINS.ethereum, { symbol: 'ETH' }), true);
  assert.equal(isNative(CHAINS.avalanche, { address: 'native' }), true);
  assert.equal(isNative(CHAINS.ethereum, { symbol: 'USDC', address: '0x1' }), false);
});

test('quote module is BROWSER-safe: the CLI guard is typeof-guarded (the pool-brain lesson)', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('./kula-quote.mjs', import.meta.url)), 'utf8');
  assert.ok(!/\bif \(process\.argv/.test(src), 'unguarded process.argv crashes the module on browser import');
});
