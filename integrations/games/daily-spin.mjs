// daily-spin.mjs — the free daily-spin wheel + non-cashable PLAY-points claim ledger.
// Off-chain, Bot-repo. PURE logic + an injectable store; no clock in the pure path (pass `today`
// and seeds in). Mirrors the house pattern of integrations/games/arcade.mjs.
//
//   import { spinResult, canSpin, streakBonus, makeStore, claim, pointsBalance, renderWheel } from './daily-spin.mjs'
//   node integrations/games/daily-spin.mjs      # tiny self-demo
//
// ── WHY THIS SHAPE (compliance — bake it in, don't bolt it on) ────────────────────────────────────
// From the unified-earn-economy design + .local/RESEARCH_ATTENTION_ECONOMY.md, the research's clear
// conclusion: award NON-CASHABLE, FIXED-VALUE internal PLAY points, NOT a tradeable token. A cashable
// or floating token drags the whole thing across the gambling line and invites the BAT / STEPN-GST
// "reflexive death spiral". Fixed internal points that can never be withdrawn for cash keep the daily
// spin on the sweepstakes / AMOE (Alternative Means Of Entry) side of the line:
//   • FREE — no purchase, no wager, no stake is ever required to spin.
//   • ONE free spin per UTC day per account (the AMOE cadence).
//   • The prize is PLAY points only — non-cashable, fixed-value, internal. There is deliberately NO
//     withdraw / redeem-for-cash / transfer path in this module. (Verified by a test.)
//   • The draw is PROVABLY FAIR: deterministic HMAC(serverSeed, account:daySeed:nonce), so any player
//     can recompute their segment and confirm the house didn't tilt the wheel.
// If PLAY points are ever spent (arcade entries, cosmetics), that's a one-way sink, still non-cashable.

import { createHmac, randomUUID } from 'node:crypto';

// ── the server seed (provably-fair commitment). In production this is a per-epoch committed secret;
// here it's injectable + defaults to an env value so the pure draw stays deterministic and testable.
let _serverSeed = process.env.SPIN_SERVER_SEED || 'melek-daily-spin-v1';
export function __setServerSeed(s) { _serverSeed = s || 'melek-daily-spin-v1'; }
export function serverSeed() { return _serverSeed; }

// ── the prize table. Fixed PLAY-point values, weighted. Weights are integers (a discrete wheel);
// higher-value segments are rarer. Sum of weights = the wheel's resolution. NON-CASHABLE points.
export const PRIZE_TABLE = [
  { segment: 'JACKPOT', points: 500, weight: 1 },
  { segment: 'BIG',     points: 200, weight: 4 },
  { segment: 'GOOD',    points: 100, weight: 10 },
  { segment: 'FAIR',    points: 50,  weight: 20 },
  { segment: 'SMALL',   points: 25,  weight: 30 },
  { segment: 'TINY',    points: 10,  weight: 35 },
];
export const TOTAL_WEIGHT = PRIZE_TABLE.reduce((a, s) => a + s.weight, 0);

// ── provably-fair draw ────────────────────────────────────────────────────────────────────────────
// A 52-bit unsigned int from HMAC-SHA256(serverSeed, "account:daySeed:nonce"). Deterministic: same
// inputs → same output, so a player can recompute and verify. Not a security RNG — a fair public draw.
export function drawFloat({ account, daySeed, nonce = 0 } = {}) {
  const msg = `${String(account || '')}:${String(daySeed || '')}:${String(nonce)}`;
  const hex = createHmac('sha256', _serverSeed).update(msg).digest('hex').slice(0, 13); // 52 bits
  const int = parseInt(hex, 16);
  return int / 0x10000000000000; // 2^52 → [0,1)
}

// spinResult({account, daySeed, nonce}) -> { segment, points, roll, verify }
// PURE + deterministic. `roll` is the integer wheel position [0,TOTAL_WEIGHT); `verify` echoes the
// exact HMAC message so a client can independently recompute the same segment.
export function spinResult({ account, daySeed, nonce = 0 } = {}) {
  const f = drawFloat({ account, daySeed, nonce });
  let roll = Math.floor(f * TOTAL_WEIGHT);
  if (roll >= TOTAL_WEIGHT) roll = TOTAL_WEIGHT - 1; // guard the f→1 edge
  let acc = 0;
  let hit = PRIZE_TABLE[PRIZE_TABLE.length - 1];
  for (const seg of PRIZE_TABLE) {
    acc += seg.weight;
    if (roll < acc) { hit = seg; break; }
  }
  return {
    segment: hit.segment,
    points: hit.points,
    roll,
    verify: { account: String(account || ''), daySeed: String(daySeed || ''), nonce, totalWeight: TOTAL_WEIGHT },
  };
}

// ── cadence: one free spin per UTC day ──────────────────────────────────────────────────────────
// `today` / `lastSpinDay` are UTC date strings 'YYYY-MM-DD' — the caller supplies them (no Date.now()
// in the pure path). Never spun before (null/undefined lastSpinDay) → allowed.
export function canSpin({ account, lastSpinDay, today } = {}) {
  if (!account || !today) return false;
  if (!lastSpinDay) return true;
  return String(lastSpinDay) !== String(today);
}

// ── streak: consecutive-day bonus. A small, fixed, non-cashable multiplier-style top-up. Bounded so
// it can't inflate without limit. Day 1 = no bonus; grows to a cap.
export function streakBonus(streakDays) {
  const n = Number(streakDays);
  if (!Number.isFinite(n) || n <= 1) return 0;
  return Math.min(50, (Math.floor(n) - 1) * 5); // +5/day after the first, capped at +50
}

// isConsecutive('2026-08-24','2026-08-25') -> true  (prev is exactly the day before today, UTC)
export function isConsecutive(prevDay, today) {
  if (!prevDay || !today) return false;
  const p = Date.parse(`${prevDay}T00:00:00Z`);
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(p) || !Number.isFinite(t)) return false;
  return t - p === 86_400_000;
}

// ── the ledger store (memory + injectable). Records only { account, points, lastSpinDay, streak }.
// There is deliberately NO withdraw / cashout / transfer method — points are non-cashable by design.
export function makeStore(seed = {}) {
  const rows = new Map();
  for (const [acct, v] of Object.entries(seed)) {
    rows.set(acct, { account: acct, points: 0, lastSpinDay: null, streak: 0, ...v });
  }
  const get = (account) => rows.get(String(account)) || null;
  const ensure = (account) => {
    const a = String(account);
    if (!rows.has(a)) rows.set(a, { account: a, points: 0, lastSpinDay: null, streak: 0 });
    return rows.get(a);
  };
  return {
    get,
    ensure,
    all: () => [...rows.values()].map((r) => ({ ...r })),
    // credit is the ONLY mutation that changes the balance — additive, non-cashable, never negative.
    credit(account, pts, day, streak) {
      const r = ensure(account);
      r.points += Math.max(0, Math.floor(Number(pts) || 0));
      r.lastSpinDay = String(day);
      if (Number.isFinite(streak)) r.streak = streak;
      return { ...r };
    },
  };
}

// ── claim: enforce one-per-day, draw, credit. Soft-fail (never throws) — returns {ok:false, reason}. ─
// claim({account, today, store, daySeed, nonce}) -> { ok, awarded, base, bonus, streak, segment, balance, reason?, verify? }
export function claim({ account, today, store, daySeed, nonce = 0 } = {}) {
  try {
    const acct = String(account || '').trim();
    if (!acct) return { ok: false, awarded: 0, balance: 0, reason: 'account required' };
    if (!today) return { ok: false, awarded: 0, balance: 0, reason: 'today (UTC date) required' };
    if (!store || typeof store.credit !== 'function') {
      return { ok: false, awarded: 0, balance: 0, reason: 'store required' };
    }
    const seed = daySeed != null ? String(daySeed) : String(today); // day IS the default per-day seed

    const existing = store.get(acct);
    const lastSpinDay = existing ? existing.lastSpinDay : null;
    if (!canSpin({ account: acct, lastSpinDay, today })) {
      return {
        ok: false,
        awarded: 0,
        balance: existing ? existing.points : 0,
        reason: 'already spun today — one free spin per day',
      };
    }

    // streak: consecutive day → +1, otherwise reset to 1 (a gap breaks it).
    const prevStreak = existing ? Number(existing.streak) || 0 : 0;
    const streak = existing && isConsecutive(lastSpinDay, today) ? prevStreak + 1 : 1;

    const draw = spinResult({ account: acct, daySeed: seed, nonce });
    const bonus = streakBonus(streak);
    const awarded = draw.points + bonus;

    const row = store.credit(acct, awarded, today, streak);
    return {
      ok: true,
      awarded,
      base: draw.points,
      bonus,
      streak,
      segment: draw.segment,
      balance: row.points,
      verify: draw.verify,
    };
  } catch (e) {
    // soft-fail: never throw out of a claim
    return { ok: false, awarded: 0, balance: 0, reason: 'error: ' + (e && e.message ? e.message : 'unknown') };
  }
}

export function pointsBalance(account, store) {
  if (!store || typeof store.get !== 'function') return 0;
  const r = store.get(String(account || ''));
  return r ? r.points : 0;
}

// ── escaped HTML wheel (server-rendered; the client can animate over it) ──────────────────────────
const _esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderWheel({ result = null, balance = 0, streak = 0, canSpinToday = true } = {}) {
  const n = PRIZE_TABLE.length;
  const segs = PRIZE_TABLE.map((s, i) => {
    const a0 = (i / n) * 360;
    const a1 = ((i + 1) / n) * 360;
    const active = result && result.segment === s.segment ? ' active' : '';
    return `<div class="wheel-seg${active}" data-seg="${_esc(s.segment)}" data-a0="${a0}" data-a1="${a1}"
      style="--a0:${a0}deg;--a1:${a1}deg">
        <span class="seg-label">${_esc(s.segment)}</span>
        <span class="seg-pts">${_esc(s.points)}</span>
      </div>`;
  }).join('');
  const resultHtml = result
    ? `<div class="spin-result" role="status">You landed on <b>${_esc(result.segment)}</b> — <b>+${_esc(result.points)}</b> PLAY points${result.bonus ? ` (+${_esc(result.bonus)} streak bonus)` : ''}.</div>`
    : `<div class="spin-result muted">Spin the wheel for today's free PLAY points.</div>`;
  const btn = canSpinToday
    ? `<button class="spin-btn" type="submit">Spin (free · once a day)</button>`
    : `<button class="spin-btn" type="button" disabled>Come back tomorrow — you've spun today</button>`;
  return `<div class="wheel-wrap">
    <div class="wheel" aria-label="Daily spin wheel">${segs}<div class="wheel-hub">SPIN</div></div>
    ${resultHtml}
    <div class="wheel-stats">
      <span class="stat">PLAY balance: <b>${_esc(balance)}</b></span>
      <span class="stat">Day streak: <b>${_esc(streak)}</b></span>
    </div>
    ${btn}
    <p class="play-note">Free daily spin · <b>points are for play, not cash</b> — non-cashable internal PLAY points, no purchase, one free spin per day.</p>
  </div>`;
}

// CLI self-demo (guarded; never runs on import)
if (process.argv[1] && process.argv[1].endsWith('daily-spin.mjs')) {
  const store = makeStore();
  const acct = 'demo-player';
  let day = '2026-08-25';
  for (let i = 0; i < 3; i++) {
    const r = claim({ account: acct, today: day, store });
    console.log(day, '→', r);
    if (i === 0) console.log('  same-day again →', claim({ account: acct, today: day, store }));
    // advance one UTC day
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  console.log('balance:', pointsBalance(acct, store));
  console.log('one spin id (unused, non-cashable):', randomUUID());
}
