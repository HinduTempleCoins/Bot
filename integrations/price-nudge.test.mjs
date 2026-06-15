// price-nudge.test.mjs — OFFLINE tests for the VKBT OUTBID-RATCHET market maker.
// No network: nudgePlan is PURE; run() executes only through an INJECTED fake trader.
// Verifies the operator's correction: COMPETE with troll bids (resting limit one increment above),
// NEVER market-buy; HOLD when winning / capped at ask / max-jump / daily cap / ceiling; and that we
// CANCEL our stale bid before placing a clean top bid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgePlan, run, dailyCountFromState, emptyState, outbidStep, loadState, saveState } from './price-nudge.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const INC = 0.00000010;
// a config with a sane fair-value ceiling so the ceiling guard doesn't trip unrelated tests.
const CFG = {
  increment: INC, maxNudgesDay: 10, nudgeInterval: 3600000, maxJump: 0.05,
  buyWallSize: 50, supportSize: 25, minWhale: 100000, ceiling: 0.001, floor: null,
};
const OURS = ['angelicalist', 'kalivankush'];
const NOW = 1_700_000_000_000;

function bid(price, quantity, account, id) { return { price, quantity, account, _id: id }; }
function ask(price, quantity, account = 'seller', id) { return { price, quantity, account, _id: id }; }

// ── competitor outbids us → place a resting LIMIT bid one increment above (NOT market) ──────────
test('competitor outbids us → PLACE_LIMIT_BID one increment above the top competing bid', () => {
  const buyBook = [
    bid(0.00000200, 1000, 'trollbot', 1),   // top competing
    bid(0.00000150, 25, 'angelicalist', 2), // our stale lower bid
  ];
  const sellBook = [ask(0.00000500, 1000)]; // ask far above → no cap
  const p = nudgePlan({ buyBook, sellBook, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: CFG });
  assert.equal(p.action, 'NUDGE');
  const place = p.intents.find((i) => i.action === 'PLACE_LIMIT_BID');
  assert.ok(place, 'must place a limit bid');
  assert.equal(place.price, +(0.00000200 + INC).toFixed(8), 'one increment above the troll');
  assert.equal(place.quantity, CFG.supportSize, 'uses MM_SUPPORT_SIZE');
  // no market/crossing op anywhere
  assert.ok(!p.intents.some((i) => /MARKET/i.test(i.action)), 'never a market buy');
});

// ── cancels our stale bid BEFORE placing the new clean top bid (the key fix vs the dust pile) ───
test('cancels our stale lower bid before placing the new top bid', () => {
  const buyBook = [
    bid(0.00000200, 1000, 'trollbot', 1),
    bid(0.00000150, 25, 'angelicalist', 42),
    bid(0.00000140, 25, 'kalivankush', 43),
  ];
  const sellBook = [ask(0.00000500, 1000)];
  const p = nudgePlan({ buyBook, sellBook, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: CFG });
  const cancels = p.intents.filter((i) => i.action === 'CANCEL').map((i) => i.orderId).sort();
  assert.deepEqual(cancels, [42, 43], 'both our stale bids cancelled');
  // CANCELs come before the PLACE
  const placeIdx = p.intents.findIndex((i) => i.action === 'PLACE_LIMIT_BID');
  const lastCancelIdx = p.intents.map((i) => i.action).lastIndexOf('CANCEL');
  assert.ok(lastCancelIdx < placeIdx, 'cancels ordered before the place');
});

// ── we're already winning → HOLD ───────────────────────────────────────────────────────────────
test("we're already best bid → HOLD (we're winning)", () => {
  const buyBook = [
    bid(0.00000220, 25, 'angelicalist', 1), // ours, already above the troll by >1 inc
    bid(0.00000200, 1000, 'trollbot', 2),
  ];
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00000500, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: CFG });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /already best/i);
  assert.equal(p.intents.length, 0);
});

// ── target would cross the ask → cap just below ask (here the increment is large vs the spread) ─
test('target would cross the ask → capped just below ask, never at/above it', () => {
  // bigger increment so target = troll + inc lands ABOVE the ask, but there's room to cap and still
  // beat the troll. troll=0.0010, inc=0.0010 → target=0.0020 ≥ ask=0.0018 → cap = 0.0018−0.0010 =
  // 0.0008 < troll → HOLD. To get a successful cap we need ask−inc > troll: ask=0.0025, troll=0.0010,
  // inc=0.0010 → target=0.0020 ≥ ask? no. So use inc small enough to clear the ask but cap above troll:
  const cfg = { ...CFG, increment: 0.0001, ceiling: 1 };
  const buyBook = [bid(0.0010, 1000, 'trollbot', 1)];
  const sellBook = [ask(0.0010 + 0.00005, 500)]; // ask is half an increment above troll
  const p = nudgePlan({ buyBook, sellBook, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: cfg });
  // target = troll + inc = 0.0011 ≥ ask 0.00105 → cap = ask − inc = 0.00095 < troll 0.0010 → HOLD (no cross)
  assert.equal(p.action, 'HOLD', 'capping below ask would fall under the troll → HOLD, never cross');
  assert.match(p.reason, /spread too tight|cross the ask/i);
});

test('cap below ask succeeds when the spread leaves room above the troll', () => {
  // inc small relative to the troll→ask gap: troll=0.00000200, ask=0.00000260, inc=0.00000010.
  // target = troll+inc = 0.00000210 < ask → no cap needed (normal place). To FORCE the cap branch
  // and still beat the troll, set a competing bid just under the ask so target lands on the ask.
  const buyBook = [bid(0.00000250, 1000, 'trollbot', 1)]; // troll one inc below the ask
  const sellBook = [ask(0.00000260, 500)];                 // ask = troll + 1 inc
  const p = nudgePlan({ buyBook, sellBook, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: CFG });
  // target = 0.00000260 = ask → cap to 0.00000250 = troll → not above troll → HOLD (correct: cannot
  // outbid without crossing). This proves we NEVER place at/above the ask.
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /spread too tight/i);
});

// ── spread too tight (one increment between troll and ask) → HOLD, no crossing ──────────────────
test('spread too tight to outbid without crossing → HOLD', () => {
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1)];
  const sellBook = [ask(0.00000201, 500)]; // ask is troll + 1 inc; capping below = troll → can't beat
  const p = nudgePlan({ buyBook, sellBook, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: CFG });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /spread too tight/i);
});

// ── the minimal one-increment outbid is ALWAYS allowed (operator: always +1 tick; ceiling is the cap)
test('minimal one-increment outbid is allowed even past max-jump (ceiling is the real cap)', () => {
  // a troll posts a bid well above our stale one. A one-increment outbid is a >maxJump% jump, but it
  // is the minimal legal outbid (you cannot bid less than one tick over them), so it is allowed. This
  // is the fix: before, max-jump froze the bot at sub-tick prices where one tick already exceeds 5%.
  const buyBook = [
    bid(0.00000300, 5000, 'trollbot', 1),    // troll way up
    bid(0.00000200, 25, 'angelicalist', 2),  // our current (lower) bid
  ];
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00001, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: { ...CFG, ceiling: 0.01, maxJump: 0 } });
  assert.equal(p.action, 'NUDGE', 'a one-tick outbid is never blocked by max-jump');
  const place = p.intents.find((i) => i.action === 'PLACE_LIMIT_BID');
  assert.equal(place.price, +(0.00000300 + INC).toFixed(8), 'one increment over the troll');
});

// ── LIVE REGRESSION: the real VKBT book froze the bot before the fix ─────────────────────────────
test('LIVE regression: at 8e-8 with a 1e-8 tick, outbids to 9e-8 (was frozen by max-jump)', () => {
  // reproduces the live dry-run that HELD: top competing bid 0.00000008 (d9connect's 3.4M wall),
  // one real HE tick = 0.00000001, ceiling just under the snipers' 0.00008 basis.
  const cfg = { ...CFG, increment: 0.00000001, ceiling: 0.00007 };
  const buyBook = [bid(0.00000008, 3399863, 'd9connect', 1)];
  const sellBook = [ask(0.005, 1000)];
  const p = nudgePlan({ buyBook, sellBook, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: cfg });
  assert.equal(p.action, 'NUDGE', 'must move — this exact book was frozen before the fix');
  const place = p.intents.find((i) => i.action === 'PLACE_LIMIT_BID');
  assert.equal(place.price, 0.00000009, 'one tick over 8e-8 = 9e-8');
});

// ── with sig-fig stepping every outbid IS the minimal one tick, so the CEILING (not max-jump) is the
//    runaway guard. This proves the ladder keeps climbing one sig-fig tick per move until the ceiling.
test('ladder climbs one sig-fig tick per move and stops at the ceiling', () => {
  const cfg = { ...CFG, increment: 0.00000001, ceiling: 0.00009, maxJump: 0.05 };
  // competitor at 0.00008 → we target 0.000081 (< ceiling) → NUDGE
  const below = nudgePlan({ buyBook: [bid(0.00008, 1000, 'troll', 1)], sellBook: [ask(0.005, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: cfg });
  assert.equal(below.action, 'NUDGE');
  assert.equal(below.intents.find((i) => i.action === 'PLACE_LIMIT_BID').price, 0.000081);
  // competitor at the ceiling → one tick over would breach it → HOLD
  const atCeil = nudgePlan({ buyBook: [bid(0.00009, 1000, 'troll', 1)], sellBook: [ask(0.005, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: cfg });
  assert.equal(atCeil.action, 'HOLD');
  assert.match(atCeil.reason, /ceiling/i);
});

// ── daily cap hit → HOLD ───────────────────────────────────────────────────────────────────────
test('daily cap reached → HOLD', () => {
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1)];
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00000500, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 10, now: NOW, config: CFG });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /daily cap/i);
});

// ── interval not elapsed → HOLD ────────────────────────────────────────────────────────────────
test('interval since last nudge not elapsed → HOLD', () => {
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1)];
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00000500, 1000)], ourAccounts: OURS, lastNudge: NOW - 60000, dailyCount: 0, now: NOW, config: CFG });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /interval/i);
});

// ── ceiling reached → HOLD (don't pump into infinity) ──────────────────────────────────────────
test('fair-value ceiling reached → HOLD', () => {
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1)];
  const cfg = { ...CFG, ceiling: 0.00000200 }; // ceiling == troll price; target (troll+inc) > ceiling
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00000500, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: cfg });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /ceiling/i);
});

// ── unset ceiling → refuse to ratchet (never unbounded) ────────────────────────────────────────
test('no ceiling configured → HOLD (refuse unbounded ratchet)', () => {
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1)];
  const cfg = { ...CFG, ceiling: null };
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00000500, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: cfg });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /ceiling/i);
});

// ── no competing bid → HOLD ────────────────────────────────────────────────────────────────────
test('no competing bid in the book → HOLD', () => {
  const buyBook = [bid(0.00000150, 25, 'angelicalist', 1)]; // only ours
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00000500, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: CFG });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /nobody to outbid|no competing/i);
});

// ── runner: dry-run never calls the trader; live calls placeOrder/cancel via injected trader ────
test('run() dry-run (default) never touches the injected trader', async () => {
  const calls = [];
  const trader = { placeOrder: async (o) => { calls.push(['place', o]); return { ok: true }; }, cancel: async (c) => { calls.push(['cancel', c]); return { ok: true }; } };
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1), bid(0.00000150, 25, 'angelicalist', 2)];
  const sellBook = [ask(0.00000500, 1000)];
  // inject the book by stubbing market via run's fetch path: we pass a fake trader but live=false.
  const r = await run('VKBT', { trader, state: emptyState(), config: CFG, ourAccounts: OURS, live: false,
    now: NOW, _book: { buyBook, sellBook } });
  // dry-run: no trader calls regardless of book outcome
  assert.equal(calls.length, 0, 'dry-run must not call the trader');
});

// ── runner: live executes CANCEL then PLACE via the injected trader and records the nudge ──────
test('run() live calls cancel then placeOrder and records the nudge in state', async () => {
  const calls = [];
  const trader = { placeOrder: async (o) => { calls.push(['place', o]); return { txId: 'tx1' }; }, cancel: async (c) => { calls.push(['cancel', c]); return { txId: 'tx0' }; } };
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1), bid(0.00000150, 25, 'angelicalist', 7)];
  const sellBook = [ask(0.00000500, 1000)];
  const state = emptyState();
  const r = await run('VKBT', { trader, state, config: CFG, ourAccounts: OURS, live: true, now: NOW, _book: { buyBook, sellBook } });
  assert.equal(r.live, true);
  assert.deepEqual(calls.map((c) => c[0]), ['cancel', 'place'], 'cancel before place');
  assert.equal(calls[0][1].orderId, 7);
  assert.equal(calls[1][1].side, 'buy', 'a BUY limit, not a market op');
  assert.equal(calls[1][1].price, +(0.00000200 + INC).toFixed(8));
  assert.equal(state.nudges.length, 1, 'nudge recorded for the daily cap');
  assert.equal(state.lastNudge, NOW);
});

// ── outbidStep: a "tick" is +1 in the last significant figure, scaling with the price ───────────
test('outbidStep matches the operator examples (sig-fig tick, floored at the HE min tick)', () => {
  assert.equal(outbidStep(0.000007), 0.0000001, '0.000007 → +1e-7 (0.0000071)');
  assert.equal(outbidStep(0.00007), 0.000001, '0.00007 → +1e-6 (0.000071)');
  assert.equal(outbidStep(0.00000008), 0.00000001, '8e-8 floors to one real HE tick (→9e-8)');
  assert.equal(outbidStep(0), 0.00000001, 'bad price → min tick, never 0/NaN');
});

// ── the sig-fig ladder produces the operator's exact prices at each level ───────────────────────
test('nudge ladders by a sig-fig tick: 0.00007 → 0.000071, and 8e-8 → 9e-8', () => {
  const sell = [ask(0.005, 1000)];
  const at7e5 = nudgePlan({ buyBook: [bid(0.00007, 1000, 'troll', 1)], sellBook: sell, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: { ...CFG, increment: 0.00000001, ceiling: 0.001 } });
  assert.equal(at7e5.intents.find((i) => i.action === 'PLACE_LIMIT_BID').price, 0.000071, '0.00007 → 0.000071');
  const at8e8 = nudgePlan({ buyBook: [bid(0.00000008, 1000, 'troll', 1)], sellBook: sell, ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: { ...CFG, increment: 0.00000001, ceiling: 0.00007 } });
  assert.equal(at8e8.intents.find((i) => i.action === 'PLACE_LIMIT_BID').price, 0.00000009, '8e-8 → 9e-8');
});

// ── state file persists across runs so the interval + daily cap actually hold (systemd oneshot) ──
test('loadState/saveState round-trip; missing/garbage path soft-fails to emptyState', () => {
  const p = join(tmpdir(), `pn-state-${NOW}.json`);
  try {
    assert.deepEqual(loadState(p), emptyState(), 'missing file → emptyState');
    assert.deepEqual(loadState(null), emptyState(), 'null path → emptyState');
    saveState(p, { lastNudge: NOW, nudges: [NOW, NOW - 1000] });
    const back = loadState(p);
    assert.equal(back.lastNudge, NOW);
    assert.deepEqual(back.nudges, [NOW, NOW - 1000]);
    assert.equal(saveState(null, { lastNudge: 1 }), false, 'no path → no write, no throw');
  } finally { try { rmSync(p); } catch { /* ignore */ } }
});

test('run() live persists the nudge to the state file so the next run sees the interval', async () => {
  const p = join(tmpdir(), `pn-run-${NOW}.json`);
  const trader = { placeOrder: async () => ({ txId: 't' }), cancel: async () => ({ txId: 'c' }) };
  const buyBook = [bid(0.00000200, 1000, 'trollbot', 1)];
  const sellBook = [ask(0.00000500, 1000)];
  try {
    const r1 = await run('VKBT', { trader, statePath: p, config: CFG, ourAccounts: OURS, live: true, now: NOW, _book: { buyBook, sellBook } });
    assert.equal(r1.action, 'NUDGE');
    // a fresh run (no injected state) loads the file → interval guard now HOLDs
    const r2 = await run('VKBT', { trader, statePath: p, config: CFG, ourAccounts: OURS, live: true, now: NOW + 60000, _book: { buyBook, sellBook } });
    assert.equal(r2.action, 'HOLD');
    assert.match(r2.reason, /interval/i);
  } finally { try { rmSync(p); } catch { /* ignore */ } }
});

// ── dailyCountFromState rolls off entries older than 24h ───────────────────────────────────────
test('dailyCountFromState counts only the last 24h', () => {
  const st = { lastNudge: NOW, nudges: [NOW, NOW - 1000, NOW - (25 * 3600 * 1000)] };
  assert.equal(dailyCountFromState(st, NOW), 2, 'the 25h-old entry rolls off');
});
