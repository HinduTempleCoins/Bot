/**
 * !price [symbol] — show the current USD price of an asset, outlier-rejected across
 * multiple public sources (price-oracle). Defaults to HIVE. Read-only, keyless.
 *
 * Examples: !price        -> HIVE
 *           !price bitcoin -> BTC
 *           !price hive    -> HIVE
 *
 * Uses a coingecko-id alias map for the common tickers people type.
 */

import { priceUsd } from '../../integrations/price-oracle.mjs';

// common tickers -> coingecko ids the oracle understands
const ALIAS = {
  hive: 'hive', btc: 'bitcoin', bitcoin: 'bitcoin', eth: 'ethereum', ethereum: 'ethereum',
  ltc: 'litecoin', litecoin: 'litecoin', doge: 'dogecoin', dogecoin: 'dogecoin',
  steem: 'steem', blurt: 'blurt', hbd: 'hive_dollar', sol: 'solana', solana: 'solana',
};

export async function price(parsed, ctx) {
  const raw = (parsed.args[0] || 'hive').toLowerCase().replace(/^[#$@]/, '');
  const id = ALIAS[raw] || raw;
  try {
    const p = await priceUsd(id);
    if (!p.usd) return { ok: true, reply: `No confident price found for "${raw}". Try: !price hive | btc | eth | sol` };
    const flag = p.confident ? '' : ' _(unconfirmed — few sources)_';
    return { ok: true, reply: `**${raw.toUpperCase()}**: $${p.usd < 1 ? p.usd.toFixed(6) : p.usd.toFixed(2)} (${p.sources} source${p.sources === 1 ? '' : 's'})${flag}` };
  } catch (e) {
    return { ok: false, error: `price: ${e.message}` };
  }
}
