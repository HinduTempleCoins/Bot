import { test } from 'node:test';
import assert from 'node:assert';
import {
  eligible, tipAmount, planTip, execute, assertClarityFirewall, DEFAULT_RULES,
} from './tipbot.mjs';

const NOW = Date.parse('2026-06-03T12:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// A user that passes every gate, for use as a baseline.
const good = () => ({ name: 'alice', stake: 50, accountAgeDays: 5, tipsReceived: 0 });

test('eligible: passes when all gates met', () => {
  const r = eligible(good(), DEFAULT_RULES, NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(r.reasons, []);
});

test('eligible: stake gate blocks under-staked users', () => {
  const r = eligible({ ...good(), stake: 1 }, DEFAULT_RULES, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /stake/.test(x)));
});

test('eligible: account-age gate blocks fresh accounts', () => {
  const byField = eligible({ ...good(), accountAgeDays: 0.1 }, DEFAULT_RULES, NOW);
  assert.equal(byField.ok, false);
  assert.ok(byField.reasons.some((x) => /age/.test(x)));

  // also via createdAt timestamp
  const byTs = eligible(
    { name: 'bob', stake: 50, createdAt: NOW - 2 * HOUR, tipsReceived: 0 },
    DEFAULT_RULES, NOW,
  );
  assert.equal(byTs.ok, false);
  assert.ok(byTs.reasons.some((x) => /age/.test(x)));
});

test('eligible: cooldown blocks repeat tips inside the window', () => {
  const recent = { ...good(), lastTipAt: NOW - 2 * HOUR };
  const blocked = eligible(recent, DEFAULT_RULES, NOW);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.reasons.some((x) => /cooldown/.test(x)));

  const old = { ...good(), lastTipAt: NOW - 48 * HOUR };
  assert.equal(eligible(old, DEFAULT_RULES, NOW).ok, true);
});

test('eligible: daily cap blocks once budget is spent', () => {
  const r = eligible(good(), { ...DEFAULT_RULES, spentToday: 500 }, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /dailyCap/.test(x)));
});

test('eligible: maxTipsPerUser stops endless faucet draining', () => {
  const r = eligible({ ...good(), tipsReceived: 6 }, DEFAULT_RULES, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /maxTipsPerUser/.test(x)));
});

test('tipAmount: first tip is the base amount', () => {
  assert.equal(tipAmount(good(), DEFAULT_RULES), DEFAULT_RULES.base);
});

test('tipAmount: tapers down for repeat recipients but stays above floor', () => {
  const a = tipAmount({ ...good(), tipsReceived: 0 }, DEFAULT_RULES);
  const b = tipAmount({ ...good(), tipsReceived: 3 }, DEFAULT_RULES);
  assert.ok(b < a, 'later tips are smaller');
  const floor = DEFAULT_RULES.base * 0.25;
  const deep = tipAmount({ ...good(), tipsReceived: 50 }, DEFAULT_RULES);
  assert.ok(deep >= floor - 1e-9, 'never below the floor');
});

test('tipAmount: never exceeds remaining daily budget', () => {
  const amt = tipAmount(good(), { ...DEFAULT_RULES, base: 100, spentToday: 498 });
  assert.ok(amt <= 2 + 1e-9, `clamped to remaining budget, got ${amt}`);
});

test('planTip: burn fraction is applied on top of the tip', () => {
  const intent = planTip(good(), DEFAULT_RULES, NOW);
  assert.equal(intent.skipped, false);
  assert.equal(intent.to, 'alice');
  assert.equal(intent.burn, Math.round(intent.tip * DEFAULT_RULES.burnFraction * 1000) / 1000);
  assert.equal(intent.total, Math.round((intent.tip + intent.burn) * 1000) / 1000);
  assert.equal(intent.burnTo, DEFAULT_RULES.burnTo);
});

test('planTip: ineligible user yields a skipped intent with reasons', () => {
  const intent = planTip({ ...good(), stake: 0 }, DEFAULT_RULES, NOW);
  assert.equal(intent.skipped, true);
  assert.ok(intent.reasons.length > 0);
});

test('planTip: intent is explicitly Clarity-firewalled', () => {
  assert.equal(planTip(good(), DEFAULT_RULES, NOW).clarityFirewalled, true);
});

test('execute: defaults to DRY-RUN (simulated, no signer)', async () => {
  const intent = planTip(good(), DEFAULT_RULES, NOW);
  const res = await execute(intent); // no { sign }
  assert.equal(res.simulated, true);
  assert.equal(res.ok, true);
  // tip + burn => two transfer ops, none broadcast
  assert.equal(res.ops.length, 2);
  assert.ok(res.ops.every((o) => o.type === 'transfer'));
});

test('execute: skipped intent does not act', async () => {
  const intent = planTip({ ...good(), stake: 0 }, DEFAULT_RULES, NOW);
  const res = await execute(intent);
  assert.equal(res.skipped, true);
  assert.equal(res.ok, false);
  assert.equal(res.simulated, true);
});

test('execute: with injected signer, calls sign and is not simulated', async () => {
  let seen = null;
  const sign = async (ops) => { seen = ops; return { txid: 'deadbeef' }; };
  const intent = planTip(good(), DEFAULT_RULES, NOW);
  const res = await execute(intent, { sign });
  assert.equal(res.simulated, false);
  assert.deepEqual(res.result, { txid: 'deadbeef' });
  assert.ok(Array.isArray(seen) && seen.length === 2, 'signer received the ops');
});

test('clarity firewall: rules referencing clarity are rejected', () => {
  assert.equal(assertClarityFirewall(DEFAULT_RULES), true);
  assert.throws(() => assertClarityFirewall({ clarityBoost: 1 }), /clarity firewall/i);
});
