import { test } from 'node:test';
import assert from 'node:assert';
import {
  SEASONS, DAYS_PER_SEASON, EPOCH, seasonOf,
  makeLand, makeSeed, plant, harvest, sellHarvest, gift, seasonReward,
} from './crops.mjs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const dayN = (n) => EPOCH + n * MS_PER_DAY; // day n (0-based) from the calendar epoch

test('seasonOf maps calendar days to the four seasons', () => {
  assert.equal(seasonOf(dayN(0)), 'Spring');          // first day
  assert.equal(seasonOf(dayN(14)), 'Spring');         // last day of Spring
  assert.equal(seasonOf(dayN(15)), 'Summer');         // first day of Summer
  assert.equal(seasonOf(dayN(30)), 'Fall');
  assert.equal(seasonOf(dayN(45)), 'Winter');
  assert.equal(seasonOf(dayN(60)), 'Spring');         // wraps after a full cycle
  assert.equal(seasonOf(dayN(-1)), 'Winter');         // day before epoch is end of prior Winter
});

test('off-season plant is rejected, in-season plant succeeds', () => {
  const land = makeLand({ id: 'L', owner: 'alice', rarity: 'common' });
  const summerSeed = makeSeed({ id: 'S', owner: 'alice', name: 'Corn', season: 'Summer', growDays: 4, yield: 20 });

  // It's Spring at the epoch — a Summer seed must be rejected.
  assert.throws(() => plant(land, summerSeed, { now: dayN(0) }), /Summer seed/);

  // In Summer (day 15+) it plants fine.
  const plot = plant(land, summerSeed, { now: dayN(15) });
  assert.equal(plot.kind, 'plot');
  assert.equal(plot.landId, 'L');
});

test('harvest before grow-time is rejected, then allowed once grown', () => {
  const land = makeLand({ id: 'L', owner: 'alice', rarity: 'common' });
  const seed = makeSeed({ id: 'S', owner: 'alice', name: 'Tomato', season: 'Spring', growDays: 5, yield: 12 });
  const plantedAt = dayN(0);
  const plot = plant(land, seed, { now: plantedAt });

  // Too early (day 3 of a 5-day grow) → rejected.
  assert.throws(() => harvest(plot, { now: dayN(3) }), /not ready/);
  assert.equal(plot.harvested, false);

  // Exactly at readyAt → allowed, yields the seed's yield.
  const units = harvest(plot, { now: plot.readyAt });
  assert.equal(units, 12);
  assert.equal(plot.harvested, true);

  // Double-harvest is rejected.
  assert.throws(() => harvest(plot, { now: plot.readyAt }), /already harvested/);
});

test('land rarity sets plot count', () => {
  assert.equal(makeLand({ id: 'a', owner: 'u', rarity: 'common' }).plots, 3);
  assert.equal(makeLand({ id: 'b', owner: 'u', rarity: 'legendary' }).plots, 12);
});

test('gift transfers ownership; cannot gift what you do not own or to yourself', () => {
  const seed = makeSeed({ id: 'S', owner: 'alice', name: 'Tomato', season: 'Spring' });
  const moved = gift(seed, 'alice', 'bob');
  assert.equal(moved.owner, 'bob');
  assert.equal(moved.giftedBy, 'alice');
  assert.equal(seed.owner, 'alice', 'original card is not mutated');

  assert.throws(() => gift(seed, 'charlie', 'bob'), /does not own/);
  assert.throws(() => gift(seed, 'alice', 'alice'), /yourself/);
});

test('gift of an age-restricted item requires age verification (21+)', () => {
  const joint = makeSeed({ id: 'J', owner: 'alice', name: 'Joint', season: 'Summer', ageRestricted: true });
  assert.throws(() => gift(joint, 'alice', 'bob'), /age-verified/);
  const ok = gift(joint, 'alice', 'bob', { ageVerified: true });
  assert.equal(ok.owner, 'bob');
});

test('sellHarvest converts units to CROP token', () => {
  assert.equal(sellHarvest(10), 1);     // default 0.1/unit
  assert.equal(sellHarvest(25), 2.5);
  assert.equal(sellHarvest(0), 0);
  assert.throws(() => sellHarvest(-5), /non-negative/);
});

test('seasonReward splits the pool by your share', () => {
  // 100 units sold → pool of 10 CROP; a 40% share → 4 CROP.
  assert.equal(seasonReward(100, 0.4), 4);
  assert.equal(seasonReward(100, 0), 0);
  assert.equal(seasonReward(100, 1), 10);
  assert.throws(() => seasonReward(100, 1.5), /share must be in/);
});

test('SEASONS shape is the four 15-day seasons', () => {
  assert.deepEqual(SEASONS, ['Spring', 'Summer', 'Fall', 'Winter']);
  assert.equal(DAYS_PER_SEASON, 15);
});
