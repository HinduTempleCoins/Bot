// tipbot.mjs — onboarding tip-bot faucet (queue #141), Pizza-Bot pattern.
//
// PURE logic + DRY-RUN only. This module performs NO real chain ops and holds NO keys.
// It decides WHO is eligible for an onboarding tip, HOW MUCH, and produces a tip INTENT.
// Actually broadcasting a transfer/burn is someone else's job (MELEK-Signer, scoped token),
// handed in as a `sign` callback to execute(). When no signer is provided, execute() returns
// a {simulated:true} result and touches nothing.
//
// Design (per brief):
//   • STAKE-GATED  — eligibility requires a minimum stake AND a minimum account age,
//                    plus a per-user cooldown and a faucet-wide daily cap. This is what
//                    keeps a faucet from being a sybil/airdrop drain.
//   • BURN SINK    — a fixed fraction of every tip is burned (sent to a burn account),
//                    so the faucet is mildly deflationary rather than pure emission.
//
// ┌───────────────────────────────────────────────────────────────────────────────────────┐
// │ CRITICAL INVARIANT: TIPS ARE FIREWALLED FROM THE CLARITY SCORE.                         │
// │ Tipping (sending, receiving, amount, eligibility) must NEVER read from or write to the   │
// │ SoapBox Clarity Score, and Clarity must never be an input to any function here. A tip is  │
// │ a faucet reward for onboarding, not a signal of quality. Mixing the two would let people  │
// │ buy/farm Clarity via tips. There is therefore NO clarity import in this file — by         │
// │ construction. assertClarityFirewall() exists so the test suite can pin that promise.      │
// └───────────────────────────────────────────────────────────────────────────────────────┘
//
//   import { eligible, tipAmount, planTip, execute, DEFAULT_RULES } from './tipbot.mjs'
//   node integrations/tipbot.mjs            # dry-run demo (no chain ops, no keys)

// ---- rules ----------------------------------------------------------------------------

export const DEFAULT_RULES = {
  base: 5.0,            // base tip size, in MELEK
  symbol: 'MELEK',
  minStake: 10.0,       // stake gate: vesting/staked balance floor
  minAgeDays: 1,        // account-age gate (anti-sybil)
  cooldownHours: 24,    // min gap between tips to the SAME user
  dailyCap: 500.0,      // faucet-wide budget per UTC day (tip+burn counts against it)
  burnFraction: 0.10,   // 10% of each tip is burned to the sink
  burnTo: 'null',       // burn account (Graphene "@null"); never a key, just a name
  maxTipsPerUser: 6,    // onboarding is finite — stop after N lifetime tips
};

// ---- pure helpers ---------------------------------------------------------------------

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

function num(x, dflt = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

// Clarity firewall pin: there is no clarity dependency in this module, by construction.
// The test suite calls this to assert the promise holds.
export function assertClarityFirewall(rules = {}) {
  for (const k of Object.keys(rules || {})) {
    if (/clarity/i.test(k)) {
      throw new Error(`clarity firewall violated: rules key "${k}" references Clarity`);
    }
  }
  return true;
}

// eligible(user, rules) — PURE. Returns { ok, reasons } (reasons empty when ok).
// `now` is injectable for deterministic tests.
export function eligible(user = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const r = { ...DEFAULT_RULES, ...rules };
  const reasons = [];

  const stake = num(user.stake);
  if (stake < r.minStake) reasons.push(`stake ${stake} < minStake ${r.minStake}`);

  const ageDays = num(user.accountAgeDays, computeAgeDays(user, now));
  if (ageDays < r.minAgeDays) reasons.push(`age ${ageDays.toFixed(2)}d < minAgeDays ${r.minAgeDays}`);

  const since = lastTipAgoHours(user, now);
  if (since !== null && since < r.cooldownHours) {
    reasons.push(`cooldown: last tip ${since.toFixed(2)}h ago < ${r.cooldownHours}h`);
  }

  const count = num(user.tipsReceived);
  if (count >= r.maxTipsPerUser) reasons.push(`tipsReceived ${count} >= maxTipsPerUser ${r.maxTipsPerUser}`);

  // faucet-wide daily budget (caller supplies how much already spent this UTC day)
  const spent = num(rules.spentToday ?? user.spentToday);
  if (spent >= r.dailyCap) reasons.push(`dailyCap reached: spentToday ${spent} >= ${r.dailyCap}`);

  return { ok: reasons.length === 0, reasons };
}

function computeAgeDays(user, now) {
  if (user.createdAt != null) {
    const t = typeof user.createdAt === 'number' ? user.createdAt : Date.parse(user.createdAt);
    if (Number.isFinite(t)) return Math.max(0, (now - t) / DAY_MS);
  }
  return 0;
}

function lastTipAgoHours(user, now) {
  if (user.lastTipAt == null) return null;
  const t = typeof user.lastTipAt === 'number' ? user.lastTipAt : Date.parse(user.lastTipAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / HOUR_MS);
}

// tipAmount(user, rules) — PURE. Base tip, mildly tapered as a user gets more tips (onboarding
// curve), clamped so a tip never exceeds the remaining daily budget. NEVER reads Clarity.
export function tipAmount(user = {}, rules = DEFAULT_RULES) {
  const r = { ...DEFAULT_RULES, ...rules };
  const count = Math.max(0, num(user.tipsReceived));
  // taper: 1st tip full base, each subsequent tip 85% of the previous (bounded floor at 25%).
  const taper = Math.max(0.25, Math.pow(0.85, count));
  let amt = r.base * taper;

  // never exceed remaining daily budget
  const spent = num(rules.spentToday ?? user.spentToday);
  const remaining = Math.max(0, r.dailyCap - spent);
  amt = Math.min(amt, remaining);

  return round3(Math.max(0, amt));
}

function round3(n) { return Math.round(n * 1000) / 1000; }

// planTip(user, rules) — returns a tip INTENT { tip, burn, to, ... }. The `tip` is what the
// recipient receives; `burn` is sent to the burn sink on top (so faucet outlay = tip + burn).
// If the user isn't eligible or the amount rounds to 0, returns an intent with skipped:true.
export function planTip(user = {}, rules = DEFAULT_RULES, now = Date.now()) {
  const r = { ...DEFAULT_RULES, ...rules };
  const elig = eligible(user, r, now);
  const tip = tipAmount(user, r);
  const burn = round3(tip * r.burnFraction);

  const skipped = !elig.ok || tip <= 0;
  return {
    kind: 'onboarding_tip',
    to: user.name ?? user.account ?? null,
    tip,
    burn,
    burnTo: r.burnTo,
    symbol: r.symbol,
    total: round3(tip + burn),
    skipped,
    reasons: elig.ok ? (tip <= 0 ? ['tip amount is 0'] : []) : elig.reasons,
    // explicit, load-bearing marker that this intent is Clarity-independent:
    clarityFirewalled: true,
  };
}

// execute(intent, { sign }) — DRY-RUN by default. With no `sign` callback this performs NO
// chain ops and returns { simulated:true }. A real signer (MELEK-Signer via scoped token) is
// injected by the caller; this module never holds or sees a private key.
export async function execute(intent, opts = {}) {
  const { sign } = opts;

  if (!intent || intent.skipped) {
    return { ok: false, simulated: true, skipped: true, reasons: intent?.reasons ?? ['no intent'] };
  }

  // Build the two standard Graphene transfers (tip + burn). No keys, no broadcast here.
  const ops = [
    { type: 'transfer', to: intent.to, amount: intent.tip, symbol: intent.symbol, memo: 'MELEK onboarding tip' },
  ];
  if (intent.burn > 0) {
    ops.push({ type: 'transfer', to: intent.burnTo, amount: intent.burn, symbol: intent.symbol, memo: 'tip burn sink' });
  }

  if (typeof sign !== 'function') {
    return { ok: true, simulated: true, ops, total: intent.total };
  }

  // Real path: hand the ops to the injected signer. Still no key in THIS module.
  const result = await sign(ops);
  return { ok: true, simulated: false, ops, result, total: intent.total };
}

// ---- CLI: dry-run demo (no chain ops, no keys) ---------------------------------------

if (process.argv[1] && process.argv[1].endsWith('tipbot.mjs')) {
  const now = Date.now();
  const sample = [
    { name: 'newbie', stake: 25, accountAgeDays: 3, tipsReceived: 0 },
    { name: 'fresh', stake: 25, accountAgeDays: 0.2, tipsReceived: 0 },        // too new
    { name: 'pauper', stake: 2, accountAgeDays: 10, tipsReceived: 0 },          // under stake gate
    { name: 'serial', stake: 50, accountAgeDays: 30, tipsReceived: 0, lastTipAt: now - 2 * HOUR_MS }, // cooldown
    { name: 'graduate', stake: 100, accountAgeDays: 100, tipsReceived: 6 },     // maxed out
  ];
  console.log('tipbot dry-run demo (NO chain ops, NO keys) — Clarity firewalled\n');
  for (const u of sample) {
    const intent = planTip(u, DEFAULT_RULES, now);
    const res = await execute(intent); // dry-run (no signer)
    console.log(
      `${u.name.padEnd(9)} skipped=${String(intent.skipped).padEnd(5)} ` +
      `tip=${intent.tip} burn=${intent.burn} -> ${intent.to ?? '∅'}  ` +
      `simulated=${res.simulated}` +
      (intent.skipped ? `  (${intent.reasons.join('; ')})` : '')
    );
  }
}
