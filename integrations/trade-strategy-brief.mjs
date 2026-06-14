// trade-strategy-brief.mjs — turns the venue analytics + HIVE-Engine trade analysis into the
// ACTIONABLE strategy brief the operator asked for:
//
//   "Given Americans have few exchange options, WHICH exchanges should we JOIN based on arbitrage
//    and other opportunities between HIVE-Engine and elsewhere, and best next steps for the trade
//    bot in various directions."
//
// ┌─ HARD SAFETY INVARIANT (read before touching) ──────────────────────────────────────────────┐
// │ READ-ONLY / ADVISORY. NO keys. NO trading. NO broadcasts. This is a PURE composer: it takes  │
// │ the OUTPUTS of the existing readers (venue collectors + trade-analyzer + signal-orchestrator) │
// │ injected as `inputs`, and returns a structured brief + a markdown render. It does not fetch,  │
// │ does not import the live readers, and cannot be made to place an order.                        │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// IT COMPOSES, IT DOES NOT REINVENT. The inputs are the SAME shapes the existing modules already emit:
//   inputs.usCex      = us-cex-venues.collectUsCexVenues()      → { venues:[{ name, publicApi, usAvailability, markets:[{symbol,bid,ask,last,vol24h}], depth }] }
//   inputs.solana     = solana-venues.collectSolanaVenues()     → { venues:[{ venue, kind, chain, alive, data:{ volume24hUsd, tvlUsd, topPairs } }] }
//   inputs.evmDex     = evm-dex-venues.collectEvmDexVenues()    → { venues:[{ venue, kind, chain, topPairs, ... }] }
//   inputs.perps      = perps-venues.collectPerpsVenues()       → { venues:[{ ok, venue, chain, volume24hUsd, openInterestUsd }] }
//   inputs.aggXchain  = agg-xchain-venues.collectAggXchainVenues() → { venues:[{ venue, kind, chain, volume24hUsd, tvlUsd }] }
//   inputs.analyzer   = trade-analyzer.analyze()                → { tokens, findings, suggestions, liveArb, totals }
//   inputs.signalFeed = signal-orchestrator.buildSignalFeed()   → { signals:[{ symbol, side, edgePct, verdict, flags }], counts }
//
// OUTPUT (buildStrategyBrief → structured) has three sections the operator named:
//   1. exchangesToJoin   — ranked candidate venues, FILTERED/annotated by US-accessibility.
//   2. crossVenueArb     — concrete SWAP.X↔X pairs, trap-filtered (no phantom/one-way/illiquid).
//   3. nextSteps         — scale winners, which venue to test next, which chains to add, what to avoid.
//
//   import { buildStrategyBrief, renderStrategyBriefMd, appendToTradeFeed } from './trade-strategy-brief.mjs'
//   node integrations/trade-strategy-brief.mjs                  # live composition (pulls readers, read-only)
//
// WIRING (does NOT fork the pipeline): the existing flow is
//   trade-analyzer → digest.mjs → trade-sanitizer.mjs → .local/shared/trade-brief-feed.md → brain's brief-builder.
// This module APPENDS its strategy section to that same feed via appendToTradeFeed(feedMd, brief).
// One-line wire into digest.mjs is documented at the bottom of this file.

import { fileURLToPath } from 'node:url';

// ── small pure helpers ───────────────────────────────────────────────────────────────────────────
const num = (x) => { const v = +x; return Number.isFinite(v) ? v : null; };
const isPos = (x) => num(x) != null && num(x) > 0;
const fmt = (x, d = 2) => (x == null ? '—' : (+x).toLocaleString(undefined, { maximumFractionDigits: d }));
const arr = (x) => (Array.isArray(x) ? x : []);

// US-accessibility classification from a us-cex `usAvailability` string (pure, keyword-based).
// Returns { accessible:boolean, retailOnly:boolean, stateLimited:boolean, note }.
function classifyUsAvailability(usAvailability) {
  const s = String(usAvailability || '').toLowerCase();
  // "not all states" / "varies by state" / "rolling out by state" / "not in NY" → usable but
  // STATE-limited (still US-accessible). Detect this FIRST so a state carve-out isn't read as a
  // country-level block. "not in <2-letter state>" (e.g. "US, not in NY/HI/TX/VT") counts here.
  const stateLimited = /not all states|by state|varies by state|some states|not in [a-z]{2}\b|except [a-z]{2}\b/.test(s);
  // country-level exclusion of US persons → blocked. A bare "not in <state>" is NOT this — the
  // `&& !stateLimited` guard keeps a US-with-state-carve-out venue from being wrongly excluded.
  const blocked = /\bblocked\b|\bbanned\b|geoblock/.test(s)
    || (/not available to us|not for us|no us persons|\bno us\b|\bnot us\b|us persons (prohibited|excluded)|not (in|available) the us|\bexcluded\b/.test(s) && !stateLimited);
  // a retail broker / consumer rail (no real maker API) — can hold/buy but not run an arb bot.
  const retailOnly = /broker|consumer|retail|copy-trading|no public market data|no public market-data/.test(s);
  const accessible = !blocked && /\bus\b|u\.s\.|united states|nydfs|robinhood|block\b/.test(s);
  return { accessible: accessible && !blocked, retailOnly, stateLimited, note: usAvailability || '' };
}

// total executable-ish volume across a venue's markets (us-cex shape).
function cexVol(v) { return arr(v.markets).reduce((a, m) => a + (num(m.vol24h) || 0), 0); }

// best (tightest) relative spread across a venue's markets, or null.
function cexBestSpread(v) {
  let best = null;
  for (const m of arr(v.markets)) {
    const bid = num(m.bid), ask = num(m.ask);
    if (bid != null && ask != null && ask > 0 && ask >= bid) {
      const sp = (ask - bid) / ask;
      if (best == null || sp < best) best = sp;
    }
  }
  return best;
}

// ── SECTION 1: exchanges to join ───────────────────────────────────────────────────────────────────
// Rank US-CEX candidates by realistic opportunity, filtered/annotated by US-accessibility. Each
// recommended join carries WHY (volume/liquidity/the assets we trade / an arb path) and the CATCH.
function buildExchangesToJoin(usCex, ctx) {
  const venues = arr(usCex && usCex.venues);
  const swapAssets = ctx.swapAssets;     // Set of bare assets behind our SWAP.X tokens (LTC, DOGE, ...)
  const out = [];

  for (const v of venues) {
    const cls = classifyUsAvailability(v.usAvailability);
    const vol = cexVol(v);
    const spread = cexBestSpread(v);
    const hasApi = v.publicApi === true;

    // which of OUR traded assets does this venue quote? (symbol like BTC-USD / XBTUSD / btcusd)
    const quotes = [];
    for (const a of swapAssets) {
      if (arr(v.markets).some((m) => String(m.symbol || '').toUpperCase().replace(/[^A-Z]/g, '').includes(a)))
        quotes.push(a);
    }

    // score: liquidity (log volume) + API maker-access + tight spread + carries an asset we trade.
    let score = 0;
    if (isPos(vol)) score += Math.log10(vol + 10);
    if (hasApi) score += 2;                              // a public maker API = can actually run a bot
    if (spread != null) score += Math.max(0, 1 - spread * 50); // tighter is better
    if (quotes.length) score += 1.5 * quotes.length;    // it lists the other leg of our arb
    if (!cls.accessible) score -= 100;                  // not US-accessible → never a recommendation
    if (cls.retailOnly) score -= 1.5;                   // retail-only can hold, can't run a maker bot

    const why = [];
    if (isPos(vol)) why.push(`24h vol ~${fmt(vol, 0)} on quoted markets`);
    if (spread != null) why.push(`tightest spread ~${(spread * 100).toFixed(2)}%`);
    if (hasApi) why.push('keyless public market API (we can read + later trade via maker keys off-host)');
    if (quotes.length) why.push(`lists ${quotes.join('/')} — the other leg of our HIVE-Engine SWAP arb`);

    const catches = [];
    if (!cls.accessible) catches.push('NOT US-accessible for our use — excluded');
    if (cls.stateLimited) catches.push('state-limited (NY/blocked states) — confirm your state first');
    if (cls.retailOnly) catches.push('retail/broker only — no maker API, can hold but cannot run an arb bot');
    if (!hasApi) catches.push('no public market-data API — manual only');
    if (cls.note) catches.push(cls.note);

    out.push({
      name: v.name,
      recommend: cls.accessible && score > 0,
      usAccessible: cls.accessible,
      stateLimited: cls.stateLimited,
      retailOnly: cls.retailOnly,
      hasApi,
      vol24h: vol || null,
      bestSpread: spread,
      quotesOurAssets: quotes,
      score: +score.toFixed(2),
      why,
      catches,
    });
  }

  // recommendations: US-accessible, positive score, ranked; blocked/retail surfaced but not recommended.
  out.sort((a, b) => b.score - a.score);
  return out;
}

// ── SECTION 2: cross-venue arbitrage (SWAP.X ↔ X) ───────────────────────────────────────────────────
// Concrete pairs: a HIVE-Engine SWAP.X token vs the same asset X on a CEX/DEX, with the spread and the
// trap filters APPLIED (phantom wall / illiquid / one-way bleed). We NEVER recommend a one-way-bleed
// pair (SWAP.LTC) and we EXCLUDE any signal the orchestrator already verdicted REJECT.
function buildCrossVenueArb(inputs, ctx) {
  const analyzer = inputs.analyzer || {};
  const feed = inputs.signalFeed || {};
  const signals = arr(feed.signals);
  const oneWay = ctx.oneWayBleed;       // Set of bare assets known to only bleed (LTC)

  // map bare asset -> the US-accessible CEX venues that quote it (the executable other leg).
  const venueByAsset = new Map();
  for (const v of arr(inputs.usCex && inputs.usCex.venues)) {
    const cls = classifyUsAvailability(v.usAvailability);
    if (!cls.accessible || v.publicApi !== true) continue;
    for (const a of ctx.swapAssets) {
      if (arr(v.markets).some((m) => String(m.symbol || '').toUpperCase().replace(/[^A-Z]/g, '').includes(a))) {
        if (!venueByAsset.has(a)) venueByAsset.set(a, []);
        venueByAsset.get(a).push(v.name);
      }
    }
  }

  const pairs = [];
  const seen = new Set();
  // primary source: the fused signal feed (already trap-filtered + verdicted by the orchestrator).
  for (const s of signals) {
    const sym = String(s.symbol || '').toUpperCase();         // e.g. SWAP.DOGE
    const asset = sym.replace(/^SWAP\./, '');                 // DOGE
    if (!sym.startsWith('SWAP.')) continue;                   // only SWAP.X ↔ X cross-venue pairs here
    const key = `${sym}::${s.side || 'na'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const trapFlags = arr(s.flags);
    const bleed = oneWay.has(asset);
    const rejected = s.verdict === 'REJECT' || bleed;        // never recommend a REJECT or a one-way-bleed
    const venues = venueByAsset.get(asset) || [];

    pairs.push({
      heToken: sym,
      asset,
      side: s.side || null,
      edgePct: num(s.edgePct),
      verdict: bleed && s.verdict !== 'REJECT' ? 'REJECT' : s.verdict || (rejected ? 'REJECT' : 'WATCH'),
      flags: bleed && !trapFlags.includes('one-way-bleed') ? [...trapFlags, 'one-way-bleed'] : trapFlags,
      otherLegVenues: venues,
      recommended: !rejected && venues.length > 0 && num(s.edgePct) != null && num(s.edgePct) > 0,
      reason: rejected
        ? (bleed ? `${asset} historically only bleeds — never accumulate (one-way-bleed)` : `trap-filtered: ${trapFlags.join(', ') || 'rejected upstream'}`)
        : (venues.length ? `executable other leg on ${venues.join('/')}` : 'no US-accessible venue lists the other leg yet'),
    });
  }

  // secondary: analyzer.liveArb entries for SWAP.X not already represented (carries wall notes).
  for (const o of arr(analyzer.liveArb)) {
    const sym = String(o.signal || o.sym || '').toUpperCase().match(/SWAP\.[A-Z0-9]+/)?.[0];
    if (!sym) continue;
    const asset = sym.replace(/^SWAP\./, '');
    const key = `${sym}::${o.side || 'na'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bleed = oneWay.has(asset);
    const venues = venueByAsset.get(asset) || [];
    pairs.push({
      heToken: sym, asset, side: o.side || null,
      edgePct: num(o.edgePct),
      verdict: bleed ? 'REJECT' : 'WATCH',
      flags: bleed ? ['one-way-bleed'] : [],
      otherLegVenues: venues,
      recommended: !bleed && venues.length > 0 && isPos(o.edgePct),
      reason: bleed ? `${asset} one-way-bleed — excluded` : (o.walls ? `walls: ${o.walls}` : (venues.length ? `other leg on ${venues.join('/')}` : 'no US-accessible other leg')),
    });
  }

  pairs.sort((a, b) => (b.recommended - a.recommended) || ((b.edgePct || 0) - (a.edgePct || 0)));
  return pairs;
}

// ── SECTION 3: best next steps (various directions) ─────────────────────────────────────────────────
// Scale what works (DOGE/BLURT), which venue to test next with the $1-5 stakes, which chains to add,
// what to avoid, and what data/access is still missing. Derived from the analyzer + venue coverage.
function buildNextSteps(inputs, ctx, exchangesToJoin, crossVenueArb) {
  const analyzer = inputs.analyzer || {};
  const tokens = arr(analyzer.tokens);
  const steps = { scaleWinners: [], avoid: [], testVenues: [], addChains: [], dataGaps: [] };

  // scale: proven winners (positive net) and what avoid: proven losers / one-way bleed.
  for (const t of tokens) {
    const net = num(t.netHive);
    if (net != null && net >= 50) steps.scaleWinners.push(`${t.symbol}: +${fmt(net, 0)} HIVE realized — keep/grow the strategy that earns it.`);
    if (net != null && net <= -50) steps.avoid.push(`${t.symbol}: ${fmt(net, 0)} HIVE — stop the strategy that buys it (pure bleed).`);
  }
  for (const a of ctx.oneWayBleed) steps.avoid.push(`SWAP.${a}: one-way-bleed — never run a SWAP.${a}↔${a} accumulation arb.`);

  // which venue to test next with the small $1-5 stakes: the top US-accessible recommendation that
  // lists an asset we trade and has a maker API.
  const candidates = exchangesToJoin.filter((e) => e.recommend && e.hasApi);
  for (const e of candidates.slice(0, 3)) {
    const assets = e.quotesOurAssets.length ? ` (lists ${e.quotesOurAssets.join('/')})` : '';
    steps.testVenues.push(`${e.name}${assets}: open an account, fund a $1-5 test stake, paper-then-tiny-live the SWAP↔asset leg. ${e.stateLimited ? 'Confirm your state is supported first.' : ''}`.trim());
  }

  // which chains to add: SOL / EVM-DEX presence with real volume = a place the same SWAP assets trade.
  const solLive = arr(inputs.solana && inputs.solana.venues).filter((v) => v.alive && v.data && isPos(v.data.volume24hUsd));
  if (solLive.length) steps.addChains.push(`Solana: ${solLive.length} live DEX venue(s) with real volume (e.g. ${solLive.slice(0, 3).map((v) => v.venue).join(', ')}) — cheap fees, route the same assets there for a third arb leg.`);
  const evmLive = arr(inputs.evmDex && inputs.evmDex.venues).filter((v) => arr(v.topPairs).length);
  if (evmLive.length) steps.addChains.push(`EVM DEX (Polygon/Base): ${evmLive.length} venue(s) quoting pairs — low-fee chains worth a small routed test.`);
  const perpsLive = arr(inputs.perps && inputs.perps.venues).filter((v) => v.ok && isPos(v.volume24hUsd));
  if (perpsLive.length) steps.addChains.push(`Perps: ${perpsLive.length} venue(s) live — funding-rate / basis is a separate direction (hedge a SWAP holding), NOT spot arb. Research only for now.`);

  // data / access still missing (honest gaps).
  if (!arr(inputs.usCex && inputs.usCex.venues).some((v) => v.publicApi)) steps.dataGaps.push('No US-CEX public market data came back this run — re-run the collector / check connectivity.');
  if (!crossVenueArb.some((p) => p.recommended)) steps.dataGaps.push('No executable SWAP↔CEX pair right now: either no US venue lists the other leg, or every edge is trap-filtered. Need the missing venue listings or a wider asset set.');
  const swapsWithoutVenue = [...ctx.swapAssets].filter((a) => !exchangesToJoin.some((e) => e.recommend && e.quotesOurAssets.includes(a)));
  if (swapsWithoutVenue.length) steps.dataGaps.push(`SWAP assets with no US-accessible CEX leg found: ${swapsWithoutVenue.join(', ')} — the arb can't be closed until a venue listing them is joined.`);
  steps.dataGaps.push('VannyServer (live trade host) access not yet wired — these steps are advisory; the live executor stays separate and keyed off-host.');

  return steps;
}

// ── the composer ────────────────────────────────────────────────────────────────────────────────
/**
 * buildStrategyBrief(inputs, opts) — PURE. Compose the three-section strategy brief from injected
 * reader outputs. Soft-fails to a valid empty brief on any error; never throws, never fetches.
 *
 * @param {object} inputs  { usCex, solana, evmDex, perps, aggXchain, analyzer, signalFeed }
 * @param {object} [opts]  { swapAssets?:string[], oneWayBleed?:string[] }
 *   swapAssets   — bare assets behind our SWAP.X tokens (default LTC,DOGE,BLURT,BTC,ETH,EOS,HIVE).
 *   oneWayBleed  — assets that historically only bleed (default LTC) — never recommended.
 * @returns {{ asOf, readOnly:true, exchangesToJoin, crossVenueArb, nextSteps, summary }}
 */
export function buildStrategyBrief(inputs = {}, opts = {}) {
  try {
    const ctx = {
      swapAssets: new Set((opts.swapAssets || ['LTC', 'DOGE', 'BLURT', 'BTC', 'ETH', 'EOS', 'HIVE']).map((s) => String(s).toUpperCase())),
      oneWayBleed: new Set((opts.oneWayBleed || ['LTC']).map((s) => String(s).toUpperCase())),
    };
    const exchangesToJoin = buildExchangesToJoin(inputs.usCex, ctx);
    const crossVenueArb = buildCrossVenueArb(inputs, ctx);
    const nextSteps = buildNextSteps(inputs, ctx, exchangesToJoin, crossVenueArb);

    const recExchanges = exchangesToJoin.filter((e) => e.recommend);
    const recPairs = crossVenueArb.filter((p) => p.recommended);
    return {
      asOf: new Date().toISOString(),
      readOnly: true,
      advisory: true,
      exchangesToJoin,
      crossVenueArb,
      nextSteps,
      summary: {
        recommendedExchanges: recExchanges.length,
        topExchange: recExchanges[0] ? recExchanges[0].name : null,
        executableArbPairs: recPairs.length,
        excludedPairs: crossVenueArb.length - recPairs.length,
      },
    };
  } catch (e) {
    return {
      asOf: new Date().toISOString(), readOnly: true, advisory: true,
      exchangesToJoin: [], crossVenueArb: [], nextSteps: { scaleWinners: [], avoid: [], testVenues: [], addChains: [], dataGaps: ['soft-fail: ' + ((e && e.message) || String(e))] },
      summary: { recommendedExchanges: 0, topExchange: null, executableArbPairs: 0, excludedPairs: 0 },
      error: (e && e.message) || String(e),
    };
  }
}

// ── markdown render ───────────────────────────────────────────────────────────────────────────────
/**
 * renderStrategyBriefMd(brief) — render the three named sections as the markdown the operator reads.
 * Pure; soft-fails to a short note on a malformed brief.
 */
export function renderStrategyBriefMd(brief) {
  try {
    const b = brief || {};
    const L = [];
    L.push('## Trade-strategy brief — which exchanges to JOIN, the arb between HIVE-Engine and elsewhere, and next steps');
    L.push('');
    L.push('_Advisory / read-only. No keys, no trading. Composed from the venue collectors + trade-analyzer + signal-orchestrator. Americans have few exchange options, so every recommendation is filtered by US-accessibility._');
    L.push('');

    // 1. EXCHANGES TO JOIN
    L.push('### 1. Exchanges to join');
    const rec = arr(b.exchangesToJoin).filter((e) => e.recommend);
    const notRec = arr(b.exchangesToJoin).filter((e) => !e.recommend);
    if (rec.length) {
      L.push('| rank | venue | 24h vol | best spread | lists our assets | why / the catch |');
      L.push('|---:|---|---:|---:|---|---|');
      rec.forEach((e, i) => {
        const why = e.why.join('; ') || '—';
        const cat = e.catches.length ? ` **Catch:** ${e.catches.join('; ')}` : '';
        L.push(`| ${i + 1} | ${e.name} | ${fmt(e.vol24h, 0)} | ${e.bestSpread == null ? '—' : (e.bestSpread * 100).toFixed(2) + '%'} | ${e.quotesOurAssets.join('/') || '—'} | ${why}.${cat} |`);
      });
    } else {
      L.push('_No US-accessible venue cleared the bar this run._');
    }
    if (notRec.length) {
      L.push('');
      L.push('**Not recommended (surfaced for transparency):**');
      for (const e of notRec) {
        const flag = !e.usAccessible ? 'US-BLOCKED' : e.retailOnly ? 'retail-only' : 'low-score';
        L.push(`- ${e.name} — _${flag}_: ${e.catches.join('; ') || 'n/a'}`);
      }
    }
    L.push('');

    // 2. CROSS-VENUE ARBITRAGE
    L.push('### 2. Cross-venue arbitrage (HIVE-Engine SWAP.X ↔ the same asset elsewhere)');
    const recPairs = arr(b.crossVenueArb).filter((p) => p.recommended);
    const excl = arr(b.crossVenueArb).filter((p) => !p.recommended);
    if (recPairs.length) {
      L.push('| pair | side | edge | executable other leg |');
      L.push('|---|---|---:|---|');
      for (const p of recPairs) L.push(`| ${p.heToken} ↔ ${p.asset} | ${p.side || '—'} | ${p.edgePct == null ? '—' : p.edgePct + '%'} | ${p.otherLegVenues.join('/') || '—'} |`);
    } else {
      L.push('_No executable SWAP↔asset pair right now (see data gaps below)._');
    }
    if (excl.length) {
      L.push('');
      L.push('**Excluded (trap-filtered — never act on these):**');
      for (const p of excl) L.push(`- ${p.heToken} ↔ ${p.asset}${p.flags.length ? ` [${p.flags.join(',')}]` : ''} — ${p.reason}`);
    }
    L.push('');

    // 3. BEST NEXT STEPS
    L.push('### 3. Best next steps (various directions)');
    const ns = b.nextSteps || {};
    const block = (title, items) => {
      if (!arr(items).length) return;
      L.push(`**${title}**`);
      for (const x of items) L.push(`- ${x}`);
      L.push('');
    };
    block('Scale what works', ns.scaleWinners);
    block('Avoid (proven losers / one-way bleed)', ns.avoid);
    block('Test next with the $1-5 stakes', ns.testVenues);
    block('Add these directions/chains', ns.addChains);
    block('Data / access still missing', ns.dataGaps);

    return L.join('\n');
  } catch (e) {
    return `## Trade-strategy brief\n\n_(render soft-failed: ${(e && e.message) || String(e)})_\n`;
  }
}

// ── feed wiring (does NOT fork the pipeline) ────────────────────────────────────────────────────────
/**
 * appendToTradeFeed(feedMd, brief) — append the rendered strategy section to the EXISTING sanitized
 * trade-brief-feed markdown that brief-builder already consumes. Pure string op; idempotent-ish
 * (re-appending replaces a prior strategy block if present). Returns the new feed markdown.
 *
 * One-line wiring into the pipeline (see digest.mjs note below) — no new artifact, no new consumer.
 */
export function appendToTradeFeed(feedMd, brief) {
  const section = renderStrategyBriefMd(brief);
  const base = String(feedMd || '');
  const MARK = '<!-- trade-strategy-brief -->';
  // strip a prior strategy block (between the marker and EOF) so re-runs don't stack duplicates.
  const cut = base.indexOf(MARK);
  const head = (cut >= 0 ? base.slice(0, cut) : base).replace(/\s+$/, '');
  return `${head}\n\n${MARK}\n${section}\n`;
}

export default { buildStrategyBrief, renderStrategyBriefMd, appendToTradeFeed };

// ── CLI (guarded) — live composition, read-only. Pulls the real readers; soft-fails each. ────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  async function safe(p) { try { return await p; } catch { return null; } }
  const load = async (path, fn) => { try { const m = await import(path); return await safe(m[fn]()); } catch { return null; } };

  const [usCex, solana, evmDex, perps, aggXchain, analyzer] = await Promise.all([
    load('./venues/us-cex-venues.mjs', 'collectUsCexVenues'),
    load('./venues/solana-venues.mjs', 'collectSolanaVenues'),
    load('./venues/evm-dex-venues.mjs', 'collectEvmDexVenues'),
    load('./venues/perps-venues.mjs', 'collectPerpsVenues'),
    load('./venues/agg-xchain-venues.mjs', 'collectAggXchainVenues'),
    load('./trade-analyzer.mjs', 'analyze'),
  ]);
  let signalFeed = null;
  try { const m = await import('./signal-orchestrator.mjs'); signalFeed = await safe(m.liveSignalFeed()); } catch {}

  const brief = buildStrategyBrief({ usCex, solana, evmDex, perps, aggXchain, analyzer, signalFeed });
  console.log(renderStrategyBriefMd(brief));
  console.log('\n' + '─'.repeat(70));
  console.log(`recommended exchanges: ${brief.summary.recommendedExchanges} (top: ${brief.summary.topExchange || '—'}) · executable arb pairs: ${brief.summary.executableArbPairs} · excluded: ${brief.summary.excludedPairs}`);
  console.log('Advisory only — no keys, no orders. Wire into digest.mjs to ride the existing trade-brief-feed.');
}
