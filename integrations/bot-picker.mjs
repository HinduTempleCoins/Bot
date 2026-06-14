#!/usr/bin/env node
// bot-picker.mjs — the "Pick a bot" surface for the MELEK pool/autovote ecosystem.
//
// WHAT THIS IS
//   A thin, SAFE-BY-CONSTRUCTION front door to the already-built strategy registry in
//   trade-strategies.mjs. It lets a person pick one of the 7 standard strategies (peg-arb, grid,
//   market-make, dca, momentum, nudge, wall) and SEE it run in DRY-RUN against a market snapshot,
//   showing the proposed orders. It NEVER executes, NEVER signs, NEVER holds a key.
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ─────────────────────────────────────────────┐
// │ • This module DECIDES nothing itself — it delegates every decision to trade-strategies.decide,│
// │   whose orders are frozen {dryRun:true, signer:null} by construction (see freezeOrder there).  │
// │ • simulatePick HARD-ASSERTS the output is dry-run with a null signer. If a future change to the │
// │   strategy layer ever produced a live/signer-attached order, simulatePick refuses to return it. │
// │ • No I/O in the pure path. The HTTP handler may fetch a live market snapshot via an INJECTED    │
// │   fetch; with no fetch (or on any error) it soft-fails to a bundled static sample snapshot.     │
// │ • zero-WIF-on-host holds: nothing here reads, stores, references, or returns a WIF/key.          │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
//   import { listStrategies, simulatePick } from './integrations/bot-picker.mjs';
//   const cards = listStrategies();
//   const sim = simulatePick('peg-arb', { symbol:'SWAP.DOGE', hePrice:0.011, realUsd:0.085, hiveUsd:0.30 });
//
// CLI:  node integrations/bot-picker.mjs            # list the bots + a demo dry-run each

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STRATEGIES, decide, listStrategies as registryList } from './trade-strategies.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8137);
const HOST = process.env.BOT_PICKER_BIND || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || '';
const PAGE_FILE = join(HERE, 'bot-picker.html');

// ── HTML-escape for any string that lands in CLI/HTML output. Never throws. ─────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// One-liner descriptions keyed off the registry. We reuse the registry's own `note` so the copy
// stays in lockstep with the strategy layer; this map only provides the SHORT card line.
const SHORT_DESC = Object.freeze({
  'peg-arb': 'Fade the gap when a SWAP token drifts from its real-world price. The one proven family.',
  'grid': 'Ladder buys below / sells above a center price. For range-bound chop, inventory-capped.',
  'market-make': 'Quote both sides for the spread, leaning sell so the book net-distributes.',
  'dca': 'Buy a fixed amount each interval, hard-capped by a total budget. Slow and robust.',
  'momentum': 'Go long on an up-trend, flatten on the cross-back. One unit, no pyramiding.',
  'nudge': 'Outbid troll bids by one increment to support an issued token. Never crosses the ask.',
  'wall': 'Defend a price floor with a buy wall / cap a ceiling with a sell wall.',
});

/**
 * The strategy cards for the picker UI. id, label, one-line desc, proven flag — all from the registry.
 * @returns {Array<{id:string,label:string,desc:string,proven:boolean,note:string}>}
 */
export function listStrategies() {
  return registryList().map((s) => ({
    id: s.name,
    label: s.label,
    desc: SHORT_DESC[s.name] || s.note || '',
    proven: !!s.proven,
    note: s.note || '',
  }));
}

// A bundled, deterministic snapshot used when no live market data is available. It carries enough
// fields that EVERY strategy can act (price, peg, book, fast/slow) so the demo is never blank.
export const SAMPLE_SNAPSHOT = Object.freeze({
  symbol: 'SWAP.DOGE',
  hePrice: 0.011,
  mid: 0.011,
  realUsd: 0.085,
  hiveUsd: 0.30,
  bid: 0.0108,
  ask: 0.0112,
  fast: 0.0118,
  slow: 0.011,
  buyBook: [{ price: 0.0108, quantity: 5000 }, { price: 0.0105, quantity: 8000 }],
  sellBook: [{ price: 0.0112, quantity: 4000 }, { price: 0.0120, quantity: 6000 }],
  ts: 1718000000000,
});

// A modest default state so the inventory/budget-gated strategies have something to act on in a demo.
const SAMPLE_STATE = Object.freeze({ inventoryToken: 100, inventoryHive: 25, spentHive: 0 });

// The structural guarantee, re-checked at THIS boundary: an order may only leave simulatePick if it
// is dryRun:true and signer == null. Anything else is treated as a safety breach and dropped to a hold.
function assertDryRun(orders) {
  return (orders || []).every((o) => o && o.dryRun === true && o.signer === null && !('wif' in o) && !('key' in o));
}

// We ECHO the snapshot back so the UI can show what was simulated against — but we ONLY ever echo a
// known-safe allowlist of MARKET fields. A caller cannot smuggle a signer/WIF/key into the response
// by stuffing it into the snapshot: anything off this list is dropped here.
const SNAPSHOT_FIELDS = ['symbol', 'hePrice', 'mid', 'realUsd', 'hiveUsd', 'bid', 'ask', 'fast', 'slow', 'buyBook', 'sellBook', 'ts'];
function safeSnapshotEcho(snapshot) {
  const out = {};
  for (const k of SNAPSHOT_FIELDS) if (snapshot[k] !== undefined) out[k] = snapshot[k];
  return out;
}

/**
 * Run the picked strategy in DRY-RUN against a snapshot and return its order intentions + a summary.
 * Soft-fails to a safe hold on bad input. Never throws, never executes, never returns a signer/key.
 *
 * @param {string} strategyId  one of the registry ids (peg-arb, grid, …)
 * @param {object} [marketSnapshot]  market snapshot (see trade-strategies.mjs header); falls back to SAMPLE_SNAPSHOT
 * @param {object} [opts]  { params, state }
 * @returns {{ok:boolean, strategyId:string, label:string, proven:boolean, dryRun:true,
 *            snapshot:object, orders:Array, reason:string, summary:string, signer:null}}
 */
export function simulatePick(strategyId, marketSnapshot, opts = {}) {
  const id = String(strategyId || '');
  const meta = STRATEGIES[id];
  const snapshot = marketSnapshot && typeof marketSnapshot === 'object' ? marketSnapshot : SAMPLE_SNAPSHOT;
  const params = (opts && typeof opts.params === 'object' && opts.params) || {};
  const state = (opts && typeof opts.state === 'object' && opts.state) || SAMPLE_STATE;

  if (!meta) {
    return {
      ok: false, strategyId: id, label: '', proven: false, dryRun: true,
      snapshot: safeSnapshotEcho(snapshot), orders: [], reason: `unknown strategy '${id}'`,
      summary: `No such bot: ${id}. Pick one of: ${Object.keys(STRATEGIES).join(', ')}.`,
      signer: null,
    };
  }

  // decide() already soft-fails to a hold and freezes every order dryRun:true / signer:null.
  const { orders, reason } = decide(id, snapshot, params, state);

  // Defence in depth: refuse to surface anything that isn't provably dry-run / keyless.
  const safe = assertDryRun(orders) ? orders : [];
  const summary = safe.length
    ? `${meta.label} would place ${safe.length} dry-run order${safe.length > 1 ? 's' : ''}: ` +
      safe.map((o) => `${o.side.toUpperCase()} ${o.qtyToken} ${o.symbol} @ ${o.price}`).join('; ') +
      '. SIMULATION ONLY — nothing is broadcast and no key is touched.'
    : `${meta.label} would HOLD this snapshot — no order proposed. (${reason})`;

  return {
    ok: true,
    strategyId: id,
    label: meta.label,
    proven: !!meta.proven,
    dryRun: true,
    snapshot: safeSnapshotEcho(snapshot),
    orders: safe,
    reason,
    summary,
    signer: null,
  };
}

// ── HTTP surface ────────────────────────────────────────────────────────────────────────────────
// GET  /                    → the static picker page
// GET  /api/bots            → listStrategies() JSON
// POST /api/bots/simulate   → { strategyId, market?, params?, state? } → simulatePick() JSON
//
// deps.fetch (optional) is used ONLY to enrich a live market snapshot when the POST body asks for it
// (body.live === true) and supplies no `market`. With no fetch, or on any error, it soft-fails to the
// bundled SAMPLE_SNAPSHOT. There is NO execution path: this handler can only ever return dry-run data.

function readJson(req, limit = 8192) {
  return new Promise((resolve) => {
    let buf = ''; let over = false;
    req.on('data', (c) => { buf += c; if (buf.length > limit) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(buf || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// Soft-fetch a live snapshot. Tolerant of any shape; on ANY problem returns the bundled sample.
async function liveSnapshot(fetchImpl, url) {
  if (typeof fetchImpl !== 'function' || !url) return { ...SAMPLE_SNAPSHOT };
  try {
    const r = await fetchImpl(url);
    const data = r && typeof r.json === 'function' ? await r.json() : r;
    if (data && typeof data === 'object') return { ...SAMPLE_SNAPSHOT, ...data };
  } catch { /* soft-fail: fall through to the sample */ }
  return { ...SAMPLE_SNAPSHOT };
}

/**
 * HTTP handler. deps:
 *   fetch   -> injected fetch for live market data (optional; soft-fails to SAMPLE_SNAPSHOT).
 *   marketUrl -> URL to fetch a snapshot from when a request asks for live data (optional).
 *   readPage -> async () => html (tests inject this so the page need not exist on disk).
 */
export async function handler(req, res, deps = {}) {
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const sendText = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const path = (req.url || '/').split('?')[0];
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' && (path === '/' || path === '/bot-picker' || path === '/index.html')) {
    try {
      const html = deps.readPage ? await deps.readPage() : await readFile(PAGE_FILE, 'utf8');
      return sendText(200, 'text/html; charset=utf-8', html);
    } catch {
      return sendText(500, 'text/html; charset=utf-8', '<!doctype html><p>bot-picker page unavailable</p>');
    }
  }

  if (method === 'GET' && path === '/api/bots') {
    return sendJson(200, { ok: true, bots: listStrategies() });
  }

  if (method === 'POST' && path === '/api/bots/simulate') {
    const body = await readJson(req);
    if (!body || typeof body.strategyId !== 'string') {
      return sendJson(200, { ...simulatePick(body && body.strategyId), ok: false, error: 'need { strategyId, market? }' });
    }
    let snapshot = body.market && typeof body.market === 'object' ? body.market : null;
    if (!snapshot) snapshot = await liveSnapshot(deps.fetch, deps.marketUrl || body.marketUrl);
    const sim = simulatePick(body.strategyId, snapshot, { params: body.params, state: body.state });
    return sendJson(200, sim);
  }

  return sendJson(404, { ok: false, error: 'not found' });
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bot-picker.mjs')) {
  const serve = process.argv.includes('--serve');
  if (serve) {
    http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('{"ok":false}'); } catch {} }); })
      .listen(PORT, HOST, () => console.log(`bot-picker on http://${HOST}:${PORT}/${BASE_URL ? ` (base ${BASE_URL})` : ''} — DRY-RUN ONLY, no keys`));
  } else {
    console.log('Pick-a-bot — DRY-RUN simulation of the standard MELEK trade strategies. NO execution, NO keys.');
    console.log('─'.repeat(88));
    for (const b of listStrategies()) {
      const sim = simulatePick(b.id, SAMPLE_SNAPSHOT);
      console.log(`\n[${b.id}] ${b.label}${b.proven ? '  ★ proven' : ''}`);
      console.log(`  ${b.desc}`);
      console.log(`  → ${sim.summary}`);
      for (const o of sim.orders) console.log(`      ${o.side.toUpperCase()} ${o.qtyToken} ${o.symbol} @ ${o.price} (${o.qtyHive} HIVE)  dryRun=${o.dryRun} signer=${o.signer}`);
    }
    console.log('\nEvery order above is dryRun:true / signer:null by construction. Run with --serve to start the HTTP surface.');
  }
}
