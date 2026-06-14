// he-external-listings.mjs — the map the trade brief was missing: HIVE-Engine tokens that ALSO
// trade on EXTERNAL venues (CEX/DEX), so the cross-venue arb can reach beyond the SWAP.X wrappers.
//
// WHY: the SWAP.X tokens (SWAP.LTC/DOGE/BLURT) are bridge-pegged wrappers — the "arb" there is really
// the peg. The REAL cross-venue opportunity is a HIVE-Engine NATIVE token (SPS, DEC, LEO …) that has a
// genuine market on an outside exchange: a price gap between Hive-Engine and Gate/MEXC/Uniswap is a
// true arbitrage, not a peg. This registry is the "what trades in both places, and where" knowledge.
//
// READ-ONLY DATA. No keys, no trading. Pure registry + helpers; everything here is public market
// metadata. Operator can extend it. Listings DRIFT (exchanges add/drop tokens) — every entry carries a
// `confidence` and the live collectors should CONFIRM a listing returns data before acting on it.
//
// Shape per listing: { venue, symbol, kind:'cex'|'dex', chain, usAccessible:boolean, cgId?, note }
//   usAccessible — can a US person actually trade it here? Gate/MEXC/Bitget block US persons, so for
//   most HE-native tokens the US-accessible leg is the DEX-wrapped version (Uniswap/Pancake), not the CEX.
//
//   import { HE_EXTERNAL_LISTINGS, listingsFor, watchedHeTokens, usAccessibleListings,
//            symbolMapForVenue, coingeckoIds } from './he-external-listings.mjs'

// ── the registry ─────────────────────────────────────────────────────────────────────────────────
// Curated, conservative. `confidence: 'high'` = well-known stable listing; 'medium' = real but
// liquidity/листing drifts; 'verify' = believed-listed, confirm live before acting.
export const HE_EXTERNAL_LISTINGS = {
  // ── Splinterlands (the biggest real HE-native external markets) ──
  SPS: [
    { venue: 'Gate.io',      symbol: 'SPS_USDT',  kind: 'cex', chain: 'cex',      usAccessible: false, cgId: 'splintershards', confidence: 'high',   note: 'deepest CEX book; Gate blocks US persons' },
    { venue: 'MEXC',         symbol: 'SPSUSDT',   kind: 'cex', chain: 'cex',      usAccessible: false, cgId: 'splintershards', confidence: 'high',   note: 'MEXC blocks US persons' },
    { venue: 'Bitget',       symbol: 'SPSUSDT',   kind: 'cex', chain: 'cex',      usAccessible: false, cgId: 'splintershards', confidence: 'medium', note: 'US-blocked' },
    { venue: 'Uniswap',      symbol: 'SPS/WETH',  kind: 'dex', chain: 'ethereum', usAccessible: true,  cgId: 'splintershards', confidence: 'medium', note: 'wrapped SPS on Ethereum — US-accessible via DEX (gas + bridge cost)' },
    { venue: 'PancakeSwap',  symbol: 'SPS/BNB',   kind: 'dex', chain: 'bsc',      usAccessible: true,  cgId: 'splintershards', confidence: 'medium', note: 'SPS on BSC — US-accessible via DEX (low gas)' },
  ],
  DEC: [
    { venue: 'PancakeSwap',  symbol: 'DEC/BUSD',  kind: 'dex', chain: 'bsc',      usAccessible: true,  cgId: 'dark-energy-crystals', confidence: 'medium', note: 'Dark Energy Crystals on BSC — main external DEX market' },
    { venue: 'Uniswap',      symbol: 'DEC/WETH',  kind: 'dex', chain: 'ethereum', usAccessible: true,  cgId: 'dark-energy-crystals', confidence: 'verify', note: 'Ethereum pool thin — confirm before acting' },
    { venue: 'Gate.io',      symbol: 'DEC_USDT',  kind: 'cex', chain: 'cex',      usAccessible: false, cgId: 'dark-energy-crystals', confidence: 'verify', note: 'historically listed; US-blocked' },
  ],
  // ── LeoFinance (HE-native, wrapped to ETH/BSC) ──
  LEO: [
    { venue: 'Uniswap',      symbol: 'wLEO/WETH', kind: 'dex', chain: 'ethereum', usAccessible: true,  cgId: 'wrapped-leo',  confidence: 'medium', note: 'wLEO on Ethereum — the US-accessible LEO market' },
    { venue: 'PancakeSwap',  symbol: 'bLEO/BNB',  kind: 'dex', chain: 'bsc',      usAccessible: true,  cgId: 'wrapped-leo',  confidence: 'medium', note: 'bLEO on BSC (CubFinance ecosystem)' },
  ],
  // ── Hive-Engine infra / other notable HE tokens with some external presence ──
  BEE:   [{ venue: 'TribalDEX', symbol: 'BEE/SWAP.HIVE', kind: 'dex', chain: 'hive-engine', usAccessible: true, confidence: 'high',   note: "Hive-Engine's own governance token; mostly internal (TribalDEX/HE market)" }],
  PAL:   [{ venue: 'Hive-Engine', symbol: 'PAL', kind: 'dex', chain: 'hive-engine', usAccessible: true, confidence: 'medium', note: 'PALnet — largely internal HE liquidity' }],
};

// SWAP.X wrappers (the bridge-pegged set) — kept SEPARATE: their "external" leg is the native coin on a
// mainstream US CEX. Used so the brief can still reason about them, distinctly from native-token arb.
export const SWAP_WRAPPER_BASES = {
  'SWAP.BTC': 'BTC', 'SWAP.ETH': 'ETH', 'SWAP.LTC': 'LTC', 'SWAP.DOGE': 'DOGE',
  'SWAP.BLURT': 'BLURT', 'SWAP.STEEM': 'STEEM', 'SWAP.HBD': 'HBD', 'SWAP.EOS': 'EOS', 'SWAP.MATIC': 'MATIC',
};

// ── helpers (pure) ──────────────────────────────────────────────────────────────────────────────
const norm = (s) => String(s || '').toUpperCase().trim();

/** All external listings for a HE token (e.g. 'SPS'). [] if unknown. */
export function listingsFor(token) {
  return HE_EXTERNAL_LISTINGS[norm(token)] || [];
}

/** HE-native tokens we track external markets for (the broadened arb/watch set). */
export function watchedHeTokens() {
  return Object.keys(HE_EXTERNAL_LISTINGS);
}

/** Only the listings a US person can actually trade (DEX-wrapped or US-accessible CEX). */
export function usAccessibleListings(token) {
  return listingsFor(token).filter((l) => l.usAccessible);
}

/** True if at least one listing for this token is US-accessible. */
export function hasUsAccessibleMarket(token) {
  return usAccessibleListings(token).length > 0;
}

/** CoinGecko ids referenced by the registry (for a price oracle leg), de-duped. */
export function coingeckoIds() {
  const ids = new Set();
  for (const arr of Object.values(HE_EXTERNAL_LISTINGS)) for (const l of arr) if (l.cgId) ids.add(l.cgId);
  return [...ids];
}

/**
 * Build a { '<venue name>': '<symbol>' } map for a given external venue, so a venue collector that
 * accepts a symbolMap can be pointed at the HE tokens that venue actually lists. Returns {} if none.
 */
export function symbolMapForVenue(venueName) {
  const out = {};
  const want = norm(venueName);
  for (const [token, arr] of Object.entries(HE_EXTERNAL_LISTINGS)) {
    for (const l of arr) if (norm(l.venue) === want) out[token] = l.symbol;
  }
  return out;
}

/** Flat list of every listing tagged with its token — handy for tables / the brief. */
export function allListings() {
  const rows = [];
  for (const [token, arr] of Object.entries(HE_EXTERNAL_LISTINGS)) {
    for (const l of arr) rows.push({ token, ...l });
  }
  return rows;
}

export default {
  HE_EXTERNAL_LISTINGS, SWAP_WRAPPER_BASES, listingsFor, watchedHeTokens,
  usAccessibleListings, hasUsAccessibleMarket, coingeckoIds, symbolMapForVenue, allListings,
};

// ── CLI: print the registry (read-only) ─────────────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('HIVE-Engine tokens with EXTERNAL markets (read-only registry; listings drift — confirm live)\n');
  for (const row of allListings()) {
    const us = row.usAccessible ? 'US-OK ' : 'US-BLOCKED';
    console.log(`${row.token.padEnd(5)} ${row.kind.toUpperCase().padEnd(3)} ${us} ${row.venue.padEnd(13)} ${row.symbol.padEnd(12)} [${row.confidence}] ${row.note}`);
  }
  console.log(`\n${watchedHeTokens().length} HE-native tokens · ${allListings().length} external listings · ${allListings().filter((r) => r.usAccessible).length} US-accessible`);
}
