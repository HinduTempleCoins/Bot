// send-ledger — how many messages this mailbox has actually sent, and on which day.
//
// WHY. `compliance.warmupCap()` and `compliance.perInboxCap()` say a mailbox that has never cold-sent
// may send 10 on its first day, climbing to 50 over four weeks. Both have been written, tested and
// documented since the module was created, and both were called exactly zero times outside their own
// tests and `batch-runner.rampSchedule()` — which prints the schedule and is itself called by nothing.
//
// A ramp nobody applies is a diagram of a ramp. The live route has no per-day cap at all: 218 leads,
// 218 buttons, and a Gmail mailbox that has never cold-sent doing all of them in an afternoon. Gmail
// itself would rate-limit some of it; the reputation damage does not need the rest of them to land.
//
// A cap needs a count, and a count needs somewhere to live. That is this file: one JSON blob, per
// mailbox, injectable fs and clock, soft-fail-never-throw, the same discipline as crm/model.mjs.
// It records what happened. It decides nothing and it sends nothing.
//
//   import { recordSend, ledgerFor, capFor } from './send-ledger.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { perInboxCap, warmupCap } from './compliance.mjs';

const env = (k, d = '') => ((typeof process !== 'undefined' && process.env && process.env[k]) || d);
export const DATA_FILE = () => env('HERALD_LEDGER_DATA', join(process.cwd(), 'data', 'herald-send-ledger.json'));

const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** The day a timestamp falls in, as a whole number of UTC days. Day boundaries are UTC on purpose:
 *  a cap that resets at the operator's local midnight resets twice a year, and once in the wrong
 *  direction. */
export const dayIndex = (t) => Math.floor(num(t, 0) / 86400000);

const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch { /* soft-fail */ } try { writeFileSync(p, s); } catch { /* soft-fail */ } },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { inboxes: {} };
  try { const o = JSON.parse(raw); return o && o.inboxes ? o : { inboxes: {} }; } catch { return { inboxes: {} }; }
}
const saveStore = (fs, file, s) => { (fs.write || realFs.write)(file, JSON.stringify(s)); };
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE(), now: o.now != null ? o.now : Date.now() });

const blank = () => ({ firstDay: null, day: null, today: 0, sent: 0, bounces: 0, complaints: 0 });

/**
 * What this mailbox has done, and what it may still do today.
 *
 * `warmupDay` is days since the FIRST send, not days since the account existed — a mailbox that sat
 * idle for a month did not warm up while it sat there.
 */
export function ledgerFor(account, opts = {}) {
  const { fs, file, now } = ctx(opts);
  const rec = loadStore(fs, file).inboxes[acct(account)] || blank();
  const today = dayIndex(now);
  const sentToday = rec.day === today ? num(rec.today) : 0;      // a new day is a fresh count
  const warmupDay = rec.firstDay == null ? 0 : Math.max(0, today - num(rec.firstDay));
  const established = String(env('HERALD_INBOX_ESTABLISHED', '')) === '1';
  const cap = perInboxCap({ warmupDay, established });
  return {
    account: acct(account),
    sent: num(rec.sent), bounces: num(rec.bounces), complaints: num(rec.complaints),
    sentToday, warmupDay, established, cap,
    remainingToday: Math.max(0, cap - sentToday),
    firstDay: rec.firstDay,
  };
}

/**
 * Record one attempt. `ok` counts against today's cap; a bounce or a complaint feeds
 * `deliverabilityHealth()` through the gate.
 *
 * A FAILED send still counts. That is deliberate: a message the provider refused was still an
 * attempt against a cap that exists to keep the sending pattern human, and a caller that retried a
 * hundred failures would otherwise ramp nothing while looking like it had.
 */
export function recordSend(account, { ok = true, bounced = false, complained = false } = {}, opts = {}) {
  const { fs, file, now } = ctx(opts);
  const a = acct(account);
  if (!a) return { ok: false, reason: 'account required' };
  try {
    const store = loadStore(fs, file);
    const rec = store.inboxes[a] || blank();
    const today = dayIndex(now);
    if (rec.firstDay == null) rec.firstDay = today;
    if (rec.day !== today) { rec.day = today; rec.today = 0; }
    rec.today = num(rec.today) + 1;
    rec.sent = num(rec.sent) + 1;
    if (bounced) rec.bounces = num(rec.bounces) + 1;
    if (complained) rec.complaints = num(rec.complaints) + 1;
    store.inboxes[a] = rec;
    saveStore(fs, file, store);
    return { ok: true, ledger: ledgerFor(a, opts), counted: true, attemptSucceeded: !!ok };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || 'ledger write failed') };
  }
}

/** Today's ceiling for this mailbox. A ceiling, never a target. */
export const capFor = (account, opts = {}) => ledgerFor(account, opts).cap;

/** The whole ramp, so the operator sees the schedule before starting rather than after. */
export function schedule(days = 28) {
  const out = []; let total = 0;
  for (let d = 0; d < Math.max(1, num(days, 28)); d += 1) {
    const c = warmupCap(d); total += c;
    out.push({ day: d + 1, cap: c, cumulative: total });
  }
  return out;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'herald-send-ledger',
    schedule: schedule(28),
    note: 'per-mailbox daily counts, so compliance.perInboxCap() has something to compare against. '
        + 'Day one is 10. 218 leads is three weeks of ramp, not an afternoon.',
  }, null, 2));
}

export default { ledgerFor, recordSend, capFor, schedule, dayIndex, DATA_FILE, handler };

if (process.argv[1] && process.argv[1].endsWith('send-ledger.mjs')) {
  console.log(JSON.stringify({ schedule: schedule(Number(process.argv[2]) || 28) }, null, 1));
}
