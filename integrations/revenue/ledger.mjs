// ledger.mjs — the ONE append-only record of every money-move outcome the pipeline produces.
//
// Every suggestion that reaches the pipeline lands here with its fate: STAGED (built, gated, ready,
// awaiting operator authorization), FILLED (real value moved), REJECTED (failed the risk gate),
// FAILED (adapter error). Nothing is silently dropped — that is the whole point. A $0 day must be
// explainable from this ledger alone: "12 STAGED, 0 FILLED, live execution not authorized" is a
// fact recorded here, not a story told afterward.
//
// REALIZED P&L is computed ONLY from FILLED rows, via the audited `../trade/pnl-metric.mjs`
// scorecard (round-trip, FIFO, net-of-fees, naked-sells excluded). STAGED intents are NOT revenue.
//
// House style: pure by default (in-memory store), injectable, soft-fail-never-throw, no network.
// Optional JSONL persistence to a caller-supplied path (default under .local/, never committed).

import { scorecard } from '../trade/pnl-metric.mjs';

export const STATUS = Object.freeze({
  STAGED: 'STAGED',     // gated + ready; NOT broadcast (needs operator authorization)
  FILLED: 'FILLED',     // real value moved on a venue — the only status that counts as revenue
  REJECTED: 'REJECTED', // failed the risk gate; recorded with reason
  FAILED: 'FAILED',     // adapter/broadcast error
});

const num = (x) => (Number.isFinite(+x) ? +x : NaN);

function makeMemoryStore() {
  const rows = [];
  return {
    push: (e) => { rows.push(e); return e; },
    all: () => rows.slice(),
    clear: () => { rows.length = 0; },
  };
}

let store = makeMemoryStore();
export function useStore(s) { store = s || makeMemoryStore(); return store; }
export function reset() { store = makeMemoryStore(); return store; }
export function entries() { return store.all(); }

/**
 * Record one outcome. Always returns the normalized row (soft-fail: junk still records a row with
 * whatever it could parse, so nothing vanishes). Shape:
 *   { ts, venue, symbol, side, qty, priceUsd, feeUsd, notionalUsd, status, signalId, reason, source }
 */
export function record(e) {
  e = e || {};
  const row = {
    ts: Number.isFinite(+e.ts) ? +e.ts : Date.now(),
    venue: String(e.venue ?? 'unknown'),
    symbol: String(e.symbol ?? '_'),
    side: String(e.side ?? '').toLowerCase(),
    qty: Number.isFinite(+e.qty) ? +e.qty : 0,
    priceUsd: Number.isFinite(+e.priceUsd) ? +e.priceUsd : 0,
    feeUsd: Number.isFinite(+e.feeUsd) ? +e.feeUsd : 0,
    notionalUsd: Number.isFinite(+e.notionalUsd)
      ? +e.notionalUsd
      : (Number.isFinite(+e.qty) && Number.isFinite(+e.priceUsd) ? +e.qty * +e.priceUsd : 0),
    status: STATUS[e.status] || String(e.status ?? STATUS.STAGED),
    signalId: e.signalId != null ? String(e.signalId) : null,
    reason: e.reason != null ? String(e.reason) : null,
    source: e.source != null ? String(e.source) : null,
  };
  return store.push(row);
}

/** All rows with a given status. */
export function withStatus(status, { since = 0 } = {}) {
  const s = num(since) || 0;
  return store.all().filter((r) => r.status === status && r.ts >= s);
}

/** FILLED rows only — the real-money leg. Optional { since } epoch-ms filter. */
export function fills({ since = 0 } = {}) { return withStatus(STATUS.FILLED, { since }); }

// Map a FILLED row to the flat buy/sell shape pnl-metric.scorecard() expects.
function toPnlRow(r) {
  return { symbol: r.symbol, side: r.side, qty: r.qty, price: r.priceUsd, fee: r.feeUsd, ts: r.ts };
}

/**
 * The profitability scorecard over FILLED rows since `since` (default: all time). USD-denominated
 * because priceUsd × qty is dollars. Delegates entirely to the audited pnl-metric. `benchmarkPnl`
 * is the do-nothing alternative over the window (default 0 = flat cash).
 */
export function realizedScorecard({ since = 0, benchmarkPnl = 0 } = {}) {
  return scorecard(fills({ since }).map(toPnlRow), { benchmarkPnl });
}

/** Just the realized net USD since `since` — the single number the accountability loop watches. */
export function realizedUsdSince(since = 0) {
  return realizedScorecard({ since }).netPnl;
}

/** Count rows by status since `since` (the anti-theater census). */
export function census({ since = 0 } = {}) {
  const s = num(since) || 0;
  const out = { STAGED: 0, FILLED: 0, REJECTED: 0, FAILED: 0, total: 0 };
  for (const r of store.all()) {
    if (r.ts < s) continue;
    out.total += 1;
    if (out[r.status] != null) out[r.status] += 1;
  }
  return out;
}

// ── optional JSONL persistence (kept OUT of the repo; path lives under .local/) ────────────────────
export async function save(path) {
  if (!path) return { saved: false, reason: 'no path' };
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true }).catch(() => {});
    await writeFile(path, store.all().map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return { saved: true, path, rows: store.all().length };
  } catch (e) { return { saved: false, reason: e?.message || String(e) }; }
}

export async function load(path) {
  if (!path) return { loaded: false, reason: 'no path' };
  try {
    const { readFile } = await import('node:fs/promises');
    const txt = await readFile(path, 'utf8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (t) record(JSON.parse(t));
    }
    return { loaded: true, path, rows: store.all().length };
  } catch (e) { return { loaded: false, reason: e?.message || String(e) }; }
}

export default { STATUS, useStore, reset, entries, record, withStatus, fills, realizedScorecard, realizedUsdSince, census, save, load };
