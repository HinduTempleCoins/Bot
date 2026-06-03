// proof-of-human.test.mjs — OFFLINE unit tests for the anti-fraud humanity gate.
// No network, no I/O. Covers: tier resolution, verified > unverified earning, anomaly
// reduction/denial, attestation boosts, and numeric bounds.
import { test } from 'node:test';
import assert from 'node:assert';
import { assess, gate, resolveTier, TIERS } from './proof-of-human.mjs';

// ── TIERS shape + ordering ──────────────────────────────────────────────────────
test('TIERS exposes the three tiers with strictly increasing multipliers', () => {
  assert.deepEqual(Object.keys(TIERS).sort(), ['anonymous', 'device', 'idme']);
  assert.ok(TIERS.anonymous.multiplier < TIERS.device.multiplier);
  assert.ok(TIERS.device.multiplier < TIERS.idme.multiplier);
  assert.ok(TIERS.anonymous.base < TIERS.device.base);
  assert.ok(TIERS.device.base < TIERS.idme.base);
});

// ── resolveTier picks the highest supported tier ────────────────────────────────
test('resolveTier: idVerified > deviceAttested > anonymous', () => {
  assert.equal(resolveTier({ idVerified: true }).tier, 'idme');
  assert.equal(resolveTier({ idVerified: true, deviceAttested: true }).tier, 'idme');
  assert.equal(resolveTier({ deviceAttested: true }).tier, 'device');
  assert.equal(resolveTier({}).tier, 'anonymous');
  assert.equal(resolveTier().tier, 'anonymous');
});

// ── verified out-earns unverified (the whole point) ─────────────────────────────
test('verified human earns a higher multiplier than unverified, on identical clean activity', () => {
  const idme = assess({ signals: { idVerified: true, deviceAttested: true, stepRatePerMin: 100 } });
  const device = assess({ signals: { deviceAttested: true, stepRatePerMin: 100 } });
  const anon = assess({ signals: { stepRatePerMin: 100 } });

  assert.ok(idme.multiplier > device.multiplier);
  assert.ok(device.multiplier > anon.multiplier);

  // clean accounts keep their full tier multiplier
  assert.equal(idme.multiplier, TIERS.idme.multiplier);
  assert.equal(device.multiplier, TIERS.device.multiplier);
  assert.equal(anon.multiplier, TIERS.anonymous.multiplier);
});

test('attestation tier boosts both humanityScore and payout for the same payout request', () => {
  const idmeGate = gate({ payout: 10, assessment: assess({ signals: { idVerified: true, deviceAttested: true } }) });
  const deviceGate = gate({ payout: 10, assessment: assess({ signals: { deviceAttested: true } }) });
  const anonGate = gate({ payout: 10, assessment: assess({ signals: {} }) });

  assert.ok(idmeGate.adjustedPayout > deviceGate.adjustedPayout);
  assert.ok(deviceGate.adjustedPayout > anonGate.adjustedPayout);
  // device-attested clean human gets full 1.0x → exactly the payout
  assert.equal(deviceGate.adjustedPayout, 10);
  assert.equal(idmeGate.adjustedPayout, 15);
  assert.equal(anonGate.adjustedPayout, 5);
});

// ── humanityScore bounds ────────────────────────────────────────────────────────
test('humanityScore and multiplier stay within bounds for all inputs', () => {
  const cases = [
    { idVerified: true, deviceAttested: true },
    { stepRatePerMin: 1e9 },
    { accountsOnDevice: 1000 },
    { eventsInWindow: 1e6, windowMinutes: 1 },
    { stepRatePerMin: -50 },          // garbage negative
    { stepRatePerMin: NaN },          // garbage NaN
    {},
  ];
  for (const signals of cases) {
    const a = assess({ signals });
    assert.ok(a.humanityScore >= 0 && a.humanityScore <= 1, `score in range for ${JSON.stringify(signals)}`);
    assert.ok(a.multiplier >= 0, `multiplier non-negative for ${JSON.stringify(signals)}`);
    assert.ok(a.multiplier <= TIERS.idme.multiplier, `multiplier capped for ${JSON.stringify(signals)}`);
  }
});

test('assess with no args is safe and yields anonymous baseline', () => {
  const a = assess();
  assert.equal(a.tier, 'anonymous');
  assert.ok(a.humanityScore > 0 && a.humanityScore <= 1);
});

// ── anomaly: impossible rates reduce/deny ───────────────────────────────────────
test('impossible step rate collapses humanity and denies payout', () => {
  const a = assess({ signals: { deviceAttested: true, stepRatePerMin: 1000 } });
  assert.ok(a.humanityScore < 0.15, `score ${a.humanityScore} should be near zero`);
  assert.ok(a.reasons.some((r) => r.includes('impossible')));

  const g = gate({ payout: 10, assessment: a });
  assert.equal(g.allowed, false);
  assert.equal(g.adjustedPayout, 0);
});

test('impossible rate detected across different surface fields', () => {
  for (const field of ['actionsPerMin', 'tapsPerMin', 'claimsPerHour']) {
    const a = assess({ signals: { deviceAttested: true, [field]: 1e6 } });
    assert.ok(a.reasons.some((r) => r.includes('impossible')), `${field} flagged`);
    assert.ok(a.humanityScore < 0.2);
  }
});

test('a normal rate is NOT flagged', () => {
  const a = assess({ signals: { deviceAttested: true, stepRatePerMin: 120, actionsPerMin: 50 } });
  assert.equal(a.reasons.length, 0);
  assert.equal(a.humanityScore, TIERS.device.base);
});

// ── anomaly: device reuse ───────────────────────────────────────────────────────
test('device reuse reduces multiplier; one account per device is fine', () => {
  const solo = assess({ signals: { deviceAttested: true, accountsOnDevice: 1 } });
  assert.equal(solo.reasons.length, 0);
  assert.equal(solo.multiplier, TIERS.device.multiplier);

  const shared2 = assess({ signals: { deviceAttested: true, accountsOnDevice: 2 } });
  assert.ok(shared2.multiplier < solo.multiplier);
  assert.ok(shared2.reasons.some((r) => r.includes('device shared')));

  const farm = assess({ signals: { deviceAttested: true, accountsOnDevice: 8 } });
  assert.ok(farm.humanityScore < shared2.humanityScore, 'more accounts → lower score');
});

// ── anomaly: velocity ───────────────────────────────────────────────────────────
test('high event velocity lowers the score and can deny', () => {
  const ok = assess({ signals: { deviceAttested: true, eventsInWindow: 10, windowMinutes: 10 } });
  assert.equal(ok.reasons.length, 0);

  const burst = assess({ signals: { deviceAttested: true, eventsInWindow: 300, windowMinutes: 10 } });
  assert.ok(burst.reasons.some((r) => r.includes('velocity')));
  assert.ok(burst.humanityScore < ok.humanityScore);
});

// ── anomalies stack ─────────────────────────────────────────────────────────────
test('stacked anomalies compound and push toward denial', () => {
  const a = assess({ signals: {
    eventsInWindow: 240, windowMinutes: 10, datacenterIp: true, accountAgeDays: 0.05, accountsOnDevice: 4,
  } });
  assert.ok(a.reasons.length >= 3, 'multiple flags raised');
  const g = gate({ payout: 10, assessment: a });
  assert.equal(g.allowed, false);
});

// ── gate: payout mechanics ──────────────────────────────────────────────────────
test('gate denies a zero/negative payout request', () => {
  const a = assess({ signals: { idVerified: true, deviceAttested: true } });
  assert.equal(gate({ payout: 0, assessment: a }).allowed, false);
  assert.equal(gate({ payout: -5, assessment: a }).allowed, false);
});

test('gate honors minHumanityScore rule', () => {
  const a = assess({ signals: { deviceAttested: true } }); // score 0.65
  assert.equal(gate({ payout: 10, assessment: a, rules: { minHumanityScore: 0.9 } }).allowed, false);
  assert.equal(gate({ payout: 10, assessment: a, rules: { minHumanityScore: 0.5 } }).allowed, true);
});

test('gate honors maxPayout cap', () => {
  const a = assess({ signals: { idVerified: true, deviceAttested: true } }); // 1.5x
  const g = gate({ payout: 100, assessment: a, rules: { maxPayout: 120 } });
  assert.equal(g.allowed, true);
  assert.equal(g.adjustedPayout, 120); // 100*1.5=150, capped to 120
  assert.ok(g.flags.includes('payout capped'));
});

test('gate carries assessment reasons into flags', () => {
  const a = assess({ signals: { deviceAttested: true, accountsOnDevice: 3 } });
  const g = gate({ payout: 10, assessment: a });
  assert.ok(g.flags.some((f) => f.includes('device shared')));
});

test('gate with no assessment falls back to anonymous and still works', () => {
  const g = gate({ payout: 10 });
  assert.equal(g.allowed, true);
  assert.equal(g.adjustedPayout, 5); // anonymous 0.5x
});

// ── the spoofer-is-unprofitable invariant ───────────────────────────────────────
test('a spoofer never out-earns a clean verified human on the same raw payout', () => {
  const payout = 100;
  const human = gate({ payout, assessment: assess({ signals: { idVerified: true, deviceAttested: true, stepRatePerMin: 110 } }) });
  const spoofer = gate({ payout, assessment: assess({ signals: { stepRatePerMin: 950, accountsOnDevice: 5, datacenterIp: true } }) });

  const spooferEarn = spoofer.allowed ? spoofer.adjustedPayout : 0;
  assert.ok(human.adjustedPayout > spooferEarn, `human ${human.adjustedPayout} vs spoofer ${spooferEarn}`);
});
