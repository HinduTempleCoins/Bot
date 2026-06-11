// budget-manager.mjs — Daily budget cap + spend tracker for the trade bots (queue #133/137/138).
//
// PURE, no-IO, stateful ledger. Holds NO keys, performs NO chain ops, never broadcasts.
// It tracks how much HIVE a bot has "spent" within the current UTC-offset day, enforces a
// daily cap and an optional per-trade max, and rolls over at local midnight derived from
// ts + timezoneOffsetH. A DRY-RUN tally is kept entirely separate from the live tally, so
// test/simulation runs never consume the real budget.
//
//   import { createBudget, record, check, remaining, summary } from './budget-manager.mjs'
//
//   const led = createBudget({ dailyCapHive: 35 });
//   check(led, { amountHive: 10, ts: Date.now() });   // { allowed, reason, remaining }
//   record(led, { amountHive: 10, ts: Date.now() });   // { ok, reason, remaining, spentToday }
//
// Design notes:
//   • Soft-fail: bad input returns { ok:false, reason } / { allowed:false, reason }. NEVER throws.
//   • "Day" = the calendar day in the operator's chosen UTC offset. dayKey derived from
//     floor((ts + offsetMs) / DAY_MS); when the key changes, the live + dry tallies reset.
//   • dryRun records into a parallel shadow ledger keyed the same way; check/record with
//     dryRun:true read/write only the shadow side. The live cap is unaffected.
//   • Stateful: the ledger object carries its own day/spend state. It is the single source of
//     truth — callers do not pass spentToday in (that is spend-gate.mjs's stateless model).

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isPosCapNum = (n) => typeof n === 'number' && n > 0 && (Number.isFinite(n) || n === Infinity);
const isValidTs = (t) => typeof t === 'number' && Number.isFinite(t);

// Calendar-day key in the configured UTC offset. Returns null on bad ts.
export function dayKeyOf(ts, timezoneOffsetH = 0) {
  if (!isValidTs(ts)) return null;
  const offsetMs = (isFiniteNum(timezoneOffsetH) ? timezoneOffsetH : 0) * HOUR_MS;
  return Math.floor((ts + offsetMs) / DAY_MS);
}

// Create a fresh ledger. Invalid options fall back to safe defaults.
export function createBudget(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const dailyCapHive = isPosCapNum(o.dailyCapHive) ? o.dailyCapHive : 35;
  const perTradeMaxHive = isPosCapNum(o.perTradeMaxHive) ? o.perTradeMaxHive : Infinity;
  const timezoneOffsetH = isFiniteNum(o.timezoneOffsetH) ? o.timezoneOffsetH : 0;
  return {
    dailyCapHive,
    perTradeMaxHive,
    timezoneOffsetH,
    // live tally
    dayKey: null,
    spentToday: 0,
    tradeCount: 0,
    // shadow (dry-run) tally — never affects the live cap
    dryDayKey: null,
    drySpentToday: 0,
    dryTradeCount: 0,
  };
}

// Roll the live tally over if ts lands on a new day. Returns the day key, or null if ts bad.
function rolloverLive(ledger, ts) {
  const key = dayKeyOf(ts, ledger.timezoneOffsetH);
  if (key === null) return null;
  if (ledger.dayKey !== key) {
    ledger.dayKey = key;
    ledger.spentToday = 0;
    ledger.tradeCount = 0;
  }
  return key;
}

// Roll the shadow tally over independently.
function rolloverDry(ledger, ts) {
  const key = dayKeyOf(ts, ledger.timezoneOffsetH);
  if (key === null) return null;
  if (ledger.dryDayKey !== key) {
    ledger.dryDayKey = key;
    ledger.drySpentToday = 0;
    ledger.dryTradeCount = 0;
  }
  return key;
}

// HIVE left in the current day for the live side (clamped at 0). Bad input => full cap.
export function remaining(ledger, ts) {
  if (!ledger || typeof ledger !== 'object') return 0;
  const cap = isPosCapNum(ledger.dailyCapHive) ? ledger.dailyCapHive : 35;
  const key = dayKeyOf(ts, ledger.timezoneOffsetH);
  // If ts is bad or it is a new (not-yet-recorded) day, the full cap is available.
  if (key === null || ledger.dayKey !== key) return cap;
  return Math.max(0, cap - ledger.spentToday);
}

// Would this trade be allowed right now? Pure read — touches no state.
// Rejects: bad ledger/ts, amount<=0, amount>perTradeMax, spentToday+amount>dailyCap.
export function check(ledger, { amountHive, ts } = {}) {
  if (!ledger || typeof ledger !== 'object') {
    return { allowed: false, reason: 'bad-ledger', remaining: 0 };
  }
  if (!isValidTs(ts)) {
    return { allowed: false, reason: 'bad-ts', remaining: remaining(ledger, ts) };
  }
  if (!isFiniteNum(amountHive) || amountHive <= 0) {
    return { allowed: false, reason: 'bad-amount', remaining: remaining(ledger, ts) };
  }
  const rem = remaining(ledger, ts);
  if (amountHive > ledger.perTradeMaxHive) {
    return { allowed: false, reason: 'per-trade-exceeded', remaining: rem };
  }
  if (amountHive > rem) {
    return { allowed: false, reason: 'daily-cap-exceeded', remaining: rem };
  }
  return { allowed: true, reason: 'ok', remaining: rem };
}

// Record a spend. dryRun routes into the shadow tally only.
// Returns { ok, reason, remaining, spentToday }. Never throws.
export function record(ledger, { amountHive, ts, dryRun = false } = {}) {
  if (!ledger || typeof ledger !== 'object') {
    return { ok: false, reason: 'bad-ledger', remaining: 0, spentToday: 0 };
  }
  if (!isValidTs(ts)) {
    return { ok: false, reason: 'bad-ts', remaining: remaining(ledger, ts), spentToday: ledger.spentToday };
  }
  if (!isFiniteNum(amountHive) || amountHive <= 0) {
    return {
      ok: false,
      reason: 'bad-amount',
      remaining: remaining(ledger, ts),
      spentToday: dryRun ? ledger.drySpentToday : ledger.spentToday,
    };
  }

  if (dryRun) {
    rolloverDry(ledger, ts);
    if (amountHive > ledger.perTradeMaxHive) {
      return {
        ok: false,
        reason: 'per-trade-exceeded',
        remaining: Math.max(0, ledger.dailyCapHive - ledger.drySpentToday),
        spentToday: ledger.drySpentToday,
      };
    }
    if (ledger.drySpentToday + amountHive > ledger.dailyCapHive) {
      return {
        ok: false,
        reason: 'daily-cap-exceeded',
        remaining: Math.max(0, ledger.dailyCapHive - ledger.drySpentToday),
        spentToday: ledger.drySpentToday,
      };
    }
    ledger.drySpentToday += amountHive;
    ledger.dryTradeCount += 1;
    return {
      ok: true,
      reason: 'ok-dry',
      remaining: Math.max(0, ledger.dailyCapHive - ledger.drySpentToday),
      spentToday: ledger.drySpentToday,
    };
  }

  // live path
  rolloverLive(ledger, ts);
  const decision = check(ledger, { amountHive, ts });
  if (!decision.allowed) {
    return { ok: false, reason: decision.reason, remaining: decision.remaining, spentToday: ledger.spentToday };
  }
  ledger.spentToday += amountHive;
  ledger.tradeCount += 1;
  return {
    ok: true,
    reason: 'ok',
    remaining: Math.max(0, ledger.dailyCapHive - ledger.spentToday),
    spentToday: ledger.spentToday,
  };
}

// Snapshot of the live day. dryRun:true on the shadow tally is reported via `dryRun` block.
export function summary(ledger, ts) {
  if (!ledger || typeof ledger !== 'object') {
    return { spentToday: 0, remaining: 0, dailyCap: 0, tradeCount: 0, dryRun: { spentToday: 0, tradeCount: 0 } };
  }
  const key = dayKeyOf(ts, ledger.timezoneOffsetH);
  const liveSameDay = key !== null && ledger.dayKey === key;
  const drySameDay = key !== null && ledger.dryDayKey === key;
  const spentToday = liveSameDay ? ledger.spentToday : 0;
  const tradeCount = liveSameDay ? ledger.tradeCount : 0;
  const drySpent = drySameDay ? ledger.drySpentToday : 0;
  const dryTrades = drySameDay ? ledger.dryTradeCount : 0;
  return {
    spentToday,
    remaining: remaining(ledger, ts),
    dailyCap: ledger.dailyCapHive,
    tradeCount,
    dryRun: { spentToday: drySpent, tradeCount: dryTrades },
  };
}

// --- CLI demo (guarded) ----------------------------------------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const now = Date.UTC(2026, 5, 11, 12, 0, 0);
  const led = createBudget({ dailyCapHive: 35, perTradeMaxHive: 20 });
  const lines = [];
  const log = (label, obj) => lines.push(`${esc(label)}: ${esc(JSON.stringify(obj))}`);

  log('check 10', check(led, { amountHive: 10, ts: now }));
  log('record 10', record(led, { amountHive: 10, ts: now }));
  log('record 30 (over cap)', record(led, { amountHive: 30, ts: now }));
  log('record 25 (over per-trade)', record(led, { amountHive: 25, ts: now }));
  log('dry record 30', record(led, { amountHive: 30, ts: now, dryRun: true }));
  log('summary', summary(led, now));
  log('next day remaining', remaining(led, now + DAY_MS));

  for (const l of lines) console.log(l);
}
