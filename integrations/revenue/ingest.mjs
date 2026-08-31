// ingest.mjs — bridge the REAL trade record into the revenue ledger so the accountability loop watches
// actual realized P&L, not just what this pipeline staged. Two sources:
//   • profit-tracker.mjs   — the FIFO fill ledger the live loop writes (account/market/side/qty/price/ts)
//   • the box monitor JSON — the trade-monitor latest.json summary (path via TRADE_MONITOR_JSON env)
//
// Every ingested fill is recorded as FILLED (it actually happened on-chain). Prices are in HIVE; pass
// `hiveUsd` to denominate the scorecard in dollars, else it reads in HIVE (0 is 0 either way, which is
// all the $0-flag needs). Pure/injectable, soft-fail-never-throw, no network of its own.

import * as defaultLedger from './ledger.mjs';

const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);

/** Record an array of profit-tracker-shaped fills into the ledger as FILLED rows. */
export function fromProfitTracker(entries = [], { ledger = defaultLedger, hiveUsd = 1 } = {}) {
  const rows = Array.isArray(entries) ? entries : [];
  let recorded = 0;
  for (const e of rows) {
    const side = String(e?.side ?? '').toLowerCase();
    const qty = num(e?.qty ?? e?.quantity);
    const priceHive = num(e?.price);
    if (!['buy', 'sell'].includes(side) || !(qty > 0) || !(priceHive > 0)) continue;
    ledger.record({
      ts: num(e?.ts, Date.now()),
      venue: 'hive-engine',
      symbol: e?.market ?? e?.symbol ?? '_',
      side, qty,
      priceUsd: priceHive * num(hiveUsd, 1),
      feeUsd: num(e?.feeHive) * num(hiveUsd, 1),
      status: 'FILLED',
      source: e?.account ? `profit-tracker:${e.account}` : 'profit-tracker',
    });
    recorded += 1;
  }
  return { recorded, unit: hiveUsd === 1 ? 'HIVE' : 'USD', hiveUsd };
}

/**
 * Load the live profit-tracker ledger and ingest it. `path` (optional) loads its JSONL first (the box
 * persists it). Soft-fails to { recorded: 0 } if the module or file is unavailable (e.g. offline tests
 * that don't inject). Returns what was ingested.
 */
export async function loadProfitTracker({ ledger = defaultLedger, path = process.env.PROFIT_TRACKER_PATH, hiveUsd = 1 } = {}) {
  try {
    const pt = await import('../profit-tracker.mjs');
    if (path && typeof pt.load === 'function') await pt.load(path).catch(() => {});
    const entries = typeof pt.entries === 'function' ? pt.entries() : [];
    return fromProfitTracker(entries, { ledger, hiveUsd });
  } catch (e) { return { recorded: 0, reason: e?.message || String(e) }; }
}

/**
 * Parse the box monitor summary object (or its JSON file) for a realized figure. This does NOT create
 * per-fill rows (it has none) — it returns the reported realized number so the accountability loop can
 * cross-check its own ledger against what the box observed. Returns { realizedHive, idleHive, ... } or null.
 */
export function fromMonitorSummary(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const realizedHive = num(obj.realizedHive ?? obj.realized ?? obj.realizedNet, NaN);
  return {
    realizedHive: Number.isFinite(realizedHive) ? realizedHive : null,
    idleHive: num(obj.idleHive ?? obj.idle, NaN) || null,
    topEdge: obj.topEdge ?? obj.topLiveEdge ?? null,
    at: obj.at ?? obj.ts ?? null,
  };
}

export async function loadMonitorSummary({ path = process.env.TRADE_MONITOR_JSON } = {}) {
  if (!path) return null;   // box path supplied via TRADE_MONITOR_JSON env (kept out of the repo)
  try {
    const { readFile } = await import('node:fs/promises');
    const txt = await readFile(path, 'utf8');
    return fromMonitorSummary(JSON.parse(txt));
  } catch (e) { return null; }
}

export default { fromProfitTracker, loadProfitTracker, fromMonitorSummary, loadMonitorSummary };
