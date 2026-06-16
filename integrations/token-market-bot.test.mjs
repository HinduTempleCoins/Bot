// token-market-bot.test.mjs — fully offline tests (node:test + node:assert), injected fetch, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  midPrice, spreadOrders, rebalanceLP, curationPicks, planActions, __setFetch,
} from './token-market-bot.mjs';

// ───────────────────────── midPrice ─────────────────────────
test('midPrice: two-sided book → (bestBid+bestAsk)/2', () => {
  const ob = { bids: [{ price: 0.098, quantity: 10 }, { price: 0.095, quantity: 5 }],
    asks: [{ price: 0.102, quantity: 8 }, { price: 0.106, quantity: 4 }] };
  assert.equal(midPrice(ob), 0.1); // (0.098 + 0.102)/2
});

test('midPrice: array-tuple levels and buyBook/sellBook aliases', () => {
  const ob = { buyBook: [[0.2, 100], [0.18, 50]], sellBook: [[0.24, 80], [0.30, 40]] };
  assert.equal(midPrice(ob), 0.22); // (0.2 + 0.24)/2
});

test('midPrice: one-sided falls back to that side', () => {
  assert.equal(midPrice({ bids: [{ price: 0.5, quantity: 1 }], asks: [] }), 0.5);
  assert.equal(midPrice({ bids: [], asks: [{ price: 0.7, quantity: 1 }] }), 0.7);
});

test('midPrice: scalar last/mid fallback', () => {
  assert.equal(midPrice({ last: 1.25 }), 1.25);
  assert.equal(midPrice({ bid: 0.9, ask: 1.1 }), 1.0);
});

test('midPrice: garbage/empty → 0 (soft-fail)', () => {
  assert.equal(midPrice(null), 0);
  assert.equal(midPrice('x'), 0);
  assert.equal(midPrice({}), 0);
  assert.equal(midPrice({ bids: [], asks: [] }), 0);
});

// ───────────────────────── spreadOrders ─────────────────────────
test('spreadOrders: ladders buy+sell rungs around mid, frozen dryRun/signer', () => {
  const { orders, reason } = spreadOrders({ mid: 1.0, symbol: 'APIS', spreadPct: 0.02, ladders: 3, size: 10 });
  assert.equal(orders.length, 6); // 3 rungs × 2 sides
  const buys = orders.filter((o) => o.side === 'buy').map((o) => o.price);
  const sells = orders.filter((o) => o.side === 'sell').map((o) => o.price);
  assert.deepEqual(buys, [0.98, 0.96, 0.94]);
  assert.deepEqual(sells, [1.02, 1.04, 1.06]);
  for (const o of orders) {
    assert.equal(o.dryRun, true);
    assert.equal(o.signer, null);
    assert.equal(o.symbol, 'APIS');
    assert.equal(o.strategy, 'token-market-bot');
    assert.throws(() => { o.dryRun = false; }, 'orders are frozen');
  }
  assert.match(reason, /6-rung/);
});

test('spreadOrders: maxNotionalHive caps total laddered HIVE', () => {
  const { orders } = spreadOrders({ mid: 1.0, symbol: 'APIS', spreadPct: 0.02, ladders: 5, size: 10, maxNotionalHive: 30 });
  // 30 HIVE / 10 per rung = 3 rungs placed before the cap stops further rungs.
  assert.equal(orders.length, 3);
});

test('spreadOrders: bad inputs soft-fail to empty + reason', () => {
  assert.deepEqual(spreadOrders(null).orders, []);
  assert.equal(spreadOrders({ mid: 0, symbol: 'X' }).orders.length, 0);
  assert.equal(spreadOrders({ mid: 1, symbol: '' }).orders.length, 0);
  assert.equal(spreadOrders({ mid: 1, symbol: 'X', spreadPct: 2 }).orders.length, 0); // out of (0,1)
  assert.equal(spreadOrders({ mid: 1, symbol: 'X', size: -5 }).orders.length, 0);
  assert.match(spreadOrders({ mid: 1, symbol: 'X', size: -5 }).reason, /size/);
});

// ───────────────────────── rebalanceLP ─────────────────────────
test('rebalanceLP: balanced pool → hold', () => {
  const r = rebalanceLP({ reserveA: 1000, reserveB: 1000, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' }, { target: 0.5, band: 0.05 });
  assert.equal(r.action, 'hold');
  assert.equal(r.currentWeight, 0.5);
  assert.equal(r.intent, null);
});

test('rebalanceLP: tokenA under-weighted → provide skewed to A', () => {
  const r = rebalanceLP({ reserveA: 600, reserveB: 1400, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' }, { target: 0.5, band: 0.05 });
  assert.equal(r.action, 'provide');
  assert.equal(r.currentWeight, 0.3); // 600/2000
  assert.equal(r.intent.kind, 'lp-provide');
  assert.equal(r.intent.skewToward, 'KULA');
  assert.equal(r.intent.unsigned, true);
  assert(r.intent.notionalHive > 0);
});

test('rebalanceLP: tokenA over-weighted → withdraw', () => {
  const r = rebalanceLP({ reserveA: 1500, reserveB: 500, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' }, { target: 0.5, band: 0.05 });
  assert.equal(r.action, 'withdraw');
  assert.equal(r.currentWeight, 0.75); // 1500/2000
  assert.equal(r.intent.kind, 'lp-withdraw');
  assert.equal(r.intent.unsigned, true);
});

test('rebalanceLP: no external prices → spot fallback weight 0.5 → hold', () => {
  const r = rebalanceLP({ reserveA: 800, reserveB: 1200 }, { target: 0.5, band: 0.05 });
  assert.equal(r.currentWeight, 0.5);
  assert.equal(r.action, 'hold');
});

test('rebalanceLP: missing/zero reserves soft-fail to hold', () => {
  assert.equal(rebalanceLP(null).action, 'hold');
  assert.equal(rebalanceLP({}).action, 'hold');
  assert.equal(rebalanceLP({ reserveA: 0, reserveB: 100 }).action, 'hold');
});

test('rebalanceLP: step scales with drift, capped by maxStep', () => {
  const r = rebalanceLP({ reserveA: 100, reserveB: 1900, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' },
    { target: 0.5, band: 0.05, stepHive: 10, maxStep: 25 });
  assert.equal(r.action, 'provide');
  assert.equal(r.intent.notionalHive, 25); // would be huge; capped at maxStep
});

// ───────────────────────── curationPicks ─────────────────────────
const POSTS = [
  { author: 'alice', permlink: 'p1', tribe: 'APIS', rshares: 5e9, ageMinutes: 5 },
  { author: 'bob', permlink: 'p2', tribe: 'APIS', rshares: 8e9, ageMinutes: 30 },
  { author: 'carol', permlink: 'p3', tribe: 'APIS', rshares: 2e7, ageMinutes: 5 },   // below floor
  { author: 'dave', permlink: 'p4', tribe: 'SCROLL', rshares: 6e9, ageMinutes: 5, alreadyVoted: true },
  { author: 'eve', permlink: 'p5', tribe: 'SCROLL', rshares: 4e9, ageMinutes: 5 },
];

test('curationPicks: floor + already-voted + per-tribe cap', () => {
  const { picks, skipped } = curationPicks(POSTS, { minRshares: 5e7, perTribe: 2, weight: 5000 });
  // APIS: alice + bob clear floor (2 within cap); carol below floor; SCROLL: dave already-voted, eve picked.
  const refs = picks.map((p) => `${p.author}/${p.permlink}`).sort();
  assert.deepEqual(refs, ['alice/p1', 'bob/p2', 'eve/p5']);
  for (const p of picks) {
    assert.equal(p.kind, 'vote-intent');
    assert.equal(p.weight, 5000);
    assert.equal(p.dryRun, true);
    assert.equal(p.signer, null);
    assert.throws(() => { p.weight = 10000; }); // frozen
  }
  assert(skipped.some((s) => s.reason.includes('floor')));
  assert(skipped.some((s) => s.reason === 'already-voted'));
});

test('curationPicks: per-tribe cap caps a busy tribe', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ author: 'u' + i, permlink: 'k' + i, tribe: 'APIS', rshares: (i + 1) * 1e9, ageMinutes: 5 }));
  const { picks, skipped } = curationPicks(many, { minRshares: 0, perTribe: 3 });
  assert.equal(picks.length, 3);
  assert(skipped.some((s) => s.reason.includes('per-tribe cap')));
});

test('curationPicks: optimal-window freshness influences rank', () => {
  const posts = [
    { author: 'far', permlink: 'a', tribe: 'T', rshares: 1e9, ageMinutes: 240 },
    { author: 'near', permlink: 'b', tribe: 'T', rshares: 1e9, ageMinutes: 5 },
  ];
  const { picks } = curationPicks(posts, { minRshares: 0, perTribe: 1, optimalMinutes: 5 });
  assert.equal(picks[0].author, 'near'); // equal rshares → closer to optimal window wins
});

test('curationPicks: maxAgeMinutes gate', () => {
  const posts = [{ author: 'old', permlink: 'x', tribe: 'T', rshares: 9e9, ageMinutes: 500 }];
  const { picks, skipped } = curationPicks(posts, { minRshares: 0, maxAgeMinutes: 60 });
  assert.equal(picks.length, 0);
  assert(skipped.some((s) => s.reason.includes('max')));
});

test('curationPicks: non-array / malformed soft-fail', () => {
  assert.deepEqual(curationPicks(null).picks, []);
  assert.match(curationPicks(null).reason, /not an array/);
  const { picks, skipped } = curationPicks([null, { author: 'a' }, { permlink: 'b' }], { minRshares: 0 });
  assert.equal(picks.length, 0);
  assert.equal(skipped.length, 3);
});

// ───────────────────────── planActions (injected fetch, offline) ─────────────────────────
function fakeFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [frag, body] of Object.entries(routes)) {
      if (u.includes(frag)) return { ok: true, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test('planActions: assembles MM + LP + curation from injected fetch', async () => {
  __setFetch(fakeFetch({
    'orderbook': { bids: [{ price: 0.98, quantity: 10 }], asks: [{ price: 1.02, quantity: 10 }] },
    'payouts': [
      { author: 'alice', permlink: 'p1', rshares: 5e9, ageMinutes: 5 },
      { author: 'bob', permlink: 'p2', rshares: 8e9, ageMinutes: 8 },
    ],
  }));
  const r = await planActions(
    { engineApi: 'https://engine.example', symbol: 'apis', tribe: 'APIS',
      pool: { reserveA: 600, reserveB: 1400, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' } },
    { mm: { spreadPct: 0.02, ladders: 2, size: 5 }, lp: { target: 0.5, band: 0.05 }, curation: { minRshares: 1e8, perTribe: 5 } },
  );
  __setFetch();
  assert.equal(r.ok, true);
  assert.equal(r.symbol, 'APIS');
  assert.equal(r.market.orders.length, 4);     // 2 rungs × 2 sides
  assert.equal(r.lp.action, 'provide');
  assert.equal(r.curation.picks.length, 2);
  // actions = MM orders + 1 LP intent + curation picks
  assert.equal(r.actions.length, 4 + 1 + 2);
  assert.match(r.reason, /MM order/);
});

test('planActions: no engineApi → MM+curation skipped, still soft-returns', async () => {
  const r = await planActions({ symbol: 'APIS', pool: { reserveA: 1000, reserveB: 1000, priceA: 1, priceB: 1 } }, {});
  assert.equal(r.market.orders.length, 0);
  assert.equal(r.curation.picks.length, 0);
  assert.equal(r.lp.action, 'hold'); // balanced pool
  assert.equal(r.ok, false);         // no actions produced
});

test('planActions: failed fetch (404 everywhere) soft-fails to empty', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const r = await planActions({ engineApi: 'https://engine.example', symbol: 'APIS' }, {});
  __setFetch();
  assert.equal(r.ok, false);
  assert.equal(r.actions.length, 0);
  assert.equal(r.market.orders.length, 0);
  assert.equal(r.curation.picks.length, 0);
});

test('planActions: bad source / no symbol → safe empty shape', async () => {
  const a = await planActions(null);
  assert.equal(a.ok, false);
  assert.deepEqual(a.actions, []);
  const b = await planActions({ engineApi: 'https://x' });
  assert.equal(b.ok, false);
  assert.match(b.reason, /symbol/);
});

test('planActions: thrown fetch is swallowed (never throws)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await planActions({ engineApi: 'https://engine.example', symbol: 'APIS' }, {});
  __setFetch();
  assert.equal(r.ok, false);
  assert.equal(r.actions.length, 0);
});
