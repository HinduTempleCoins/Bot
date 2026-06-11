// dry-run-ledger.mjs — pure in-memory ledger of INTENDED trades that are NEVER executed (queue #0e4909e42b).
//
// This is the backbone of the queue's "Dry run mode for safe testing": a strategy can record every
// order it WOULD place, with full HIVE math + per-symbol netting, so it can be validated entirely
// offline before a single real order is ever broadcast. Nothing here touches the chain, the signer,
// or the network — every recorded entry carries `dryRun: true` and `hive: price * amount`.
//
// Distinct from its siblings:
//   • profit-tracker.mjs  — REALIZED P&L from actual fills (FIFO lot matching).
//   • budget-manager.mjs  — live spend-cap enforcement.
//   • dry-run-ledger.mjs  — intended (never-executed) orders for offline strategy validation.
//
// API (object-passing — each ledger is an independent value, no module-level state):
//   createLedger()                                   -> ledger
//   record(ledger, {ts, symbol, side, price, amount, note}) -> entry | null   (null = invalid, skipped)
//   entries(ledger)                                  -> entry[]
//   totals(ledger)                                   -> {buys:{count,hive}, sells:{count,hive}, netHive}
//   bySymbol(ledger)                                 -> {SYMBOL:{buys,sells,netHive}}
//   wouldExceedBudget(ledger, {dailyCapHive, ts})    -> boolean   (day-bucket of the given ts)
//   reset(ledger)                                    -> ledger
//   renderReport(ledger)                             -> markdown, banner "DRY RUN — no orders placed"
//
// Design rules: soft-fail (invalid entries return null, never throw), no I/O, no network, zero WIF.
//
//   node integrations/dry-run-ledger.mjs    # demo: record a few intended trades + print the report

// Minimal HTML/markdown-cell escaper for any interpolated free text (e.g. note, symbol).
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\|/g, '\\|'); // keep stray pipes from breaking markdown table cells
}

// A ledger is just a holder around an append-only array. Independent per createLedger().
export function createLedger() {
  return { entries: [] };
}

// UTC day-key bucket (YYYY-MM-DD) for the daily-cap check. Falls back to "unknown" on bad ts.
function dayKey(ts) {
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 10);
}

// Normalize + validate one intended-trade entry. Returns the canonical entry, or null if invalid.
function normalize(e) {
  if (!e || typeof e !== 'object') return null;
  const side = String(e.side || '').toLowerCase();
  if (side !== 'buy' && side !== 'sell') return null;
  const symbol = String(e.symbol || '').trim();
  if (!symbol) return null;
  const price = Number(e.price);
  const amount = Number(e.amount);
  if (!Number.isFinite(price) || !(price >= 0)) return null;
  if (!Number.isFinite(amount) || !(amount > 0)) return null;
  const ts = Number(e.ts);
  return {
    ts: Number.isFinite(ts) ? ts : Date.now(),
    symbol,
    side,
    price,
    amount,
    note: e.note == null ? '' : String(e.note),
    hive: price * amount,
    dryRun: true,
  };
}

// Append one intended trade. Invalid input is skipped (returns null) and nothing is recorded.
export function record(ledger, entry) {
  if (!ledger || !Array.isArray(ledger.entries)) return null;
  const row = normalize(entry);
  if (!row) return null;
  ledger.entries.push(row);
  return row;
}

// Snapshot copy of the recorded entries.
export function entries(ledger) {
  if (!ledger || !Array.isArray(ledger.entries)) return [];
  return ledger.entries.slice();
}

// Aggregate HIVE notionals: buy/sell counts + HIVE, and net (buys − sells).
export function totals(ledger) {
  const rows = entries(ledger);
  const buys = { count: 0, hive: 0 };
  const sells = { count: 0, hive: 0 };
  for (const r of rows) {
    if (r.side === 'buy') { buys.count++; buys.hive += r.hive; }
    else { sells.count++; sells.hive += r.hive; }
  }
  return { buys, sells, netHive: buys.hive - sells.hive };
}

// Per-symbol breakdown: { SYMBOL: { buys: hive, sells: hive, netHive } }.
export function bySymbol(ledger) {
  const rows = entries(ledger);
  const out = {};
  for (const r of rows) {
    const s = (out[r.symbol] ||= { buys: 0, sells: 0, netHive: 0 });
    if (r.side === 'buy') s.buys += r.hive;
    else s.sells += r.hive;
  }
  for (const s of Object.values(out)) s.netHive = s.buys - s.sells;
  return out;
}

// Would the BUY notional on the same UTC day as `ts` exceed `dailyCapHive`?
// Counts only the day-bucket the given ts lands in; sells don't consume the buy cap.
export function wouldExceedBudget(ledger, { dailyCapHive, ts } = {}) {
  const cap = Number(dailyCapHive);
  if (!Number.isFinite(cap) || cap < 0) return false; // no/invalid cap → never blocks
  const key = dayKey(ts ?? Date.now());
  let spent = 0;
  for (const r of entries(ledger)) {
    if (r.side === 'buy' && dayKey(r.ts) === key) spent += r.hive;
  }
  return spent > cap;
}

// Empty the ledger in place. Returns the ledger for chaining.
export function reset(ledger) {
  if (ledger && Array.isArray(ledger.entries)) ledger.entries.length = 0;
  return ledger;
}

// Markdown summary, prominently marked as a dry run with no orders placed.
export function renderReport(ledger) {
  const rows = entries(ledger);
  const t = totals(ledger);
  const per = bySymbol(ledger);
  const lines = [];
  lines.push('# Dry-run trade ledger');
  lines.push('');
  lines.push('> **DRY RUN — no orders placed.** Intended trades only; nothing was broadcast or executed.');
  lines.push('');
  lines.push(`- Intended trades: **${rows.length}**`);
  lines.push(`- Buys: ${t.buys.count} (${t.buys.hive.toFixed(4)} HIVE)`);
  lines.push(`- Sells: ${t.sells.count} (${t.sells.hive.toFixed(4)} HIVE)`);
  lines.push(`- Net (buys − sells): ${t.netHive.toFixed(4)} HIVE`);
  lines.push('');
  const symbols = Object.keys(per);
  if (symbols.length) {
    lines.push('| Symbol | Buys (HIVE) | Sells (HIVE) | Net (HIVE) |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const sym of symbols.sort()) {
      const s = per[sym];
      lines.push(`| ${esc(sym)} | ${s.buys.toFixed(4)} | ${s.sells.toFixed(4)} | ${s.netHive.toFixed(4)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// --- CLI ------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('dry-run-ledger.mjs')) {
  const led = createLedger();
  const t0 = Date.parse('2026-06-11T09:00:00Z');
  record(led, { ts: t0, symbol: 'SWAP.DOGE', side: 'buy', price: 0.04, amount: 1000, note: 'entry signal' });
  record(led, { ts: t0 + 3600e3, symbol: 'SWAP.DOGE', side: 'sell', price: 0.05, amount: 600, note: 'partial exit' });
  record(led, { ts: t0 + 7200e3, symbol: 'SWAP.LTC', side: 'buy', price: 60, amount: 2 });
  record(led, { symbol: 'SWAP.LTC', side: 'wat', price: 1, amount: 1 }); // invalid → skipped
  console.log(renderReport(led));
  console.log('\n(would exceed 20 HIVE/day cap on day 0?', wouldExceedBudget(led, { dailyCapHive: 20, ts: t0 }), ')');
}
