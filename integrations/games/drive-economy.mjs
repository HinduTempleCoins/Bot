// drive-economy.mjs — MELEK Drive: the DRIVE-to-earn half of MELEK Move (gas money for miles driven).
//
// MELEK Move pays WALKING out of the chain's "move" reward fund (move-economy.mjs). MELEK Drive pays
// DRIVING out of its OWN chain-level reward fund, "drive" — operator, 2026-11-11: the drive lane is NOT
// the Move pool, and it is funded by hardforking further emission into it from elsewhere in the split.
// Operator, 2026-11-12: "We are going to take some of the Mining Rewards for Driving." So at the MELEK
// Drive flip (MELEK_DRIVE_ATTESTER_PAY_TIME) the drive fund takes 15% of emission from two places —
// the whole proposal(SPS) carve (10 points) and half the mining/block-producer slice (5 points):
//
//   walk  "move"  fund: 15% of emission, 150.000/epoch cap   (unchanged)
//   drive "drive" fund: 15% of emission, 135.000/epoch cap   (new — 0.15 x 21,600 / 24 = 135.000/hr)
//   mining (block pay):  10% -> 5%        proposal(SPS): 10% -> 0%
//
// The drive cap equals the drive fund's own inflow, so that fund neither drains under a full hour nor
// grows without bound. Content, vesting and the walk lane do not move at all.
//
// WHAT THIS MODULE IS: the pure economic engine for the drive lane — the walk/drive classifier, the
// per-mile drive-weight (the rshares analog the drive cap is split by), the anti-cheat bounds, and the
// GAS ARITHMETIC that turns a driver's MELEK into gallons. No network, no keys, no state (drive-ledger
// holds the hourly tally; the chain pays). Tested offline.
//
//   import { classify, driveWeight, driveBudgetForEpoch, gasEquivalent } from './drive-economy.mjs';

import { STAKE_FLOOR, EPOCH_SEC } from './move-economy.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };

// ── the drive lane's own budget — mirrors the chain constants in config.hpp ────────────────────────
/** The drive fund's share of emission (chain: MELEK_DRIVE_FUND_PERCENT). */
export const DRIVE_FUND_PCT = () => num('DRIVE_FUND_PCT', 0.15);
/** MELEK drawn per closed hour for the drive lane (chain: MELEK_DRIVE_EPOCH_PAY_CAP_AMOUNT). */
export const DRIVE_EPOCH_CAP = () => num('DRIVE_EPOCH_CAP', 135);
/** The drive fund's inflow: 15% of a flat 1.000 MELEK/block at 21,600 blocks/day = 135.000 MELEK/hour. */
export const DRIVE_FUND_INFLOW_PER_HOUR = () => DRIVE_FUND_PCT() * num('MELEK_BLOCK_REWARD', 1) * num('MELEK_BLOCKS_PER_DAY', 21600) / 24;
/** The walk lane, for contrast — untouched by this flip. */
export const WALK_EPOCH_CAP = () => num('MOVE_EPOCH_CAP', 150);
/** The drive budget for one epoch (hour). Equal to the chain's per-epoch drive cap. */
export const driveBudgetForEpoch = () => DRIVE_EPOCH_CAP() * (EPOCH_SEC() / 3600);

// ── classification: is this sample walking, driving, or impossible? ────────────────────────────────
// A phone cannot tell a car from a bicycle from a train, and it should not pretend to. What it CAN do
// is bound the claim: below DRIVE_MIN_MPH the sample belongs to the walk lane (where steps already pay
// it), and above DRIVE_MAX_MPH no road vehicle produced it — that is a spoof or a flight, and it earns
// nothing. Everything between is the drive lane. The bands are the whole anti-cheat story for speed.
export const DRIVE_MIN_MPH = () => num('DRIVE_MIN_MPH', 8);     // below this it is walking/cycling, not driving
export const DRIVE_MAX_MPH = () => num('DRIVE_MAX_MPH', 95);    // above this it is not a car on a road
/** Miles one account may claim in one hour, whatever the GPS says (95 mph for a full hour is the ceiling). */
export const DRIVE_MILES_CAP = () => num('DRIVE_MILES_CAP', 95);

/**
 * Classify one drive sample from its distance and elapsed time.
 * @param {{miles?:number, seconds?:number, avgMph?:number}} s
 * @returns {{lane:'drive'|'walk'|'rejected', avgMph:number, miles:number, reason?:string}}
 */
export function classify(sample) {
  const { miles = 0, seconds = 0, avgMph } = sample || {};
  const mi = Math.max(0, Number(miles) || 0);
  const sec = Math.max(0, Number(seconds) || 0);
  const mph = Number.isFinite(Number(avgMph)) && Number(avgMph) > 0
    ? Number(avgMph)
    : (sec > 0 ? mi / (sec / 3600) : 0);
  if (!(mi > 0)) return { lane: 'rejected', avgMph: mph, miles: 0, reason: 'no distance in this sample' };
  if (!(mph > 0)) return { lane: 'rejected', avgMph: 0, miles: mi, reason: 'need elapsed time or average speed' };
  if (mph > DRIVE_MAX_MPH()) return { lane: 'rejected', avgMph: mph, miles: mi, reason: `${Math.round(mph)} mph is faster than a car on a road — not counted` };
  if (mph < DRIVE_MIN_MPH()) return { lane: 'walk', avgMph: mph, miles: mi, reason: 'slower than driving — this belongs to the walk lane' };
  return { lane: 'drive', avgMph: mph, miles: mi };
}

// ── the drive-weight (rshares analog), per mile ────────────────────────────────────────────────────
// Same shape as moveWeight so the two lanes read alike: effective stake x activity x boost x diminish.
// Activity here is MILES (capped per hour), not geo-cells. The stake floor is shared with the walk lane
// so a driver with no MELEK still earns a baseline share — the on-ramp reason the floor exists.
export const DRIVE_BASE = () => num('DRIVE_BASE', 10);          // base weight per mile, mirrors GEO_REWARD per cell
/**
 * Verified MELEK Ride trips earn a boost; a self-reported third-party shift does not. The asymmetry is
 * deliberate and it is not a judgement about Uber or Lyft: a trip completed on MELEK Ride is a record
 * this system can check, and a typed-in "I drove for a rideshare app" is not. Set DRIVE_RIDE_BOOST to
 * 1 to pay them the same.
 */
export const DRIVE_RIDE_BOOST = () => num('DRIVE_RIDE_BOOST', 1.5);   // verified MELEK Ride trip
export const DRIVE_SHIFT_BOOST = () => num('DRIVE_SHIFT_BOOST', 1);   // self-reported third-party shift
export const DRIVE_DIMINISH_K = () => num('DRIVE_DIMINISH_K', 0.25);  // gentler than walking: a shift is many samples

/** Diminishing returns within the hour, by sample index (0-based). Gentler than the walk lane's. */
export function driveDiminish(sampleIndex) {
  return 1 / (1 + DRIVE_DIMINISH_K() * Math.max(0, Number(sampleIndex) || 0));
}

/** The boost for a sample's source: a verified MELEK Ride trip, a third-party shift, or neither. */
export function sourceBoost(source) {
  const s = String(source || '').toLowerCase();
  if (s === 'ride' || s === 'melek-ride') return DRIVE_RIDE_BOOST();
  if (s === 'rideshare' || s === 'shift') return DRIVE_SHIFT_BOOST();
  return 1;
}

/**
 * A driver's drive-weight for one sample — the rshares analog the drive cap is split by.
 *   weight = (stake + floor) x cappedMiles x DRIVE_BASE x sourceBoost x diminish
 * @param {{stake?:number, miles?:number, source?:string, diminish?:number, milesAlready?:number}} p
 */
export function driveWeight(p) {
  const { stake = 0, miles = 0, source, diminish = 1, milesAlready = 0 } = p || {};
  const effStake = Math.max(0, Number(stake) || 0) + STAKE_FLOOR();
  const room = Math.max(0, DRIVE_MILES_CAP() - Math.max(0, Number(milesAlready) || 0));
  const mi = Math.min(Math.max(0, Number(miles) || 0), room);
  if (!(mi > 0)) return 0;
  return effStake * mi * DRIVE_BASE() * sourceBoost(source) * (Number(diminish) || 0);
}

// ── gas arithmetic — the whole point of the lane, as arithmetic rather than as a slogan ────────────
// MELEK has no market price yet, so there is no honest USD figure to print unless someone supplies a
// price. gasEquivalent therefore returns usd/gallons/milesOfGas = null when no price is given, and a
// THEORETICAL figure when one is (priced = false means "derived from a price you supplied, not a trade").
export const GAS_USD_PER_GALLON = () => num('GAS_USD_PER_GALLON', 3);
export const VEHICLE_MPG = () => num('VEHICLE_MPG', 25);

/**
 * Turn an amount of MELEK into gas, at a supplied MELEK price.
 * @param {{melek:number, melekUsd?:number|null, gasUsdPerGallon?:number, mpg?:number}} p
 * @returns {{melek:number, melekUsd:number|null, usd:number|null, gallons:number|null,
 *            milesOfGas:number|null, gasUsdPerGallon:number, mpg:number, theoretical:boolean, note:string}}
 */
export function gasEquivalent(p) {
  const { melek = 0, melekUsd, gasUsdPerGallon, mpg } = p || {};
  const amt = Math.max(0, Number(melek) || 0);
  const perGal = Number(gasUsdPerGallon) > 0 ? Number(gasUsdPerGallon) : GAS_USD_PER_GALLON();
  const mileage = Number(mpg) > 0 ? Number(mpg) : VEHICLE_MPG();
  const envPrice = Number(env('MELEK_USD', ''));
  const price = Number.isFinite(Number(melekUsd)) && Number(melekUsd) > 0
    ? Number(melekUsd)
    : (Number.isFinite(envPrice) && envPrice > 0 ? envPrice : null);
  if (price == null) {
    return {
      melek: round(amt, 3), melekUsd: null, usd: null, gallons: null, milesOfGas: null,
      gasUsdPerGallon: perGal, mpg: mileage, theoretical: true,
      note: 'No market price for MELEK yet, so there is no dollar figure to give. Set MELEK_USD (or pass melekUsd) to price it.',
    };
  }
  const usd = amt * price;
  const gallons = usd / perGal;
  return {
    melek: round(amt, 3), melekUsd: price, usd: round(usd, 4), gallons: round(gallons, 4),
    milesOfGas: round(gallons * mileage, 2), gasUsdPerGallon: perGal, mpg: mileage, theoretical: true,
    note: `Theoretical: ${round(amt, 3)} MELEK at $${price} = $${round(usd, 4)} = ${round(gallons, 4)} gal at $${perGal}/gal = ${round(gallons * mileage, 2)} mi at ${mileage} mpg. Derived from the price supplied, not from a trade.`,
  };
}

const round = (n, p) => { const f = 10 ** p; return Math.round(Number(n) * f) / f; };

/** A plain breakdown of the drive lane at current params — for /economy endpoints + the report. */
export function driveEconomySummary() {
  return {
    lane: 'drive',
    fund: 'drive',
    fundSharePct: DRIVE_FUND_PCT(),
    fundSource: 'the proposal(SPS) carve (10 points) + half the mining/block-producer slice (5 points), moved to the drive fund at the MELEK Drive flip — NOT the Move pool',
    driveCapPerHour: DRIVE_EPOCH_CAP(),
    fundInflowPerHour: DRIVE_FUND_INFLOW_PER_HOUR(),
    walkCapPerHour: WALK_EPOCH_CAP(),
    walkLaneTouched: false,
    miningSlicePct: 0.05,          // block pay after the flip: 10% -> 5%
    proposalSlicePct: 0,           // the treasury carve goes to zero
    driveBudgetPerHour: driveBudgetForEpoch(),
    speedBandMph: [DRIVE_MIN_MPH(), DRIVE_MAX_MPH()],
    milesCapPerHour: DRIVE_MILES_CAP(),
    basePerMile: DRIVE_BASE(),
    rideBoost: DRIVE_RIDE_BOOST(),
    shiftBoost: DRIVE_SHIFT_BOOST(),
    stakeWeighted: true,
    note: 'MELEK Drive has its OWN chain reward fund, "drive" (15% of emission = 135.000 MELEK/hr, carved from the proposal fund and half the mining reward), split by stake-weighted drive-weight per mile and paid on-chain hourly by the drive_pay attested op. It is not the Move pool, and the Move pool is unchanged.',
  };
}

if (process.argv[1] && process.argv[1].endsWith('drive-economy.mjs')) {
  console.log(JSON.stringify(driveEconomySummary(), null, 2));
  const claims = [
    { who: 'rideshare-driver', miles: 42, source: 'ride', stake: 500 },
    { who: 'commuter', miles: 24, source: null, stake: 0 },
    { who: 'third-party-shift', miles: 60, source: 'rideshare', stake: 0 },
  ];
  const rows = claims.map((c) => ({ ...c, weight: driveWeight(c) }));
  const total = rows.reduce((s, r) => s + r.weight, 0);
  console.log(`\nexample hour (${DRIVE_EPOCH_CAP().toFixed(3)} MELEK drive cap, its own fund):`);
  for (const r of rows) {
    const melek = total > 0 ? (DRIVE_EPOCH_CAP() * r.weight) / total : 0;
    console.log(`  ${r.who.padEnd(18)} ${r.miles} mi  ${melek.toFixed(3)} MELEK  ${gasEquivalent({ melek }).note.slice(0, 60)}`);
  }
}
