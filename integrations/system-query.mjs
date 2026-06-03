// system-query.mjs — THE single front door for "ask the system anything" (#188).
//
// The conversational bots (Smols / Telegram / Discord / Hathor) call ONE function — `ask(question)` —
// and get back a chat-ready answer plus the structured facts behind it. This module routes a
// natural-language question to the right data source(s) across the whole Resource-Center stack:
//
//   resource-center.latest()   — the 24/7 fused snapshot (HE metrics, metals, indices, forex, holdings)
//   held-asset-scan.scanAccounts() — what we hold + rotation opportunities
//   market-universe            — Hive-Engine token universe (top volume, totals)
//   soapbox/macro              — gold/silver, indices, VIX, forex, commodities
//   soapbox/markets-catalog    — exchanges (US-friendly, by asset)
//   soapbox/condenser.getCoin  — any coin's live price
//   soapbox/stocks.stockQuote  — any stock's quote
//   llm-router.complete        — phrase grounded answers / interpret open questions (only when a key exists)
//
// Design rules:
//   • FACTS COME FROM OUR DATA. The LLM only phrases what we already pulled — it never invents numbers.
//     With no LLM key present, every path still returns a real templated answer from the data.
//   • Best-effort: any source that fails contributes nothing; `ask()` NEVER throws.
//   • Read-only / advisory. This module reads data and talks; it executes nothing (zero-WIF rule).
//
//   node integrations/system-query.mjs "what are my best holdings opportunities?"
//   node integrations/system-query.mjs --commands        # list example questions
//   node integrations/system-query.mjs --brief           # the one-liner state-of-the-system

import { latest, briefReport } from './resource-center.mjs';
import { scanAccounts } from './held-asset-scan.mjs';
import { topByVolume, marketSnapshot } from './market-universe.mjs';
import { macro, forex, commodities } from './soapbox/macro.mjs';
import { usFriendly, exchangesByAsset } from './soapbox/markets-catalog.mjs';
import { getCoin } from './soapbox/condenser.mjs';

// Optional deps — import defensively so a missing/broken module never takes the front door down.
// Each surface degrades to a plain "that source is unavailable" answer rather than throwing.
let complete = async () => ({ text: '', error: 'llm-router absent' });
try { ({ complete } = await import('./llm-router.mjs')); } catch { /* no LLM layer — templated answers only */ }
let stockQuote = async () => null;
try { ({ stockQuote } = await import('./soapbox/stocks.mjs')); } catch { /* stocks optional */ }

// The Library RAG ("Ask the Library" over the Ashurbanipal wiki). Optional — degrade if absent.
let askLibrary = async () => ({ answer: '', sources: [], grounded: false });
try { ({ askLibrary } = await import('./library-rag.mjs')); } catch { /* no library layer */ }

// The scam/trust registry (government + community fraud signals + legit allowlist). Optional.
let scamSignals = async () => null;
try { ({ scamSignals } = await import('./soapbox/scam-registry.mjs')); } catch { /* no trust layer */ }

// Arbitrage / rotation readers (all advisory, read-only, never execute). Optional.
let crossVenueEdges = async () => [];
try { ({ crossVenueEdges } = await import('./cross-venue-arb.mjs')); } catch { /* no arb layer */ }
let scalpCandidates = async () => [];
try { ({ scalpCandidates } = await import('./profit-circles.mjs')); } catch { /* no profit-circles */ }

// The fused diagnostics read (news lean × price action → suggested moves). Optional.
let diagnostics = async () => null;
try { ({ diagnostics } = await import('./diagnostics-pipeline.mjs')); } catch { /* no diagnostics */ }

// ── formatting helpers ─────────────────────────────────────────────────────────
const num = (n, d = 2) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: d }));
const pct = (n) => (n == null || !Number.isFinite(+n) ? '—' : `${+n >= 0 ? '+' : ''}${(+n).toFixed(2)}%`);
const usd = (n) => (n == null || !Number.isFinite(+n) ? '—' : `$${(+n).toLocaleString(undefined, { maximumFractionDigits: +n >= 1 ? 2 : 6 })}`);
const safe = (fn, fallback) => Promise.resolve().then(fn).catch(() => fallback);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// LLM availability: keyed off any provider env the router knows. Cheap presence check, no values logged.
const LLM_ENV = ['GEMINI_API_KEY', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'GITHUB_TOKEN', 'TOGETHER_API_KEY', 'DEEPSEEK_API_KEY', 'MISTRAL_API_KEY'];
const haveLLM = () => LLM_ENV.some((e) => process.env[e]);

// ── intent routing (keyword/regex first — cheap, deterministic) ─────────────────
// Each route: { intent, test(q), handle(q) → { answer, data } }. First match wins; order = priority.
const re = (...words) => new RegExp(`\\b(${words.join('|')})\\b`, 'i');

const ROUTES = [
  {
    // "is X legit / a scam?", "is coinbase.com safe?", "check 0x… / a domain" → trust/scam registry.
    // Placed first: a "scam/legit/safe" question must beat the generic price/worth catch-all.
    intent: 'trust',
    test: (q) => re('scam', 'legit', 'legitimate', 'safe', 'fraud', 'rug', 'rugpull', 'rug pull', 'trustworthy', 'is .* (real|fake)', 'phishing', 'pig butcher', 'romance scam', 'should i trust', 'reported').test(q),
    handle: handleTrust,
  },
  {
    // "best arbitrage right now?", "any arb?", "rotation edges", "scalp opportunities" → arb readers.
    intent: 'arbitrage',
    test: (q) => re('arbitrage', 'arb\\b', 'cross[- ]?venue', 'best (trade|edge|play|move)', 'where(?:\'s| is) the (edge|spread|money)', 'scalp', 'flip', 'round ?trip', 'profit circle').test(q),
    handle: handleArbitrage,
  },
  {
    // "what does the Library say about witnesses?", "ask the library about the Convergence" → RAG.
    intent: 'library',
    test: (q) => re('library', 'ashurbanipal', 'wiki', 'scripture', 'corpus', 'what does .* say about', 'convergence', 'egregore', 'rule 1', 'angelic', 'zar', 'oilahuasca', 'witness(es)?', 'docs? say', 'knowledge base').test(q),
    handle: handleLibrary,
  },
  {
    // "what's the read?", "diagnose the market", "signals" → fused news×price diagnostics.
    intent: 'diagnostics',
    test: (q) => re('diagnos', 'signals?', "what'?s the read", 'suggested moves?', 'news (vs|and) price', 'confluence', 'divergence', 'what should i (do|watch)').test(q),
    handle: handleDiagnostics,
  },
  {
    intent: 'holdings',
    test: (q) => re('hold', 'holdings', 'opportunit', 'rotation', 'rotate', 'my (tokens|balances|assets|portfolio)', 'what do i own').test(q),
    handle: handleHoldings,
  },
  {
    intent: 'exchanges',
    test: (q) => re('where (can|do|to).{0,20}(trade|buy|sell)', 'which exchange', 'what exchange', 'us[- ]?friendly', 'us exchange', 'americans?', 'list(ed)? on', 'exchanges? (for|that)').test(q),
    handle: handleExchanges,
  },
  {
    intent: 'macro',
    test: (q) => re('gold', 'silver', 'platinum', 'palladium', 'copper', 'dow', 's&p|sp500|s and p', 'nasdaq', 'russell', 'vix', 'crude|oil|wti|brent', 'natural gas', 'index|indices', 'metals', 'volatility', 'wheat|corn|soybean|coffee|sugar|cocoa|cotton|cattle|hogs|lumber|commodit').test(q),
    handle: handleMacro,
  },
  {
    intent: 'forex',
    test: (q) => /\b[a-z]{3}\s*\/\s*[a-z]{3}\b/i.test(q) || re('forex', 'fx', 'eur|euro', 'usd|dollar', 'jpy|yen', 'gbp|pound|sterling', 'dxy', 'currency|currencies').test(q),
    handle: handleForex,
  },
  {
    intent: 'markets',
    test: (q) => re('top (volume|markets|tokens)', 'hive[- ]?engine', 'tribaldex', 'most (traded|active)', 'biggest market', 'volume').test(q),
    handle: handleMarkets,
  },
  {
    intent: 'brief',
    test: (q) => re("what'?s the brief", 'the brief', 'state of (the )?(markets|system)', 'overview', 'summary|summarize', 'status report', "what'?s (going on|happening)").test(q),
    handle: handleBrief,
  },
  {
    intent: 'price',
    test: (q) => re('price of', 'how much is', "what'?s .* (worth|trading)", 'quote for', 'value of', 'price', 'worth').test(q),
    handle: handlePrice,
  },
];

// ── route handlers — each returns { answer, data } from REAL data (no LLM needed) ────────────────

async function handleHoldings(q) {
  const ops = await safe(() => scanAccounts(), []);
  if (!ops.length) return { answer: 'No holdings or rotation opportunities surfaced this pass (account balances may be empty or the data source was unreachable).', data: { opportunities: [] } };
  const top = ops.slice(0, 5);
  const lines = top.map((o) => `• @${o.account} ${o.symbol} (~${usd(o.valueUsd)}${o.spreadPct == null ? '' : `, spread ${pct(o.spreadPct)}`}): ${o.action}`);
  const answer = `Top holdings / rotation opportunities (advisory, no trades executed):\n${lines.join('\n')}`;
  return { answer, data: { opportunities: top } };
}

async function handleMarkets(q) {
  const [snap, top] = await Promise.all([
    safe(() => marketSnapshot({ topN: 10 }), null),
    safe(() => topByVolume(8), []),
  ]);
  const rows = (snap?.topVolume?.length ? snap.topVolume : top).slice(0, 8)
    .map((r) => ({ symbol: r.symbol, volume: r.volume, changePct: r.changePct ?? r.priceChangePercent ?? null }));
  if (!rows.length) return { answer: 'Hive-Engine market data is unavailable right now.', data: { topVolume: [] } };
  const head = snap ? `Hive-Engine / TribalDEX: ${num(snap.totalTokens, 0)} tokens, ${num(snap.activeMarkets, 0)} active markets, ${num(snap.totalVolumeHive, 0)} HIVE 24h volume.\n` : '';
  const lines = rows.map((r) => `• ${r.symbol} — ${num(r.volume, 0)} HIVE${r.changePct == null ? '' : ` (${pct(r.changePct)})`}`);
  return { answer: `${head}Top Hive-Engine markets by 24h volume:\n${lines.join('\n')}`, data: { snapshot: snap, topVolume: rows } };
}

async function handlePrice(q) {
  // pull the most likely asset token out of the question
  const sym = extractSymbol(q);
  if (!sym) return { answer: 'Which coin or token did you want a price for? Try "price of HIVE" or "price of bitcoin".', data: null };
  // try a coin first; if it's a known Hive-Engine ticker style, also try the hive-engine resolver.
  const candidates = [sym.toLowerCase(), COIN_ALIASES[sym.toLowerCase()], `hive-engine:${sym.toLowerCase()}`].filter(Boolean);
  let coin = null;
  for (const id of [...new Set(candidates)]) {
    coin = await safe(() => getCoin(id), null);
    if (coin && coin.price_usd != null) break;
  }
  if (!coin || coin.price_usd == null) {
    return { answer: `I couldn't find a live price for "${sym}". It may not be listed on the sources I read.`, data: { query: sym } };
  }
  const ch = coin.change_24h;
  const answer = `${coin.name || coin.symbol || sym} (${coin.symbol || ''}): ${usd(coin.price_usd)}${ch == null ? '' : ` (${pct(ch)} 24h)`}${coin.source === 'hive-engine' ? ' — on Hive-Engine' : ''}.`;
  return { answer, data: { id: coin.id, symbol: coin.symbol, name: coin.name, price_usd: coin.price_usd, change_24h: ch, source: coin.source } };
}

async function handleMacro(q) {
  const wantCommodity = re('wheat|corn|soybean|coffee|sugar|cocoa|cotton|cattle|hogs|lumber|commodit').test(q);
  const [mac, com] = await Promise.all([
    safe(() => macro(), {}),
    wantCommodity ? safe(() => commodities(), {}) : Promise.resolve({}),
  ]);
  // flatten every macro/commodity row into a lookup so we can match the asked label
  const rows = [...Object.values(mac).flat(), ...Object.values(com).flat()].filter(Boolean);
  const hits = matchLabels(q, rows);
  if (!hits.length) {
    // no specific match → headline snapshot
    const find = (cat, label) => (mac[cat] || []).find((x) => x.label?.startsWith(label));
    const head = [find('Metals', 'Gold'), find('US Indices', 'Dow'), find('US Indices', 'S&P'), find('Risk & Currency', 'VIX')].filter(Boolean);
    const lines = head.map((r) => `• ${r.label}: ${r.kind === 'index' ? num(r.price) : usd(r.price)} (${pct(r.change)})`);
    return { answer: `Macro snapshot:\n${lines.join('\n') || 'unavailable'}`, data: { rows: head } };
  }
  const lines = hits.map((r) => `• ${r.label}: ${r.kind === 'index' || r.kind === 'pct' ? num(r.price) : usd(r.price)}${r.unit ? ` ${r.unit}` : ''} (${pct(r.change)})`);
  return { answer: lines.join('\n'), data: { rows: hits } };
}

async function handleForex(q) {
  const fx = await safe(() => forex(), {});
  const rows = Object.values(fx).flat().filter(Boolean);
  const hits = matchLabels(q, rows);
  const picked = hits.length ? hits : (fx['Major pairs'] || []).slice(0, 4);
  if (!picked.length) return { answer: 'Forex data is unavailable right now.', data: { rows: [] } };
  const lines = picked.map((r) => `• ${r.label}: ${num(r.price, 4)}${r.change == null ? '' : ` (${pct(r.change)})`}`);
  return { answer: `${hits.length ? '' : 'Major FX pairs:\n'}${lines.join('\n')}`, data: { rows: picked } };
}

async function handleExchanges(q) {
  const asset = detectAsset(q);
  const sym = extractSymbol(q);
  const usOnly = re('us[- ]?friendly', 'us exchanges?', 'americans?', 'in the us', 'united states', 'us venues?').test(q);
  const list = (usOnly ? usFriendly(asset) : exchangesByAsset(asset)) || [];
  if (!list.length) return { answer: `I don't have an exchange list for ${asset}.`, data: { asset, exchanges: [] } };
  const top = list.slice(0, 8);
  const lines = top.map((e) => `• ${e.name} (${e.type || 'venue'}, US: ${e.us})${e.note ? ` — ${e.note}` : ''}`);
  const subject = sym ? ` ${sym}` : '';
  const where = usOnly ? 'US-friendly' : '';
  const answer = `${where ? 'US-friendly ' : ''}${asset} venues${subject ? ` (for${subject}, verify the listing)` : ''}:\n${lines.join('\n')}`;
  return { answer, data: { asset, usOnly, symbol: sym, exchanges: top } };
}

async function handleBrief(q) {
  const snap = await safe(() => latest(), null);
  if (!snap) {
    // no cached snapshot — build a live mini-brief from market-universe + macro
    const [mk, line] = await Promise.all([handleMarkets(q), briefLine()]);
    return { answer: `No cached intelligence snapshot yet. Live read:\n${line}\n\n${mk.answer}`, data: { live: mk.data } };
  }
  const report = await safe(() => briefReport(snap), '');
  return { answer: report || (await briefLine()), data: { snapshot: snap } };
}

// "is X legit?" → pull the entity (domain / address / name) and read the trust registry.
async function handleTrust(q) {
  const subject = extractTrustSubject(q);
  if (!subject) return { answer: 'Which coin, site, or wallet did you want me to check? Try "is coinbase.com legit?" or paste a token name / address.', data: null };
  const sig = await safe(() => scamSignals(subject), null);
  if (!sig) return { answer: `I couldn't reach the trust/scam registry to check "${subject}" right now. Treat the absence of a signal as "unknown", not "safe" — always DYOR.`, data: { query: subject } };
  const hint = sig.riskHint || 'unknown';
  const verdict = {
    verified: `✅ ${subject} reads as **regulated / legit**${sig.legit?.basis ? ` — ${sig.legit.basis}` : ''}.`,
    high: `🚨 ${subject} carries **strong scam signals** — do not send funds.`,
    elevated: `⚠️ ${subject} has **elevated risk signals** — be cautious.`,
    low: `${subject} appears in real filings (a mild legitimacy signal), but that is not an endorsement.`,
    unknown: `I found **no clear signal** for ${subject} either way. No signal is NOT a safety guarantee — DYOR.`,
  }[hint] || `Risk read for ${subject}: ${hint}.`;
  const reportLines = (sig.reports || []).map((r) => `• ${r.source}: ${r.detail}`);
  const answer = [verdict, reportLines.length ? `\nWhat the registries say:\n${reportLines.join('\n')}` : '', sig.sources?.length ? `\n_Sources checked: ${sig.sources.join(', ')}._` : '']
    .filter(Boolean).join('\n');
  return { answer, data: { subject, riskHint: hint, legit: sig.legit, reports: sig.reports, sources: sig.sources } };
}

// "best arbitrage right now?" → cross-venue edges + scalp candidates (advisory only).
async function handleArbitrage(q) {
  const wantScalp = re('scalp', 'flip', 'oscillat', 'profit circle').test(q);
  const [edges, scalps] = await Promise.all([
    safe(() => crossVenueEdges(), []),
    wantScalp ? safe(() => scalpCandidates({ universeN: 30 }), []) : Promise.resolve([]),
  ]);
  const lines = [];
  const topEdges = (Array.isArray(edges) ? edges : []).filter((e) => Number.isFinite(e?.edgePct) && e.edgePct > 0).sort((a, b) => b.edgePct - a.edgePct).slice(0, 5);
  if (topEdges.length) {
    lines.push('Cross-venue edges (Hive-Engine ↔ external, fees included):');
    for (const e of topEdges) lines.push(`• ${e.token || e.symbol}: ${pct(e.edgePct)} edge (${e.direction || ''}${e.heUsd != null ? `, HE ${usd(e.heUsd)} vs ${usd(e.externalUsd)}` : ''})`.replace(/\(\s*,/, '('));
  }
  const topScalps = (Array.isArray(scalps) ? scalps : []).slice(0, 5);
  if (topScalps.length) {
    lines.push(`${lines.length ? '\n' : ''}Scalp candidates (intraday oscillation on Hive-Engine):`);
    for (const s of topScalps) lines.push(`• ${s.symbol}: osc ${pct(s.oscPct ?? s.oscillationPct)}${s.volHive != null ? `, vol ${num(s.volHive, 0)} HIVE` : ''}`);
  }
  if (!lines.length) return { answer: 'No positive arbitrage or scalp edges surfaced this pass (markets may be tight, or the readers were unreachable). Nothing executes from here — this is advisory.', data: { edges: [], scalps: [] } };
  return { answer: `Best edges right now (ADVISORY — no trades execute from here):\n${lines.join('\n')}`, data: { edges: topEdges, scalps: topScalps } };
}

// "what does the Library say about X?" → grounded RAG over the Ashurbanipal wiki.
async function handleLibrary(q) {
  // strip the framing words so the RAG search gets the actual topic
  const topic = q.replace(/\b(what does|the|library|ashurbanipal|wiki|say|about|tell me|ask|of)\b/gi, ' ').replace(/\s+/g, ' ').trim() || q;
  const res = await safe(() => askLibrary(topic), null);
  if (!res || !res.answer) return { answer: "I couldn't reach the Library right now. Try again, or browse https://wiki.soapbox.community.", data: { topic } };
  const src = (res.sources || []).length ? `\nSources: ${res.sources.map((s) => s.title).join('; ')}` : '';
  return { answer: `${res.answer}${res.grounded ? src : ''}`, data: { topic, grounded: res.grounded, sources: res.sources } };
}

// "what's the read / diagnose the market?" → fused news×price diagnostics, rendered plainly.
async function handleDiagnostics(q) {
  const diag = await safe(() => diagnostics(), null);
  if (!diag) return { answer: 'The diagnostics read is unavailable right now (no snapshot or feeds this pass).', data: null };
  const sig = (diag.signals || []).slice(0, 4).map((s) => `• ${s.topic} — ${s.kind}: ${s.note}`);
  const moves = (diag.suggestedMoves || []).slice(0, 3).map((m) => `• [${m.kind}] ${m.label} — ${m.rationale}`);
  const parts = [];
  if (sig.length) parts.push(`Signals (news lean vs. price action):\n${sig.join('\n')}`);
  if (moves.length) parts.push(`Suggested moves (advisory — nothing auto-acts):\n${moves.join('\n')}`);
  if (!parts.length) return { answer: 'No diagnostic signals this pass.', data: { diag } };
  return { answer: parts.join('\n\n'), data: { signals: diag.signals, suggestedMoves: diag.suggestedMoves } };
}

// ── helpers for matching ───────────────────────────────────────────────────────

// Pull the entity to trust-check out of a question. Prefers an explicit domain or 0x/BTC address,
// then a quoted phrase, then the most coin-like token after stripping the trust framing words.
function extractTrustSubject(q) {
  const s = String(q || '');
  const addr = s.match(/0x[a-fA-F0-9]{40}|\b(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}\b/);
  if (addr) return addr[0];
  const dom = s.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i);
  if (dom) return dom[0];
  const quoted = s.match(/["'“”]([^"'“”]{2,40})["'“”]/);
  if (quoted) return quoted[1].trim();
  // strip the trust framing, keep the subject token(s)
  const TRUST_WORDS = new Set(['is', 'a', 'an', 'the', 'scam', 'legit', 'legitimate', 'safe', 'fraud', 'rug', 'rugpull', 'pull', 'real', 'fake', 'trustworthy', 'trust', 'should', 'i', 'reported', 'check', 'phishing', 'this', 'coin', 'token', 'site', 'project', 'or', 'and', 'about', 'on', 'romance']);
  const caps = (s.match(/\b[A-Z]{2,6}\b/g) || []).filter((w) => !TRUST_WORDS.has(w.toLowerCase()));
  if (caps.length) return caps[0];
  const words = s.toLowerCase().replace(/[^a-z0-9. ]/g, ' ').split(/\s+/).filter((w) => w && !TRUST_WORDS.has(w));
  return words.sort((a, b) => b.length - a.length)[0] || null;
}


// known coin name → coingecko id aliases (so "price of bitcoin/btc/eth" resolves)
const COIN_ALIASES = {
  btc: 'bitcoin', xbt: 'bitcoin', eth: 'ethereum', ada: 'cardano', sol: 'solana', doge: 'dogecoin',
  ltc: 'litecoin', xrp: 'ripple', bnb: 'binancecoin', dot: 'polkadot', matic: 'matic-network',
  link: 'chainlink', avax: 'avalanche-2', atom: 'cosmos', hive: 'hive', hbd: 'hive_dollar',
  steem: 'steem', sbd: 'steem-dollars', blurt: 'blurt', usdc: 'usd-coin', usdt: 'tether',
  bch: 'bitcoin-cash', eos: 'eos', trx: 'tron', xmr: 'monero', paxg: 'pax-gold',
};

const STOPWORDS = new Set(['price', 'of', 'the', 'what', "what's", 'whats', 'is', 'how', 'much', 'a', 'for', 'me', 'in', 'usd', 'value', 'worth', 'quote', 'trading', 'at', 'coin', 'token', 'and', 'where', 'can', 'i', 'trade', 'buy', 'sell', 'do', 'hold', 'my', 'us', 'usa', 'exchange', 'exchanges', 'american', 'americans', 'on', 'which', 'venue', 'venues', 'list', 'listed', 'to', 'crypto', 'stock', 'stocks', 'forex']);

// Pull the most likely asset symbol/name out of a question. Prefers an explicit ALL-CAPS ticker,
// then a known alias word, then the longest remaining content word.
function extractSymbol(q) {
  const caps = (q.match(/\b[A-Z]{2,6}\b/g) || []).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  if (caps.length) return caps[0];
  const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  // a known alias takes priority over a random long word
  const alias = words.find((w) => COIN_ALIASES[w]);
  if (alias) return alias.toUpperCase();
  const longest = words.sort((a, b) => b.length - a.length)[0];
  return longest ? longest.toUpperCase() : null;
}

// Match the question text against a set of {label} rows — by label word, ticker, or alias.
function matchLabels(q, rows) {
  const lc = q.toLowerCase();
  const out = [];
  for (const r of rows) {
    const label = (r.label || '').toLowerCase();
    if (!label) continue;
    const base = label.split('(')[0].trim();             // "Gold (volatility)" → "gold"
    const slash = label.replace(/\s*\/\s*/g, '/');        // "EUR / USD" → "EUR/USD"
    const first = base.split(/\s+/)[0];                   // "Dow Jones" → "dow", "S&P 500" → "s&p"
    if (base && lc.includes(base)) { out.push(r); continue; }
    if (slash && lc.replace(/\s*\/\s*/g, '/').includes(slash)) { out.push(r); continue; }
    // also match a distinctive first token (≥3 chars, or a symbol like s&p/dxy) standalone in the query
    if (first && (first.length >= 3 || /[&]/.test(first)) && new RegExp(`(^|[^a-z0-9&])${escapeRe(first)}([^a-z0-9]|$)`, 'i').test(lc)) { out.push(r); continue; }
  }
  // de-dupe by label
  const seen = new Set();
  return out.filter((r) => (seen.has(r.label) ? false : seen.add(r.label)));
}

// Which asset class is an exchange question about?
function detectAsset(q) {
  if (re('stock|equit|share|nasdaq|nyse').test(q)) return 'stocks';
  if (/\b[a-z]{3}\s*\/\s*[a-z]{3}\b/i.test(q) || re('forex|fx|currenc').test(q)) return 'forex';
  if (re('bond|treasur|yield').test(q)) return 'bonds';
  if (re('gold|silver|metal|oil|wheat|corn|commodit').test(q)) return 'commodities';
  return 'crypto';
}

// ── the front door ───────────────────────────────────────────────────────────

/**
 * Answer "ask the system anything." Routes the question to the right data source(s), returns a
 * chat-ready string + the structured facts behind it. Best-effort, never throws.
 *
 * @param {string} question
 * @param {object} [opts]   { llm?: boolean (default: use if key present), task?: 'cheap'|'quality', prefer?: string }
 * @returns {Promise<{ answer: string, data: any, intent: string }>}
 */
/** Pure intent classification (no data fetch) — which route a question matches, or 'open' if none.
 *  Exported for tests and for bots that want to branch UI before paying for the data call. */
export function routeIntent(question) {
  const q = String(question || '').trim();
  if (!q) return 'empty';
  const route = ROUTES.find((r) => { try { return r.test(q); } catch { return false; } });
  return route ? route.intent : 'open';
}

export async function ask(question, opts = {}) {
  const q = String(question || '').trim();
  if (!q) return { answer: 'Ask me about holdings, markets, a coin price, gold/silver/indices, forex, where to trade something, the best arbitrage right now, whether a coin or site is legit, or what the Library says about a topic.', data: null, intent: 'empty' };

  // 1. cheap keyword routing
  const route = ROUTES.find((r) => { try { return r.test(q); } catch { return false; } });

  if (route) {
    const { answer, data } = await safe(() => route.handle(q), { answer: 'I hit an error reading that data — try again.', data: null });
    return { answer, data, intent: route.intent };
  }

  // 2. open-ended → ground an LLM answer in a compact context built from our data
  const wantLLM = opts.llm !== false && haveLLM();
  const ctx = await buildContext(q);
  if (wantLLM) {
    const prompt = [
      'You are the MELEK Resource-Center assistant. Answer the user STRICTLY from the FACTS below.',
      'Do not invent numbers. If the facts do not cover it, say so plainly and suggest a more specific question.',
      'Keep it to 1-3 sentences, chat-ready, no markdown headers.',
      '',
      'FACTS:',
      ctx.text || '(no data available this pass)',
      '',
      `USER QUESTION: ${q}`,
    ].join('\n');
    const res = await safe(() => complete(prompt, { task: opts.task || 'cheap', prefer: opts.prefer }), { text: '' });
    if (res?.text) return { answer: res.text.trim(), data: ctx.data, intent: 'open-llm' };
  }

  // 3. no LLM (or it failed) → templated fact answer
  return {
    answer: ctx.text
      ? `Here's what the system currently knows that may be relevant:\n${ctx.text}`
      : "I don't have data for that right now. Try asking about holdings, top markets, a coin price, gold/indices/forex, or where to trade something.",
    data: ctx.data,
    intent: wantLLM ? 'open-llm-failed' : 'open-templated',
  };
}

// Compact, grounded context for open-ended questions: the cached snapshot's headline numbers +
// top markets. Cheap — reads the last snapshot, falls back to a live market read.
async function buildContext(q) {
  const snap = await safe(() => latest(), null);
  const data = { snapshot: snap };
  const L = [];
  if (snap?.metrics) {
    const m = snap.metrics;
    if (m.hiveEngine) L.push(`Hive-Engine: ${num(m.hiveEngine.totalTokens, 0)} tokens, ${num(m.hiveEngine.activeMarkets, 0)} active markets, ${num(m.hiveEngine.totalVolumeHive, 0)} HIVE 24h volume; top by volume ${(m.hiveEngine.topVolume || []).map((r) => r.symbol).join(', ')}.`);
    if (m.metals?.gold) L.push(`Gold ${usd(m.metals.gold.price)} (${pct(m.metals.gold.change)}); Silver ${m.metals.silver ? usd(m.metals.silver.price) : '—'}.`);
    if (m.indices?.dow) L.push(`Indices — Dow ${pct(m.indices.dow.change)}, S&P ${m.indices.sp500 ? pct(m.indices.sp500.change) : '—'}, VIX ${m.indices.vix ? num(m.indices.vix.price, 1) : '—'} (${m.riskOn || '—'}).`);
    if (m.forex?.length) L.push(`Forex — ${m.forex.slice(0, 3).map((p) => `${p.pair} ${num(p.rate, 4)}`).join(', ')}.`);
  }
  if (Array.isArray(snap?.holdings) && snap.holdings.length) {
    L.push(`Holdings opportunities (top): ${snap.holdings.slice(0, 3).map((o) => `${o.symbol} @${o.account} (~${usd(o.valueUsd)})`).join(', ')}.`);
  }
  if (!L.length) {
    // no snapshot — pull a quick live market read so the LLM/template has SOMETHING factual
    const snap2 = await safe(() => marketSnapshot({ topN: 6 }), null);
    if (snap2) { L.push(`Hive-Engine: ${num(snap2.totalTokens, 0)} tokens, ${num(snap2.activeMarkets, 0)} active markets; top volume ${(snap2.topVolume || []).map((r) => r.symbol).join(', ')}.`); data.liveSnapshot = snap2; }
  }
  return { text: L.join('\n'), data };
}

/** One-liner state-of-the-system (reuses the resource-center snapshot). For /help footers, status pings. */
export async function briefLine() {
  const snap = await safe(() => latest(), null);
  if (!snap?.metrics) {
    const s = await safe(() => marketSnapshot({ topN: 3 }), null);
    return s ? `Hive-Engine: ${num(s.totalTokens, 0)} tokens, ${num(s.activeMarkets, 0)} active markets, ${num(s.totalVolumeHive, 0)} HIVE 24h volume (live).` : 'System intelligence snapshot is not available yet.';
  }
  const m = snap.metrics;
  const parts = [];
  if (m.hiveEngine) parts.push(`HE ${num(m.hiveEngine.activeMarkets, 0)} active mkts / ${num(m.hiveEngine.totalVolumeHive, 0)} HIVE vol`);
  if (m.metals?.gold) parts.push(`Gold ${usd(m.metals.gold.price)} ${pct(m.metals.gold.change)}`);
  if (m.indices?.vix) parts.push(`VIX ${num(m.indices.vix.price, 1)} (${m.riskOn || '—'})`);
  if (m.dxy) parts.push(`DXY ${num(m.dxy.price)} ${pct(m.dxy.change)}`);
  const age = snap.ts ? `, as of ${snap.ts.slice(0, 16).replace('T', ' ')}Z` : '';
  return `${parts.join(' · ') || 'snapshot present but empty'}${age}.`;
}

/** Example questions for a /help command — one per intent the bridge handles. */
export function commands() {
  return [
    { intent: 'holdings', example: 'what are my best holdings opportunities?' },
    { intent: 'markets', example: 'top hive-engine markets by volume' },
    { intent: 'price', example: 'price of HIVE' },
    { intent: 'macro', example: 'gold and silver price' },
    { intent: 'macro', example: 'how is the dow and vix doing?' },
    { intent: 'forex', example: 'eur/usd rate' },
    { intent: 'exchanges', example: 'where can americans trade ADA?' },
    { intent: 'brief', example: "what's the state of the markets?" },
    { intent: 'arbitrage', example: "what's the best arbitrage right now?" },
    { intent: 'trust', example: 'is coinbase.com legit?' },
    { intent: 'library', example: 'what does the Library say about witnesses?' },
    { intent: 'diagnostics', example: "what's the read on the market?" },
  ];
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('system-query.mjs')) {
  const args = process.argv.slice(2);
  if (args.includes('--commands')) {
    console.log('Example questions the system can answer:');
    for (const c of commands()) console.log(`  [${c.intent}] ${c.example}`);
    process.exit(0);
  }
  if (args.includes('--brief')) {
    console.log(await briefLine());
    process.exit(0);
  }
  const question = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!question) {
    console.error('usage: node integrations/system-query.mjs "your question"');
    console.error('       node integrations/system-query.mjs --commands | --brief');
    process.exit(1);
  }
  const res = await ask(question, { llm: !args.includes('--no-llm') });
  console.log(res.answer);
  if (args.includes('--json')) console.log('\n' + JSON.stringify({ intent: res.intent, data: res.data }, null, 2));
  else console.error(`\n[intent: ${res.intent}]`);
}
