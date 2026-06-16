// cross-venue-arb.mjs — READ-ONLY cross-venue / multi-hop arbitrage finder. NO keys. NO execution.
// Extends the single-leg arb-scanner (#191) with the operator's refined round-trip strategy:
//
//   A SWAP.* token (SWAP.LTC/DOGE/BTC/HIVE/HBD/EOS/BCH/MATIC…) is a Hive-Engine IOU redeemable
//   1:1 for the REAL underlying asset. Those weird, low-volume HE markets sometimes price the
//   SWAP token BELOW what the real asset fetches on an external exchange. The play: buy SWAP.X
//   cheap on Hive-Engine, redeem it to the underlying chain, withdraw to a US-friendly exchange
//   where the real asset trades, sell into the higher price, and bring the proceeds back to
//   Hive-Engine — so the asset rotates through up to ~5 venues and RETURNS to Hive-Engine with
//   MORE HIVE than it left.
//
// This is profitable ONLY when the HE underprice exceeds the ENTIRE fee stack:
//   • Hive-Engine trade fee: 1% per side (buy + the eventual re-entry)            → ~2%
//   • the underlying CHAIN's network / withdraw fee (LTC tx, DOGE tx, BTC tx…)    → flat USD
//   • the external exchange's taker fee                                           → ~0.5%
// Most candidates do NOT clear that stack — and this module is FEE-HONEST: it computes the full
// stack and surfaces ONLY the edges that survive it. The empty result is the correct, common one.
//
// Advisory only. It never holds a key, never broadcasts, never trades. It hands the analyzer /
// briefs a ranked list of net-after-fee round trips for a human to judge. (#191 cross-venue ext.)
//
//   node integrations/cross-venue-arb.mjs                 # full net-after-fee scan
//   node integrations/cross-venue-arb.mjs plan 500        # best round trip a 500-HIVE size can fund
//   node integrations/cross-venue-arb.mjs block           # brief-ready markdown
//   import { crossVenueEdges, bestRoundTripToHE, engineBlock, SWAP_TOKENS } from './cross-venue-arb.mjs'

import { allMarketMetrics } from './market-universe.mjs';
import { market } from './hive-engine-market.mjs';
import { hiveUsd as oracleHiveUsd } from './price-oracle.mjs';
import { getCoin, fromCoinGecko } from './soapbox/condenser.mjs';
import { usFriendly } from './soapbox/markets-catalog.mjs';
import { cached, TTL } from './soapbox/cache.mjs';
import { usAccessibleListings } from './he-external-listings.mjs';

// ── the redeemable SWAP.* universe ──────────────────────────────────────────────
// Each entry: the CoinGecko id of the REAL underlying, the underlying chain, a rough flat
// network/withdraw fee in USD (the cost to move the asset off-chain to / from the exchange — the
// hop the SWAP IOU's redemption actually pays), and redeemable=true (Hive-Engine honours 1:1).
//
// Network fees are deliberately CONSERVATIVE round figures (research, mid-2026 ballpark — they
// fluctuate with congestion and each exchange sets its own withdrawal flat fee). Over-stating the
// fee is the safe direction: it can only HIDE a marginal edge, never invent one. Override any of
// them at runtime via CVA_NETFEE_<SYMBOL>_USD (e.g. CVA_NETFEE_BTC_USD=3.50).
export const SWAP_TOKENS = {
  'SWAP.BTC':   { coingeckoId: 'bitcoin',       chain: 'Bitcoin',  typicalNetworkFeeUsd: 3.00, redeemable: true },
  'SWAP.LTC':   { coingeckoId: 'litecoin',      chain: 'Litecoin', typicalNetworkFeeUsd: 0.10, redeemable: true },
  'SWAP.DOGE':  { coingeckoId: 'dogecoin',      chain: 'Dogecoin', typicalNetworkFeeUsd: 0.50, redeemable: true },
  'SWAP.BCH':   { coingeckoId: 'bitcoin-cash',  chain: 'BitcoinCash', typicalNetworkFeeUsd: 0.05, redeemable: true },
  'SWAP.EOS':   { coingeckoId: 'eos',           chain: 'EOS',      typicalNetworkFeeUsd: 0.10, redeemable: true },
  'SWAP.MATIC': { coingeckoId: 'matic-network', chain: 'Polygon',  typicalNetworkFeeUsd: 0.05, redeemable: true },
  'SWAP.HIVE':  { coingeckoId: 'hive',          chain: 'Hive',     typicalNetworkFeeUsd: 0.01, redeemable: true },
  'SWAP.HBD':   { coingeckoId: 'hive_dollar',   chain: 'Hive',     typicalNetworkFeeUsd: 0.01, redeemable: true },
  'SWAP.BLURT': { coingeckoId: 'blurt',         chain: 'Blurt',    typicalNetworkFeeUsd: 0.01, redeemable: true },
};

// ── the fee stack ───────────────────────────────────────────────────────────────
export const HE_FEE = +(process.env.CVA_HE_FEE || 0.01);          // Hive-Engine: 1% per side
export const EXT_TAKER = +(process.env.CVA_EXT_TAKER || 0.005);   // external exchange: ~0.5% taker
// minimum NET edge (after the full stack) we bother surfacing — below this it's noise.
const MIN_NET_PCT = +(process.env.CVA_MIN_NET_PCT || 0.5);
// representative round-trip SIZE (USD) the flat network/bridge fee is amortized over. The edge is
// size-dependent (the flat fee shrinks as a % as size grows); we also report the breakeven size.
const ARB_SIZE_USD = +(process.env.CVA_ARB_SIZE_USD || 100);

function netFeeUsd(sym, meta) {
  const env = process.env[`CVA_NETFEE_${sym.replace(/^SWAP\./, '')}_USD`];
  return env != null && env !== '' ? +env : meta.typicalNetworkFeeUsd;
}

// Pick the US-friendly external venue where the underlying actually trades. We can't enumerate every
// listing keylessly, so use a small, honest mapping onto the catalog's us:'full'/'partial' set; fall
// back to the first US-friendly major. Gated on usFriendly() so we never name a US-restricted venue.
const US_CRYPTO = usFriendly('crypto');
function pickUsVenue(coingeckoId) {
  const want = {
    bitcoin: ['Coinbase', 'Kraken', 'Gemini'],
    litecoin: ['Coinbase', 'Kraken'],
    dogecoin: ['Coinbase', 'Kraken', 'Crypto.com'],
    'bitcoin-cash': ['Coinbase', 'Kraken'],
    eos: ['Kraken', 'Coinbase'],
    'matic-network': ['Coinbase', 'Kraken'],
    hive: ['Bitstamp'],          // HIVE has thin US listings; surfaced honestly with low confidence
    hive_dollar: [],
    blurt: [],
  }[coingeckoId] || [];
  for (const name of want) {
    const hit = US_CRYPTO.find((e) => e.name === name);
    if (hit) return { name: hit.name, url: hit.url, us: hit.us };
  }
  const major = US_CRYPTO.find((e) => e.type === 'CEX' && e.us === 'full');
  return major ? { name: major.name, url: major.url, us: major.us } : null;
}

// Resolve the real external USD price for the underlying. getCoin handles the adapter failover; the
// keyless CoinGecko coin endpoint (fromCoinGecko) is the fallback. Cached so a full scan hits each
// underlying once. Returns a positive number or 0.
async function externalUsd(coingeckoId) {
  return cached(`cva:ext:${coingeckoId}`, TTL.price, async () => {
    let coin = await getCoin(coingeckoId).catch(() => null);
    if (!coin || !(+coin.price_usd > 0)) coin = await fromCoinGecko(coingeckoId).catch(() => null);
    return coin && +coin.price_usd > 0 ? +coin.price_usd : 0;
  });
}

// PURE: given the HE USD price, the external USD price, and the fee parameters for ONE token, work
// out the net-after-fee round-trip edge. heUsd is what one unit costs to BUY on Hive-Engine (its
// lowestAsk × hiveUsd); externalUsd is what it SELLS for on the external venue. Returns the gross
// gap and the same gap net of the whole stack, expressed both per-unit (USD) and as a percentage.
export function computeEdge({ heUsd, externalUsd, netFeeUsd, heFee = HE_FEE, extTaker = EXT_TAKER, sizeUsd = null }) {
  if (!(heUsd > 0) || !(externalUsd > 0)) return null;
  const grossPct = (externalUsd - heUsd) / heUsd * 100;

  // SIZE-AWARE path: the flat network/withdraw/bridge fee is paid ONCE for the whole transfer, so it
  // amortizes across the trade SIZE — it is NOT a per-unit cost. (Charging it per unit wrongly nukes
  // every cheap-token edge: a $0.80 bridge fee is not paid on each of a million SPS.) Pass sizeUsd to
  // get the honest net at that size + the breakeven size at which the flat fee is finally covered.
  if (sizeUsd && sizeUsd > 0) {
    const grossFrac = (externalUsd - heUsd) / heUsd;
    const variableFrac = heFee * 2 + extTaker;          // HE buy + HE re-entry + external taker
    const flatFrac = netFeeUsd / sizeUsd;               // the once-paid flat fee, amortized over size
    const netFrac = grossFrac - variableFrac - flatFrac;
    const marginAfterVariable = grossFrac - variableFrac;
    const breakevenSizeUsd = marginAfterVariable > 0 ? netFeeUsd / marginAfterVariable : null;
    return {
      grossPct: +grossPct.toFixed(3),
      netPct: +(netFrac * 100).toFixed(3),
      netAfterFeesUsd: +(netFrac * sizeUsd).toFixed(6),
      feeStackUsd: +((variableFrac * sizeUsd) + netFeeUsd).toFixed(6),
      sizeUsd,
      breakevenSizeUsd: breakevenSizeUsd != null ? +breakevenSizeUsd.toFixed(2) : null,
    };
  }
  // per-unit cost to acquire on HE (incl. the HE buy fee) and proceeds from selling externally
  // (net of the external taker AND the flat network/withdraw fee paid once on the redeemed unit).
  const acquire = heUsd * (1 + heFee);
  const proceedsBeforeReentry = externalUsd * (1 - extTaker) - netFeeUsd;
  // the proceeds come back to HIVE and re-enter Hive-Engine, paying the HE fee a second time.
  const proceeds = proceedsBeforeReentry * (1 - heFee);
  const netAfterFeesUsd = proceeds - acquire;        // per unit, USD
  const netPct = netAfterFeesUsd / acquire * 100;
  // the fee stack as a single per-unit USD figure (what the gross gap must beat)
  const feeStackUsd = (externalUsd - heUsd) - netAfterFeesUsd;
  return {
    grossPct: +grossPct.toFixed(3),
    feeStackUsd: +feeStackUsd.toFixed(6),
    netAfterFeesUsd: +netAfterFeesUsd.toFixed(6),
    netPct: +netPct.toFixed(3),
    acquireUsd: +acquire.toFixed(6),
  };
}

// ── the scan: one net-after-fee edge per SWAP token ─────────────────────────────
// Returns ONLY the round trips whose net edge (after HE 1%/side + chain net fee + external taker)
// clears MIN_NET_PCT. The rejected ones are kept in `.rejected` so a brief can be honest about how
// many candidates were looked at and correctly thrown out.
export async function crossVenueEdges() {
  const [metrics, hUsd] = await Promise.all([
    allMarketMetrics().catch(() => []),
    oracleHiveUsd().catch(() => 0),
  ]);
  if (!hUsd) return { hiveUsd: 0, edges: [], rejected: [], scanned: 0 };
  const bySym = new Map(metrics.map((m) => [m.symbol, m]));

  const edges = [], rejected = [];
  for (const [sym, meta] of Object.entries(SWAP_TOKENS)) {
    const m = bySym.get(sym);
    // buy on HE = pay the lowest ask. No ask → no executable buy side → skip.
    const heAskHive = m ? +m.lowestAsk || 0 : 0;
    const heUsd = heAskHive * hUsd;
    const ext = await externalUsd(meta.coingeckoId);
    const usVenue = pickUsVenue(meta.coingeckoId);
    const fee = netFeeUsd(sym, meta);

    if (!(heUsd > 0) || !(ext > 0)) {
      rejected.push({ token: sym, reason: !(heUsd > 0) ? 'no HE ask (one-sided/empty market)' : 'no external price', heUsd, externalUsd: ext });
      continue;
    }
    const e = computeEdge({ heUsd, externalUsd: ext, netFeeUsd: fee, sizeUsd: ARB_SIZE_USD });
    // confidence: a real underlying-chain venue (full US support) + a non-trivial net edge reads
    // higher than a token whose only US venue is partial/thin or whose net edge is marginal.
    const venueOk = usVenue && usVenue.us === 'full';
    const confidence = e.netPct >= 3 && venueOk ? 'high' : e.netPct >= MIN_NET_PCT && usVenue ? 'medium' : 'low';

    const row = {
      token: sym,
      chain: meta.chain,
      heUsd: +heUsd.toFixed(8),
      externalUsd: +ext.toFixed(8),
      grossPct: e.grossPct,
      feeStackUsd: e.feeStackUsd,
      netPct: e.netPct,
      netAfterFeesUsd: e.netAfterFeesUsd,
      sizeUsd: e.sizeUsd,
      breakevenSizeUsd: e.breakevenSizeUsd,
      heVolumeHive: m ? +m.volume || 0 : 0,
      path: [
        `buy ${sym} on Hive-Engine`,
        `redeem ${sym} → ${meta.chain}`,
        usVenue ? `withdraw to ${usVenue.name}` : 'withdraw to a US-friendly exchange',
        `sell ${meta.coingeckoId} for fiat/HIVE-bridgeable`,
        'bring HIVE back to Hive-Engine',
      ],
      usVenue,
      confidence,
      note: `gross ${e.grossPct}% vs fee stack $${e.feeStackUsd}/unit (HE ${HE_FEE * 100}%/side + ${meta.chain} net $${fee} + ext ${EXT_TAKER * 100}%)`,
    };
    if (e.netPct >= MIN_NET_PCT) edges.push(row);
    else rejected.push({ ...row, reason: `net ${e.netPct}% below ${MIN_NET_PCT}% threshold (fee stack not cleared)` });
  }
  // rank by net percentage edge — the strongest fee-cleared round trip first.
  edges.sort((a, b) => b.netPct - a.netPct);
  return { hiveUsd: hUsd, edges, rejected, scanned: Object.keys(SWAP_TOKENS).length };
}

// ── HE-NATIVE bridgeable tokens (SPS/DEC/LEO …) ──────────────────────────────────
// Unlike SWAP.* (a 1:1 IOU you redeem), these are the SAME token on an external chain reachable via a
// BRIDGE. The play is the same shape — buy cheap on Hive-Engine, move the token to its external chain,
// sell on a US-accessible DEX where it trades higher, bring the proceeds back — and the fee math is
// identical (computeEdge), with the DEX swap fee standing in for the external taker and a flat
// bridge+gas USD for the network hop. The US-accessible venue comes from he-external-listings (the DEX
// leg — Gate/MEXC are US-blocked and never named here). Override fees via CVA_NETFEE_<SYM>_USD.
export const HE_NATIVE_TOKENS = {
  SPS: { coingeckoId: 'splintershards',      chain: 'BSC',      typicalNetworkFeeUsd: 0.80, dexSwapFee: 0.0025 },
  DEC: { coingeckoId: 'dark-energy-crystals', chain: 'BSC',      typicalNetworkFeeUsd: 0.80, dexSwapFee: 0.0025 },
  LEO: { coingeckoId: 'wrapped-leo',          chain: 'Ethereum', typicalNetworkFeeUsd: 6.00, dexSwapFee: 0.003 },
};

function netFeeUsdNative(sym, meta) {
  const env = process.env[`CVA_NETFEE_${sym}_USD`];
  return env != null && env !== '' ? +env : meta.typicalNetworkFeeUsd;
}

// Scan the HE-native bridgeable tokens the same fee-honest way as crossVenueEdges. Reads each token's
// Hive-Engine ask price directly (market.metrics) and the external USD price (CoinGecko). Surfaces
// ONLY net-after-fee edges that clear MIN_NET_PCT; the rest go to `.rejected` for an honest count.
export async function heNativeEdges() {
  const hUsd = await oracleHiveUsd().catch(() => 0);
  if (!hUsd) return { hiveUsd: 0, edges: [], rejected: [], scanned: 0 };

  const edges = [], rejected = [];
  for (const [sym, meta] of Object.entries(HE_NATIVE_TOKENS)) {
    const m = await market.metrics(sym).catch(() => null);
    const heAskHive = m ? +m.lowestAsk || 0 : 0;
    const heUsd = heAskHive * hUsd;
    const ext = await externalUsd(meta.coingeckoId);
    const fee = netFeeUsdNative(sym, meta);
    const usVenue = usAccessibleListings(sym)[0] || null;   // the DEX leg (US-accessible)

    if (!(heUsd > 0) || !(ext > 0)) {
      rejected.push({ token: sym, reason: !(heUsd > 0) ? 'no HE ask (one-sided/empty market)' : 'no external price', heUsd, externalUsd: ext });
      continue;
    }
    const e = computeEdge({ heUsd, externalUsd: ext, netFeeUsd: fee, extTaker: meta.dexSwapFee, sizeUsd: ARB_SIZE_USD });
    const confidence = e.netPct >= 3 && usVenue ? 'high' : e.netPct >= MIN_NET_PCT && usVenue ? 'medium' : 'low';
    const row = {
      token: sym,
      kind: 'he-native-bridge',
      chain: meta.chain,
      heUsd: +heUsd.toFixed(8),
      externalUsd: +ext.toFixed(8),
      grossPct: e.grossPct,
      feeStackUsd: e.feeStackUsd,
      netPct: e.netPct,
      netAfterFeesUsd: e.netAfterFeesUsd,
      sizeUsd: e.sizeUsd,
      breakevenSizeUsd: e.breakevenSizeUsd,
      heVolumeHive: m ? +m.volume || 0 : 0,
      path: [
        `buy ${sym} on Hive-Engine`,
        `bridge ${sym} → ${meta.chain}`,
        usVenue ? `sell on ${usVenue.venue} (${usVenue.symbol})` : 'sell on a US-accessible DEX',
        'bring proceeds back to Hive-Engine',
      ],
      usVenue: usVenue ? { name: usVenue.venue, symbol: usVenue.symbol, us: 'dex' } : null,
      confidence,
      note: `gross ${e.grossPct}% → net ${e.netPct}% at $${ARB_SIZE_USD} (HE ${HE_FEE * 100}%/side + ${meta.chain} bridge+gas $${fee} + DEX ${meta.dexSwapFee * 100}%)${e.breakevenSizeUsd ? `; breakeven size ~$${e.breakevenSizeUsd}` : '; gross gap < variable fees — no size clears it'}`,
    };
    if (e.netPct >= MIN_NET_PCT) edges.push(row);
    else rejected.push({ ...row, reason: `net ${e.netPct}% at $${ARB_SIZE_USD} below ${MIN_NET_PCT}%${e.breakevenSizeUsd ? ` (breakeven needs ~$${e.breakevenSizeUsd})` : ' (gross gap under variable fees — never clears)'}` });
  }
  edges.sort((a, b) => b.netPct - a.netPct);
  return { hiveUsd: hUsd, edges, rejected, scanned: Object.keys(HE_NATIVE_TOKENS).length };
}

// ── depth: how much HIVE you can actually push into one SWAP token's ask side ────
// Walk the sell book (people selling SWAP.X — we buy) and sum the HIVE each level absorbs while the
// level's USD cost is still under the external price. Caps the round trip a given HIVE size can fund.
function executableBuyHive(askLevels, externalUsd, hiveUsd) {
  let execHive = 0;
  for (const lvl of askLevels) {
    const price = +lvl.price, qty = +lvl.quantity;     // price in HIVE per token
    if (!(price > 0) || !(qty > 0)) continue;
    if (price * hiveUsd >= externalUsd) break;          // level no longer under external — stop
    execHive += price * qty;
  }
  return execHive;
}

// ── best round trip a given HIVE size can fund ──────────────────────────────────
// Given startHive, pick the highest-net edge whose HE ask side has enough executable depth to absorb
// (at least part of) that size, and return the full plan back to Hive-Engine with the fundable
// fraction and the expected net HIVE the trip returns.
export async function bestRoundTripToHE(startHive = 100) {
  const { hiveUsd, edges } = await crossVenueEdges();
  if (!hiveUsd || !edges.length) return { hiveUsd, startHive, plan: null, reason: edges.length ? 'no hive price' : 'no fee-clearing edge' };

  let best = null;
  for (const e of edges) {
    const meta = SWAP_TOKENS[e.token];
    const asks = await market.sellBook(e.token, 25).catch(() => []);
    const depthHive = executableBuyHive(asks, e.externalUsd, hiveUsd);
    const fundableHive = Math.min(startHive, depthHive);   // can't push more than the book absorbs
    if (!(fundableHive > 0)) continue;
    // net HIVE returned ≈ fundable × netPct (the edge is expressed on the acquire cost, ~the HIVE in)
    const netHive = fundableHive * (e.netPct / 100);
    const cand = {
      token: e.token, chain: meta.chain, confidence: e.confidence,
      startHive, depthHive: +depthHive.toFixed(2), fundableHive: +fundableHive.toFixed(2),
      capByDepth: fundableHive < startHive,
      netPct: e.netPct, netHiveReturned: +netHive.toFixed(3),
      expectedHiveBack: +(fundableHive + netHive).toFixed(3),
      usVenue: e.usVenue, path: e.path, note: e.note,
    };
    if (!best || cand.netHiveReturned > best.netHiveReturned) best = cand;
  }
  return { hiveUsd, startHive, plan: best, reason: best ? null : 'no edge with executable HE depth for this size' };
}

// ── brief-ready markdown block ──────────────────────────────────────────────────
// The briefs/digest call engineBlock() and splice the returned "### Cross-venue arbitrage" section
// straight into the markdown they assemble — same way they consume other modules' blocks.
export async function engineBlock() {
  let r;
  try { r = await crossVenueEdges(); } catch { r = { hiveUsd: 0, edges: [], rejected: [], scanned: 0 }; }
  const L = ['### Cross-venue arbitrage', ''];
  L.push('_Advisory only — read-only, no keys, no execution. Round trip: buy SWAP.X cheap on Hive-Engine → redeem → withdraw to a US exchange → sell → bring HIVE back. Net of the full fee stack (HE 1%/side + chain network fee + external taker)._', '');
  if (!r.hiveUsd) { L.push('_No HIVE price available — scan skipped._'); return L.join('\n'); }
  L.push(`HIVE $${r.hiveUsd.toFixed(6)} · scanned ${r.scanned} SWAP tokens · ${r.edges.length} clear the fee stack.`, '');
  if (r.edges.length) {
    L.push('| token | chain | HE $ | ext $ | gross | net (after fees) | US venue | conf |', '|---|---|---|---|---|---|---|---|');
    for (const e of r.edges) {
      L.push(`| ${e.token} | ${e.chain} | ${e.heUsd} | ${e.externalUsd} | ${e.grossPct}% | **${e.netPct}%** ($${e.netAfterFeesUsd}/u) | ${e.usVenue ? e.usVenue.name : '—'} | ${e.confidence} |`);
    }
    const top = r.edges[0];
    L.push('', `Best round trip: **${top.token}** — ${top.path.join(' → ')}. ${top.note}.`);
  } else {
    L.push('_No round trip clears the full fee stack right now — the HE underprices are smaller than HE 1%/side + the chain network fee + the external taker. (This is the common, correct outcome.)_');
  }
  if (r.rejected.length) L.push('', `_(${r.rejected.length} candidate(s) rejected: ${r.rejected.slice(0, 4).map((x) => `${x.token} — ${x.reason}`).join('; ')}${r.rejected.length > 4 ? '; …' : ''}.)_`);
  return L.join('\n');
}

export default { SWAP_TOKENS, crossVenueEdges, bestRoundTripToHE, engineBlock, computeEdge, HE_FEE, EXT_TAKER };

// ── CLI ──────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('cross-venue-arb.mjs')) {
  const cmd = (process.argv[2] || 'scan').toLowerCase();
  if (cmd === 'block') {
    console.log(await engineBlock());
  } else if (cmd === 'plan') {
    const size = +(process.argv[3]) || 100;
    const { hiveUsd, plan, reason } = await bestRoundTripToHE(size);
    console.log(`Best round trip back to Hive-Engine for ${size} HIVE — read-only, fee-honest (HIVE $${(hiveUsd || 0).toFixed(6)})\n${'─'.repeat(74)}`);
    if (!plan) { console.log(`  (${reason})`); }
    else {
      console.log(`  ${plan.token} (${plan.chain}) — confidence ${plan.confidence}`);
      console.log(`  fundable: ${plan.fundableHive} HIVE${plan.capByDepth ? ` (capped by HE book depth ${plan.depthHive})` : ''}`);
      console.log(`  net edge: ${plan.netPct}%  →  ~${plan.netHiveReturned} HIVE profit, ~${plan.expectedHiveBack} HIVE back`);
      console.log(`  path: ${plan.path.join(' → ')}`);
      console.log(`  US venue: ${plan.usVenue ? plan.usVenue.name + ' (' + plan.usVenue.url + ')' : '—'}`);
      console.log(`  ${plan.note}`);
    }
    console.log('\n(Execution needs redemption + a funded exchange account — a separate gated, keyed step. This only surfaces the edge.)');
  } else {
    const { hiveUsd, edges, rejected, scanned } = await crossVenueEdges();
    console.log(`Cross-venue arbitrage scan — ${scanned} SWAP tokens, HIVE $${(hiveUsd || 0).toFixed(6)} (read-only, fee-honest)\n${'─'.repeat(86)}`);
    console.log('token        chain        HE $        ext $       gross     net(after fees)  conf');
    console.log('─'.repeat(86));
    for (const e of edges) {
      console.log(`${e.token.padEnd(12)} ${e.chain.padEnd(11)} ${e.heUsd.toFixed(6).padStart(11)} ${e.externalUsd.toFixed(6).padStart(11)} ${(e.grossPct + '%').padStart(9)} ${(e.netPct + '% ($' + e.netAfterFeesUsd + ')').padStart(18)}  ${e.confidence}`);
    }
    console.log('─'.repeat(86));
    if (edges.length) {
      console.log(`\n${edges.length} round trip(s) clear the FULL fee stack:`);
      for (const e of edges) console.log(`  • ${e.token}: ${e.path.join(' → ')}\n      ${e.note}`);
    } else {
      console.log('\nNo round trip clears the fee stack — HE underprices are below HE 1%/side + chain net fee + external taker. (Correct, common.)');
    }
    if (rejected.length) {
      console.log(`\n${rejected.length} rejected (fee-honest):`);
      for (const x of rejected) console.log(`  – ${x.token.padEnd(12)} ${x.reason}`);
    }
    console.log('\n(Advisory only — no keys, no execution. The asset rotates ≤5 venues and returns to Hive-Engine with more HIVE.)');
  }
}
