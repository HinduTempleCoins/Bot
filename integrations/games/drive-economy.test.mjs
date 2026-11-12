// drive-economy.test.mjs — MELEK Drive economics. OFFLINE, pure: no fs, no network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classify, driveWeight, driveDiminish, sourceBoost, gasEquivalent, driveBudgetForEpoch,
  driveEconomySummary, DRIVE_MILES_CAP, DRIVE_EPOCH_CAP, DRIVE_FUND_INFLOW_PER_HOUR, DRIVE_FUND_PCT, WALK_EPOCH_CAP,
} from './drive-economy.mjs';

test('the drive lane has its OWN fund, and its cap equals that fund\'s inflow', () => {
  assert.equal(DRIVE_FUND_PCT(), 0.15);                     // 15%: 3 content + 5 mining + 7 proposal
  assert.equal(DRIVE_FUND_INFLOW_PER_HOUR(), 135);          // 0.15 x 1 MELEK/block x 21,600/day / 24
  assert.equal(DRIVE_EPOCH_CAP(), DRIVE_FUND_INFLOW_PER_HOUR(), 'cap = inflow: cannot drain, cannot hoard');
  assert.equal(driveBudgetForEpoch(), 135);
});

test('the walk lane is NOT touched — this is not a share of the Move pool', () => {
  assert.equal(WALK_EPOCH_CAP(), 150, 'the Move cap stays where it was');
  const s = driveEconomySummary();
  assert.equal(s.fund, 'drive');
  assert.equal(s.walkLaneTouched, false);
  assert.match(s.fundSource, /NOT the Move pool/);
  assert.match(s.fundSource, /mining/, 'the operator put points on the mining slice');
  assert.match(s.fundSource, /blogging 50% -> 47%/, 'and 3 more points on blogging');
  assert.match(s.note, /OWN chain reward fund/);
});

test('classify: driving, walking and impossible speeds are told apart', () => {
  assert.equal(classify({ miles: 12, seconds: 1200 }).lane, 'drive');       // 36 mph
  assert.equal(classify({ miles: 1, seconds: 1200 }).lane, 'walk');         // 3 mph — the walk lane pays that
  assert.equal(classify({ miles: 200, seconds: 1200 }).lane, 'rejected');   // 600 mph — not a car
  assert.match(classify({ miles: 200, seconds: 1200 }).reason, /faster than a car/);
});

test('classify needs a distance and a time (or a speed), and never throws on junk', () => {
  assert.equal(classify({}).lane, 'rejected');
  assert.equal(classify({ miles: 10 }).lane, 'rejected');                   // no elapsed time
  assert.equal(classify({ miles: 10, avgMph: 40 }).lane, 'drive');          // speed given directly
  assert.equal(classify({ miles: 'x', seconds: 'y' }).lane, 'rejected');
  assert.equal(classify(null).lane, 'rejected');
});

test('driveWeight scales with miles and stake, and honours the hourly mile cap', () => {
  const a = driveWeight({ stake: 0, miles: 10 });
  const b = driveWeight({ stake: 0, miles: 20 });
  assert.ok(b > a && Math.abs(b - 2 * a) < 1e-9, 'linear in miles');
  assert.ok(driveWeight({ stake: 1000, miles: 10 }) > a, 'stake-weighted, like vote weight');
  // a driver already at the cap earns nothing more this hour
  assert.equal(driveWeight({ miles: 10, milesAlready: DRIVE_MILES_CAP() }), 0);
  // and a sample that straddles the cap is only paid for the miles under it
  const partial = driveWeight({ miles: 10, milesAlready: DRIVE_MILES_CAP() - 4 });
  assert.ok(partial > 0 && partial < driveWeight({ miles: 10 }));
});

test('a verified MELEK Ride trip is worth more per mile than a self-reported shift', () => {
  assert.ok(sourceBoost('ride') > sourceBoost('rideshare'));
  assert.equal(sourceBoost('rideshare'), sourceBoost('shift'));
  assert.equal(sourceBoost('anything-else'), 1);
  assert.ok(driveWeight({ miles: 10, source: 'ride' }) > driveWeight({ miles: 10, source: 'shift' }));
});

test('diminishing returns within the hour are gentler than walking (a shift is many samples)', () => {
  assert.equal(driveDiminish(0), 1);
  assert.ok(driveDiminish(1) < 1 && driveDiminish(1) > 0.5);
  assert.ok(driveDiminish(10) < driveDiminish(1));
  assert.equal(driveDiminish(-5), 1);
});

test('gasEquivalent gives NO dollar figure without a price — and the math when there is one', () => {
  const unpriced = gasEquivalent({ melek: 12 });
  assert.equal(unpriced.usd, null);
  assert.equal(unpriced.gallons, null);
  assert.match(unpriced.note, /No market price for MELEK yet/);

  const priced = gasEquivalent({ melek: 12, melekUsd: 0.25, gasUsdPerGallon: 3, mpg: 25 });
  assert.equal(priced.usd, 3);              // 12 x 0.25
  assert.equal(priced.gallons, 1);          // $3 / $3 per gal
  assert.equal(priced.milesOfGas, 25);      // 1 gal x 25 mpg
  assert.equal(priced.theoretical, true);   // derived from a supplied price, never from a trade
  assert.match(priced.note, /Derived from the price supplied, not from a trade/);
});

test('driveEconomySummary states the fund, its source and the cap', () => {
  const s = driveEconomySummary();
  assert.equal(s.lane, 'drive');
  assert.equal(s.fund, 'drive');
  assert.equal(s.driveCapPerHour, s.fundInflowPerHour);
  assert.equal(s.fundSharePct, 0.15);
  assert.equal(s.miningSlicePct, 0.05, 'block pay goes 10% -> 5%');
  assert.equal(s.proposalSlicePct, 0.03, 'the DAO keeps a permanent 3%');
  assert.equal(s.contentSlicePct, 0.47, 'blogging gives up 3 points');
  // the three carves plus the untouched lanes still account for the whole emission
  assert.equal(s.contentSlicePct + 0.15 + 0.15 + s.miningSlicePct + s.proposalSlicePct + s.fundSharePct, 1);
});
