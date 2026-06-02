// copy-trade-scan.mjs — COPY-TRADE / MIRROR scanner for the Resource-Center engine (task #192).
// It scans public social/copy-trading + signal sources for MIMICKABLE trades — the trades of
// successful, public traders that a follower could mirror — across stocks / forex / crypto, then
// filters to the concrete-and-recent few and ranks them as candidates.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  ADVISORY ONLY — NO EXECUTION.  This module is READ-ONLY: it reads PUBLIC pages/search results and
//  PROPOSES mirrors. It never holds a key, never broadcasts, never trades (zero-WIF rule). Per the
//  operator's strategy, mirrors are funded LATER from the *skim bucket / war chest* (accumulated
//  profit), NEVER from core capital. Nothing here is financial advice; every candidate is a lead a
//  human verifies on the source before risking a cent.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
//   node integrations/copy-trade-scan.mjs                 # scan a default crypto/forex/stock spread
//   node integrations/copy-trade-scan.mjs crypto BTC      # one asset class + symbol/query
//   node integrations/copy-trade-scan.mjs block           # the brief-ready engineBlock()
//   import { COPY_SOURCES, scanIdeas, mimickable, engineBlock } from './copy-trade-scan.mjs'

import { search, searchAll, fetchClean } from './scraper.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

// ── 1. COPY_SOURCES — catalogue of social/copy-trading + signal sources ───────────────────────────
// `access`:  'keyless'  → public page/search, no login (what scanIdeas actually pulls from);
//            'scrape'   → public page but JS-heavy / partial without a session (best-effort scrape);
//            'keyed'    → real signal/positions data needs an API key or a logged-in account.
// `kind`:    leaderboard | ideas | sentiment | marketplace | signals | profiles.
// URLs verified against the live sites (2026-06). Symbol-templated URLs use `{sym}`.
export const COPY_SOURCES = [
  {
    name: 'TradingView — symbol ideas',
    url: 'https://www.tradingview.com/symbols/{sym}/ideas/?sort=recent',
    indexUrl: 'https://www.tradingview.com/ideas/',
    asset: 'crypto/forex/stocks', kind: 'ideas', access: 'keyless',
    notes: 'Public community trade ideas per symbol (long/short call, entry/target on the chart). The richest keyless mimickable source; we read it via search + clean-fetch.',
  },
  {
    name: 'Myfxbook — community outlook',
    url: 'https://www.myfxbook.com/community/outlook',
    asset: 'forex', kind: 'sentiment', access: 'keyless',
    notes: 'Live aggregate long/short % per FX pair (and XAUUSD) from verified accounts, refreshed ~60s. Crowd sentiment, not a single trader — used as a directional bias signal.',
  },
  {
    name: 'Myfxbook — signal-provider reviews',
    url: 'https://www.myfxbook.com/reviews/signal-providers/13,1',
    asset: 'forex', kind: 'signals', access: 'scrape',
    notes: 'Ranked forex signal providers w/ verified track records. Names + headline stats are public; the actual live signals are keyed/subscription.',
  },
  {
    name: 'ZuluTrade — leaders',
    url: 'https://www.zulutrade.com/leaders',
    altUrl: 'https://www.zulutrade.com/traders',
    asset: 'forex/crypto/stocks', kind: 'leaderboard', access: 'scrape',
    notes: 'Public leaderboard of copyable "Leaders" with risk score (1–5) + return. List is public-ish but JS-rendered; per-leader live trades need an account. Use for trader NAMES to follow.',
  },
  {
    name: 'eToro — discover people / popular investors',
    url: 'https://www.etoro.com/discover/people',
    altUrl: 'https://www.etoro.com/people/popularinvestors',
    asset: 'stocks/crypto/forex', kind: 'profiles', access: 'scrape',
    notes: 'Public Popular-Investor profiles (stats, risk score, copiers). Discovery is public; the live portfolio/positions stream needs login. Use for credible trader NAMES.',
  },
  {
    name: '3Commas — marketplace signals',
    url: 'https://3commas.io/signal-bot',
    indexUrl: 'https://help.3commas.io/en/articles/4728025-what-are-marketplace-signals',
    asset: 'crypto', kind: 'marketplace', access: 'keyed',
    notes: 'Marketplace of subscribable bot/signal providers (Popular/Free filters). Catalogue browsable; consuming a signal needs an account + (mostly) a paid subscription.',
  },
  {
    name: 'Bitsgap — public strategies / signals',
    url: 'https://bitsgap.com/signal',
    indexUrl: 'https://bitsgap.com/',
    asset: 'crypto', kind: 'marketplace', access: 'keyed',
    notes: 'Grid/DCA bot signals + a public signal feed. Marketplace is browsable; actual bot config/signals are account-gated.',
  },
  {
    name: 'Public web — "<asset> trade idea" search',
    url: 'duckduckgo+searchAll',
    asset: 'crypto/forex/stocks', kind: 'ideas', access: 'keyless',
    notes: 'Fallback fan-out across the search providers in scraper.mjs for fresh "<asset> trade idea / setup" posts (TradingView, forums, Substacks). Always keyless, always something.',
  },
];

// quick lookup: which sources are actually pullable keyless this build vs. need keys/login.
export const KEYLESS_SOURCES = COPY_SOURCES.filter((s) => s.access === 'keyless').map((s) => s.name);
export const GATED_SOURCES = COPY_SOURCES.filter((s) => s.access !== 'keyless').map((s) => s.name);

// ── normalization helpers ─────────────────────────────────────────────────────────────────────
const nz = (s) => String(s == null ? '' : s);

// Map a freeform asset/query to a plausible TradingView symbol slug for the symbol-ideas URL.
// Crypto → <SYM>USD, FX majors → e.g. EURUSD, stocks/index left as the bare ticker. Best-effort.
const FX_PAIRS = new Set(['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'XAUUSD', 'EURJPY', 'GBPJPY']);
export function toTvSymbol(query, asset = '') {
  const q = nz(query).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!q) return '';
  if (FX_PAIRS.has(q)) return q;
  if (/forex|fx/i.test(asset) && q.length === 6) return q;     // already a pair like EURGBP
  if (/crypto/i.test(asset) || ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'LTC', 'ADA', 'LINK', 'AVAX', 'BNB'].includes(q)) {
    return /USD[TC]?$/.test(q) ? q : `${q}USD`;
  }
  return q;                                                     // stock/index ticker as-is
}

// Direction sniffer over a blob of text → 'long' | 'short' | null. Looks for the strongest signal.
const LONG_RE = /\b(long|buy|bullish|breakout up|going up|accumulate|calls?\b|moon|target above)\b/i;
const SHORT_RE = /\b(short|sell|bearish|breakdown|dump|going down|puts?\b|target below)\b/i;
export function sniffDirection(text) {
  const t = nz(text);
  const long = (t.match(LONG_RE) || []).length;
  const short = (t.match(SHORT_RE) || []).length;
  if (long === 0 && short === 0) return null;
  return long >= short ? 'long' : 'short';
}

// Pull the first plausible "entry"/"target" price out of a blob (best-effort, often null).
function sniffPrice(text, label) {
  const re = new RegExp(`${label}\\s*[:=]?\\s*\\$?([0-9][0-9,]*\\.?[0-9]*)`, 'i');
  const m = nz(text).match(re);
  if (!m) return null;
  const v = +m[1].replace(/,/g, '');
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Source-credibility weight by host — drives the mimickable() ranking. The named copy-trade venues
// plus reputable trade-idea / market-desk publishers a follower could actually mirror from.
const CREDIBLE_HOST = /(^|\.)(tradingview\.com|myfxbook\.com|zulutrade\.com|etoro\.com|3commas\.io|bitsgap\.com|investing\.com|investinglive\.com|forexlive\.com|fxstreet\.com|dailyfx\.com|babypips\.com|cointelegraph\.com|coindesk\.com|binance\.com|bitget\.com|bybit\.com|okx\.com|kraken\.com|tradingview\.com)/i;

// TradingView page-chrome link labels that are navigation, not an actual trade idea — filtered out
// so scanIdeas keeps only real idea cards (or the aggregate-bias fallback).
const TV_CHROME = /^(see on supercharts|cryptocurrencies|community|overview|technicals?|seasonals?|markets?|news|forecast|ideas|scripts|minds|sign in|get started|more|chart)\b/i;
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } }

// ── 2. scanIdeas — best-effort pull of recent public trade ideas/signals ─────────────────────────
/**
 * Pull recent public, keyless trade ideas/signals for an asset class + query → normalized
 * [{ source, trader, asset, direction, entry, target, url, ts, raw }]. Cached, NEVER throws.
 *   scanIdeas({ asset: 'crypto', query: 'BTC' })
 * Strategy: (a) the TradingView symbol-ideas page (clean-fetched, the best keyless source);
 *           (b) a search fan-out for "<query> trade idea / setup" across scraper.mjs providers.
 */
export async function scanIdeas({ asset = 'crypto', query = '' } = {}) {
  const key = `copytrade:ideas:${asset}:${query}`.toLowerCase();
  return cached(key, TTL.list, async () => {
    const out = [];
    const seen = new Set();
    const push = (it) => {
      const u = nz(it.url);
      const dedupe = u || `${it.source}:${it.trader}:${it.direction}:${nz(it.raw).slice(0, 40)}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      out.push(it);
    };

    // (a) TradingView symbol ideas — clean-fetched markdown of the recent-ideas page.
    const sym = toTvSymbol(query, asset);
    if (sym) {
      try {
        const tvUrl = `https://www.tradingview.com/symbols/${sym}/ideas/?sort=recent`;
        const page = await fetchClean(tvUrl, { maxChars: 9000 });
        if (page.markdown) {
          // Idea cards on the page surface as markdown links; pair each link with nearby text.
          const links = [...page.markdown.matchAll(/\[([^\]]{6,120})\]\((https?:\/\/[^)]+\/chart\/[^)]+|https?:\/\/www\.tradingview\.com\/[^)]*?\/[A-Za-z0-9-]+\/?)\)/g)];
          for (const m of links) {
            const label = m[1].replace(/\s+/g, ' ').trim();
            if (TV_CHROME.test(label)) continue;             // skip nav-chrome, keep real idea cards
            const dir = sniffDirection(label);
            push({
              source: 'TradingView', trader: null, asset: asset || 'crypto',
              direction: dir, entry: sniffPrice(label, 'entry'), target: sniffPrice(label, 'target'),
              url: m[2], ts: null, raw: label,
            });
          }
          // also a coarse direction read of the whole page as a fallback bias
          if (!links.length) {
            const dir = sniffDirection(page.markdown);
            if (dir) push({ source: 'TradingView', trader: null, asset: asset || 'crypto', direction: dir, entry: null, target: null, url: tvUrl, ts: null, raw: `aggregate ${sym} ideas page bias` });
          }
        }
      } catch { /* keyless best-effort */ }
    }

    // (b) search fan-out for fresh "<query> trade idea / setup" posts.
    const terms = `${query || asset} trade idea setup ${asset} long short entry target`.trim();
    let hits = [];
    try { hits = await searchAll(terms, { limit: 12, knowledge: false }); } catch { hits = []; }
    if (!hits.length) { try { hits = await search(`${query || asset} ${asset} trade idea`, { limit: 10 }); } catch { hits = []; } }
    for (const h of hits) {
      const blob = `${nz(h.title)} ${nz(h.snippet)}`;
      const dir = sniffDirection(blob);
      if (!dir && !CREDIBLE_HOST.test(hostOf(h.url))) continue;   // keep only directional OR credible-host hits
      push({
        source: hostOf(h.url) || 'web', trader: null, asset: asset || 'crypto',
        direction: dir, entry: sniffPrice(blob, 'entry'), target: sniffPrice(blob, 'target'),
        url: h.url, ts: null, raw: nz(h.title).slice(0, 160),
      });
    }
    return out;
  });
}

// ── 3. mimickable — filter to concrete + recent + credible; rank with a confidence + skim note ────
/**
 * Filter raw ideas to the MIMICKABLE few: a clear direction, a credible source, ideally a concrete
 * entry/target. Returns ranked candidates, each with a 0–1 confidence and the standing
 * "fund from skim bucket, not core capital" note. Pure (no network); safe on [].
 */
export function mimickable(ideas = []) {
  const SKIM_NOTE = 'Fund any mirror from the SKIM BUCKET / war chest (accumulated profit) — never from core capital. Verify on the source first. Not financial advice.';
  const scored = [];
  for (const it of Array.isArray(ideas) ? ideas : []) {
    if (!it || !it.direction) continue;                 // must have a callable direction
    const host = hostOf(it.url);
    const credible = CREDIBLE_HOST.test(host) || it.source === 'TradingView';
    let conf = 0.2;
    if (credible) conf += 0.35;                          // credible venue
    if (it.entry != null) conf += 0.2;                   // concrete entry
    if (it.target != null) conf += 0.15;                 // concrete target
    if (it.url && /^https?:\/\//.test(it.url)) conf += 0.1;
    conf = Math.min(1, +conf.toFixed(2));

    // "concrete enough to mimic" gate: credible source AND (has a price OR a clean direction call).
    if (!credible) continue;

    scored.push({
      source: it.source, trader: it.trader || null, asset: it.asset,
      direction: it.direction, entry: it.entry ?? null, target: it.target ?? null,
      url: it.url || null, ts: it.ts || null,
      confidence: conf,
      funding: 'skim-bucket-only',
      note: SKIM_NOTE,
      summary: `${(it.direction || '').toUpperCase()} ${it.asset}${it.entry != null ? ` @ ${it.entry}` : ''}${it.target != null ? ` → ${it.target}` : ''} (${it.source})`,
      raw: it.raw || '',
    });
  }
  // rank: confidence, then concreteness (entry present), then credible source first.
  return scored.sort((a, b) =>
    b.confidence - a.confidence ||
    (b.entry != null) - (a.entry != null) ||
    nz(a.source).localeCompare(nz(b.source)));
}

/** Convenience: scan + filter in one call for an asset+query. Never throws. */
export async function candidates({ asset = 'crypto', query = '' } = {}) {
  const ideas = await scanIdeas({ asset, query }).catch(() => []);
  return mimickable(ideas);
}

// ── 4. engineBlock — brief-ready "### Copy-trade candidates" section ──────────────────────────────
// Mirrors the shape of the other resource-center engine blocks so it can be appended directly.
const DEFAULT_TARGETS = [
  { asset: 'crypto', query: 'BTC' },
  { asset: 'crypto', query: 'ETH' },
  { asset: 'forex', query: 'EURUSD' },
];

export async function engineBlock({ targets = DEFAULT_TARGETS, maxPer = 4, maxTotal = 8 } = {}) {
  const lists = await Promise.all(targets.map((t) =>
    candidates(t).then((c) => c.slice(0, maxPer)).catch(() => [])));
  const all = lists.flat()
    .sort((a, b) => b.confidence - a.confidence || (b.entry != null) - (a.entry != null))
    .slice(0, maxTotal);

  const L = [];
  L.push('### Copy-trade candidates');
  L.push('*Mirrors of public traders/ideas (stocks · forex · crypto). ADVISORY ONLY — no execution. Per the strategy, any mirror is funded from the SKIM BUCKET / war chest (accumulated profit), NEVER from core capital. Not financial advice — verify on the source before acting.*');
  L.push('');
  if (all.length) {
    for (const c of all) {
      const price = c.entry != null ? ` entry ~${c.entry}${c.target != null ? `, target ~${c.target}` : ''}` : '';
      L.push(`- **${(c.direction || '').toUpperCase()} ${c.asset}** — ${c.summary}${price ? ` (${price.trim()})` : ''} · conf ${c.confidence} · [source](${c.url || '#'})`);
    }
  } else {
    L.push('- No concrete, credible-source mirror candidates surfaced this pass (keyless sources thin right now — leaderboards/marketplaces need an account).');
  }
  L.push('');
  L.push(`**Keyless sources scanned:** ${KEYLESS_SOURCES.join(', ')}.`);
  L.push(`**Need keys/login (names only this build):** ${GATED_SOURCES.join(', ')}.`);
  L.push('**Skim model:** mirrors draw ONLY from skimmed profit; core capital is never risked on a copied trade.');
  return L.join('\n');
}

export default { COPY_SOURCES, scanIdeas, mimickable, candidates, engineBlock };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('copy-trade-scan.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === 'block') {
    console.log(await engineBlock());
  } else if (args[0] === 'sources') {
    console.log('Copy-trade sources (READ-ONLY · advisory):\n' + '─'.repeat(72));
    for (const s of COPY_SOURCES) console.log(`• [${s.access}] ${s.name} (${s.asset}, ${s.kind})\n    ${s.url}\n    ${s.notes}`);
  } else {
    const asset = args[0] || 'crypto';
    const query = args[1] || (asset === 'forex' ? 'EURUSD' : 'BTC');
    console.log(`Copy-trade scan — asset=${asset} query=${query} (READ-ONLY · advisory · no execution)\n` + '─'.repeat(72));
    const ideas = await scanIdeas({ asset, query });
    console.log(`\nRaw ideas pulled: ${ideas.length}`);
    for (const i of ideas.slice(0, 12)) console.log(`  · [${i.source}] ${i.direction || '?'}  ${nz(i.raw).slice(0, 70)}\n      ${i.url || ''}`);
    const cands = mimickable(ideas);
    console.log(`\nMimickable candidates: ${cands.length}`);
    for (const c of cands.slice(0, 10)) console.log(`  ✓ ${c.summary}  (conf ${c.confidence})\n      ${c.url || ''}\n      ${c.note}`);
    console.log('\n*advisory only — mirrors funded from the skim bucket, never core capital; not financial advice.*');
  }
}
