// rc-cost.test.mjs — offline tests for the RC cost estimator. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rcCostOf,
  manaRegen,
  opsRemaining,
  timeToAfford,
  DEFAULT_RC_PER_BYTE,
  DEFAULT_RC_PER_STATE_BYTE,
  DEFAULT_BASE_RC,
  NEW_ACCOUNT_STATE_RC,
} from './rc-cost.mjs';

// ── rcCostOf ────────────────────────────────────────────────────────────────────────────────────
test('rcCostOf: base op with no bytes is just baseRc', () => {
  const { opRc } = rcCostOf({ op: 'vote', sizeBytes: 0, stateBytes: 0 });
  assert.equal(opRc, DEFAULT_BASE_RC);
});

test('rcCostOf: bytes and state bytes add their per-unit cost', () => {
  const { opRc } = rcCostOf({ op: 'comment', sizeBytes: 10, stateBytes: 2 });
  assert.equal(opRc, DEFAULT_BASE_RC + 10 * DEFAULT_RC_PER_BYTE + 2 * DEFAULT_RC_PER_STATE_BYTE);
});

test('rcCostOf: newAccount adds the large state premium', () => {
  const without = rcCostOf({ op: 'create', sizeBytes: 100, stateBytes: 0 }).opRc;
  const withNew = rcCostOf({ op: 'create', sizeBytes: 100, stateBytes: 0, newAccount: true }).opRc;
  assert.equal(withNew - without, NEW_ACCOUNT_STATE_RC);
});

test('rcCostOf: overridable coefficients are respected', () => {
  const { opRc } = rcCostOf({ sizeBytes: 5, stateBytes: 3, rcPerByte: 1, rcPerStateByte: 2, baseRc: 10 });
  assert.equal(opRc, 10 + 5 * 1 + 3 * 2);
});

test('rcCostOf: monotonic in size and state bytes', () => {
  const a = rcCostOf({ sizeBytes: 100, stateBytes: 1 }).opRc;
  const b = rcCostOf({ sizeBytes: 200, stateBytes: 1 }).opRc;
  const c = rcCostOf({ sizeBytes: 200, stateBytes: 5 }).opRc;
  assert.ok(b > a);
  assert.ok(c > b);
});

test('rcCostOf: garbage / negative inputs soft-fail (never NaN, never throw)', () => {
  assert.equal(rcCostOf().opRc, DEFAULT_BASE_RC); // no args -> base only
  assert.equal(rcCostOf({ sizeBytes: 'x', stateBytes: null }).opRc, DEFAULT_BASE_RC);
  assert.equal(rcCostOf({ sizeBytes: -50, stateBytes: -5 }).opRc, DEFAULT_BASE_RC);
  assert.equal(rcCostOf({ sizeBytes: NaN, baseRc: Infinity }).opRc, DEFAULT_BASE_RC);
  assert.equal(rcCostOf(null).opRc, DEFAULT_BASE_RC);
});

test('rcCostOf: newAccount only triggers on strict true', () => {
  assert.equal(rcCostOf({ sizeBytes: 0, stateBytes: 0, newAccount: 1 }).opRc, DEFAULT_BASE_RC);
  assert.equal(rcCostOf({ sizeBytes: 0, stateBytes: 0, newAccount: 'yes' }).opRc, DEFAULT_BASE_RC);
});

// ── manaRegen ───────────────────────────────────────────────────────────────────────────────────
test('manaRegen: half window regenerates half of max', () => {
  const { regenerated, fraction } = manaRegen({ maxMana: 1000, regenSeconds: 100, elapsedSeconds: 50 });
  assert.equal(regenerated, 500);
  assert.equal(fraction, 0.5);
});

test('manaRegen: caps at max (cannot over-regen)', () => {
  const { regenerated, fraction } = manaRegen({ maxMana: 1000, regenSeconds: 100, elapsedSeconds: 9999 });
  assert.equal(regenerated, 1000);
  assert.equal(fraction, 1);
});

test('manaRegen: zero/garbage params soft-fail to zeros', () => {
  assert.deepEqual(manaRegen(), { regenerated: 0, fraction: 0 });
  assert.deepEqual(manaRegen({ maxMana: 0, regenSeconds: 100, elapsedSeconds: 10 }), { regenerated: 0, fraction: 0 });
  assert.deepEqual(manaRegen({ maxMana: 1000, regenSeconds: 0, elapsedSeconds: 10 }), { regenerated: 0, fraction: 0 });
  assert.deepEqual(manaRegen({ maxMana: 'x', regenSeconds: 'y', elapsedSeconds: 'z' }), { regenerated: 0, fraction: 0 });
});

// ── opsRemaining ────────────────────────────────────────────────────────────────────────────────
test('opsRemaining: floors mana / opRc', () => {
  assert.equal(opsRemaining({ currentMana: 1000, opRc: 300 }), 3);
  assert.equal(opsRemaining({ currentMana: 900, opRc: 300 }), 3);
  assert.equal(opsRemaining({ currentMana: 299, opRc: 300 }), 0);
});

test('opsRemaining: opRc<=0 or garbage -> 0', () => {
  assert.equal(opsRemaining({ currentMana: 1000, opRc: 0 }), 0);
  assert.equal(opsRemaining({ currentMana: 1000, opRc: -5 }), 0);
  assert.equal(opsRemaining({ currentMana: 'x', opRc: 'y' }), 0);
  assert.equal(opsRemaining(), 0);
});

// ── timeToAfford ────────────────────────────────────────────────────────────────────────────────
test('timeToAfford: 0 when already affordable', () => {
  assert.equal(timeToAfford({ neededRc: 100, currentMana: 100, maxMana: 1000, regenSeconds: 100 }), 0);
  assert.equal(timeToAfford({ neededRc: 100, currentMana: 500, maxMana: 1000, regenSeconds: 100 }), 0);
  assert.equal(timeToAfford({ neededRc: 0, currentMana: 0, maxMana: 1000, regenSeconds: 100 }), 0);
});

test('timeToAfford: linear regen gives expected seconds', () => {
  // rate = max/window = 1000/100 = 10 mana/s; deficit = 500 -> 50s
  assert.equal(timeToAfford({ neededRc: 500, currentMana: 0, maxMana: 1000, regenSeconds: 100 }), 50);
});

test('timeToAfford: null when needed exceeds maxMana (unreachable)', () => {
  assert.equal(timeToAfford({ neededRc: 2000, currentMana: 0, maxMana: 1000, regenSeconds: 100 }), null);
});

test('timeToAfford: null when no regen', () => {
  assert.equal(timeToAfford({ neededRc: 500, currentMana: 0, maxMana: 1000, regenSeconds: 0 }), null);
  assert.equal(timeToAfford({ neededRc: 500, currentMana: 0, maxMana: 0, regenSeconds: 100 }), null);
});

test('timeToAfford: garbage soft-fails (already-affordable or unreachable, never throws)', () => {
  assert.equal(timeToAfford(), 0); // neededRc<=0 -> affordable
  assert.equal(timeToAfford({ neededRc: 'x', currentMana: 'y', maxMana: 'z', regenSeconds: 'w' }), 0);
  assert.equal(timeToAfford({ neededRc: 500, currentMana: 'x', maxMana: 'y', regenSeconds: 'z' }), null);
});

test('integration: full op affordable from empty within one regen window', () => {
  const { opRc } = rcCostOf({ op: 'comment', sizeBytes: 600, stateBytes: 8 });
  const maxMana = 5.0e9;
  const regenSeconds = 432000;
  const tta = timeToAfford({ neededRc: opRc, currentMana: 0, maxMana, regenSeconds });
  assert.ok(tta !== null && tta >= 0 && tta <= regenSeconds);
  assert.ok(opsRemaining({ currentMana: maxMana, opRc }) > 0);
});
