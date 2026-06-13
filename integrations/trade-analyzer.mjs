// trade-analyzer.mjs — fuses Way 1 (what the bot did, on-chain P&L) + Way 2 (live market) into
// ranked findings + concrete, rules-based suggestions. READ-ONLY, no keys. Emits JSON that the
// annal/brief AIs consume (after the sanitizer). This is the "watch + suggest" core.
//
//   node integrations/trade-analyzer.mjs [account]   (default kalivankush)
// Writes .local/trade-analysis.json and prints a readable report.

import { writeFileSync, mkdirSync } from 'node:fs';
import { marketHistory, reconstruct, currentHoldings } from './tradebot-forensics.mjs';
import { market } from './hive-engine-market.mjs';
import { scanArb } from './arb-scanner.mjs';
import { ownership } from './market-depth.mjs';
import { detectWalls } from './liquidity-walls.mjs';

// Fetch a symbol's HE order book and report the nearest support/resistance wall, if any. This is
// the "verify order-book depth before sizing" step the arb findings already call for: a fat sell
// wall just above an arb BUY (or a buy wall just below a SELL) is exactly what eats the edge.
// Soft-fail → null on any error or empty book.
async function wallNote(symbol) {
  try {
    const [buys, sells] = await Promise.all([
      market.buyBook(symbol, 25).catch(() => []),
      market.sellBook(symbol, 25).catch(() => []),
    ]);
    const { buyWalls, sellWalls } = detectWalls({ buyOrders: buys, sellOrders: sells }, { mult: 5 });
    const parts = [];
    if (sellWalls[0]) parts.push(`resistance ${sellWalls[0].size}@${sellWalls[0].price} (${sellWalls[0].x}× median)`);
    if (buyWalls[0]) parts.push(`support ${buyWalls[0].size}@${buyWalls[0].price} (${buyWalls[0].x}× median)`);
    return parts.length ? parts.join(', ') : null;
  } catch { return null; }
}

import { ISSUED_TOKENS, PARITY_TARGET, TRADE_ACCOUNT } from './watchlist.mjs';

const ISSUED = new Set(ISSUED_TOKENS); // tokens this account issues / tries to push

function pct(n) { return `${(n * 100).toFixed(1)}%`; }

// ─── finding categorization / filtering / grouping (deterministic, pure) ───────────────
// The analyze() output's `findings` was a flat list of strings. These helpers add a
// legible taxonomy on top of it WITHOUT changing the existing `findings` field: analyze()
// now also emits `findingsStructured` — the same findings as objects, each carrying a
// `categories` field — so old consumers (which read the string `findings`) keep working.
//
// A "finding" object has the shape:
//   { text, kind, token, net, severity, impact, ts, categories? }
// where `kind` is the source rule (sink|works|parity|stuck|ownership|arb), `net` is the
// realized HIVE swing (negative = loss), `severity`/`impact` are 0..1 magnitudes. Strings
// are accepted too — categorizeFinding parses the leading TAG: prefix when given a string.

export const CATEGORIES = Object.freeze([
  'bleed',               // realized loss / capital destroyed
  'win',                 // realized profit
  'arbitrage',           // mispricing edge (live or recurring profitable pair)
  'fee-drag',            // costs eating returns
  'slippage',            // wide spread / thin book moving the fill against you
  'idle-capital',        // value held but frozen / unproductive
  'concentration-risk',  // self-held / few outside holders / parity fantasy
  'opportunity',         // actionable upside not yet taken
]);
const CATEGORY_SET = new Set(CATEGORIES);

// Map a rule `kind` to its baseline categories. Numeric fields refine this below.
const KIND_CATEGORIES = {
  sink: ['bleed'],
  works: ['win'],
  parity: ['concentration-risk'],
  stuck: ['idle-capital', 'slippage'],
  ownership: ['concentration-risk'],
  arb: ['arbitrage', 'opportunity'],
};

// Infer a finding's kind from a leading "TAG:" prefix when only a string is available.
const KIND_BY_PREFIX = [
  [/^SINK:/i, 'sink'], [/^WORKS:/i, 'works'], [/^PARITY:/i, 'parity'],
  [/^STUCK:/i, 'stuck'], [/^OWNERSHIP:/i, 'ownership'], [/^LIVE ARB:/i, 'arb'],
];

function kindOf(f) {
  if (f && typeof f === 'object' && f.kind) return f.kind;
  const text = typeof f === 'string' ? f : (f && f.text) || '';
  for (const [re, k] of KIND_BY_PREFIX) if (re.test(text)) return k;
  return null;
}

/**
 * Tag a finding with one or more of CATEGORIES, based on its fields (pure).
 * Accepts a finding object or a finding string. Always returns a NEW array; never mutates.
 * Categories are derived from `kind` plus numeric signals: a loss (net<0) → 'bleed',
 * a recurring profitable pair (kind 'arb'/'works' with profit) → 'arbitrage'/'win', a
 * wide spread → 'slippage', high self-ownership → 'concentration-risk', etc.
 */
export function categorizeFinding(finding) {
  const f = finding && typeof finding === 'object' ? finding : {};
  const kind = kindOf(finding);
  const out = new Set(kind && KIND_CATEGORIES[kind] ? KIND_CATEGORIES[kind] : []);

  const net = Number.isFinite(f.net) ? f.net : null;
  if (net != null) {
    if (net < 0) out.add('bleed');
    else if (net > 0) out.add('win');
  }
  // a profitable, repeated pair is arbitrage that worked
  if ((kind === 'arb' || kind === 'works') && (net == null || net >= 0)) {
    out.add('win'); out.add('arbitrage');
  }
  if (Number.isFinite(f.spread) && f.spread > 0.2) out.add('slippage');
  if (Number.isFinite(f.fees) && f.fees > 0) out.add('fee-drag');
  if (Number.isFinite(f.issuerPct) && f.issuerPct > 30) out.add('concentration-risk');
  if (Number.isFinite(f.heldHive) && Number.isFinite(f.held) && f.held > 0 && f.heldHive < 1)
    out.add('idle-capital');
  if (Number.isFinite(f.edgePct) && f.edgePct > 0) { out.add('opportunity'); out.add('arbitrage'); }

  return CATEGORIES.filter((c) => out.has(c)); // stable order, only known categories
}

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
function severityScore(f) {
  if (f && Number.isFinite(f.severity)) return f.severity;            // 0..1 numeric
  const s = f && typeof f.severity === 'string' ? SEVERITY_RANK[f.severity.toLowerCase()] : null;
  return s != null ? s / 4 : 0;
}
function impactScore(f) {
  if (f && Number.isFinite(f.impact)) return Math.abs(f.impact);
  if (f && Number.isFinite(f.net)) return Math.abs(f.net);            // HIVE swing as impact
  if (f && Number.isFinite(f.edgePct)) return Math.abs(f.edgePct);
  return 0;
}

/**
 * Return the subset of `findings` matching the filter (pure; never mutates input).
 * Options (all optional): category (string or array — match if the finding has ANY),
 * minSeverity (0..1 or a label), token (exact symbol match), sinceTs (keep ts >= sinceTs).
 */
export function filterFindings(findings, opts = {}) {
  if (!Array.isArray(findings)) return [];
  const { category, minSeverity, token, sinceTs } = opts;
  const wantCats = category == null ? null
    : (Array.isArray(category) ? category : [category]).filter((c) => CATEGORY_SET.has(c));
  const minSev = minSeverity == null ? null
    : (typeof minSeverity === 'string' ? (SEVERITY_RANK[minSeverity.toLowerCase()] ?? 0) / 4 : minSeverity);

  return findings.filter((f) => {
    if (wantCats && wantCats.length) {
      const cats = Array.isArray(f && f.categories) ? f.categories : categorizeFinding(f);
      if (!wantCats.some((c) => cats.includes(c))) return false;
    }
    if (minSev != null && severityScore(f) < minSev) return false;
    if (token != null && (!f || f.token !== token)) return false;
    if (sinceTs != null) {
      const ts = f && Number.isFinite(f.ts) ? f.ts : null;
      if (ts == null || ts < sinceTs) return false;
    }
    return true;
  });
}

/**
 * Group findings by category and by token, plus a net summary (pure).
 * Returns { byCategory: { cat: [findings] }, byToken: { sym: [findings] },
 *           summary: { bleed, win, net } } where bleed/win are summed |net| of losses/wins.
 */
export function groupFindings(findings) {
  const byCategory = {}, byToken = {};
  let bleed = 0, win = 0;
  if (Array.isArray(findings)) {
    for (const f of findings) {
      const cats = Array.isArray(f && f.categories) ? f.categories : categorizeFinding(f);
      for (const c of cats) (byCategory[c] ||= []).push(f);
      const tok = f && f.token;
      if (tok) (byToken[tok] ||= []).push(f);
      const net = f && Number.isFinite(f.net) ? f.net : null;
      if (net != null) { if (net < 0) bleed += -net; else win += net; }
    }
  }
  return { byCategory, byToken, summary: { bleed: +bleed.toFixed(2), win: +win.toFixed(2), net: +(win - bleed).toFixed(2) } };
}

/**
 * Sort findings by severity then impact, descending (pure; returns a NEW array).
 */
export function rankFindings(findings) {
  if (!Array.isArray(findings)) return [];
  return [...findings].sort((a, b) => {
    const sd = severityScore(b) - severityScore(a);
    if (sd) return sd;
    return impactScore(b) - impactScore(a);
  });
}

export async function analyze(account) {
  const ops = await marketHistory(account);
  const { sym } = reconstruct(ops);
  const holdings = Object.fromEntries((await currentHoldings(account)).map(h => [h.symbol, h.balance + h.stake]));

  const tokens = [];
  for (const [s, v] of Object.entries(sym)) {
    if (!(v.buys || v.sells)) continue;
    const net = v.hiveRecv - v.hiveSpent;
    const held = holdings[s] || 0;
    let last = 0, ask = 0, bid = 0, spread = null;
    try { const m = await market.metrics(s); if (m) { last = +m.lastPrice; ask = +m.lowestAsk; bid = +m.highestBid; } } catch {}
    if (ask && bid) spread = (ask - bid) / ask;
    tokens.push({ symbol: s, ...v, net, held, heldHive: held * last, last, spread, issued: ISSUED.has(s) });
  }
  tokens.sort((a, b) => a.net - b.net); // losers first

  const findings = [], suggestions = [];
  // Structured mirror of `findings` — each entry is an object carrying the fields that
  // categorizeFinding() reads. `findings` (strings) stays byte-identical for old consumers;
  // `findingsStructured` is the categorized, filterable view added in this build.
  const structured = [];
  const rec = (text, fields) => {
    const f = { text, ...fields };
    f.categories = categorizeFinding(f);
    structured.push(f);
  };
  for (const t of tokens) {
    if (t.net <= -50 && t.held === 0)
      { findings.push(`SINK: ${t.symbol} lost ${(-t.net).toFixed(0)} HIVE and holds nothing now — pure bleed.`);
        rec(findings[findings.length - 1], { kind: 'sink', token: t.symbol, net: t.net, severity: 'high', impact: -t.net });
        suggestions.push(`STOP trading ${t.symbol}. It cost ${(-t.net).toFixed(0)} HIVE with zero recovery. Disable whatever strategy buys it.`); }
    else if (t.net >= 200)
      { findings.push(`WORKS: ${t.symbol} netted +${t.net.toFixed(0)} HIVE (${t.sells} sells).`);
        rec(findings[findings.length - 1], { kind: 'works', token: t.symbol, net: t.net, severity: 'medium', impact: t.net });
        suggestions.push(`SCALE ${t.symbol}: this is where profit came from. Increase allocation / keep the arbitrage running.`); }
    if (t.issued && t.last > 0) {
      const gap = PARITY_TARGET / t.last;
      findings.push(`PARITY: ${t.symbol} trades at ${t.last.toFixed(6)} HIVE vs target ${PARITY_TARGET} — ${gap.toFixed(0)}× away. Held ${t.held.toLocaleString()} = only ${t.heldHive.toFixed(1)} HIVE.`);
      rec(findings[findings.length - 1], { kind: 'parity', token: t.symbol, heldHive: t.heldHive, held: t.held, severity: 'medium', impact: t.heldHive });
      suggestions.push(`RETHINK ${t.symbol} push-to-parity: a ${gap.toFixed(0)}× move is unrealistic by self-buying. Cap spend; treat the ${t.heldHive.toFixed(0)} HIVE bag as sunk, not an asset.`);
    }
    if (t.held > 0 && t.heldHive < 1 && t.spread != null && t.spread > 0.5)
      { findings.push(`STUCK: ${t.symbol} held ${t.held.toLocaleString()} but worth <1 HIVE and ${pct(t.spread)} spread — illiquid/dead.`);
        rec(findings[findings.length - 1], { kind: 'stuck', token: t.symbol, held: t.held, heldHive: t.heldHive, spread: t.spread, severity: 'low', impact: t.heldHive });
        suggestions.push(`Do not add to ${t.symbol}; it is illiquid (${pct(t.spread)} spread). Capital here is effectively frozen.`); }
  }

  // ownership concentration for issued tokens (is there real outside demand?)
  for (const s of ISSUED) {
    try {
      const o = await ownership(s);
      if (o) {
        findings.push(`OWNERSHIP: ${s} is ${o.issuerPct}% held by the issuer with only ${o.outsideHolders} outside holders ≥1 token — little/no real outside demand.`);
        rec(findings[findings.length - 1], { kind: 'ownership', token: s, issuerPct: o.issuerPct, outsideHolders: o.outsideHolders, severity: o.issuerPct > 30 ? 'high' : 'low', impact: o.issuerPct });
        if (o.issuerPct > 30) suggestions.push(`${s} is ${o.issuerPct}% self-held with ~no outside buyers — the price "push" is self-trading. Stop spending HIVE to push it; demand must come from real users, not the bot.`);
      }
    } catch {}
  }

  // live arbitrage opportunities (the proven earner): SWAP.X HE price vs real asset
  let liveArb = [];
  try {
    const { opportunities } = await scanArb();
    liveArb = await Promise.all(opportunities.map(async o => ({
      signal: o.signal, sym: o.sym, side: o.side,
      edgePct: +(o.edge * 100).toFixed(1), realUsd: +o.realUsd.toFixed(2),
      walls: o.sym ? await wallNote(o.sym) : null,
    })));
    for (const o of liveArb) {
      const wall = o.walls ? ` Walls: ${o.walls}.` : '';
      findings.push(`LIVE ARB: ${o.signal} — ${o.edgePct}% edge (verify order-book depth).${wall}`);
      rec(findings[findings.length - 1], { kind: 'arb', token: o.signal, edgePct: o.edgePct, realUsd: o.realUsd, walls: o.walls, severity: o.edgePct >= 5 ? 'high' : 'medium', impact: o.edgePct });
      const wallAdvice = o.walls ? ` A wall is in the way (${o.walls}) — it will cap the fill, so size to it, not to the headline edge.` : '';
      suggestions.push(`Consider ${o.signal}: ${o.edgePct}% mispricing vs real $${o.realUsd}. Confirm executable depth before sizing.${wallAdvice}`);
    }
  } catch {}

  const realized = tokens.reduce((a, t) => a + t.net, 0);
  const unrealized = tokens.reduce((a, t) => a + t.heldHive, 0);
  return {
    liveArb,
    account, generatedAtNote: 'stamp on write', window_ops: ops.length,
    totals: { realizedHive: +realized.toFixed(2), unrealizedHive: +unrealized.toFixed(2), netHive: +(realized + unrealized).toFixed(2) },
    tokens: tokens.map(t => ({ symbol: t.symbol, buys: t.buys, sells: t.sells, netHive: +t.net.toFixed(2), held: t.held, heldHive: +t.heldHive.toFixed(2), lastPrice: t.last, issued: t.issued })),
    findings, suggestions,
    // Categorized, filterable view of the same findings (additive — old consumers read `findings`).
    findingsStructured: rankFindings(structured),
    findingGroups: groupFindings(structured),
  };
}

if (process.argv[1] && process.argv[1].endsWith('trade-analyzer.mjs')) {
  const ACCOUNT = process.argv[2] || TRADE_ACCOUNT;
  const result = await analyze(ACCOUNT);
  mkdirSync('.local', { recursive: true });
  writeFileSync('.local/trade-analysis.json', JSON.stringify(result, null, 2));

  console.log(`\n═══════ TRADE ANALYSIS — @${result.account} ═══════`);
  console.log(`window: ${result.window_ops} ops | realized ${result.totals.realizedHive} + holdings ${result.totals.unrealizedHive} = ${result.totals.netHive} HIVE\n`);
  console.log('FINDINGS:'); result.findings.forEach(f => console.log('  • ' + f));
  console.log('\nSUGGESTIONS:'); result.suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log('\n→ .local/trade-analysis.json (for the annal/brief AIs, after sanitizing)');
}
