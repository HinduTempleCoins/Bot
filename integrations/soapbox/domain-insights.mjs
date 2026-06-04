// domain-insights.mjs — the "Alexa rankings" replacement (operator 2026-06-02). Given a domain, returns
// a popularity RANK (Tranco — a free, manipulation-resistant academic top-list), domain AGE (RDAP
// registration date, keyless), and an on-page SEO score (reuses seo-audit). All keyless. This is what
// makes the Directory subdomain double as a site-insights surface. Best-effort: any source may be null.

import { auditPage } from './seo-audit.mjs';

const UA = 'Mozilla/5.0 (compatible; SoapBox-Insights/1.0; +https://directory.soapbox.community)';
const T = (ms) => AbortSignal.timeout(ms);

// Injectable fetch seam (house pattern) so the Tranco/RDAP parse + aggregation logic is
// offline-testable without touching the network. Defaults to the global fetch.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** Normalize "https://www.x.com/path" or "X.com" → "x.com" (registrable-ish host, lowercased). */
export function normDomain(input) {
  let h = String(input || '').trim().toLowerCase();
  if (!h) return '';
  if (h.includes('://')) { try { h = new URL(h).hostname; } catch { h = h.replace(/^.*:\/\//, '').split('/')[0]; } }
  else h = h.split('/')[0];
  h = h.replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : '';
}

/** Tranco rank (lower = more popular). Keyless. Returns { rank, date } or null. */
export async function trancoRank(domain) {
  try {
    const r = await _fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { headers: { 'user-agent': UA }, signal: T(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const latest = (d.ranks || []).find((x) => x.rank);
    return latest ? { rank: latest.rank, date: latest.date } : null;
  } catch { return null; }
}

/** Tranco rank history (keyless). Returns { points:[{date,rank},…] oldest→newest, latest, first, delta } or null.
 *  delta = first(oldest) − latest, so a POSITIVE delta means the rank number fell over the window = climbing. */
export async function trancoTrend(domain, { limit = 30 } = {}) {
  try {
    const r = await _fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { headers: { 'user-agent': UA }, signal: T(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    // API returns newest-first; keep ranked points, cap to `limit`, then reverse to oldest→newest for charting.
    const ranked = (d.ranks || []).filter((x) => x && x.rank).slice(0, limit).reverse();
    if (!ranked.length) return null;
    const points = ranked.map((x) => ({ date: x.date, rank: x.rank }));
    const latest = points[points.length - 1].rank;
    const first = points[0].rank;
    return { points, latest, first, delta: first - latest };
  } catch { return null; }
}

/** Registration date + age via RDAP (keyless). Returns { registered, ageYears, registrar } or null. */
export async function domainAge(domain) {
  try {
    const r = await _fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { 'user-agent': UA, accept: 'application/rdap+json' }, signal: T(8000), redirect: 'follow' });
    if (!r.ok) return null;
    const d = await r.json();
    const reg = (d.events || []).find((e) => e.eventAction === 'registration');
    const registrar = (d.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const out = { registered: reg?.eventDate || null, ageYears: null, registrar: registrar?.vcardArray?.[1]?.find?.((x) => x[0] === 'fn')?.[3] || null };
    if (out.registered) { const ms = Date.parse(out.registered); if (Number.isFinite(ms)) out.ageYears = Math.max(0, Math.round((Date.now() - ms) / 31557600000 * 10) / 10); }
    return out;
  } catch { return null; }
}

// Rough category guess from a curated keyword/known-domain map — keyless, best-effort, not authoritative.
const CATEGORY_HINTS = [
  ['Search', ['google.', 'bing.', 'duckduckgo.', 'baidu.', 'yandex.', 'ecosia.', 'brave.com', 'startpage.']],
  ['Social', ['facebook.', 'instagram.', 'tiktok.', 'twitter.', 'x.com', 'reddit.', 'linkedin.', 'pinterest.', 'snapchat.', 'discord.', 'mastodon', 'threads.', 'tumblr.', 'whatsapp.', 'telegram.']],
  ['Video', ['youtube.', 'netflix.', 'twitch.', 'vimeo.', 'hulu.', 'disneyplus.', 'dailymotion.']],
  ['Crypto', ['coinbase.', 'binance.', 'kraken.', 'coingecko.', 'coinmarketcap.', 'etherscan.', 'blockchain.', 'tradingview.', 'uniswap.', 'opensea.', 'crypto.com', 'bitcoin.', 'ethereum.']],
  ['News', ['nytimes.', 'cnn.', 'bbc.', 'reuters.', 'theguardian.', 'wsj.', 'bloomberg.', 'foxnews.', 'washingtonpost.', 'apnews.']],
  ['Shopping', ['amazon.', 'ebay.', 'aliexpress.', 'walmart.', 'etsy.', 'shopify.', 'alibaba.']],
  ['Developer', ['github.', 'gitlab.', 'stackoverflow.', 'npmjs.', 'mozilla.org', 'cloudflare.', 'vercel.', 'netlify.']],
  ['Reference', ['wikipedia.', 'wikimedia.', 'archive.org', 'britannica.']],
];
export function guessCategory(domain) {
  const h = normDomain(domain);
  if (!h) return null;
  for (const [cat, keys] of CATEGORY_HINTS) if (keys.some((k) => h.includes(k))) return cat;
  return null;
}

/** Combined insights for a domain. seo:false skips the (slower) on-page audit; trend:false skips rank history. */
export async function insights(input, { seo = true, trend = true } = {}) {
  const domain = normDomain(input);
  if (!domain) return { domain: '', error: 'invalid domain' };
  const [rank, history, age, audit] = await Promise.all([
    trancoRank(domain),
    trend ? trancoTrend(domain).catch(() => null) : Promise.resolve(null),
    domainAge(domain),
    seo ? auditPage(`https://${domain}/`).then((a) => ({ score: a.score, fails: a.fails, warns: a.warns })).catch(() => null) : Promise.resolve(null),
  ]);
  return { domain, rank, trend: history, age, seo: audit, category: guessCategory(domain) };
}

if (process.argv[1] && process.argv[1].endsWith('domain-insights.mjs')) {
  console.log(JSON.stringify(await insights(process.argv[2] || 'github.com'), null, 2));
}
