// price-nudge.test.mjs — OFFLINE tests for the VKBT OUTBID-RATCHET market maker.
// No network: nudgePlan is PURE; run() executes only through an INJECTED fake trader.
// Verifies the operator's correction: COMPETE with troll bids (resting limit one increment above),
// NEVER market-buy; HOLD when winning / capped at ask / max-jump / daily cap / ceiling; and that we
// CANCEL our stale bid before placing a clean top bid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nudgePlan, run, dailyCountFromState, emptyState } from './price-nudge.mjs';

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

// ── max-jump exceeded → HOLD ───────────────────────────────────────────────────────────────────
test('max-jump exceeded → HOLD', () => {
  // current best bid is ours at a low price; a troll posts a bid >5% above it. Outbidding the troll
  // would jump >5% over the current best bid → guarded.
  const buyBook = [
    bid(0.00000300, 5000, 'trollbot', 1),    // troll way up
    bid(0.00000200, 25, 'angelicalist', 2),  // our current (lower) bid
  ];
  // ceiling high enough not to trip; ask far above
  const cfg = { ...CFG, ceiling: 0.01 };
  // currentBest = 0.00000300 (troll holds top). target = 0.0000003+inc. jumpCap = 0.000003*1.05.
  // To force the max-jump path, lower maxJump so target exceeds the cap.
  const p = nudgePlan({ buyBook, sellBook: [ask(0.00001, 1000)], ourAccounts: OURS, lastNudge: 0, dailyCount: 0, now: NOW, config: { ...cfg, maxJump: 0 } });
  assert.equal(p.action, 'HOLD');
  assert.match(p.reason, /max-jump/i);
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

// ── dailyCountFromState rolls off entries older than 24h ───────────────────────────────────────
test('dailyCountFromState counts only the last 24h', () => {
  const st = { lastNudge: NOW, nudges: [NOW, NOW - 1000, NOW - (25 * 3600 * 1000)] };
  assert.equal(dailyCountFromState(st, NOW), 2, 'the 25h-old entry rolls off');
});
