// resource-center.mjs — THE 24/7 market-intelligence engine (operator 2026-06-02, priority).
// One pass pulls EVERYTHING we built and fuses it: the Hive-Engine/TribalDEX token universe (all ~1264
// tokens, volume-ranked), macro (gold/silver, US + global indices, oil), forex (major pairs + DXY), and
// the depth-aware trade proposals — then writes a structured snapshot + an append-only history log + a
// brief-ready markdown report. A systemd timer runs `runPass()` on a schedule so it's always current.
//
// It is ADVISORY: it tells us what to make operational on Hive-Engine first, which chains/exchanges to
// add alongside HE (US-aware, for Americans), and surfaces cross-market arbitrage + metals/stock signals.
// It NEVER executes a trade (zero-WIF rule). Start with the Hive-Engine data we have; grow from there.
//
//   node integrations/resource-center.mjs            # one pass → prints the brief, writes the snapshot
//   node integrations/resource-center.mjs --json     # print the raw snapshot JSON

import { writeFile, appendFile, mkdir, readFile } from 'node:fs/promises';
import { marketSnapshot, topByVolume } from './market-universe.mjs';
import { macro, forex } from './soapbox/macro.mjs';
import { scanAccounts, accountHoldings } from './held-asset-scan.mjs';
// free-apis.mjs (#275): our keyless API catalog (~50 no-auth fetchers). The Resource Center now
// fans a BOUNDED, soft-failing subset of these into every pass so it returns real fetched DATA
// (crypto prices, on-chain status, FX) as first-class results — each tagged with the upstream
// source AND with OUR OWN canonical page where that datum lives. Imported defensively.
let freeApis = null;
try { freeApis = await import('./free-apis.mjs'); } catch { /* catalog absent — engine still runs */ }

// datum-type → OUR canonical page (data.soapbox.community / stocks.soapbox.community). The clickable
// link is always to our own record; the upstream provider rides along as `via`/attribution.
export const OUR_PAGES = {
  crypto: 'https://data.soapbox.community/coins',     // + /<slug> when we know the coin
  chain: 'https://data.soapbox.community/coins',      // on-chain status lives under the coin page
  forex: 'https://data.soapbox.community/fx',
  fx: 'https://data.soapbox.community/fx',
  metals: 'https://data.soapbox.community/commodities',
  commodities: 'https://data.soapbox.community/commodities',
  macro: 'https://data.soapbox.community/macro',
  indices: 'https://data.soapbox.community/macro',
  stocks: 'https://stocks.soapbox.community',
  sentiment: 'https://data.soapbox.community/macro',
};
/** Our canonical page for a datum-type, optionally a specific slug (e.g. crypto + 'bitcoin'). */
export function ourPage(type, slug) {
  const base = OUR_PAGES[type] || 'https://data.soapbox.community';
  return slug ? `${base}/${String(slug).toLowerCase()}` : base;
}

// The BOUNDED, representative set of keyless catalog fetchers fanned each pass. Configurable via
// RC_CATALOG (comma-separated dotted names, e.g. "crypto.coingecko,chains.btcTipHeight"). Each entry
// names the fetcher, the upstream label, the datum-type (→ our page), and a parser → a normalized
// fact. Kept SMALL on purpose (we don't fan all ~50 every pass).
const DEFAULT_CATALOG_FANS = [
  { id: 'crypto.coingecko', via: 'CoinGecko', type: 'crypto', slug: 'bitcoin',
    run: (api) => api.crypto.coingecko('bitcoin,hive', 'usd'),
    parse: (d) => `BTC $${d?.bitcoin?.usd ?? '—'}, HIVE $${d?.hive?.usd ?? '—'}`, label: 'BTC / HIVE spot (USD)' },
  { id: 'crypto.fearGreed', via: 'Alternative.me', type: 'sentiment',
    run: (api) => api.crypto.fearGreed(),
    parse: (d) => { const f = d?.data?.[0]; return f ? `Crypto Fear & Greed: ${f.value} (${f.value_classification})` : null; },
    label: 'Crypto Fear & Greed' },
  { id: 'chains.btcTipHeight', via: 'Blockstream', type: 'chain', slug: 'bitcoin',
    run: (api) => api.chains.btcTipHeight(),
    parse: (t) => { const h = String(t).trim(); return /^\d+$/.test(h) ? `Bitcoin chain tip: block ${(+h).toLocaleString()}` : null; },
    label: 'Bitcoin chain tip height' },
  { id: 'crypto.frankfurter', via: 'Frankfurter (ECB)', type: 'forex',
    run: (api) => api.crypto.frankfurter('USD', 'EUR'),
    parse: (d) => { const r = d?.rates?.EUR; return r ? `Reference FX: 1 USD = ${r} EUR (ECB daily)` : null; },
    label: 'USD/EUR reference rate' },
];

/** Resolve the configured catalog-fan set (RC_CATALOG filters/reorders the defaults by id). */
function catalogFans() {
  if (!process.env.RC_CATALOG) return DEFAULT_CATALOG_FANS;
  const want = process.env.RC_CATALOG.split(',').map((s) => s.trim()).filter(Boolean);
  const byId = new Map(DEFAULT_CATALOG_FANS.map((f) => [f.id, f]));
  return want.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Fan the bounded keyless catalog set. Best-effort: each fetcher soft-fails to null and NEVER throws;
 * a missing catalog module yields []. Returns normalized facts:
 *   { id, label, value, via, source, ourUrl, type }
 * where `source` is the upstream URL (honest attribution) and `ourUrl` is OUR canonical page.
 */
export async function fanCatalog() {
  if (!freeApis) return [];
  const fans = catalogFans();
  const results = await Promise.all(fans.map(async (f) => {
    try {
      const raw = await f.run(freeApis);
      const value = f.parse(raw);
      if (value == null || value === '') return null;
      return {
        id: f.id, label: f.label, value, via: f.via,
        // upstream attribution kept honest; the link points to OUR record.
        source: f.via, ourUrl: ourPage(f.type, f.slug), type: f.type,
      };
    } catch { return null; }
  })).catch(() => []);
  return (results || []).filter(Boolean);
}

// news-diagnostics (#179): what the market is SAYING (sentiment/themes) to pair with what it's DOING.
let newsDigest = async () => null;
try { const cp = await import('./comms-parser.mjs'); newsDigest = cp.newsDigest || newsDigest; } catch { /* news layer absent — engine still runs */ }
// profit-circles (#191): round-trip loops that return to HE grown + volatility scalps (keep capital, skim).
let circlesEngine = async () => '';
try { const pc = await import('./profit-circles.mjs'); circlesEngine = pc.engineBlock || circlesEngine; } catch { /* absent — engine still runs */ }
// cross-venue arbitrage (#191) + copy-trade candidates (#192) — more advisory blocks, all defensive.
let crossVenueEngine = async () => '', copyTradeEngine = async () => '';
try { const cv = await import('./cross-venue-arb.mjs'); crossVenueEngine = cv.engineBlock || crossVenueEngine; } catch {}
try { const ct = await import('./copy-trade-scan.mjs'); copyTradeEngine = ct.engineBlock || copyTradeEngine; } catch {}
// market-entry recommender: fuse all scanners → ranked "markets we should ENTER" (the operator's ask).
let marketEntry = async () => [];
try { const me = await import('./market-entry.mjs'); marketEntry = me.recommendEntries || marketEntry; } catch {}
let impactEngine = async () => '';
try { const mi = await import('./market-impact-sim.mjs'); impactEngine = mi.engineBlock || impactEngine; } catch {}
// diagnostics pipeline (#179): fuses news (saying) + metrics (doing) → signals → suggested moves → teaching.
let diagnosticsEngine = async () => '';
try { const dp = await import('./diagnostics-pipeline.mjs'); diagnosticsEngine = dp.engineBlock || diagnosticsEngine; } catch {}
// cannabis/hemp scour (#260): a topic-seeded web scour for hemp/cannabis data, reusing the scraper.
// Optional/advisory — a missing module never takes the engine down.
let cannabisScour = async () => null;
try { const cb = await import('./soapbox/cannabis.mjs'); cannabisScour = cb.scourCannabis || cannabisScour; } catch {}

// trade-proposer is optional at load (advisory layer) — import defensively so a single broken dep
// never takes the whole engine down.
let proposeTrades = async () => null, briefBlock = () => '';
try { const tp = await import('./trade-proposer.mjs'); proposeTrades = tp.proposeTrades || proposeTrades; briefBlock = tp.briefBlock || briefBlock; } catch { /* advisory layer absent — engine still runs */ }

// live web research (#449): Tavily/Exa search to fold real headlines into the brief. No-op without the
// keys (web-search returns ok:false), so this never breaks the pass or the offline tests.
let webSearchFn = async () => ({ ok: false, results: [] });
try { const ws = await import('./web-search.mjs'); webSearchFn = ws.search || webSearchFn; } catch { /* research layer absent — engine still runs */ }
async function webResearch() {
  const queries = (process.env.RC_WEB_QUERIES || 'crypto market today;gold price and US dollar outlook')
    .split(';').map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const hits = [];
  for (const q of queries) {
    const r = await webSearchFn(q, { limit: 3 }).catch(() => null);
    if (r && r.ok && r.results.length) hits.push({ query: q, answer: r.answer || '', results: r.results.slice(0, 3) });
  }
  return hits;
}

const OUT = process.env.RC_OUT || new URL('../data/resource-center', import.meta.url).pathname;
const num = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (n) => (n == null || !Number.isFinite(+n) ? '—' : `${n >= 0 ? '+' : ''}${(+n).toFixed(2)}%`);

// Per-source time budget. The pass fans out to ~14 fetch-backed sources; without a deadline a SINGLE
// hung upstream fetch blocks the whole pass forever — that is why melek-resource-center sticks in
// "activating" and never writes. budget() races each source against a timeout: a slow/hung source
// resolves to its fallback (null/[]/''), the rest still run, and the pass always completes & writes.
const RC_SRC_TIMEOUT_MS = Number(process.env.RC_SRC_TIMEOUT_MS || 8000);
function budget(thunk, fb, ms = RC_SRC_TIMEOUT_MS) {
  return Promise.race([
    Promise.resolve().then(thunk).catch(() => fb),
    new Promise((resolve) => setTimeout(() => resolve(fb), ms)),
  ]);
}

/** One full intelligence pass. Best-effort: any source that fails OR times out is null/empty, the pass still completes. */
export async function runPass() {
  const ts = new Date().toISOString();
  const [he, mac, fx, proposals, holdings] = await Promise.all([
    budget(() => marketSnapshot({ topN: 15 }), null),
    budget(() => macro(), {}),
    budget(() => forex(), {}),
    budget(() => proposeTrades({}), null),
    // holdings-aware rotation scanner (#187): START from the operator's REAL Hive-Engine balances,
    // find held tokens with an external market, compute the move-it-to-make-money spread. Advisory.
    budget(() => scanAccounts(), []),
  ]);
  // catalog fan (#275): bounded keyless fetchers from free-apis.mjs → real fetched DATA as first-class
  // results, each tagged with upstream source AND our own canonical page. Never throws.
  const catalog = await budget(() => fanCatalog(), []);
  // what the market is SAYING (news sentiment/themes) — best-effort, separate so its feeds can't slow the rest.
  const news = await budget(() => newsDigest({ assets: ['crypto', 'forex', 'gold'] }), null);
  const circlesMd = await budget(() => circlesEngine(), '');
  const crossVenueMd = await budget(() => crossVenueEngine(), '');
  const copyTradeMd = await budget(() => copyTradeEngine(), '');
  const marketEntries = await budget(() => marketEntry({ max: 12 }), []);
  const impactMd = await budget(() => impactEngine(), '');
  // diagnostics (#179) runs LAST so it can read the snapshot the prior layers just produced.
  const diagnosticsMd = await budget(() => diagnosticsEngine(), '');
  // cannabis/hemp scour (#260) — opt-in (RC_CANNABIS=1), since it hits the web scraper. Off by default
  // so the always-on trade pass stays fast; the Hemp site / chat can call scourCannabis() directly.
  const cannabis = process.env.RC_CANNABIS
    ? await budget(() => cannabisScour(null, { limit: 6 }), null)
    : null;
  // live web research (#449) — real headlines via Tavily/Exa; [] without the keys.
  const webResearchRes = await budget(() => webResearch(), []);

  // FIRST TRADE — angelicalist ONLY: the single best executable arbitrage its HIVE can fund (advisory;
  // operator executes manually via Keychain; kalivankush untouched). The "act now" the operator asked for.
  let firstTrade = null;
  try {
    const aBal = await budget(() => accountHoldings('angelicalist'), []);
    const hive = +(aBal.find((b) => b.symbol === 'SWAP.HIVE')?.balance || aBal.find((b) => b.symbol === 'HIVE')?.balance || 0);
    const list = proposals?.proposals || (Array.isArray(proposals) ? proposals : []);
    const best = list.find((p) => p.kind === 'arbitrage');
    if (best && hive > 0) firstTrade = { account: 'angelicalist', hiveBuyingPower: hive, edge: best.summary, evidence: best.evidence, suggested: best.suggested || best.suggestedAction || '' };
  } catch { /* best-effort */ }

  const findM = (cat, label) => (mac[cat] || []).find((x) => x.label?.startsWith(label)) || null;
  const metals = {
    gold: findM('Metals', 'Gold'), silver: findM('Metals', 'Silver'),
    platinum: findM('Metals', 'Platinum'), copper: findM('Metals', 'Copper'),
  };
  const indices = {
    dow: findM('US Indices', 'Dow'), sp500: findM('US Indices', 'S&P'),
    nasdaq: findM('US Indices', 'Nasdaq'), vix: findM('Risk & Currency', 'VIX'),
  };
  const fxMajors = (fx['Major pairs'] || []);
  const dxy = (fx['Dollar strength'] || [])[0] || null;

  // cross-market metrics — the "diagnostics" layer the briefs read
  const metrics = {
    hiveEngine: he ? {
      totalTokens: he.totalTokens, activeMarkets: he.activeMarkets,
      totalVolumeHive: he.totalVolumeHive,
      topVolume: (he.topVolume || []).slice(0, 5).map((r) => ({ symbol: r.symbol, volume: r.volume, change: r.priceChangePercent ?? r.change })),
      topGainers: (he.topGainers || []).slice(0, 3).map((r) => ({ symbol: r.symbol, change: r.priceChangePercent ?? r.change })),
      topLosers: (he.topLosers || []).slice(0, 3).map((r) => ({ symbol: r.symbol, change: r.priceChangePercent ?? r.change })),
    } : null,
    metals: Object.fromEntries(Object.entries(metals).map(([k, v]) => [k, v ? { price: v.price, change: v.change } : null])),
    indices: Object.fromEntries(Object.entries(indices).map(([k, v]) => [k, v ? { price: v.price, change: v.change } : null])),
    forex: fxMajors.map((p) => ({ pair: p.label, rate: p.price, change: p.change })),
    dxy: dxy ? { price: dxy.price, change: dxy.change } : null,
    riskOn: indices.vix?.price != null ? (+indices.vix.price < 20 ? 'risk-on (VIX<20)' : 'risk-off (VIX≥20)') : null,
  };

  const snapshot = { ts, metrics, proposals, holdings, marketEntries, news, firstTrade, catalog, circlesMd, crossVenueMd, copyTradeMd, impactMd, diagnosticsMd, cannabis, webResearch: webResearchRes, sources: { hiveEngine: !!he, macro: !!Object.keys(mac).length, forex: !!fxMajors.length, proposer: !!proposals, holdings: Array.isArray(holdings) && holdings.length > 0, catalog: catalog.length, cannabis: !!(cannabis && cannabis.results && cannabis.results.length), webResearch: (webResearchRes || []).length } };

  // persist: latest + append-only history (for trend/diagnostics)
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(`${OUT}/latest.json`, JSON.stringify(snapshot, null, 2));
    await appendFile(`${OUT}/history.jsonl`, JSON.stringify({ ts, m: metrics }) + '\n');
    await writeFile(`${OUT}/brief.md`, briefReport(snapshot));
  } catch { /* read-only fs — still return the snapshot */ }
  return snapshot;
}

/** Brief-ready markdown — the section a 12&12 / brief writer drops in. */
export function briefReport(s) {
  const m = s.metrics;
  const L = [];
  L.push(`## Market Intelligence — ${s.ts.slice(0, 16).replace('T', ' ')} UTC\n`);
  // the "act now" block at the very top — angelicalist's best executable trade
  if (s.firstTrade) {
    const f = s.firstTrade;
    L.push(`### ⚡ FIRST TRADE — angelicalist (execute manually, kalivankush untouched)`);
    L.push(`Buying power: **${num(f.hiveBuyingPower)} HIVE**. Best executable edge: **${f.edge}**.`);
    if (f.suggested) L.push(`→ ${f.suggested}`);
    if (f.evidence) L.push(`  *(${typeof f.evidence === 'string' ? f.evidence : `spread ${f.evidence.spread}% · depth ${num(f.evidence.depth, 0)} HIVE · ${f.evidence.fees || ''}`})*`);
    L.push('');
  }
  if (m.hiveEngine) {
    const he = m.hiveEngine;
    L.push(`**Hive-Engine / TribalDEX** (start here): ${he.totalTokens} tokens, ${he.activeMarkets} active markets, ${num(he.totalVolumeHive, 0)} HIVE 24h volume.`);
    L.push(`  Top volume: ${he.topVolume.map((r) => `${r.symbol} (${num(r.volume, 0)})`).join(', ')}.`);
    L.push(`  Movers: ▲ ${he.topGainers.map((r) => `${r.symbol} ${pct(r.change)}`).join(', ')} · ▼ ${he.topLosers.map((r) => `${r.symbol} ${pct(r.change)}`).join(', ')}.`);
  } else L.push(`**Hive-Engine**: data unavailable this pass.`);
  L.push('');
  L.push(`**Metals**: Gold ${m.metals.gold ? '$' + num(m.metals.gold.price) + ' ' + pct(m.metals.gold.change) : '—'} · Silver ${m.metals.silver ? '$' + num(m.metals.silver.price) + ' ' + pct(m.metals.silver.change) : '—'}.`);
  L.push(`**Indices**: Dow ${m.indices.dow ? pct(m.indices.dow.change) : '—'} · S&P ${m.indices.sp500 ? pct(m.indices.sp500.change) : '—'} · Nasdaq ${m.indices.nasdaq ? pct(m.indices.nasdaq.change) : '—'} · VIX ${m.indices.vix ? num(m.indices.vix.price, 1) : '—'} (${m.riskOn || '—'}).`);
  if (m.forex.length) L.push(`**Forex**: ${m.forex.slice(0, 4).map((p) => `${p.pair} ${num(p.rate, 4)}`).join(' · ')}${m.dxy ? ` · DXY ${num(m.dxy.price)} ${pct(m.dxy.change)}` : ''}.`);
  // live catalog data (#275) — keyless fetches, each linked to OUR own record (upstream named as `via`).
  if (Array.isArray(s.catalog) && s.catalog.length) {
    L.push('');
    L.push(`**Live data** (our catalog): ${s.catalog.map((c) => `${c.value} (via ${c.via} → ${c.ourUrl})`).join(' · ')}.`);
  }
  // live web research (#449) — real headlines via Tavily/Exa, with honest source links.
  if (Array.isArray(s.webResearch) && s.webResearch.length) {
    L.push('');
    L.push(`### Live web research`);
    for (const w of s.webResearch) {
      L.push(`**${w.query}**${w.answer ? ` — ${w.answer}` : ''}`);
      for (const r of (w.results || []).slice(0, 3)) L.push(`- [${r.title}](${r.url})${r.snippet ? ` — ${r.snippet.slice(0, 160)}` : ''}`);
    }
  }
  L.push('');
  // proposals (the actionable part)
  if (s.proposals && briefBlock) {
    const pb = briefBlock(s.proposals);
    if (pb) { L.push(`### Proposed moves (advisory — operator decides)`); L.push(pb); }
  }
  // holdings & rotation opportunities (#187) — START from what we actually hold and could move
  if (Array.isArray(s.holdings) && s.holdings.length) {
    L.push('');
    L.push(`### Holdings & rotation opportunities`);
    L.push(`From the operator's real Hive-Engine balances (angelicalist, kalivankush), held tokens with an external market — could they be moved/rotated to make money:`);
    for (const o of s.holdings.slice(0, 6)) {
      const sp = o.spreadPct == null ? '—' : `${o.spreadPct >= 0 ? '+' : ''}${o.spreadPct}%`;
      L.push(`- **@${o.account} ${o.symbol}** (~$${num(o.valueUsd)}, spread ${sp}): ${o.action}`);
    }
  }
  // markets we should ENTER — fused cross-venue/exchange/chain opportunities, ranked (the operator's "what to enter")
  if (Array.isArray(s.marketEntries) && s.marketEntries.length) {
    L.push('');
    L.push(`### Markets we should enter (ranked)`);
    for (const e of s.marketEntries.slice(0, 8)) {
      const ePct = e.edgePct == null ? null : (e.edgePct < 1 ? e.edgePct * 100 : e.edgePct);
      const edge = ePct == null ? '' : ` ~${ePct.toFixed(1)}% edge`;
      const us = e.usJurisdictionOK === false ? ' (⚠ US-restricted)' : '';
      L.push(`- **${e.market || e.kind || 'opportunity'}**${e.venue ? ` @ ${e.venue}` : ''}${e.chain ? ` [${e.chain}]` : ''}${edge}${us}: ${e.reason || e.action || ''}`);
    }
  }
  // news diagnostics (#179) — what the market is SAYING, to read alongside what it's DOING
  const newsArr = Array.isArray(s.news?.assets) ? s.news.assets : (s.news?.assets && typeof s.news.assets === 'object' ? Object.values(s.news.assets) : []);
  if (newsArr.length) {
    L.push('');
    L.push(`### News diagnostics`);
    for (const d of newsArr) {
      if (!d || !d.headlineCount) continue;
      const arrow = d.sentimentHint === 'bullish' ? '▲' : d.sentimentHint === 'bearish' ? '▼' : '•';
      const themes = (d.themes || []).slice(0, 4).map((t) => t.word).join(', ');
      L.push(`- **${d.topic}**: ${arrow} ${d.sentimentHint} (${d.sentimentScore}), ${d.headlineCount} headlines${themes ? ` — themes: ${themes}` : ''}.`);
    }
  }
  if (s.circlesMd) { L.push(''); L.push(s.circlesMd); }
  if (s.crossVenueMd) { L.push(''); L.push(s.crossVenueMd); }
  if (s.copyTradeMd) { L.push(''); L.push(s.copyTradeMd); }
  if (s.impactMd) { L.push(''); L.push(s.impactMd); }
  if (s.diagnosticsMd) { L.push(''); L.push(s.diagnosticsMd); }
  L.push(`\n*Engine: resource-center.mjs · advisory only, no trades executed · US-jurisdiction-aware.*`);
  return L.join('\n');
}

/** Read the last snapshot (for the site / Hathor / briefs to display without re-running a pass). */
export async function latest() {
  try { return JSON.parse(await readFile(`${OUT}/latest.json`, 'utf8')); } catch { return null; }
}

if (process.argv[1] && process.argv[1].endsWith('resource-center.mjs')) {
  const s = await runPass();
  if (process.argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
  else console.log(briefReport(s));
}
