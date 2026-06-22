// kush-farm.mjs — the Kush Farm GROW MODEL (the Pot-Farm / RS3-style game design over PRANA SeasonalFarm).
//
// Pure, off-chain, deterministic design + math. Two INDEPENDENT dials per plant:
//   • growTier  — day | week | month | year   (sets the wait AND the inflation, via SEED-RETURN)
//   • season    — none | spring | summer | autumn | winter  (none = year-round; else a real-calendar gate)
// plus per-plant flags: multiHarvest (harvest several times across a window) and volunteer (self-sprouts
// after winter). Year is a PRIVATE rolling timer.
//
// INVERSE INFLATION (the core lever = SEEDS you get BACK on harvest, NOT the KULA yield):
//   day   → returns MANY seeds (≈4) → multiplies, "pours out like water", milk-not-gold, carpets landscapes.
//   week  → ≈1 back.  month → ≈1.  year → ≈0 (you get the prize crop, not seeds) → scarce, gold.
// The KULA yield, by contrast, GROWS with the wait (longer = bigger reward) and is scaled by the on-chain
// per-SEASON modifier on top.
//
// SUPPLY ↔ DEMAND: games are the real sink. Essential/high-burn game inputs map to the abundant DAILY crops
// (so a dry market never BLOCKS a player — they grow their own fast); luxury/rare/collectable inputs map to
// the scarce season/year crops (the wait IS the value). Compost is the interim sink until those games exist.
//
//   import { TIERS, SEASONS, STRAINS, currentSeason, canPlant, growSeconds, growBlocks, maturesAt, isReady,
//            harvest, volunteersOn, isHarvestFestival, compost, cropTierForCriticality, catalog }

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const BLOCK_SEC = () => Number(env('PRANA_BLOCK_SEC', '12')) || 12;
export const MODIFIER_DENOMINATOR = 10000n;   // 10000 bps = 1.0x season modifier (mirrors SeasonalFarm)
const DAY = 86400;

// ── grow tiers — wait + the inverse-inflation seed-return + the KULA-yield growth ────────────────────
export const TIERS = {
  day:   { id: 'day',   label: 'Daily',   growSeconds: 1 * DAY,   seedReturn: 4, yieldMult: 1,  blurb: 'Pours out daily — the milk. Cheap, abundant, the come-back-and-tend grind; feeds the high-burn games.' },
  week:  { id: 'week',  label: 'Weekly',  growSeconds: 7 * DAY,   seedReturn: 1, yieldMult: 6,  blurb: 'A week to flower; barely any seeds back, so it stays scarcer and worth more.' },
  month: { id: 'month', label: 'Monthly', growSeconds: 30 * DAY,  seedReturn: 1, yieldMult: 22, blurb: 'A month in the ground — scarce, a real commitment.' },
  year:  { id: 'year',  label: 'Yearly',  growSeconds: 365 * DAY, seedReturn: 0, yieldMult: 120, blurb: 'A private year-long grow — no seeds back, the prestige/legacy crop. Gold.' },
};
export const isTier = (t) => Object.prototype.hasOwnProperty.call(TIERS, String(t || ''));

// ── real seasons — approximate solstice/equinox windows (good enough for a game) ─────────────────────
// [startMonth, startDay] inclusive → next season's start exclusive. Northern hemisphere.
export const SEASONS = {
  spring: { id: 'spring', label: 'Spring', start: [3, 20], emoji: '🌷' },
  summer: { id: 'summer', label: 'Summer', start: [6, 21], emoji: '☀️' },
  autumn: { id: 'autumn', label: 'Autumn', start: [9, 22], emoji: '🍂' },
  winter: { id: 'winter', label: 'Winter', start: [12, 21], emoji: '❄️' },
};
export const isSeason = (s) => Object.prototype.hasOwnProperty.call(SEASONS, String(s || ''));

/** The real season for a date (Date or {month,day}); defaults to now. */
export function currentSeason(date = new Date()) {
  const m = date.getMonth ? date.getMonth() + 1 : Number(date.month);
  const d = date.getDate ? date.getDate() : Number(date.day);
  const md = m * 100 + d;
  if (md >= 1221 || md < 320) return 'winter';
  if (md < 621) return 'spring';
  if (md < 922) return 'summer';
  return 'autumn';
}
/** The Fall Harvest Festival window — the autumn community capstone (here: the back half of autumn). */
export function isHarvestFestival(date = new Date()) {
  if (currentSeason(date) !== 'autumn') return false;
  const m = date.getMonth ? date.getMonth() + 1 : Number(date.month);
  const d = date.getDate ? date.getDate() : Number(date.day);
  return (m * 100 + d) >= 1101;   // Nov onward = festival run-up to the harvest
}

// ── strain catalog — { growTier, season, multiHarvest, volunteer, rarity, baseYield(KULA), seedReturn? } ──
// season:null = year-round (grows any season). multiHarvest:n = harvest n times across its window.
export const STRAINS = [
  // year-round grind ("milk") — essential/high-burn game feedstock; never blocks a player
  { id: 'auto-sour',     name: 'Auto Sour',     growTier: 'day',  season: null,     rarity: 'common',    baseYield: 2 },
  { id: 'daily-diesel',  name: 'Daily Diesel',  growTier: 'day',  season: null,     rarity: 'common',    baseYield: 2 },
  { id: 'van-kush',      name: 'Van Kush',      growTier: 'week', season: null,     rarity: 'uncommon',  baseYield: 4 },
  { id: 'kush-og',       name: 'Kush OG',       growTier: 'month', season: null,    rarity: 'rare',      baseYield: 6 },
  // a daily that's WINTER-only (proves the axes are independent: short grow, season-gated)
  { id: 'frost-auto',    name: 'Frost Auto',    growTier: 'day',  season: 'winter', rarity: 'uncommon',  baseYield: 3 },
  // spring collectables + volunteers
  { id: 'spring-bloom',  name: 'Spring Bloom',  growTier: 'week', season: 'spring', rarity: 'rare',      baseYield: 5, flower: true },
  { id: 'wild-ditchweed', name: 'Wild Ditchweed', growTier: 'week', season: 'spring', rarity: 'common', baseYield: 3, volunteer: true },
  // multi-harvest tree (apple-like) — plant once, harvest several times across summer→fall
  { id: 'kush-apple',    name: 'Kush Apple Tree', growTier: 'month', season: 'summer', rarity: 'rare',  baseYield: 4, multiHarvest: 4 },
  // the Fall Harvest Festival crop — spring-planted, harvested at the festival
  { id: 'harvest-haze',  name: 'Harvest Haze',  growTier: 'season', season: 'spring', rarity: 'rare',   baseYield: 10, festival: true },
  // premium long grows — luxury/collectable, the wait is the value
  { id: 'punic-gold',    name: 'Punic Gold',    growTier: 'year', season: null,      rarity: 'legendary', baseYield: 12 },
  { id: 'heirloom-melek', name: 'Heirloom MELEK', growTier: 'year', season: 'autumn', rarity: 'legendary', baseYield: 16 },
];
// the 'season' growTier on a festival crop maps to ~a full real season of waiting
TIERS.season = { id: 'season', label: 'Seasonal', growSeconds: 90 * DAY, seedReturn: 0, yieldMult: 90, blurb: 'A whole real season in the ground — planted in spring, reaped at the Fall Harvest Festival.' };

export const getStrain = (id) => STRAINS.find((s) => s.id === String(id || '').toLowerCase()) || null;
const tierOf = (s) => (s && isTier(s.growTier) ? TIERS[s.growTier] : null);
const seedReturnOf = (s) => (s && s.seedReturn != null ? Number(s.seedReturn) : (tierOf(s) ? tierOf(s).seedReturn : 0));

/** Can this strain be PLANTED on `date`? year-round (season:null) always; else only in its season's window. */
export function canPlant(strain, date = new Date()) {
  const s = typeof strain === 'string' ? getStrain(strain) : strain;
  if (!s || !tierOf(s)) return false;
  if (!s.season) return true;                 // year-round: plant any time (even "out of season" — it's a game)
  return currentSeason(date) === s.season;    // season-gated: only in its real season
}
/** Strains plantable right now (for a "what can I plant?" UI). */
export const plantableOn = (date = new Date()) => STRAINS.filter((s) => canPlant(s, date));
/** Strains that can VOLUNTEER (self-sprout) — relevant just after winter, in spring. */
export const volunteersOn = (date = new Date()) => (currentSeason(date) === 'spring' ? STRAINS.filter((s) => s.volunteer) : []);

export function growSeconds(strain) { const t = tierOf(typeof strain === 'string' ? getStrain(strain) : strain); return t ? t.growSeconds : 0; }
export function growBlocks(strain, blockSec = BLOCK_SEC()) { const s = growSeconds(strain); const b = Number(blockSec) || 1; return s > 0 ? Math.ceil(s / b) : 0; }

/** Maturity block (mirrors the contract's water-shortens-growth rule). */
export function maturesAt(plantedAtBlock, strain, waterUnits = 0, { blockSec = BLOCK_SEC(), waterBoostBlocks = 0 } = {}) {
  const planted = BigInt(plantedAtBlock);
  const grow = BigInt(growBlocks(strain, blockSec));
  const boost = BigInt(Math.max(0, Number(waterUnits) || 0)) * BigInt(Math.max(0, Number(waterBoostBlocks) || 0));
  return planted + (grow > boost ? grow - boost : 0n);
}
export function isReady(plantedAtBlock, headBlock, strain, waterUnits = 0, opts = {}) {
  try { return BigInt(headBlock) >= maturesAt(plantedAtBlock, strain, waterUnits, opts); } catch { return false; }
}

/**
 * Harvest result for one maturing: the KULA yield (baseYield × tier yieldMult × season modifier) AND the
 * SEEDS back (the inflation lever — many for daily, ~0 for year) AND multi-harvest remaining.
 */
export function harvest(strain, { seasonModifierBps = 10000, harvestIndex = 0 } = {}) {
  const s = typeof strain === 'string' ? getStrain(strain) : strain;
  const t = tierOf(s);
  if (!s || !t) return { yield: 0n, seedsBack: 0, harvestsTotal: 0, harvestsLeft: 0 };
  const base = BigInt(Math.max(0, Number(s.baseYield) || 0));
  const out = (base * BigInt(t.yieldMult) * BigInt(seasonModifierBps || 0)) / MODIFIER_DENOMINATOR;
  const total = Math.max(1, Number(s.multiHarvest) || 1);
  return {
    yield: out,
    seedsBack: Math.max(0, seedReturnOf(s)),
    harvestsTotal: total,
    harvestsLeft: Math.max(0, total - (Number(harvestIndex) + 1)),
  };
}

// ── COMPOST — the (interim) deflation sink: burn plant matter → fertilizer (a yield-boosting input) ───
export const COMPOST_RATE_BPS = () => Number(env('KUSH_COMPOST_BPS', '2000')) || 2000;   // matter → fertilizer
/** Compost `matter` units of surplus plant matter → fertilizer out (a sink with a loop). Pure. */
export function compost(matter) {
  const m = Math.max(0, Math.floor(Number(matter) || 0));
  return { burned: m, fertilizer: Math.floor((m * COMPOST_RATE_BPS()) / 10000) };
}

// ── supply↔demand: which crop tier feeds a game input of a given criticality ──────────────────────────
/** essential → daily (never block a player on a dry market); luxury/rare → long grows (the wait is value). */
export function cropTierForCriticality(criticality) {
  const c = String(criticality || '').toLowerCase();
  if (c === 'essential' || c === 'high-burn' || c === 'necessity') return 'day';
  if (c === 'common' || c === 'standard') return 'week';
  if (c === 'rare' || c === 'premium') return 'month';
  return 'year';   // luxury / collectable / legacy
}

/** UI-friendly catalog grouped for the Kush Farm page: what's plantable now + the full strain list. */
export function catalog(date = new Date(), seasonModifierBps = 10000) {
  const season = currentSeason(date);
  return {
    season, festival: isHarvestFestival(date), seasonLabel: SEASONS[season] && SEASONS[season].label,
    plantableNow: plantableOn(date).map((s) => s.id),
    volunteersNow: volunteersOn(date).map((s) => s.id),
    strains: STRAINS.map((s) => {
      const h = harvest(s, { seasonModifierBps });
      return { id: s.id, name: s.name, tier: s.growTier, tierLabel: tierOf(s) && tierOf(s).label,
        season: s.season || 'year-round', rarity: s.rarity, multiHarvest: Number(s.multiHarvest) || 1,
        volunteer: !!s.volunteer, flower: !!s.flower, festival: !!s.festival,
        yield: h.yield.toString(), seedsBack: h.seedsBack, plantableNow: canPlant(s, date) };
    }),
  };
}

if (process.argv[1] && process.argv[1].endsWith('kush-farm.mjs')) {
  console.log(JSON.stringify(catalog(new Date(), 11000), null, 2));
}
