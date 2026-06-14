// cross-venue-arb.test.js — deterministic, network-free proof of the fee-honest math.
// Exercises the PURE core (computeEdge) + the SWAP_TOKENS map. The live scan (crossVenueEdges /
// bestRoundTripToHE / engineBlock) is network-bound and proven by running the CLI; here we lock
// in the fee-stack arithmetic that decides surface-vs-reject so a rate-limited node can't hide a
// regression.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEdge, SWAP_TOKENS, HE_NATIVE_TOKENS, HE_FEE, EXT_TAKER } from './cross-venue-arb.mjs';

test('SWAP_TOKENS: every entry is redeemable with a chain + coingecko id + a numeric net fee', () => {
  for (const [sym, meta] of Object.entries(SWAP_TOKENS)) {
    assert.ok(sym.startsWith('SWAP.'), `${sym} should be a SWAP.* token`);
    assert.equal(meta.redeemable, true, `${sym} must be redeemable`);
    assert.ok(meta.coingeckoId && meta.chain, `${sym} needs coingeckoId + chain`);
    assert.ok(Number.isFinite(meta.typicalNetworkFeeUsd) && meta.typicalNetworkFeeUsd >= 0, `${sym} needs a network fee`);
  }
  // the operator's named tokens are all present
  for (const s of ['SWAP.LTC', 'SWAP.DOGE', 'SWAP.BTC', 'SWAP.HIVE', 'SWAP.HBD', 'SWAP.EOS', 'SWAP.MATIC', 'SWAP.BCH']) {
    assert.ok(SWAP_TOKENS[s], `${s} should be covered`);
  }
});

test('HE_NATIVE_TOKENS: SPS/DEC/LEO each carry a coingecko id, external chain, fee + DEX swap fee', () => {
  for (const [sym, meta] of Object.entries(HE_NATIVE_TOKENS)) {
    assert.ok(!sym.startsWith('SWAP.'), `${sym} is a HE-native token, not a SWAP wrapper`);
    assert.ok(meta.coingeckoId && meta.chain, `${sym} needs coingeckoId + chain`);
    assert.ok(Number.isFinite(meta.typicalNetworkFeeUsd) && meta.typicalNetworkFeeUsd >= 0, `${sym} needs a bridge+gas fee`);
    assert.ok(Number.isFinite(meta.dexSwapFee) && meta.dexSwapFee > 0, `${sym} needs a DEX swap fee`);
  }
  for (const s of ['SPS', 'DEC', 'LEO']) assert.ok(HE_NATIVE_TOKENS[s], `${s} should be covered`);
});

test('computeEdge SIZE-AWARE: a flat fee amortizes over trade size (the cheap-token fix)', () => {
  // cheap-token with a gross gap (~5.9%) that clears the variable fees: $0.00321 HE vs $0.00340 ext,
  // $0.80 flat bridge fee. Per-unit charging would nuke it; size-aware amortizes the flat fee.
  const small = computeEdge({ heUsd: 0.00321, externalUsd: 0.00340, netFeeUsd: 0.80, extTaker: 0.0025, sizeUsd: 100 });
  const big = computeEdge({ heUsd: 0.00321, externalUsd: 0.00340, netFeeUsd: 0.80, extTaker: 0.0025, sizeUsd: 10000 });
  // bigger size → flat fee a smaller %, so net improves monotonically
  assert.ok(big.netPct > small.netPct, `net should improve with size: ${small.netPct} -> ${big.netPct}`);
  // breakeven size is reported (the size where the flat fee is finally covered), positive here
  assert.ok(small.breakevenSizeUsd > 0, 'breakeven size reported');
  // a gross gap UNDER the variable fees can never clear → breakeven null
  const hopeless = computeEdge({ heUsd: 100, externalUsd: 100.5, netFeeUsd: 0.10, sizeUsd: 100 }); // 0.5% gross < ~2.5% variable
  assert.equal(hopeless.breakevenSizeUsd, null);
});

test('computeEdge: a gross gap that BEATS the full fee stack nets positive', () => {
  // $95 on HE vs $100 external, $0.10 LTC-style net fee → a real ~5.3% gross gap.
  const e = computeEdge({ heUsd: 95, externalUsd: 100, netFeeUsd: 0.10 });
  assert.ok(e.grossPct > 5 && e.grossPct < 6, `gross ~5.26%, got ${e.grossPct}`);
  assert.ok(e.netPct > 0, `net should be positive, got ${e.netPct}`);
  assert.ok(e.netAfterFeesUsd > 0, 'net USD positive');
  // the fee stack is exactly the gross-minus-net gap, and it is real (HE 2 sides + taker + flat fee)
  assert.ok(e.feeStackUsd > 0);
  assert.ok(Math.abs((100 - 95) - e.netAfterFeesUsd - e.feeStackUsd) < 1e-6, 'gross = net + feeStack');
});

test('computeEdge: a thin gross gap is EATEN by the fee stack → net negative (correctly rejected)', () => {
  // $99 vs $100 — only ~1% gross, less than HE 1%/side alone.
  const e = computeEdge({ heUsd: 99, externalUsd: 100, netFeeUsd: 0.10 });
  assert.ok(e.grossPct > 0, 'gross is positive (it IS underpriced)…');
  assert.ok(e.netPct < 0, '…but net is negative after the full stack');
});

test('computeEdge: fee stack scales with the flat network fee (a pricey chain hop kills marginal edges)', () => {
  const cheap = computeEdge({ heUsd: 95, externalUsd: 100, netFeeUsd: 0.10 });   // LTC-style
  const dear = computeEdge({ heUsd: 95, externalUsd: 100, netFeeUsd: 3.00 });    // BTC-style
  assert.ok(dear.feeStackUsd > cheap.feeStackUsd, 'BTC net fee makes a bigger stack');
  assert.ok(dear.netAfterFeesUsd < cheap.netAfterFeesUsd, 'and a smaller net');
});

test('computeEdge: guards reject non-positive prices', () => {
  assert.equal(computeEdge({ heUsd: 0, externalUsd: 100, netFeeUsd: 0 }), null);
  assert.equal(computeEdge({ heUsd: 95, externalUsd: 0, netFeeUsd: 0 }), null);
});

test('fee constants are the operator-stated stack (HE 1%/side, ~0.5% external taker)', () => {
  assert.equal(HE_FEE, 0.01);
  assert.equal(EXT_TAKER, 0.005);
});
