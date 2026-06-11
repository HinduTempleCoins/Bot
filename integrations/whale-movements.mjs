// whale-movements.mjs — PURE whale-movement diff between two holder snapshots. No network, no keys, no IO seams needed.
//
// holder-history.json stores, per symbol, a timeline of snapshots each carrying a `whales` array
// ([{account, total, percentOfSupply}]). Every other holder module reads ONE snapshot; nothing DIFFS
// the whale arrays ACROSS time to see who accumulated, dumped, appeared, or left. This module does
// exactly that, deterministically:
//
//   whaleMoves(prevWhales, currWhales, {minDeltaPct})  — join two whale arrays on `account`, classify each
//   diffSnapshots(historyArray)                        — walk one symbol's snapshot timeline → chronological move log
//
// A "move" for an account that exists in both snapshots is ACCUMULATED (gained supply share) or DUMPED
// (lost it). An account only in `curr` is a NEW_WHALE; only in `prev` is EXITED. Moves whose absolute
// percentOfSupply change is below `minDeltaPct` (default 0.5) are filtered out as noise — except NEW_WHALE
// / EXITED, which are structural events kept regardless of size.
//
// netFlow = Σ (curr.percentOfSupply − prev.percentOfSupply) over the kept moves: positive = supply share
// migrated INTO the (surviving+new) whale set, negative = whales net-distributed out. Pure & deterministic;
// soft-fail: missing / non-array / empty inputs yield empty moves and null extremes, never throws.
//
//   node integrations/whale-movements.mjs           — demo: diff the first two local snapshots of each symbol
//   import { whaleMoves, diffSnapshots } from './whale-movements.mjs'

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ACCUMULATED = 'ACCUMULATED';
const DUMPED = 'DUMPED';
const NEW_WHALE = 'NEW_WHALE';
const EXITED = 'EXITED';

// Index a whale array by account name → {total, percentOfSupply} (coerced to finite numbers, defaulting 0).
// Non-arrays and malformed entries are skipped. Last write wins on duplicate accounts.
function indexWhales(arr) {
  const map = new Map();
  if (!Array.isArray(arr)) return map;
  for (const w of arr) {
    if (w == null || typeof w !== 'object') continue;
    const account = w.account;
    if (typeof account !== 'string' || account.length === 0) continue;
    const total = Number(w.total);
    const pct = Number(w.percentOfSupply);
    map.set(account, {
      total: Number.isFinite(total) ? total : 0,
      percentOfSupply: Number.isFinite(pct) ? pct : 0,
    });
  }
  return map;
}

function round(n, dp = 6) {
  return +Number(n).toFixed(dp);
}

// Diff two whale arrays (prev → curr). Joins on `account`, computes per-account total + percentOfSupply
// deltas, classifies, and filters by `minDeltaPct` (NEW_WHALE / EXITED always kept). Returns:
//   { moves: [{account, kind, prevTotal, currTotal, deltaTotal, prevPct, currPct, deltaPct}], netFlow,
//     biggestAccumulator, biggestDumper }
// where biggestAccumulator/biggestDumper are the moves with the most-positive / most-negative deltaPct
// (or null if none). Soft-fail: empty/invalid args → empty moves, netFlow 0, null extremes.
export function whaleMoves(prevWhales, currWhales, { minDeltaPct = 0.5 } = {}) {
  const prev = indexWhales(prevWhales);
  const curr = indexWhales(currWhales);

  const thresh = Number(minDeltaPct);
  const minAbs = Number.isFinite(thresh) ? Math.abs(thresh) : 0.5;

  const accounts = new Set([...prev.keys(), ...curr.keys()]);
  const moves = [];

  for (const account of accounts) {
    const p = prev.get(account);
    const c = curr.get(account);

    const prevTotal = p ? p.total : 0;
    const currTotal = c ? c.total : 0;
    const prevPct = p ? p.percentOfSupply : 0;
    const currPct = c ? c.percentOfSupply : 0;
    const deltaTotal = currTotal - prevTotal;
    const deltaPct = currPct - prevPct;

    let kind;
    if (!p && c) kind = NEW_WHALE;
    else if (p && !c) kind = EXITED;
    else if (deltaPct >= 0) kind = ACCUMULATED;
    else kind = DUMPED;

    // Structural events (NEW_WHALE / EXITED) are kept regardless of magnitude; in-both moves
    // below the noise floor are dropped.
    const structural = kind === NEW_WHALE || kind === EXITED;
    if (!structural && Math.abs(deltaPct) < minAbs) continue;

    moves.push({
      account,
      kind,
      prevTotal: round(prevTotal),
      currTotal: round(currTotal),
      deltaTotal: round(deltaTotal),
      prevPct: round(prevPct),
      currPct: round(currPct),
      deltaPct: round(deltaPct),
    });
  }

  // Deterministic ordering: largest absolute supply-share move first, then account name.
  moves.sort((a, b) => {
    const d = Math.abs(b.deltaPct) - Math.abs(a.deltaPct);
    if (d !== 0) return d;
    return a.account < b.account ? -1 : a.account > b.account ? 1 : 0;
  });

  let netFlow = 0;
  let biggestAccumulator = null;
  let biggestDumper = null;
  for (const m of moves) {
    netFlow += m.deltaPct;
    if (m.deltaPct > 0 && (!biggestAccumulator || m.deltaPct > biggestAccumulator.deltaPct)) {
      biggestAccumulator = m;
    }
    if (m.deltaPct < 0 && (!biggestDumper || m.deltaPct < biggestDumper.deltaPct)) {
      biggestDumper = m;
    }
  }

  return {
    moves,
    netFlow: round(netFlow),
    biggestAccumulator,
    biggestDumper,
  };
}

// Walk one symbol's snapshot timeline (the array stored under a symbol key in holder-history.json),
// diffing each consecutive pair of `whales` arrays. Returns a chronological log:
//   [{ from, to, fromIndex, toIndex, ...whaleMoves(...) }]
// `from`/`to` are the snapshots' timestamps when present (else null). Soft-fail: <2 snapshots → [].
export function diffSnapshots(historyArray, opts = {}) {
  if (!Array.isArray(historyArray) || historyArray.length < 2) return [];
  const log = [];
  for (let i = 1; i < historyArray.length; i++) {
    const prevSnap = historyArray[i - 1] || {};
    const currSnap = historyArray[i] || {};
    const prevWhales = Array.isArray(prevSnap.whales) ? prevSnap.whales : [];
    const currWhales = Array.isArray(currSnap.whales) ? currSnap.whales : [];
    const diff = whaleMoves(prevWhales, currWhales, opts);
    log.push({
      from: typeof prevSnap.timestamp === 'string' ? prevSnap.timestamp : null,
      to: typeof currSnap.timestamp === 'string' ? currSnap.timestamp : null,
      fromIndex: i - 1,
      toIndex: i,
      ...diff,
    });
  }
  return log;
}

// ── CLI demo (guarded) ───────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('whale-movements.mjs')) {
  const here = dirname(fileURLToPath(import.meta.url));
  let data = {};
  try {
    data = JSON.parse(readFileSync(join(here, '..', 'holder-history.json'), 'utf8'));
  } catch (e) {
    console.log('whale-movements demo — could not read holder-history.json:', e.message);
  }
  console.log('Whale-movements (pure snapshot diff)\n' + '─'.repeat(64));
  for (const [symbol, snaps] of Object.entries(data)) {
    if (!Array.isArray(snaps) || snaps.length < 2) {
      console.log(`\n${symbol}: need ≥2 snapshots to diff (have ${Array.isArray(snaps) ? snaps.length : 0})`);
      continue;
    }
    // Diff the FIRST two snapshots of this symbol.
    const a = snaps[0], b = snaps[1];
    const { moves, netFlow, biggestAccumulator, biggestDumper } = whaleMoves(a.whales, b.whales);
    console.log(`\n${symbol}: ${a.timestamp || '(t0)'} → ${b.timestamp || '(t1)'}`);
    console.log(`  netFlow ${netFlow >= 0 ? '+' : ''}${netFlow}% of supply across ${moves.length} move(s)`);
    if (biggestAccumulator) {
      console.log(`  top accumulator: ${biggestAccumulator.account} +${biggestAccumulator.deltaPct}% (${biggestAccumulator.kind})`);
    }
    if (biggestDumper) {
      console.log(`  top dumper:      ${biggestDumper.account} ${biggestDumper.deltaPct}% (${biggestDumper.kind})`);
    }
    for (const m of moves.slice(0, 8)) {
      const sign = m.deltaPct >= 0 ? '+' : '';
      console.log(`    ${m.kind.padEnd(11)} ${m.account.padEnd(18)} ${sign}${m.deltaPct}%  (Δtotal ${m.deltaTotal})`);
    }
  }
  console.log('\n→ ACCUMULATED/DUMPED = surviving whale gained/lost share; NEW_WHALE/EXITED = entered/left the set.');
}
