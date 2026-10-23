// list-everywhere.mjs — one-shot "get every page listed all over the internet" runner.
//
// The operator's distribution plan: (1) get all our pages LISTED/indexed everywhere (search engines +
// directories), (2) MENTION them (Bitcointalk, Hathor on-chain), (3) the MAIN pull is our currencies
// (crypto incentive) driving people to our own sites, with listing on the side, and (4) organic search
// compounds as we rank. This module does the machine half of (1): enumerate every live URL, submit each
// to IndexNow (instant Bing/Yandex/Seznam/Naver), and ping sitemaps. Best-effort, never throws.
//
// IndexNow submits per-HOST and each host must serve /{key}.txt — so cross-domain submission runs where
// the domains' key files live (the boxes). Here it batches by host and fires per host; run with
// { dryRun:true } anywhere to see the batches without sending.
//
//   import { LIVE_SITES, DIRECTORY_TARGETS, byHost, listEverywhere } from './soapbox/list-everywhere.mjs'
//   node integrations/soapbox/list-everywhere.mjs --dry     # print the batches (no network)

import { submitIndexNow, pingSitemaps, __setFetch } from './crawlers.mjs';

// Canonical registry of LIVE public surfaces to keep indexed (from the live-domains manifest). Each is a
// homepage; per-site sitemaps enumerate their deep pages, so listing the roots + pinging sitemaps covers
// the long tail. Admin/private hosts are deliberately absent.
export const LIVE_SITES = [
  // soapbox.community network
  'https://soapbox.community',
  'https://data.soapbox.community', 'https://search.soapbox.community', 'https://stocks.soapbox.community',
  'https://directory.soapbox.community', 'https://wiki.soapbox.community', 'https://hemp.soapbox.community',
  'https://law.soapbox.community', 'https://politics.soapbox.community', 'https://shopping.soapbox.community',
  'https://travel.soapbox.community', 'https://home.soapbox.community', 'https://coupons.soapbox.community',
  'https://pool.soapbox.community', 'https://genai.soapbox.community', 'https://arcade.soapbox.community',
  'https://tunein.soapbox.community', 'https://herald.soapbox.community', 'https://servers.soapbox.community',
  // melek.salon network
  'https://melek.salon', 'https://witness.melek.salon', 'https://vote.melek.salon',
  'https://engine.alpha.melek.salon', 'https://tokens.alpha.melek.salon', 'https://auto.alpha.melek.salon',
  // standalone brands
  'https://congress.ink', 'https://alpha.kula.money', 'https://vankushfamily.com',
];

// External places to LIST us (the human/manual + API half). Grouped; note which need an operator step.
// The crypto/DeFi listers matter most because currencies are the main pull.
export const DIRECTORY_TARGETS = [
  // DeFi / crypto (highest priority — the currency draw)
  { name: 'CoinGecko', kind: 'crypto', url: 'https://www.coingecko.com/en/coins/new', note: 'list KULA/PRANA/MELEK tokens; needs contract + info form (operator)' },
  { name: 'CoinMarketCap', kind: 'crypto', url: 'https://coinmarketcap.com/request/', note: 'token listing request (operator)' },
  { name: 'DexScreener', kind: 'crypto', url: 'https://dexscreener.com', note: 'auto-indexes a live DEX pair; enhance profile (small fee)' },
  { name: 'DefiLlama', kind: 'crypto', url: 'https://defillama.com/submit-project', note: 'list KulaSwap TVL adapter (dev step)' },
  { name: 'DappRadar', kind: 'crypto', url: 'https://dappradar.com/submit-dapp', note: 'submit KulaSwap/arcade dapps (operator)' },
  { name: 'CoinPaprika / Nomics-like', kind: 'crypto', url: 'https://coinpaprika.com', note: 'secondary aggregators (operator)' },
  // web / search directories
  { name: 'Bing Webmaster', kind: 'search', url: 'https://www.bing.com/webmasters', note: 'verify each domain (operator) — unlocks IndexNow trust' },
  { name: 'Google Search Console', kind: 'search', url: 'https://search.google.com/search-console', note: 'verify each domain (operator) — the one manual gate on organic measurement' },
  { name: 'Yandex Webmaster', kind: 'search', url: 'https://webmaster.yandex.com', note: 'verify (operator)' },
  // community / social listing
  { name: 'Bitcointalk', kind: 'community', url: 'https://bitcointalk.org', note: 'ANN thread + mentions (operator/Hathor voice) — see LISTING plan' },
  { name: 'Product Hunt', kind: 'community', url: 'https://www.producthunt.com', note: 'launch Herald / KulaSwap / a game surface (operator)' },
  { name: 'Reddit (relevant subs)', kind: 'community', url: 'https://www.reddit.com', note: 'value-first posts, not spam' },
  { name: 'AlternativeTo / SaaS dirs', kind: 'directory', url: 'https://alternativeto.net', note: 'list Herald as an AI-marketing alternative' },
];

/** byHost — group a URL list by hostname (IndexNow submits per host). */
export function byHost(urls = LIVE_SITES) {
  const m = new Map();
  for (const u of urls) {
    try { const h = new URL(u).host; (m.get(h) || m.set(h, []).get(h)).push(u); } catch { /* skip bad url */ }
  }
  return m;
}

/**
 * listEverywhere — submit every live URL to IndexNow (per host) and ping each host's sitemap.
 * @param {object} [opts] - { urls, dryRun, fetch }. Injectable fetch keeps it offline-testable.
 * @returns {object} summary { hosts, submitted, results }
 */
export async function listEverywhere({ urls = LIVE_SITES, dryRun = false, fetch } = {}) {
  if (fetch) __setFetch(fetch);
  const groups = byHost(urls);
  const results = [];
  for (const [host, list] of groups) {
    const base = `https://${host}`;
    const idx = await submitIndexNow(base, list, { dryRun });
    const ping = await pingSitemaps(`${base}/sitemap.xml`, { dryRun });
    results.push({ host, count: list.length, indexnow: idx, sitemap: ping });
  }
  if (fetch) __setFetch(null);
  return { hosts: groups.size, submitted: urls.length, dryRun: !!dryRun, results };
}

if (process.argv[1] && process.argv[1].endsWith('list-everywhere.mjs')) {
  const dry = process.argv.includes('--dry');
  listEverywhere({ dryRun: dry }).then((s) => {
    console.log(`list-everywhere: ${s.submitted} URLs across ${s.hosts} hosts${dry ? ' (dry run)' : ''}`);
    for (const r of s.results) console.log(`  ${r.host.padEnd(34)} ${r.count} url(s)  indexnow:${r.indexnow.ok ? 'ok' : r.indexnow.reason || r.indexnow.status}`);
    console.log(`\nExternal directories to submit (operator/dev steps): ${DIRECTORY_TARGETS.length} — see .local/LISTING_AND_DISTRIBUTION_PLAN.md`);
  });
}
