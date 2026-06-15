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

test('config: default chain is PRANA (108369 / 0x1a751), fee 30 bps', () => {
  assert.equal(CHAIN.chainId, 108369);
  assert.equal(CHAIN.chainIdHex, '0x1a751');
  assert.equal(FEE_BPS, 30);
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
  assert.equal(chainReady(CHAINS.prana), false, 'PRANA router is a placeholder until DeployAmm runs');
  assert.equal(chainReady(CHAINS.tron), false, 'non-EVM gated until its adapter ships');
  // exactly the 4 canonical EVM DEXes are swap-ready right now
  assert.deepEqual(readyChains().map((c) => c.key).sort(), ['avalanche', 'bsc', 'ethereum', 'polygon']);
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
