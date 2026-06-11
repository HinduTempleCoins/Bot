// budget-manager.test.mjs — offline node:test suite for the budget/spend ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBudget,
  record,
  check,
  remaining,
  summary,
  dayKeyOf,
} from './budget-manager.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 11, 12, 0, 0); // mid-day UTC

test('createBudget applies defaults and overrides', () => {
  const d = createBudget();
  assert.equal(d.dailyCapHive, 35);
  assert.equal(d.perTradeMaxHive, Infinity);
  assert.equal(d.timezoneOffsetH, 0);

  const o = createBudget({ dailyCapHive: 10, perTradeMaxHive: 4, timezoneOffsetH: -5 });
  assert.equal(o.dailyCapHive, 10);
  assert.equal(o.perTradeMaxHive, 4);
  assert.equal(o.timezoneOffsetH, -5);

  // bad options fall back
  const b = createBudget({ dailyCapHive: -3, perTradeMaxHive: 'x', timezoneOffsetH: NaN });
  assert.equal(b.dailyCapHive, 35);
  assert.equal(b.perTradeMaxHive, Infinity);
  assert.equal(b.timezoneOffsetH, 0);
});

test('happy path: check then record decrements remaining', () => {
  const led = createBudget({ dailyCapHive: 35 });
  assert.deepEqual(check(led, { amountHive: 10, ts: T0 }), { allowed: true, reason: 'ok', remaining: 35 });

  const r = record(led, { amountHive: 10, ts: T0 });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok');
  assert.equal(r.spentToday, 10);
  assert.equal(r.remaining, 25);
  assert.equal(remaining(led, T0), 25);
});

test('daily cap prevents overspending', () => {
  const led = createBudget({ dailyCapHive: 35 });
  record(led, { amountHive: 30, ts: T0 });
  const c = check(led, { amountHive: 10, ts: T0 });
  assert.equal(c.allowed, false);
  assert.equal(c.reason, 'daily-cap-exceeded');
  assert.equal(c.remaining, 5);

  const r = record(led, { amountHive: 10, ts: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'daily-cap-exceeded');
  // spend unchanged
  assert.equal(led.spentToday, 30);
  assert.equal(remaining(led, T0), 5);
});

test('per-trade max enforced', () => {
  const led = createBudget({ dailyCapHive: 35, perTradeMaxHive: 5 });
  const c = check(led, { amountHive: 6, ts: T0 });
  assert.equal(c.allowed, false);
  assert.equal(c.reason, 'per-trade-exceeded');

  const r = record(led, { amountHive: 6, ts: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'per-trade-exceeded');
  assert.equal(led.spentToday, 0);

  // exactly at the max is allowed
  assert.equal(record(led, { amountHive: 5, ts: T0 }).ok, true);
});

test('amount <= 0 rejected', () => {
  const led = createBudget();
  assert.equal(check(led, { amountHive: 0, ts: T0 }).reason, 'bad-amount');
  assert.equal(check(led, { amountHive: -1, ts: T0 }).reason, 'bad-amount');
  assert.equal(record(led, { amountHive: 0, ts: T0 }).ok, false);
  assert.equal(record(led, { amountHive: -5, ts: T0 }).reason, 'bad-amount');
  assert.equal(led.spentToday, 0);
});

test('rollover at local midnight resets the day', () => {
  const led = createBudget({ dailyCapHive: 35 });
  record(led, { amountHive: 30, ts: T0 });
  assert.equal(remaining(led, T0), 5);

  const nextDay = T0 + DAY_MS;
  // remaining for a fresh day reads full cap before any record
  assert.equal(remaining(led, nextDay), 35);

  const r = record(led, { amountHive: 20, ts: nextDay });
  assert.equal(r.ok, true);
  assert.equal(r.spentToday, 20);
  assert.equal(led.tradeCount, 1); // reset, not 2
});

test('timezone offset shifts the day boundary', () => {
  // offset of -12h: a ts just after UTC midnight is still "yesterday" locally.
  const led = createBudget({ dailyCapHive: 35, timezoneOffsetH: -12 });
  const utcMidnight = Date.UTC(2026, 5, 12, 0, 0, 0);
  const before = utcMidnight - 1000; // 1s before UTC midnight
  const k1 = dayKeyOf(before, -12);
  const k2 = dayKeyOf(utcMidnight, -12);
  assert.equal(k1, k2); // same local day under -12h offset
});

test('dry-run records to a separate shadow tally', () => {
  const led = createBudget({ dailyCapHive: 35 });
  const r = record(led, { amountHive: 30, ts: T0, dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'ok-dry');
  assert.equal(r.spentToday, 30);
  // live side untouched
  assert.equal(led.spentToday, 0);
  assert.equal(remaining(led, T0), 35);

  const s = summary(led, T0);
  assert.equal(s.spentToday, 0);
  assert.equal(s.dryRun.spentToday, 30);
  assert.equal(s.dryRun.tradeCount, 1);
});

test('dry-run still respects cap on its own tally', () => {
  const led = createBudget({ dailyCapHive: 35 });
  record(led, { amountHive: 30, ts: T0, dryRun: true });
  const r = record(led, { amountHive: 10, ts: T0, dryRun: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'daily-cap-exceeded');
});

test('summary reports the day snapshot', () => {
  const led = createBudget({ dailyCapHive: 35 });
  record(led, { amountHive: 10, ts: T0 });
  record(led, { amountHive: 5, ts: T0 });
  const s = summary(led, T0);
  assert.equal(s.spentToday, 15);
  assert.equal(s.remaining, 20);
  assert.equal(s.dailyCap, 35);
  assert.equal(s.tradeCount, 2);

  // a later day reports zero spend
  const s2 = summary(led, T0 + DAY_MS);
  assert.equal(s2.spentToday, 0);
  assert.equal(s2.tradeCount, 0);
  assert.equal(s2.remaining, 35);
});

test('soft-fail on bad ledger / bad ts — never throws', () => {
  assert.equal(check(null, { amountHive: 5, ts: T0 }).reason, 'bad-ledger');
  assert.equal(record(undefined, { amountHive: 5, ts: T0 }).reason, 'bad-ledger');
  assert.equal(summary(null, T0).dailyCap, 0);
  assert.equal(remaining(null, T0), 0);

  const led = createBudget();
  assert.equal(check(led, { amountHive: 5, ts: 'nope' }).reason, 'bad-ts');
  assert.equal(record(led, { amountHive: 5, ts: NaN }).reason, 'bad-ts');
  assert.equal(dayKeyOf('x'), null);
});
