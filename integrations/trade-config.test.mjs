// trade-config.test.mjs — OFFLINE tests for the consolidated trade-config.
// Pure env→numbers resolution: no network, no fs, no key. Defaults documented; env overrides applied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTradeConfig, TRADE_CONFIG } from './trade-config.mjs';

test('documented defaults resolve from an empty env', () => {
  const c = loadTradeConfig({});
  assert.deepEqual(c.issuedTokens, ['VKBT', 'CURE']);
  assert.deepEqual(c.priorityTokens, ['VKBT', 'CURE']);
  assert.equal(c.arb.threshold, 0.03);
  assert.equal(c.arb.minExecHive, 20);
  assert.equal(c.arb.heFee, 0.01);
  assert.equal(c.arb.extTaker, 0.005);
  assert.equal(c.arb.minNetPct, 0.5);
  assert.equal(c.arb.xchainThreshold, 0.03);
  assert.equal(c.arb.xchainMinLiqUsd, 5000);
  assert.equal(c.arb.xchainSpotDev, 0.20);
  assert.equal(c.exec.maxOrderHive, 10);
  assert.equal(c.exec.minOrderHive, 1);
  assert.equal(c.exec.maxBelievableEdge, 0.30);
  assert.equal(c.mm.nudgeIncrement, 0.00000001);   // one real HE tick (8-dp); the floor under the sig-fig step
  assert.equal(c.mm.maxNudgesDay, 10);
  assert.equal(c.mm.nudgeInterval, 3600000);
  assert.equal(c.mm.maxJump, 0.05);
  assert.equal(c.mm.supportSize, 25);
  assert.equal(c.mm.minWhale, 100000);
  assert.deepEqual(c.mm.ourAccounts, ['angelicalist', 'kalivankush']);
  assert.equal(c.wall.floor, 0.01);
  assert.equal(c.wall.ceiling, 0);
  assert.equal(c.wall.size, 1000);
  assert.equal(c.scenario.priorityFloor, 0.20);
  assert.equal(c.scenario.cron, '*/15 * * * *');
  assert.equal(c.strategy.pegArbThreshold, 0.03);
  assert.equal(c.strategy.pegArbTradeHive, 50);
  assert.equal(c.strategy.pegArbMaxInventoryHive, 500);
});

test('ceiling/floor are null when unset (so price-nudge HOLDs instead of inventing a number)', () => {
  const c = loadTradeConfig({});
  assert.equal(c.mm.ceiling, null);
  assert.equal(c.mm.floor, null);
});

test('ceiling/floor parse when set', () => {
  const c = loadTradeConfig({ MM_CEILING: '0.002', MM_FLOOR: '0.0005' });
  assert.equal(c.mm.ceiling, 0.002);
  assert.equal(c.mm.floor, 0.0005);
});

test('env overrides the defaults (same env names the old inline reads used)', () => {
  const c = loadTradeConfig({
    ARB_THRESHOLD: '0.05', MAX_ORDER_HIVE: '25', MM_SUPPORT_SIZE: '40',
    SCENARIO_PRIORITY: 'VKBT,CURE,BBH', WALL_SIZE: '2000', ISSUED_TOKENS: 'VKBT CURE FOO',
  });
  assert.equal(c.arb.threshold, 0.05);
  assert.equal(c.exec.maxOrderHive, 25);
  assert.equal(c.mm.supportSize, 40);
  assert.deepEqual(c.priorityTokens, ['VKBT', 'CURE', 'BBH']);
  assert.equal(c.wall.size, 2000);
  assert.deepEqual(c.issuedTokens, ['VKBT', 'CURE', 'FOO']);
});

test('garbage numeric env falls back to the default, never NaN', () => {
  const c = loadTradeConfig({ ARB_THRESHOLD: 'notanumber', MAX_ORDER_HIVE: '' });
  assert.equal(c.arb.threshold, 0.03);
  assert.equal(c.exec.maxOrderHive, 10);
});

test('the resolved config is frozen (no accidental mutation)', () => {
  const c = loadTradeConfig({});
  assert.ok(Object.isFrozen(c));
});

test('TRADE_CONFIG snapshot exists and has the documented shape', () => {
  assert.ok(TRADE_CONFIG.arb && TRADE_CONFIG.exec && TRADE_CONFIG.mm && TRADE_CONFIG.wall);
});

test('NO operator-gated knobs leak in (no daily-cap / profit-skim / live flag / key)', () => {
  // the config must NOT carry a daily cap, a profit-skim, a "live" flag, or anything key-shaped.
  const c = loadTradeConfig({ DAILY_CAP_HIVE: '999', PROFIT_SKIM: '0.5', ANGELICALIST_LIVE: 'true', ANGELICALIST_WIF: 'x' });
  const flat = JSON.stringify(c).toLowerCase();
  assert.ok(!flat.includes('999'), 'daily cap must not be read');
  assert.ok(!flat.includes('skim'));
  assert.ok(!flat.includes('wif'));
  assert.ok(!flat.includes('live'));
});
