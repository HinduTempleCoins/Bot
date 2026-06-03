// adapters/coingecko.mjs — Tier-1 primary. The uniform adapter interface every source implements
// (spec §4): fetchTokens(), fetchToken(id), fetchOHLCV(id). The condenser loops adapters and
// normalizes their output into the one schema — "adding a chain/source = adding one of these files."
// Keyless CoinGecko demo endpoints.

import { normalizeCoin } from '../schema.mjs';

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function jget(url, timeout = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await _fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

export const id = 'coingecko';
export const tier = 1;

export async function fetchTokens({ limit = 50, page = 1 } = {}) {
  const arr = await jget(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=${page}&sparkline=true&price_change_percentage=24h`);
  return (Array.isArray(arr) ? arr : []).map((c) => ({
    id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name,
    price_usd: c.current_price || 0, market_cap_usd: c.market_cap || 0, volume_24h_usd: c.total_volume || 0,
    change_24h: c.price_change_percentage_24h || 0, rank: c.market_cap_rank || null,
    sparkline_7d: c.sparkline_in_7d?.price || [],
  }));
}

export async function fetchToken(id) {
  const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`);
  const m = d.market_data || {};
  const coin = normalizeCoin({
    id: d.id, symbol: d.symbol, name: d.name,
    price_usd: m.current_price?.usd, market_cap_usd: m.market_cap?.usd, volume_24h_usd: m.total_volume?.usd,
    supply: { circulating: m.circulating_supply, total: m.total_supply, max: m.max_supply },
    chains: Object.keys(d.platforms || {}).filter(Boolean),
    contracts: Object.entries(d.platforms || {}).filter(([k, v]) => k && v).map(([chain, address]) => ({ chain, address })),
    links: {
      website: d.links?.homepage?.[0] || '',
      explorer: d.links?.blockchain_site?.filter(Boolean)[0] || '',
      // every social platform CoinGecko exposes — the coin page surfaces the real feeds/groups
      social: [
        d.links?.twitter_screen_name && `https://twitter.com/${d.links.twitter_screen_name}`,
        d.links?.telegram_channel_identifier && `https://t.me/${d.links.telegram_channel_identifier}`,
        d.links?.facebook_username && `https://facebook.com/${d.links.facebook_username}`,
        d.links?.subreddit_url || null,
        ...(d.links?.chat_url || []),                       // Discord / Telegram / community chats
        ...(d.links?.official_forum_url || []),             // Bitcointalk etc.
      ].filter(Boolean),
    },
  }, { tier: 1, source: 'coingecko', updatedAt: new Date().toISOString() });
  // extra market detail for the coin page (non-schema, attached): change ranges + ATH/ATL + rank.
  coin.change_24h = m.price_change_percentage_24h ?? null;
  coin.market = {
    rank: m.market_cap_rank ?? d.market_cap_rank ?? null,
    change_1h: m.price_change_percentage_1h_in_currency?.usd ?? null,
    change_24h: m.price_change_percentage_24h ?? null,
    change_7d: m.price_change_percentage_7d ?? null,
    change_30d: m.price_change_percentage_30d ?? null,
    change_1y: m.price_change_percentage_1y ?? null,
    ath: m.ath?.usd ?? null, ath_change: m.ath_change_percentage?.usd ?? null, ath_date: m.ath_date?.usd ?? null,
    atl: m.atl?.usd ?? null, atl_change: m.atl_change_percentage?.usd ?? null, atl_date: m.atl_date?.usd ?? null,
    high_24h: m.high_24h?.usd ?? null, low_24h: m.low_24h?.usd ?? null,
  };
  coin.categories = (d.categories || []).filter(Boolean).slice(0, 6);
  // official links the coin-link finder surfaces on the page: whitepaper, forum (often the
  // Bitcointalk thread), announcement thread, source code, official chats.
  const L = d.links || {};
  coin.official = {
    whitepaper: L.whitepaper || '',
    forum: (L.official_forum_url || []).filter(Boolean)[0] || '',     // frequently a Bitcointalk thread
    announcement: (L.announcement_url || []).filter(Boolean)[0] || '',
    repos: (L.repos_url?.github || []).filter(Boolean).slice(0, 2),
    chats: (L.chat_url || []).filter(Boolean).slice(0, 2),
    reddit: L.subreddit_url || '',
  };
  return coin;
}

export async function fetchOHLCV(id, { days = 7 } = {}) {
  const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
  return (d.prices || []).map(([t, p]) => ({ t: Math.floor(t / 1000), p }));
}
