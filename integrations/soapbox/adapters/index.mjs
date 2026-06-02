// adapters/index.mjs — the adapter registry + failover orchestration (spec §4). The condenser asks
// the registry for a token; the registry routes by id prefix and, for Tier-1, falls over across
// providers so one source rate-limiting never blanks a page. Adding a chain/source = drop a file in
// this dir and register it here. Each adapter exposes: id, tier, fetchTokens, fetchToken, fetchOHLCV.

import * as coingecko from './coingecko.mjs';
import * as coinpaprika from './coinpaprika.mjs';
import * as geckoterminal from './geckoterminal.mjs';

export const ADAPTERS = { coingecko, coinpaprika, geckoterminal };

// Tier-1 failover order: CoinGecko primary, CoinPaprika secondary (also team metadata).
const TIER1_CHAIN = [coingecko, coinpaprika];

/** Pick the adapter for an id by its prefix. Bare ids ("bitcoin") → Tier-1 chain (handled below). */
export function adapterFor(id) {
  if (id?.startsWith('gt:')) return geckoterminal;
  return coingecko; // default Tier-1 primary
}

/**
 * Fetch one token, with Tier-1 failover. Tries each provider in order; the first that returns a
 * priced coin wins. Throws only if ALL providers fail. Prefixed ids (gt:) go straight to their adapter.
 */
export async function fetchTokenFailover(id) {
  if (id?.startsWith('gt:')) return geckoterminal.fetchToken(id);
  let lastErr;
  for (const a of TIER1_CHAIN) {
    try {
      const coin = await a.fetchToken(id);
      if (coin && coin.price_usd >= 0) return coin;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`no adapter resolved "${id}"`);
}

/** OHLCV with failover (CoinGecko → GeckoTerminal where applicable). */
export async function fetchOHLCVFailover(id, opts) {
  if (id?.startsWith('gt:')) return geckoterminal.fetchOHLCV(id, opts);
  try { const s = await coingecko.fetchOHLCV(id, opts); if (s.length) return s; } catch {}
  return [];
}
