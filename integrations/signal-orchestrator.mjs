// signal-orchestrator.mjs — ONE ranked, deduped, trap-filtered trade-SIGNAL feed that fuses the
// OUTPUTS of the existing analytics modules into a single advisory view.
//
// ┌─ HARD SAFETY INVARIANT (read before touching) ──────────────────────────────────────────────┐
// │ READ-ONLY / ADVISORY. This module PRODUCES SIGNALS. It NEVER places an order, never           │
// │ broadcasts, never holds or references a key (zero-WIF-on-host). It is a pure fuser: it takes   │
// │ the outputs of the analytics modules (passed in / injected) and returns a ranked signal list.  │
// │ A live executor is a SEPARATE, gated, keyed system on a SEPARATE host — it CONSUMES this feed,  │
// │ it does not live here. Nothing here can be made to trade.                                       │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY a fuser on top of the existing modules: arb-scanner, arb-facade, cross-venue-arb,
// trade-analyzer (liveArb), cex/triangular/crosschain arb each emit their OWN shape. Several report
// the SAME opportunity. Some carry edges that are TRAPS: a phantom wall (>1000× median liquidity), an
// issuer-concentrated/illiquid token (VKBT/CURE), a one-way-bleed pair (SWAP.LTC), or an edge that
// vanishes at realistic fill size. The live data showed a SWAP.ETH "141% edge" that was a 9.9M×
// phantom wall — that MUST be rejected, never acted on. This module is the single place that:
//   1. normalizes every detector's output into ONE signal shape,
//   2. applies HARD trap filters → verdict REJECT (a trap can NEVER be ACT),
//   3. dedupes the same opportunity reported by multiple scanners,
//   4. ranks the survivors by realistic (post-trap) edge × confidence.
//
//   import { buildSignalFeed } from './signal-orchestrator.mjs';
//   const feed = buildSignalFeed({ arbFeed, analyzer, walls, ownership, oneWayBleed, prices });
//   // feed.signals = [{ source, market, symbol, side, edgePct, realUsd, confidence, flags[], verdict }]
//
//   node integrations/signal-orchestrator.mjs   # live fused scan (pulls the real modules, read-only)
//   GET /api/signals  (via handler)             # the current feed as JSON

import { fileURLToPath } from 'node:url';

// ── HTML escape (matches the rest of integrations/) — used only by the small HTML error path ─────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const round = (n, p = 3) => +num(n).toFixed(p);
const upper = (s) => String(s == null ? '' : s).toUpperCase();

// ── trap thresholds (env-overridable; conservative defaults) ─────────────────────────────────────
// A wall this many × the side median is a phantom/broken book level, not real liquidity — its "edge"
// is fake and must be rejected, not traded (matches liquidity-walls.detectWalls phantomX default).
const PHANTOM_WALL_X = num(process.env.SIG_PHANTOM_WALL_X, 1000);
// Issuer-concentration trap: a token >this% held by its issuer is a self-trading mirage (VKBT/CURE).
const ISSUER_CONCENTRATION_PCT = num(process.env.SIG_ISSUER_PCT, 40);
// …and/or fewer than this many real outside holders — no genuine outside demand.
const MIN_OUTSIDE_HOLDERS = num(process.env.SIG_MIN_OUTSIDE_HOLDERS, 5);
// Below this executable HIVE depth the edge "vanishes at realistic fill size" — a thin-book trap.
const MIN_EXEC_HIVE = num(process.env.SIG_MIN_EXEC_HIVE, 5);
// An edge above this (%) with no corroborating confidence is implausible — treat as a likely trap.
const IMPLAUSIBLE_EDGE_PCT = num(process.env.SIG_IMPLAUSIBLE_EDGE_PCT, 50);
// Below this edge (%) a surviving signal is WATCH (worth eyes), not ACT.
const ACT_MIN_EDGE_PCT = num(process.env.SIG_ACT_MIN_EDGE_PCT, 3);

// ── flags a signal can carry. REJECT_FLAGS force verdict REJECT (a trap is never ACT). ───────────
export const REJECT_FLAGS = Object.freeze([
  'phantom-wall',          // an order >PHANTOM_WALL_X× median — fake liquidity manufacturing the edge
  'issuer-concentrated',   // issuer holds too much / too few outside holders — self-trading mirage
  'one-way-bleed',         // a pair that historically only bleeds (SWAP.LTC) — never accumulate it
  'edge-vanishes',         // edge disappears at a realistic fill size (thin executable depth)
  'implausible-edge',      // a huge edge with no corroborating confidence — almost certainly stale/fake
  'suspect-book',          // an upstream detector already flagged the book suspect/one-sided/stale
]);
const REJECT_SET = new Set(REJECT_FLAGS);

// Extract the bare symbol from a venue-y market string ("BUY SWAP.ETH on HE", "SWAP.ETH", "ETH/USDT").
function symbolOf(market, sym) {
  if (sym) return upper(sym);
  const s = String(market == null ? '' : market);
  // a SWAP.X / TOKEN token, else the base of a PAIR/USDT-style string, else the raw string upper-cased.
  const swap = s.match(/SWAP\.[A-Z0-9]+/i);
  if (swap) return upper(swap[0]);
  const pair = s.match(/\b([A-Z0-9]{2,10})[\/\-]/);
  if (pair) return upper(pair[1]);
  const tok = s.match(/\b([A-Z][A-Z0-9]{1,9})\b/);
  return tok ? upper(tok[1]) : upper(s.trim());
}

// ── normalizers: each detector's native OUTPUT → the common signal ───────────────────────────────
// common signal: { source, market, symbol, side, edgePct, realUsd, execHive, confidence, flags[], verdict }
//   edgePct — the rankable figure as a PERCENT. realUsd/execHive carried when the source has them.

// arb-facade.scanAllArb() → { rows:[{ source, market, side, netEdgePct, execHive, suspect, suspectReason, raw }] }
function fromArbFacade(arbFeed) {
  const rows = (arbFeed && Array.isArray(arbFeed.rows)) ? arbFeed.rows : [];
  return rows.map((r) => {
    if (!r || r.market == null) return null;
    const raw = r.raw || {};
    return {
      source: r.source || 'arb-facade',
      market: r.market,
      symbol: symbolOf(r.market, raw.sym),
      side: r.side || null,
      edgePct: round(num(r.netEdgePct)),
      realUsd: Number.isFinite(+raw.realUsd) ? round(raw.realUsd, 6) : null,
      execHive: Number.isFinite(+r.execHive) ? round(r.execHive, 2) : null,
      // an upstream phantom/one-sided/stale flag rides straight through as a reject flag.
      _suspect: !!r.suspect,
    };
  }).filter(Boolean);
}

// trade-analyzer.analyze() → { liveArb:[{ signal, sym, side, edgePct, realUsd, walls }] }
function fromAnalyzer(analyzer) {
  const live = (analyzer && Array.isArray(analyzer.liveArb)) ? analyzer.liveArb : [];
  return live.map((o) => {
    if (!o || (o.sym == null && o.signal == null)) return null;
    return {
      source: 'trade-analyzer',
      market: o.signal || o.sym,
      symbol: symbolOf(o.signal, o.sym),
      side: o.side || null,
      edgePct: round(num(o.edgePct)),       // analyzer already emits edge as a percent
      realUsd: Number.isFinite(+o.realUsd) ? round(o.realUsd, 6) : null,
      execHive: null,
      _walls: o.walls || null,              // human wall note string (informational)
    };
  }).filter(Boolean);
}

// Accept already-normalized extra signals too (any other detector a caller wants to fold in), so the
// orchestrator stays open: each must at least carry { source, market } (+ optional symbol/side/edgePct).
function fromExtra(extra) {
  const list = Array.isArray(extra) ? extra : [];
  return list.map((s) => {
    if (!s || s.market == null) return null;
    return {
      source: s.source || 'extra',
      market: s.market,
      symbol: symbolOf(s.market, s.symbol),
      side: s.side || null,
      edgePct: round(num(s.edgePct)),
      realUsd: Number.isFinite(+s.realUsd) ? round(s.realUsd, 6) : null,
      execHive: Number.isFinite(+s.execHive) ? round(s.execHive, 2) : null,
    };
  }).filter(Boolean);
}

// ── trap filters: decide a signal's flags from the context maps (pure) ───────────────────────────
// `walls`     : { SYMBOL: detectWalls() result } — { buyWalls[], sellWalls[], hasPhantom } each wall {x, phantom}
// `ownership` : { SYMBOL: { issuerPct, outsideHolders } } — issuer-concentration / outside-demand read
// `oneWayBleed`: array/Set of symbols known to only bleed (SWAP.LTC)
// `prices`    : { SYMBOL: { confident, sources } } — price-oracle confidence per symbol
function trapFlags(sig, ctx) {
  const flags = [];
  const { walls = {}, ownership = {}, oneWayBleed, prices = {} } = ctx;
  const sym = sig.symbol;

  // 1. phantom wall — a wall >PHANTOM_WALL_X× median is FAKE liquidity; its edge must be rejected.
  const w = walls[sym];
  if (w) {
    const allWalls = [...(w.buyWalls || []), ...(w.sellWalls || [])];
    const phantom = w.hasPhantom === true
      || allWalls.some((x) => x && (x.phantom === true || num(x.x) >= PHANTOM_WALL_X));
    if (phantom) flags.push('phantom-wall');
  }

  // 2. issuer-concentrated / illiquid token (VKBT/CURE): self-trading mirage, no real outside demand.
  const o = ownership[sym];
  if (o && (num(o.issuerPct) >= ISSUER_CONCENTRATION_PCT
    || (o.outsideHolders != null && num(o.outsideHolders) < MIN_OUTSIDE_HOLDERS))) {
    flags.push('issuer-concentrated');
  }

  // 3. one-way-bleed pair (SWAP.LTC): historically only ever loses — never accumulate.
  const bleedSet = oneWayBleed instanceof Set ? oneWayBleed
    : new Set((Array.isArray(oneWayBleed) ? oneWayBleed : []).map(upper));
  if (bleedSet.has(sym)) flags.push('one-way-bleed');

  // 4. edge vanishes at realistic fill size — thin executable depth.
  if (sig.execHive != null && num(sig.execHive) < MIN_EXEC_HIVE) flags.push('edge-vanishes');

  // 5. upstream-suspect book (one-sided / stale) — carried through from arb-facade/arb-scanner.
  if (sig._suspect) flags.push('suspect-book');

  // 6. implausibly large edge with no corroborating confidence — almost certainly a stale/fake book.
  const conf = prices[sym];
  const corroborated = conf ? conf.confident === true : null;
  if (num(sig.edgePct) >= IMPLAUSIBLE_EDGE_PCT && corroborated !== true) flags.push('implausible-edge');

  return flags;
}

// confidence 0..1: starts from the price-oracle confidence (or a neutral prior), nudged by executable
// depth and corroboration. Pure. A trap-flagged signal still gets a confidence (the ranker only ranks
// survivors, but a stable score is useful to the executor).
function confidenceOf(sig, ctx) {
  const conf = (ctx.prices || {})[sig.symbol];
  let c = conf ? (conf.confident === true ? 0.85 : 0.45) : 0.5;     // oracle-confident is the strong prior
  if (sig.execHive != null) c += num(sig.execHive) >= MIN_EXEC_HIVE * 4 ? 0.1 : -0.1; // real depth helps
  if (sig.realUsd != null) c += 0.05;                                // a real comparand exists
  return Math.max(0, Math.min(1, round(c, 3)));
}

/**
 * Fuse the analytics-module OUTPUTS into ONE ranked, deduped, trap-filtered signal feed (pure).
 *
 * @param {object} inputs
 * @param {object}   [inputs.arbFeed]      arb-facade.scanAllArb() output ({ rows: [...] })
 * @param {object}   [inputs.analyzer]     trade-analyzer.analyze() output ({ liveArb: [...] })
 * @param {Array}    [inputs.extra]        any extra already-normalized signals ({ source, market, ... })
 * @param {object}   [inputs.walls]        { SYMBOL: detectWalls() result } — phantom-wall trap source
 * @param {object}   [inputs.ownership]    { SYMBOL: { issuerPct, outsideHolders } } — concentration trap
 * @param {Array|Set}[inputs.oneWayBleed]  symbols known to only bleed (e.g. ['SWAP.LTC'])
 * @param {object}   [inputs.prices]       { SYMBOL: { confident, sources } } — price-oracle confidence
 * @param {object} [opts]
 * @param {number}   [opts.max]            cap the returned signal count (default 50)
 * @returns {{ signals:Array, counts:object, generatedAt:string }}
 *   signals ranked ACT/WATCH first (by edge×confidence desc), then REJECT (kept for transparency).
 *   Each signal: { source, market, symbol, side, edgePct, realUsd, confidence, flags[], verdict }.
 *   Soft-fails to an empty-but-valid feed on any error — never throws.
 */
export function buildSignalFeed(inputs = {}, opts = {}) {
  try {
    const ctx = {
      walls: inputs.walls || {},
      ownership: inputs.ownership || {},
      oneWayBleed: inputs.oneWayBleed,
      prices: inputs.prices || {},
    };

    // 1. normalize every source into the common signal shape.
    const raw = [
      ...fromArbFacade(inputs.arbFeed),
      ...fromAnalyzer(inputs.analyzer),
      ...fromExtra(inputs.extra),
    ];

    // 2. flag, score, and verdict each signal. A REJECT flag forces REJECT — a trap is NEVER ACT.
    const scored = raw.map((sig) => {
      const flags = trapFlags(sig, ctx);
      const confidence = confidenceOf(sig, ctx);
      const trapped = flags.some((f) => REJECT_SET.has(f));
      let verdict;
      if (trapped) verdict = 'REJECT';
      else if (num(sig.edgePct) >= ACT_MIN_EDGE_PCT) verdict = 'ACT';
      else verdict = 'WATCH';
      // realistic edge: the trap-filtered edge a survivor is ranked on (0 once rejected).
      const realEdge = trapped ? 0 : num(sig.edgePct);
      const { _suspect, _walls, ...clean } = sig; // drop internal carry fields from the public signal
      return { ...clean, confidence, flags, verdict, _rank: realEdge * confidence };
    });

    // 3. DEDUP: the SAME opportunity reported by multiple scanners collapses to ONE signal. Key on
    //    symbol+side (the actual market action), NOT source — that is the whole point of fusing. Keep
    //    the strongest survivor; if every report of a key is a trap, keep the rejected one (transparency).
    const byKey = new Map();
    for (const s of scored) {
      const key = `${s.symbol}::${s.side || 'na'}`;
      const prev = byKey.get(key);
      if (!prev) { byKey.set(key, s); continue; }
      const sActive = s.verdict !== 'REJECT';
      const pActive = prev.verdict !== 'REJECT';
      // prefer a surviving signal over a rejected one; among same status, prefer the higher rank.
      if ((sActive && !pActive) || (sActive === pActive && s._rank > prev._rank)) {
        // fold the prior's distinct sources into the kept signal so the dedup is auditable.
        s.alsoReportedBy = Array.from(new Set([...(prev.alsoReportedBy || []), prev.source].filter((x) => x && x !== s.source)));
        byKey.set(key, s);
      } else {
        prev.alsoReportedBy = Array.from(new Set([...(prev.alsoReportedBy || []), s.source].filter((x) => x && x !== prev.source)));
      }
    }

    // 4. RANK: survivors (ACT/WATCH) first by edge×confidence desc; rejected kept at the end.
    const all = [...byKey.values()].sort((a, b) => {
      const aRej = a.verdict === 'REJECT', bRej = b.verdict === 'REJECT';
      if (aRej !== bRej) return aRej ? 1 : -1;     // rejected sink to the bottom
      return b._rank - a._rank;                    // then strongest realistic edge×confidence first
    });

    const max = Number.isFinite(+opts.max) ? +opts.max : 50;
    const signals = all.slice(0, max).map(({ _rank, ...s }) => s); // strip the internal rank field

    const counts = signals.reduce((acc, s) => { acc[s.verdict] = (acc[s.verdict] || 0) + 1; return acc; },
      { ACT: 0, WATCH: 0, REJECT: 0 });

    return { signals, counts, generatedAt: new Date().toISOString() };
  } catch (e) {
    // soft-fail-never-throw: a safe, valid, empty feed.
    return { signals: [], counts: { ACT: 0, WATCH: 0, REJECT: 0 }, generatedAt: new Date().toISOString(), error: e && e.message ? e.message : String(e) };
  }
}

// ── live source pull (read-only; injectable so tests run fully offline) ───────────────────────────
// Default loaders dynamic-import the real modules; a test passes { arbFeed, analyzer, ... } directly to
// buildSignalFeed and never touches this. liveInputs() soft-fails each source independently.
let _live = null;
export function __setLive(obj) { _live = obj || null; return _live; }

async function liveInputs() {
  if (_live) return _live;
  const out = {};
  try { const m = await import('./arb-facade.mjs'); out.arbFeed = await m.scanAllArb(); } catch {}
  try { const m = await import('./trade-analyzer.mjs'); out.analyzer = await m.analyze(); } catch {}
  // walls / ownership / prices are best-effort context: only build them for the symbols we actually saw,
  // and only if those modules are importable. Missing context just means fewer trap flags, never a throw.
  try {
    const seen = new Set();
    for (const r of (out.arbFeed && out.arbFeed.rows) || []) if (r && r.market) seen.add(symbolOf(r.market, r.raw && r.raw.sym));
    for (const o of (out.analyzer && out.analyzer.liveArb) || []) if (o) seen.add(symbolOf(o.signal, o.sym));
    const lw = await import('./liquidity-walls.mjs').catch(() => null);
    const hem = await import('./hive-engine-market.mjs').catch(() => null);
    if (lw && hem && hem.market) {
      out.walls = {};
      for (const sym of seen) {
        try {
          const [buys, sells] = await Promise.all([
            hem.market.buyBook(sym, 25).catch(() => []),
            hem.market.sellBook(sym, 25).catch(() => []),
          ]);
          out.walls[sym] = lw.detectWalls({ buyOrders: buys, sellOrders: sells });
        } catch {}
      }
    }
  } catch {}
  return out;
}

/**
 * Build the feed from the LIVE modules (read-only). Soft-fails to an empty feed. No keys, no trading.
 */
export async function liveSignalFeed(opts = {}) {
  try {
    const inputs = await liveInputs();
    return buildSignalFeed(inputs, opts);
  } catch (e) {
    return { signals: [], counts: { ACT: 0, WATCH: 0, REJECT: 0 }, generatedAt: new Date().toISOString(), error: e && e.message ? e.message : String(e) };
  }
}

// ── HTTP handler: GET /api/signals → the current feed JSON ────────────────────────────────────────
/**
 * handler(req, res) — GET /api/signals returns the fused feed as JSON. READ-ONLY: it only reports
 * signals; it never accepts an order or a key. Any non-GET / other path → 404 JSON. Soft-fails to a
 * valid empty feed (never 500-throws). Tests call it directly without a live server.
 */
export async function handler(req, res) {
  const method = (req && req.method) || 'GET';
  const url = (req && req.url) || '/api/signals';
  const path = url.split('?')[0];
  const send = (code, obj) => {
    if (res && typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json' });
    if (res && typeof res.end === 'function') res.end(JSON.stringify(obj));
    return obj;
  };
  if (method !== 'GET') return send(405, { ok: false, error: 'method not allowed', advisory: true });
  if (path !== '/api/signals') return send(404, { ok: false, error: `not found: ${esc(path)}`, advisory: true });
  const feed = await liveSignalFeed();
  return send(200, { ok: true, advisory: true, readOnly: true, ...feed });
}

export default { buildSignalFeed, liveSignalFeed, handler, REJECT_FLAGS };

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const feed = await liveSignalFeed();
  console.log('FUSED TRADE-SIGNAL FEED — read-only / advisory, trap-filtered, deduped, ranked');
  console.log('─'.repeat(86));
  console.log(`ACT ${feed.counts.ACT} · WATCH ${feed.counts.WATCH} · REJECT ${feed.counts.REJECT}` + (feed.error ? `  (soft-fail: ${feed.error})` : ''));
  console.log('─'.repeat(86));
  if (!feed.signals.length) console.log('  (no signals right now — sources offline/empty, or markets fairly aligned)');
  for (const s of feed.signals) {
    const flags = s.flags.length ? `  ⚠ ${s.flags.join(',')}` : '';
    const also = s.alsoReportedBy && s.alsoReportedBy.length ? ` (+${s.alsoReportedBy.join(',')})` : '';
    console.log(`  [${s.verdict.padEnd(6)}] ${String(s.symbol).padEnd(12)} ${(s.side || '—').padEnd(4)} ${String(s.edgePct).padStart(7)}%  conf ${s.confidence}  via ${s.source}${also}${flags}`);
  }
  console.log('\nAdvisory only — produces signals, never orders. A live executor (separate, gated, keyed,');
  console.log('on a separate host) consumes GET /api/signals; no key ever lives here (zero-WIF-on-host).');
}
