// tribulum.test.mjs — offline tests for the Tribulum FARM core loop. node --test, no network,
// deterministic clock passed in everywhere, soft-fail assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  newFarm, plant, growthStage, harvest, sell, createStore, openFarm, renderFarm,
  seedShop, unitPrice, CURRENCY, STAGES,
} from './tribulum.mjs';

const DAY = 86400 * 1000;
const T0 = Date.UTC(2026, 0, 1); // fixed epoch for determinism
// 'auto-sour' = a day-tier, year-round common strain (grows any season → season-independent test).

test('newFarm makes the requested number of empty plots', () => {
  const f = newFarm(6);
  assert.equal(f.size, 6);
  assert.equal(f.plots.length, 6);
  assert.ok(f.plots.every((p) => p === null));
});

test('plant then growthStage advances with time (seeded clock)', () => {
  const f = newFarm(4);
  const r = plant({ farm: f, plotIndex: 0, seedId: 'auto-sour', now: T0 });
  assert.equal(r.ok, true);
  const plot = f.plots[0];
  const s0 = growthStage({ plot, now: T0 });
  const sMid = growthStage({ plot, now: T0 + DAY / 2 });
  const sRipe = growthStage({ plot, now: T0 + DAY });
  assert.equal(s0.stage, 'seedling');
  assert.ok(sMid.fraction > s0.fraction);          // fraction advances with time
  assert.ok(STAGES.includes(sMid.stage));
  assert.equal(sRipe.stage, 'ripe');
  assert.equal(sRipe.ripe, true);
});

test('harvest yields the crop units per kush-farm math', () => {
  const f = newFarm(2);
  plant({ farm: f, plotIndex: 0, seedId: 'auto-sour', now: T0 });
  const h = harvest({ farm: f, plotIndex: 0, now: T0 + DAY });
  assert.equal(h.ok, true);
  assert.ok(h.yield > 0);                            // auto-sour baseYield 2 × day yieldMult 1 = 2
  assert.equal(h.item.units, h.yield);
  assert.equal(f.plots[0], null);                    // annual: plot clears after harvest
});

test('yield boost (golden hoe) raises the harvest', () => {
  const plain = newFarm(1);
  plant({ farm: plain, plotIndex: 0, seedId: 'auto-sour', now: T0 });
  const hPlain = harvest({ farm: plain, plotIndex: 0, now: T0 + DAY });

  const boosted = newFarm(1);
  plant({ farm: boosted, plotIndex: 0, seedId: 'auto-sour', now: T0, boosts: ['GOLDHOE'] }); // +25% yield
  const hBoost = harvest({ farm: boosted, plotIndex: 0, now: T0 + DAY });
  assert.ok(hBoost.yield >= hPlain.yield);
  assert.ok(hBoost.yield > 0);
});

test('growthSpeed boost (watering can) shortens the grow', () => {
  const fast = newFarm(1);
  plant({ farm: fast, plotIndex: 0, seedId: 'auto-sour', now: T0, boosts: ['WATERCAN'] }); // +10% speed
  const plot = fast.plots[0];
  assert.ok(plot.readyAt < T0 + DAY);                // ready sooner than the full day
  assert.equal(growthStage({ plot, now: plot.readyAt }).ripe, true);
});

test('sell returns economy-priced currency (rarer = dearer)', () => {
  const r = sell({ items: [{ symbol: 'AUTOSOUR', rarity: 'common', units: 10 }] });
  assert.equal(r.ok, true);
  assert.equal(r.currency, CURRENCY);
  assert.equal(r.total, 10 * unitPrice('common'));
  // a legendary crop clears for strictly more per unit than a common one
  assert.ok(unitPrice('legendary') > unitPrice('common'));
});

test('sell prices a real harvested item and honors a market override', () => {
  const f = newFarm(1);
  plant({ farm: f, plotIndex: 0, seedId: 'auto-sour', now: T0 });
  const h = harvest({ farm: f, plotIndex: 0, now: T0 + DAY });
  const base = sell({ items: [h.item] });
  assert.ok(base.total > 0);
  const override = sell({ items: [h.item], market: { AUTOSOUR: 100 } });
  assert.equal(override.total, h.item.units * 100); // market override beats the default price
});

test('cannot harvest before ripe (soft reject)', () => {
  const f = newFarm(1);
  plant({ farm: f, plotIndex: 0, seedId: 'auto-sour', now: T0 });
  const early = harvest({ farm: f, plotIndex: 0, now: T0 + DAY / 2 });
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'not ready');
  assert.ok(f.plots[0]);                             // plot untouched — still growing
});

test('cannot plant on an occupied plot (soft reject)', () => {
  const f = newFarm(1);
  assert.equal(plant({ farm: f, plotIndex: 0, seedId: 'auto-sour', now: T0 }).ok, true);
  const again = plant({ farm: f, plotIndex: 0, seedId: 'daily-diesel', now: T0 });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'plot occupied');
});

test('store persists farm state across actions', () => {
  const store = createStore();
  const f1 = openFarm(store, 'alice', 3);
  plant({ farm: f1, plotIndex: 1, seedId: 'auto-sour', now: T0 });
  const f2 = openFarm(store, 'alice');               // same account → same object
  assert.equal(f2.plots[1].seedId, 'auto-sour');
  const h = harvest({ farm: f2, plotIndex: 1, now: T0 + DAY });
  assert.equal(h.ok, true);
  assert.equal(openFarm(store, 'alice').plots[1], null); // harvest persisted through the store
  // separate accounts are isolated
  assert.ok(openFarm(store, 'bob').plots.every((p) => p === null));
});

test('renderFarm escapes and shows the plot grid', () => {
  const f = newFarm(2);
  plant({ farm: f, plotIndex: 0, seedId: 'auto-sour', now: T0 });
  const html = renderFarm(f, T0);
  assert.match(html, /farm-grid/);
  assert.match(html, /Auto Sour/);
  assert.match(html, /empty/);                       // the un-planted plot
  assert.ok(!html.includes('<script>'));
});

test('renderFarm escapes hostile crop names (no raw HTML)', () => {
  // simulate a plot with an injected name — renderFarm must escape it
  const f = newFarm(1);
  f.plots[0] = { plotIndex: 0, seedId: 'x', symbol: 'X', name: '<img src=x onerror=alert(1)>',
    rarity: 'common', plantedAt: T0, growMs: DAY, readyAt: T0 + DAY, yieldBps: 0, boosts: [], harvested: false };
  const html = renderFarm(f, T0);
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img/);
});

test('unknown seed is a soft reject', () => {
  const f = newFarm(1);
  const r = plant({ farm: f, plotIndex: 0, seedId: 'no-such-strain', now: T0 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown seed/);
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => plant({}));
  assert.doesNotThrow(() => plant({ farm: newFarm(1), plotIndex: 99, seedId: 'auto-sour', now: T0 }));
  assert.doesNotThrow(() => plant({ farm: newFarm(1), plotIndex: 0, seedId: 'auto-sour', now: 'not-a-number' }));
  assert.doesNotThrow(() => growthStage({}));
  assert.doesNotThrow(() => growthStage(null));
  assert.doesNotThrow(() => harvest({}));
  assert.doesNotThrow(() => harvest({ farm: null }));
  assert.doesNotThrow(() => sell({}));
  assert.doesNotThrow(() => sell({ items: 'nonsense' }));
  assert.doesNotThrow(() => sell(null));
  assert.doesNotThrow(() => renderFarm(null, T0));
  assert.doesNotThrow(() => openFarm(createStore(), '', 0));

  // and each returns a soft-fail shape, not a throw
  assert.equal(plant({}).ok, false);
  assert.equal(harvest({}).ok, false);
  assert.equal(growthStage({}).ok, false);
  assert.equal(sell({ items: [] }).ok, true); // empty sale is a valid zero sale
  assert.equal(sell({ items: [] }).total, 0);
});

test('bad plot index on harvest is a soft reject', () => {
  const f = newFarm(2);
  const r = harvest({ farm: f, plotIndex: 50, now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad plot index');
});

test('seedShop lists plantable seeds from the shop catalog', () => {
  const seeds = seedShop();
  assert.ok(Array.isArray(seeds));
  assert.ok(seeds.length > 0);
  assert.ok(seeds.every((s) => s.category === 'seed'));
});
