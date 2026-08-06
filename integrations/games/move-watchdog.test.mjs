// move-watchdog.test.mjs — OFFLINE, pure. No chain, no network. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMove, formatAlerts, DEFAULTS } from './move-watchdog.mjs';

const prev = { fund: 43000, epoch: 496100, ts: 1785900000 };
// one legit payout an hour later, fund drops within the 150 cap
const healthy = {
  fund: 42900, epoch: 496101, ts: 1785900000 + 3600,
  movePays: [{ epoch: 496101, pay: [['alice', 30], ['bob', 10]] }],
  ledger: { 496101: { alice: 300, bob: 100 } },
};

test('healthy hour → ok, no alerts', () => {
  const r = analyzeMove(healthy, prev, {});
  assert.equal(r.ok, true);
  assert.equal(r.level, 'ok');
  assert.equal(r.alerts.length, 0);
});

test('CRITICAL: fund drained faster than cap × payouts', () => {
  const cur = { ...healthy, fund: 43000 - 600 }; // -600 with only 1 payout (cap 150) → bypass
  const r = analyzeMove(cur, prev, {});
  assert.equal(r.level, 'critical');
  assert.ok(r.alerts.some((a) => a.code === 'fund_drain'));
});

test('CRITICAL: a big drain is NOT masked by a burst of claimed payouts (time-bounded)', () => {
  // attacker drains 5000 in ~1h and claims 40 payouts to try to look "within cap × count"
  const cur = { ...healthy, fund: 43000 - 5000, ts: prev.ts + 3600,
    movePays: Array.from({ length: 40 }, (_, i) => ({ epoch: 496100 + i + 1, pay: [['thief', 1]] })) };
  const r = analyzeMove(cur, prev, {});
  assert.ok(r.alerts.some((a) => a.code === 'fund_drain'), 'drain must still fire despite many payouts');
  assert.equal(r.level, 'critical');
});

test('CRITICAL: a burst of move_pay ops in one window', () => {
  const cur = { ...healthy, movePays: [1, 2, 3, 4, 5].map((e) => ({ epoch: 496100 + e, pay: [['alice', 5]] })) };
  const r = analyzeMove(cur, prev, {});
  assert.ok(r.alerts.some((a) => a.code === 'payout_burst'));
  assert.equal(r.level, 'critical');
});

test('CRITICAL: attester pays itself', () => {
  const cur = { ...healthy, movePays: [{ epoch: 496101, pay: [['hathor', 999], ['alice', 1]] }] };
  const r = analyzeMove(cur, prev, { attester: 'hathor' });
  assert.ok(r.alerts.some((a) => a.code === 'attester_self_pay'));
  assert.equal(r.level, 'critical');
});

test('WARN: one account takes almost all the attested weight', () => {
  const cur = { ...healthy, movePays: [{ epoch: 496101, pay: [['whale', 990], ['alice', 10]] }] };
  const r = analyzeMove(cur, prev, {});
  assert.ok(r.alerts.some((a) => a.code === 'concentration'));
  assert.equal(r.level, 'warn');
});

test('WARN: implausible per-walker weight (fake steps) + sybil walker spike', () => {
  const cur = { ...healthy, ledger: { 496101: { cheater: 999999 } } };
  const r1 = analyzeMove(cur, prev, {});
  assert.ok(r1.alerts.some((a) => a.code === 'implausible_walker'));

  const many = {}; for (let i = 0; i < 6000; i++) many['w' + i] = 1;
  const r2 = analyzeMove({ ...healthy, ledger: { 496101: many } }, prev, {});
  assert.ok(r2.alerts.some((a) => a.code === 'walker_spike'));
});

test('epoch guard leaping far past wall-clock → warn', () => {
  const cur = { ...healthy, epoch: 496100 + 50 }; // +50 epochs in ~1h
  const r = analyzeMove(cur, prev, {});
  assert.ok(r.alerts.some((a) => a.code === 'epoch_jump'));
});

test('first run (no previous snapshot) does not false-alarm on the fund', () => {
  const r = analyzeMove(healthy, null, {});
  assert.equal(r.ok, true);
});

test('soft-fail: garbage input never throws', () => {
  assert.doesNotThrow(() => analyzeMove(null, null, {}));
  assert.doesNotThrow(() => analyzeMove({ movePays: 'nope', ledger: 7 }, {}, {}));
  const r = analyzeMove(undefined, undefined, {});
  assert.equal(typeof r.ok, 'boolean');
});

test('formatAlerts renders a compact message for critical, empty for ok', () => {
  assert.equal(formatAlerts(analyzeMove(healthy, prev, {}), {}), '');
  const msg = formatAlerts(analyzeMove({ ...healthy, fund: 42000 }, prev, {}), { fund: 42000 });
  assert.match(msg, /🚨/);
  assert.match(msg, /fund_drain/);
});

test('DEFAULTS are sane', () => {
  assert.equal(DEFAULTS.capPerEpoch, 150);
  assert.equal(DEFAULTS.attester, 'hathor');
});
