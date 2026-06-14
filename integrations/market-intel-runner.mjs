// market-intel-runner.mjs — the unified market-intelligence collector for the MELEK Witness.
//
// ONE read-only pipeline that fans out across EVERY market-data reader we already have, normalizes
// each into a single snapshot, then hands that snapshot to the signal-orchestrator so the fused
// ACT/WATCH/REJECT feed rides along in the same response.
//
// IT COMPOSES, IT DOES NOT REINVENT. Every section is produced by an EXISTING reader:
//   - markets-brain.mjs  (buildBrainView)   → crypto, fx, metals, commodities, stocks, bonds, futures
//   - chains/sol-bot.mjs (readQuotes)       → Solana DEX quotes
//   - chains/polygon-bot.mjs (polygonQuotes)→ Polygon DEX quotes
//   - chains/multichain.mjs (nativePrices/chainsTvl) → multichain native $ + TVL
//   - chains/unified-data.mjs               → multichain explorer reachability
//   - scraper.mjs (search)                  → live web / foreign / alt search
//   - our-search.mjs (search)               → our own aggregated search index
//   - signal-orchestrator.mjs (buildSignalFeed) → the fused, trap-filtered, ranked feed
//
// House style: ESM .mjs, soft-fail-never-throw (a dead reader yields a null section + ok:false in
// `sources`, never a throw), injectable fetch + injectable readers for FULLY OFFLINE tests, esc()
// all interpolation, handler(req,res) exported, CLI guarded by process.argv[1].
//
// READ-ONLY. No keys. No trading. No broadcasts. It only reports what the markets look like.

import { fileURLToPath } from 'node:url';
import { buildSignalFeed } from './signal-orchestrator.mjs';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── injectable fetch — passed THROUGH to every reader that supports a fetch hook ───────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── injectable readers — tests pass mocks here so the whole run is offline (mirrors orchestrator's
//    __setLive). When unset, collectAll dynamic-imports the real modules and wires the injected fetch
//    into each one that exposes a fetch hook. A reader that is absent / throws → that section is null. ─
let _readers = null;
/**
 * Override the reader set for offline tests. Pass an object of async functions keyed by section name:
 *   { crypto, sol, polygon, multichain, scraped, ... } — each returns that section's raw payload.
 * Pass null to restore the live (dynamic-import) defaults.
 */
export function __setReaders(obj) { _readers = obj && typeof obj === 'object' ? obj : null; return _readers; }

// Markets the brain produces in one buildBrainView call. Kept here so a snapshot ALWAYS has a slot for
// each (null when the reader is down) — a stable shape downstream consumers can count on.
const BRAIN_MARKETS = ['crypto', 'fx', 'metals', 'commodities', 'stocks', 'bonds', 'futures'];
const ALL_MARKETS = [...BRAIN_MARKETS, 'sol', 'polygon', 'multichain'];

function emptyMarkets() {
  return Object.fromEntries(ALL_MARKETS.map((k) => [k, null]));
}

// safe(): run one reader, NEVER let it throw out. Returns { ok, value, note }. A reader that throws or
// is missing yields ok:false + the reason — the section it feeds becomes null, the run continues.
async function safe(fn) {
  try {
    if (typeof fn !== 'function') return { ok: false, value: null, note: 'reader unavailable' };
    const value = await fn();
    return { ok: true, value, note: '' };
  } catch (e) {
    return { ok: false, value: null, note: (e && e.message) ? e.message : String(e) };
  }
}

// Count "rows" in an arbitrary section payload, for the sources[] summary (best-effort, never throws).
function countOf(value) {
  try {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.length;
    if (Array.isArray(value.entries)) return value.entries.length;
    if (Array.isArray(value.sections)) return value.sections.reduce((n, s) => n + ((s.entries || []).length), 0);
    if (Array.isArray(value.quotes)) return value.quotes.length;
    if (Array.isArray(value.rows)) return value.rows.length;
    if (Array.isArray(value.hits)) return value.hits.length;
    if (typeof value === 'object') return Object.keys(value).length;
    return 1;
  } catch { return 0; }
}

// ── live reader defaults: dynamic-import the real modules, inject our fetch where supported ────────
// Each returns the SECTION'S raw payload (or throws → caught by safe()). Read-only calls only.
function liveReaders() {
  const f = _fetch;
  return {
    // markets-brain returns one view with all 7 traditional+crypto sections; it takes opts.fetch.
    brain: async () => {
      const m = await import('./markets-brain.mjs');
      return m.buildBrainView({ fetch: f });
    },
    sol: async () => {
      const m = await import('./chains/sol-bot.mjs');
      if (typeof m.__setFetch === 'function') m.__setFetch(f);
      const quotes = await m.readQuotes();
      const intentions = typeof m.strategize === 'function' ? m.strategize(quotes) : [];
      return { quotes, intentions };
    },
    polygon: async () => {
      const m = await import('./chains/polygon-bot.mjs');
      if (typeof m.__setFetch === 'function') m.__setFetch(f);
      const quotes = await m.polygonQuotes();
      const intentions = typeof m.dryRunIntentions === 'function' ? m.dryRunIntentions(quotes) : [];
      return { quotes, intentions };
    },
    multichain: async () => {
      const m = await import('./chains/multichain.mjs');
      const [prices, tvl] = await Promise.all([
        m.nativePrices ? m.nativePrices() : {},
        m.chainsTvl ? m.chainsTvl() : {},
      ]);
      return { nativePrices: prices, tvl };
    },
    scraped: async () => {
      const m = await import('./scraper.mjs');
      if (typeof m.__setFetch === 'function') m.__setFetch(f);
      const query = process.env.INTEL_QUERY || 'crypto market outlook';
      return m.search(query, { limit: 6 });
    },
  };
}

// Pull the brain view into per-market sections keyed by ALL_MARKETS. A down brain → all 7 stay null.
function splitBrain(view) {
  const out = {};
  for (const k of BRAIN_MARKETS) out[k] = null;
  if (!view || !Array.isArray(view.sections)) return out;
  for (const s of view.sections) {
    if (s && s.key && BRAIN_MARKETS.includes(s.key)) out[s.key] = s.entries || [];
  }
  return out;
}

// Normalize a scraper/our-search result into a flat array of scraped items for the snapshot.
function normalizeScraped(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.hits)) return value.hits;
  if (Array.isArray(value.results)) return value.results;
  return [];
}

// Build the orchestrator inputs from the collected sections. The DEX intentions (sol/polygon) are
// already-normalized dry-run signals → fed as `extra`; the brain's confident prices become a price-
// confidence map so the trap filter can down-weight unconfident quotes. Soft-fails to {} on any error.
function toSignalInputs(markets) {
  const inputs = { extra: [], prices: {} };
  try {
    for (const which of ['sol', 'polygon']) {
      const sec = markets[which];
      const intentions = (sec && Array.isArray(sec.intentions)) ? sec.intentions : [];
      for (const it of intentions) {
        if (!it) continue;
        inputs.extra.push({
          source: `${which}-dryrun`,
          market: it.coin || which,
          symbol: it.market || it.symbol || which,
          side: it.side,
          edgePct: typeof it.edgePct === 'number' ? it.edgePct * 100 : it.edgePct,
          realUsd: it.size,
        });
      }
    }
    const crypto = Array.isArray(markets.crypto) ? markets.crypto : [];
    for (const e of crypto) {
      if (e && e.symbol) inputs.prices[e.symbol] = { confident: !!e.confident, sources: e.sources || [] };
    }
  } catch { /* soft-fail: fewer inputs, never a throw */ }
  return inputs;
}

// Confidence for the whole snapshot: fraction of attempted sources that came back ok.
function snapshotConfidence(sources) {
  if (!sources.length) return 0;
  const ok = sources.filter((s) => s.ok).length;
  return +(ok / sources.length).toFixed(3);
}

/**
 * collectAll(opts) — fan out across EVERY reader, normalize into one snapshot, attach the fused feed.
 *
 * @param {object} [opts]
 * @param {function} [opts.fetch]  injectable fetch passed through to fetch-aware readers.
 * @param {object}   [opts.readers] override the reader set (else the live dynamic-import defaults).
 * @returns {Promise<{
 *   asOf:string, readOnly:true,
 *   sources:Array<{name,ok,count,note}>,
 *   markets:{crypto,sol,polygon,fx,metals,commodities,stocks,bonds,futures,multichain},
 *   scraped:Array, confidence:number,
 *   feed:{signals,counts,generatedAt}
 * }>}
 * Soft-fails to a valid EMPTY snapshot (all sections null, empty feed) on any error — never throws.
 */
export async function collectAll(opts = {}) {
  const asOf = new Date().toISOString();
  try {
    if (typeof opts.fetch === 'function') __setFetch(opts.fetch);
    const readers = (opts.readers && typeof opts.readers === 'object') ? opts.readers
      : (_readers || liveReaders());

    const markets = emptyMarkets();
    const sources = [];
    let scraped = [];

    // 1. markets-brain → the 7 traditional/crypto sections (one call, one source line).
    const brain = await safe(readers.brain);
    const split = splitBrain(brain.value);
    for (const k of BRAIN_MARKETS) markets[k] = split[k];
    sources.push({ name: 'markets-brain', ok: brain.ok && !!brain.value, count: countOf(brain.value), note: brain.note });

    // 2–4. the per-chain DEX / multichain readers, each its own source line + section.
    const chainSpecs = [
      ['sol', 'chains/sol-bot'],
      ['polygon', 'chains/polygon-bot'],
      ['multichain', 'chains/multichain'],
    ];
    await Promise.all(chainSpecs.map(async ([key, name]) => {
      const r = await safe(readers[key]);
      markets[key] = r.value;
      sources.push({ name, ok: r.ok, count: countOf(r.value), note: r.note });
    }));

    // 5. scraper / search → the scraped section.
    const sc = await safe(readers.scraped);
    scraped = normalizeScraped(sc.value);
    sources.push({ name: 'scraper', ok: sc.ok, count: scraped.length, note: sc.note });

    // 6. fuse: hand the normalized snapshot to the signal-orchestrator for the ranked feed.
    let feed;
    try {
      feed = buildSignalFeed(toSignalInputs(markets));
    } catch (e) {
      feed = { signals: [], counts: { ACT: 0, WATCH: 0, REJECT: 0 }, generatedAt: new Date().toISOString(), error: (e && e.message) || String(e) };
    }

    return {
      asOf, readOnly: true,
      sources,
      markets,
      scraped,
      confidence: snapshotConfidence(sources),
      feed,
    };
  } catch (e) {
    // total soft-fail: a valid empty snapshot. Downstream consumers get the SAME shape, always.
    return {
      asOf, readOnly: true,
      sources: [],
      markets: emptyMarkets(),
      scraped: [],
      confidence: 0,
      feed: { signals: [], counts: { ACT: 0, WATCH: 0, REJECT: 0 }, generatedAt: new Date().toISOString() },
      error: (e && e.message) ? e.message : String(e),
    };
  }
}

// ── HTTP handler: GET /api/intel → the full snapshot + fused feed JSON ─────────────────────────────
// READ-ONLY: reports the market snapshot only; never accepts an order or a key. Non-GET / other path
// → 4xx JSON. Soft-fails to a valid empty snapshot (never 500-throws). Callable directly in tests.
export async function handler(req, res) {
  const method = (req && req.method) || 'GET';
  const url = (req && req.url) || '/api/intel';
  const path = url.split('?')[0];
  const send = (code, obj) => {
    if (res && typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json' });
    if (res && typeof res.end === 'function') res.end(JSON.stringify(obj));
    return obj;
  };
  if (method !== 'GET') return send(405, { ok: false, error: 'method not allowed', advisory: true });
  if (path !== '/api/intel') return send(404, { ok: false, error: `not found: ${esc(path)}`, advisory: true });
  const snapshot = await collectAll();
  return send(200, { ok: true, advisory: true, readOnly: true, ...snapshot });
}

export default { collectAll, handler, __setFetch, __setReaders };

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const snap = await collectAll();
  console.log('UNIFIED MARKET-INTEL SNAPSHOT — read-only / advisory, composed from existing readers');
  console.log('─'.repeat(86));
  for (const s of snap.sources) {
    console.log(`  ${s.ok ? 'ok ' : 'DOWN'}  ${s.name.padEnd(20)} ${String(s.count).padStart(4)} rows` + (s.note ? `  (${s.note})` : ''));
  }
  console.log('─'.repeat(86));
  console.log(`confidence ${snap.confidence}  ·  scraped ${snap.scraped.length}  ·  asOf ${snap.asOf}`);
  console.log(`FUSED FEED → ACT ${snap.feed.counts.ACT} · WATCH ${snap.feed.counts.WATCH} · REJECT ${snap.feed.counts.REJECT}`);
}
