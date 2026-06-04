// crowdsource-prices.test.mjs — OFFLINE tests for the token-crowdsourced local-prices module
// (v3 §5; queue task #233). Everything is injected — store, clock, official source — so no
// network and no real keys are ever touched.
// Run: node --test integrations/crowdsource-prices.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitPrice,
  outlierFilter,
  cityBasket,
  costOfLiving,
  rewardSchedule,
  renderBasket,
  isPlausiblePrice,
  PRICE_BOUNDS,
  REWARD,
} from './crowdsource-prices.mjs';

const NOW = Date.parse('2026-06-04T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

// ── an injectable in-memory store with the list({city,item,user,since}) contract ───────────
function memStore(seed = []) {
  const rows = seed.slice();
  return {
    rows,
    put(s) { rows.push(s); },
    list({ city, item, user, since } = {}) {
      return rows.filter((s) => (
        (city == null || s.city === String(city).toLowerCase())
        && (item == null || s.item === String(item).toLowerCase())
        && (user == null || s.user === user)
        && (since == null || s.at >= since)
      ));
    },
  };
}

const clock = () => NOW;

// ───────────────────────────── submitPrice ─────────────────────────────

test('submitPrice stores a submission and returns a record-only rewardIntent', async () => {
  const store = memStore();
  const r = await submitPrice(
    { user: 'alice', city: 'Denver', item: 'Milk', price: 4.5, unit: 'gallon', humanityChecked: true },
    { store, clock },
  );
  assert.equal(r.ok, true);
  assert.ok(r.id);
  // stored, normalized, provenance-tagged
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].city, 'denver');
  assert.equal(store.rows[0].item, 'milk');
  assert.equal(store.rows[0].source, 'crowdsource');
  assert.equal(store.rows[0].provenance, 'crowdsource');
  assert.equal(store.rows[0].humanityChecked, true);
  // reward intent is RECEIVE/record-only: pending, no keys, has an amount
  assert.equal(r.rewardIntent.kind, 'token_reward');
  assert.equal(r.rewardIntent.status, 'pending');
  assert.equal(r.rewardIntent.user, 'alice');
  assert.equal(r.rewardIntent.submissionId, r.id);
  assert.ok(r.rewardIntent.amount > 0);
  // no key material anywhere in the returned object
  const blob = JSON.stringify(r).toLowerCase();
  assert.ok(!blob.includes('wif'));
  assert.ok(!blob.includes('privatekey'));
  assert.ok(!blob.includes('5j')); // common WIF prefix
});

test('submitPrice rejects absurd and negative/zero prices', async () => {
  const store = memStore();
  const neg = await submitPrice({ user: 'a', city: 'x', item: 'milk', price: -3, humanityChecked: true }, { store, clock });
  assert.equal(neg.ok, false);
  const zero = await submitPrice({ user: 'a', city: 'x', item: 'milk', price: 0, humanityChecked: true }, { store, clock });
  assert.equal(zero.ok, false);
  const absurd = await submitPrice({ user: 'a', city: 'x', item: 'milk', price: PRICE_BOUNDS.max + 1, humanityChecked: true }, { store, clock });
  assert.equal(absurd.ok, false);
  assert.equal(store.rows.length, 0); // nothing stored
});

test('submitPrice requires a humanity flag (humanity-gated surface)', async () => {
  const store = memStore();
  // no humanityChecked flag → rejected even with valid price + rich signals
  const r = await submitPrice(
    { user: 'bot', city: 'x', item: 'milk', price: 4, signals: { deviceAttested: true } },
    { store, clock },
  );
  assert.equal(r.ok, false);
  assert.match(r.reason, /humanity/i);
  assert.equal(store.rows.length, 0);
});

// ───────────────────────────── outlierFilter ─────────────────────────────

test('outlierFilter drops a 10x outlier via MAD', () => {
  const subs = [
    { price: 4.0, at: NOW }, { price: 4.2, at: NOW }, { price: 3.9, at: NOW },
    { price: 4.1, at: NOW }, { price: 4.05, at: NOW },
    { price: 41.0, at: NOW }, // the 10x fat-finger
  ];
  const res = outlierFilter(subs, { now: NOW });
  assert.equal(res.dropped.length, 1);
  assert.equal(res.dropped[0].price, 41.0);
  assert.equal(res.kept.length, 5);
  // surviving recency-weighted median lands near the cluster, not dragged up by 41
  assert.ok(res.price >= 3.9 && res.price <= 4.2, `price ${res.price} should be in cluster`);
});

test('outlierFilter is recency-weighted and never drops everything', () => {
  // two clusters far apart, recent one should win the weighted median when MAD keeps both
  const res = outlierFilter([{ price: 5, at: NOW }], { now: NOW });
  assert.equal(res.kept.length, 1);
  assert.equal(res.price, 5);
});

// ───────────────────────────── cityBasket ─────────────────────────────

test('cityBasket blends crowd + official with provenance tags', async () => {
  const store = memStore([
    { id: 's1', user: 'a', city: 'denver', item: 'milk', price: 4.5, unit: 'gallon', at: NOW },
    { id: 's2', user: 'b', city: 'denver', item: 'milk', price: 4.4, unit: 'gallon', at: NOW },
    { id: 's3', user: 'c', city: 'denver', item: 'milk', price: 4.6, unit: 'gallon', at: NOW },
  ]);
  const official = ({ item }) => (
    item === 'milk' ? { value: 4.0, source: 'bls', observedAt: NOW - 20 * DAY } : null
  );

  const basket = await cityBasket('Denver', { store, official, clock, items: ['milk', 'gasoline'] });
  assert.equal(basket.city, 'denver');
  const milk = basket.lines.find((l) => l.item === 'milk');
  assert.ok(milk.crowd, 'milk should have crowd data');
  assert.equal(milk.crowd.n, 3);
  assert.ok(milk.official, 'milk should have an official anchor');
  assert.equal(milk.provenance.official, true);
  assert.equal(milk.provenance.crowd, 3);
  assert.ok(milk.value != null);

  // gasoline: no crowd data, only official anchor → official line, provenance crowd:0
  const gas = basket.lines.find((l) => l.item === 'gasoline');
  assert.equal(gas.provenance.crowd, 0);
});

// ───────────────────────────── costOfLiving ─────────────────────────────

test('costOfLiving rolls up state/city/country and soft-fails a dead source', async () => {
  const store = memStore([
    { id: 's1', user: 'a', city: 'denver', item: 'milk', price: 4.5, at: NOW },
  ]);
  const official = ({ item }) => (item === 'milk' ? { value: 4.0, source: 'bls', observedAt: NOW - 10 * DAY } : null);
  // injected coliving whose macro source THROWS — must be soft-failed, not crash the rollup
  const deadColiving = { costOfLiving: async () => { throw new Error('macro source down'); } };

  const out = await costOfLiving(
    { city: 'Denver', state: 'Colorado', country: 'US' },
    { store, official, clock, coliving: deadColiving },
  );
  assert.equal(out.scope, 'city');
  assert.equal(out.city, 'denver');
  assert.equal(out.state, 'colorado');
  assert.equal(out.country, 'us');
  assert.ok(out.basket, 'crowd basket survives a dead macro source');
  assert.equal(out.provenance.crowd > 0, true);
  // dead macro source soft-failed: no macro, but no throw
  assert.equal(out.macro, undefined);
});

test('costOfLiving uses an injected coliving macro when healthy', async () => {
  const goodColiving = { costOfLiving: async () => ({ value: 312.4, source: 'fused', confidence: 0.8 }) };
  const out = await costOfLiving({ state: 'Texas' }, { clock, coliving: goodColiving });
  assert.equal(out.scope, 'state');
  assert.ok(out.macro);
  assert.equal(out.macro.value, 312.4);
  assert.equal(out.provenance.official, true);
});

// ───────────────────────────── rewardSchedule ─────────────────────────────

test('rewardSchedule diminishes for repeat same-day submissions by the same user', async () => {
  // user already has 2 accepted submissions earlier today
  const store = memStore([
    { id: 'p1', user: 'alice', city: 'denver', item: 'milk', price: 4, at: NOW - 2 * 3600 * 1000 },
    { id: 'p2', user: 'alice', city: 'denver', item: 'eggs', price: 3, at: NOW - 1 * 3600 * 1000 },
    // prior data for THIS city/item so no gap bonus skews the comparison
    { id: 'x1', user: 'bob', city: 'aurora', item: 'milk', price: 4, at: NOW - 5 * 3600 * 1000 },
  ]);
  const sub = { id: 'new', user: 'alice', city: 'aurora', item: 'milk', price: 4.2, at: NOW, humanityTier: 'device', humanityScore: 0.65 };
  const r = await rewardSchedule(sub, { store, clock });
  assert.equal(r.sameDayCount, 2);
  // third submission today: base × 0.5^2 = 0.25 (no gap bonus, has prior city/item data)
  assert.equal(r.gapBonus, 0);
  assert.ok(r.amount < REWARD.base, `diminished amount ${r.amount} should be < base ${REWARD.base}`);
  assert.ok(r.amount > 0);
});

test('rewardSchedule pays a gap bonus when filling a no-data city/item', async () => {
  const store = memStore(); // empty: this submission is the first for its city/item
  const sub = { id: 'g1', user: 'carol', city: 'reno', item: 'rent', price: 1500, at: NOW, humanityTier: 'device', humanityScore: 0.65 };
  const r = await rewardSchedule(sub, { store, clock });
  assert.equal(r.gapBonus, REWARD.gapBonus);
  assert.ok(r.amount >= REWARD.gapBonus, `gap-fill amount ${r.amount} should include the bonus`);
});

// ───────────────────────────── renderBasket ─────────────────────────────

test('renderBasket escapes a malicious item name and shows provenance', () => {
  const basket = {
    city: 'Denver',
    asOf: '2026-06-04T12:00:00.000Z',
    lines: [{
      item: '<script>alert(1)</script>',
      unit: 'gallon',
      value: 4.25,
      source: 'fused',
      freshness: 'fresh',
      provenance: { crowd: 3, official: true, asOf: '2026-06-04T12:00:00.000Z' },
    }],
  };
  const html = renderBasket(basket);
  // the malicious payload must be escaped, never raw
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  // provenance badges present
  assert.ok(html.includes('3 crowd'));
  assert.ok(html.includes('official anchor'));
  assert.ok(html.includes('fused'));
  // the "you helped crowdsource" note is present
  assert.match(html, /helped crowdsource/i);
});

test('isPlausiblePrice enforces the bounds', () => {
  assert.equal(isPlausiblePrice(4.5), true);
  assert.equal(isPlausiblePrice(0), false);
  assert.equal(isPlausiblePrice(-1), false);
  assert.equal(isPlausiblePrice(PRICE_BOUNDS.max + 1), false);
  assert.equal(isPlausiblePrice('not a number'), false);
});
