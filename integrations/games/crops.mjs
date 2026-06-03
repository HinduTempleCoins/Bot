// crops.mjs — dCrops-style seasonal farming game + social gifting (queue #189).
//
// PURE logic, no network. The clock is injectable everywhere ({ now }) so the whole
// game is deterministic and unit-testable offline.
//
// Model:
//   • Four SEASONS — Spring / Summer / Fall / Winter — 15 days each, cycling on a 60-day calendar.
//   • A seed plants ONLY in its matching season (off-season planting is rejected).
//   • Land + Seeds are NFT-style cards. Land rarity sets how many plots it holds.
//   • plant(land, seed, { now })   → a growing plot (records plantedAt + readyAt).
//   • harvest(plot, { now })       → CROP units, but ONLY after the seed's grow time has elapsed.
//   • sellHarvest(units)           → CROP token amount (units → fungible token).
//   • gift(item, fromUser, toUser) → transfers a card between players. This is the
//                                    "send a joint/blunt" viral loop — gifting drives growth.
//   • seasonReward(unitsSold, share) → your cut of the seasonal crop-sale pool.
//
// AGE GATE: cannabis-themed items (the "joint/blunt" gift loop) are 21+ only. Callers must
// enforce a verified 21+ flag (e.g. user.ageVerified === true) before exposing those items
// or accepting a gift of them. This module flags such items via `item.ageRestricted` and
// gift() refuses to move an age-restricted item unless { ageVerified: true } is passed.
//
//   import { SEASONS, seasonOf, plant, harvest, sellHarvest, gift, seasonReward } from './crops.mjs'
//   node integrations/games/crops.mjs            # tiny demo

// ---- calendar ----------------------------------------------------------------

export const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
export const DAYS_PER_SEASON = 15;
export const SEASON_CYCLE_DAYS = SEASONS.length * DAYS_PER_SEASON; // 60
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A fixed calendar epoch so seasonOf is deterministic and independent of "real" history.
// Day 0 (epoch) is the first day of Spring.
export const EPOCH = Date.UTC(2026, 0, 1); // 2026-01-01 = Spring, day 1

// seasonOf(date) → one of SEASONS. Accepts a Date, ms timestamp, or ISO string.
export function seasonOf(date = Date.now()) {
  const t = date instanceof Date ? date.getTime() : (typeof date === 'string' ? Date.parse(date) : Number(date));
  if (!Number.isFinite(t)) throw new TypeError('seasonOf: invalid date');
  const dayIndex = Math.floor((t - EPOCH) / MS_PER_DAY);
  // wrap into [0, SEASON_CYCLE_DAYS) handling negative (pre-epoch) dates correctly
  const wrapped = ((dayIndex % SEASON_CYCLE_DAYS) + SEASON_CYCLE_DAYS) % SEASON_CYCLE_DAYS;
  return SEASONS[Math.floor(wrapped / DAYS_PER_SEASON)];
}

// ---- card factories (NFT-style) ---------------------------------------------

// Land rarity → number of plots.
export const LAND_PLOTS = { common: 3, rare: 6, epic: 9, legendary: 12 };

export function makeLand({ id, owner, rarity = 'common' } = {}) {
  const plots = LAND_PLOTS[rarity];
  if (!plots) throw new Error(`makeLand: unknown rarity "${rarity}"`);
  return { kind: 'land', id, owner, rarity, plots };
}

// A seed card. `season` is the season it can be planted in; `growDays` is grow time;
// `yield` is CROP units produced on harvest. `ageRestricted` flags 21+ items.
export function makeSeed({ id, owner, name, season, growDays = 5, yield: yld = 10, ageRestricted = false } = {}) {
  if (!SEASONS.includes(season)) throw new Error(`makeSeed: invalid season "${season}"`);
  return { kind: 'seed', id, owner, name, season, growDays, yield: yld, ageRestricted: !!ageRestricted };
}

// ---- core game ops -----------------------------------------------------------

const nowOf = (opts) => {
  const n = opts && opts.now;
  const t = n instanceof Date ? n.getTime() : Number(n ?? Date.now());
  if (!Number.isFinite(t)) throw new TypeError('now: invalid clock value');
  return t;
};

// plant(land, seed, { now }) → a growing plot. Rejects off-season planting.
export function plant(land, seed, opts = {}) {
  if (!land || land.kind !== 'land') throw new Error('plant: first arg must be a land card');
  if (!seed || seed.kind !== 'seed') throw new Error('plant: second arg must be a seed card');
  const now = nowOf(opts);
  const season = seasonOf(now);
  if (seed.season !== season) {
    throw new Error(`plant: ${seed.name || seed.id} is a ${seed.season} seed; current season is ${season}`);
  }
  return {
    kind: 'plot',
    landId: land.id,
    seed: { ...seed },
    plantedAt: now,
    readyAt: now + seed.growDays * MS_PER_DAY,
    harvested: false,
  };
}

// harvest(plot, { now }) → CROP units. Rejects before grow time has elapsed.
export function harvest(plot, opts = {}) {
  if (!plot || plot.kind !== 'plot') throw new Error('harvest: arg must be a plot');
  if (plot.harvested) throw new Error('harvest: plot already harvested');
  const now = nowOf(opts);
  if (now < plot.readyAt) {
    const remMs = plot.readyAt - now;
    throw new Error(`harvest: not ready — ${Math.ceil(remMs / MS_PER_DAY)} day(s) of grow time remain`);
  }
  plot.harvested = true;
  return plot.seed.yield;
}

// sellHarvest(units, pricePerUnit) → CROP token amount.
export const CROP_PRICE_PER_UNIT = 0.1; // 1 CROP token per 10 units, by default
export function sellHarvest(units, pricePerUnit = CROP_PRICE_PER_UNIT) {
  const u = Number(units);
  if (!Number.isFinite(u) || u < 0) throw new Error('sellHarvest: units must be a non-negative number');
  return Math.round(u * pricePerUnit * 1e6) / 1e6; // CROP token, 6dp like Graphene assets
}

// gift(item, fromUser, toUser) — the "send a joint/blunt" viral loop.
// Transfers ownership of a card. Age-restricted items require { ageVerified: true }.
export function gift(item, fromUser, toUser, opts = {}) {
  if (!item || !item.kind) throw new Error('gift: arg must be a card');
  if (!fromUser || !toUser) throw new Error('gift: need fromUser and toUser');
  if (item.owner !== fromUser) throw new Error(`gift: ${fromUser} does not own this item`);
  if (fromUser === toUser) throw new Error('gift: cannot gift to yourself');
  if (item.ageRestricted && !(opts && opts.ageVerified === true)) {
    throw new Error('gift: recipient must be age-verified (21+) for this item');
  }
  return { ...item, owner: toUser, giftedBy: fromUser };
}

// ---- season reward split -----------------------------------------------------

// seasonReward(unitsSold, share) → your cut of the seasonal crop-sale pool, in CROP token.
// `share` is your fraction (0..1) of the season's total sold units. The pool value is the
// CROP token from selling `unitsSold`; your reward is share * pool.
export function seasonReward(unitsSold, share, pricePerUnit = CROP_PRICE_PER_UNIT) {
  const s = Number(share);
  if (!Number.isFinite(s) || s < 0 || s > 1) throw new Error('seasonReward: share must be in [0,1]');
  const pool = sellHarvest(unitsSold, pricePerUnit);
  return Math.round(pool * s * 1e6) / 1e6;
}

// ---- CLI demo ----------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('crops.mjs')) {
  const now = EPOCH; // Spring, day 1
  console.log('Season now:', seasonOf(now));
  const land = makeLand({ id: 'land-1', owner: 'alice', rarity: 'rare' });
  const seed = makeSeed({ id: 'seed-1', owner: 'alice', name: 'Tomato', season: 'Spring', growDays: 5, yield: 12 });
  const plot = plant(land, seed, { now });
  console.log('Planted, ready at day', Math.round((plot.readyAt - EPOCH) / MS_PER_DAY) + 1);
  const units = harvest(plot, { now: plot.readyAt });
  console.log('Harvested units:', units, '→ CROP token:', sellHarvest(units));
  console.log('Season reward (40% share):', seasonReward(units, 0.4));
  const joint = makeSeed({ id: 'gift-1', owner: 'alice', name: 'Joint', season: 'Summer', ageRestricted: true });
  console.log('Gifted:', gift(joint, 'alice', 'bob', { ageVerified: true }));
}
