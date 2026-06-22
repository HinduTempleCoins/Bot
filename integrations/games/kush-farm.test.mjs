// kush-farm.test.mjs — OFFLINE. Pure model: two axes, real seasons, inverse-inflation, multi-harvest, compost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS, currentSeason, isHarvestFestival, canPlant, plantableOn, volunteersOn,
  growBlocks, maturesAt, isReady, harvest, compost, cropTierForCriticality, catalog, getStrain,
} from './kush-farm.mjs';

const WINTER = new Date(2026, 0, 15);   // Jan
const SPRING = new Date(2026, 3, 1);    // Apr
const SUMMER = new Date(2026, 6, 1);    // Jul
const AUTUMN = new Date(2026, 9, 1);    // Oct (not festival)
const FESTIVAL = new Date(2026, 10, 15); // Nov 15 (autumn + festival)

test('currentSeason maps real dates to the four seasons', () => {
  assert.equal(currentSeason(WINTER), 'winter');
  assert.equal(currentSeason(SPRING), 'spring');
  assert.equal(currentSeason(SUMMER), 'summer');
  assert.equal(currentSeason(AUTUMN), 'autumn');
  assert.equal(currentSeason(new Date(2026, 11, 25)), 'winter');   // Dec 25
});

test('Harvest Festival is the back half of autumn', () => {
  assert.equal(isHarvestFestival(FESTIVAL), true);
  assert.equal(isHarvestFestival(AUTUMN), false);   // early autumn, not yet
  assert.equal(isHarvestFestival(SUMMER), false);
});

test('INVERSE INFLATION: short tiers return many seeds, long tiers ~0; KULA yield grows with the wait', () => {
  assert.ok(TIERS.day.seedReturn > TIERS.week.seedReturn);   // daily multiplies (milk)
  assert.equal(TIERS.year.seedReturn, 0);                    // year = no seeds back (gold)
  assert.ok(TIERS.year.yieldMult > TIERS.day.yieldMult);     // but the KULA reward grows with the wait
});

test('canPlant: year-round anytime; season-gated only in its real season (axes independent)', () => {
  assert.equal(canPlant('auto-sour', WINTER), true);     // year-round daily plants in winter
  assert.equal(canPlant('frost-auto', WINTER), true);    // a WINTER-gated daily (short grow, season-locked)
  assert.equal(canPlant('frost-auto', SUMMER), false);   // ...not in summer
  assert.equal(canPlant('spring-bloom', SPRING), true);
  assert.equal(canPlant('spring-bloom', WINTER), false);
});

test('plantableOn + volunteersOn reflect the date', () => {
  assert.ok(plantableOn(WINTER).some((s) => s.id === 'frost-auto'));
  assert.ok(!plantableOn(WINTER).some((s) => s.id === 'spring-bloom'));
  assert.ok(volunteersOn(SPRING).some((s) => s.id === 'wild-ditchweed'));   // volunteers pop up in spring
  assert.equal(volunteersOn(WINTER).length, 0);
});

test('growBlocks scales with the tier; a day << a year', () => {
  assert.ok(growBlocks('auto-sour') > 0);
  assert.ok(growBlocks('punic-gold') > growBlocks('auto-sour') * 100);   // year >> day
});

test('maturesAt + isReady honor the timer and water boost', () => {
  const m = maturesAt(1000, 'van-kush', 0, { blockSec: 12, waterBoostBlocks: 0 });
  assert.ok(m > 1000n);
  assert.equal(isReady(1000, m, 'van-kush'), true);
  assert.equal(isReady(1000, m - 1n, 'van-kush'), false);
  // water shortens it
  const watered = maturesAt(1000, 'van-kush', 5, { blockSec: 12, waterBoostBlocks: 10 });
  assert.ok(watered < m);
});

test('harvest: yield = base × tierMult × season modifier; seedsBack from tier; multi-harvest counts down', () => {
  // Van Kush: baseYield 4, week yieldMult 6, 1.1x season → 4*6*11000/10000 = 26
  const h = harvest('van-kush', { seasonModifierBps: 11000 });
  assert.equal(h.yield, 26n);
  assert.equal(h.seedsBack, TIERS.week.seedReturn);
  // multi-harvest tree: 4 total, first harvest leaves 3
  const tree = harvest('kush-apple', { harvestIndex: 0 });
  assert.equal(tree.harvestsTotal, 4);
  assert.equal(tree.harvestsLeft, 3);
  // a daily pours seeds back (inflationary milk)
  assert.equal(harvest('auto-sour').seedsBack, TIERS.day.seedReturn);
});

test('compost burns matter into fertilizer (the interim sink, with a loop)', () => {
  const c = compost(1000);
  assert.equal(c.burned, 1000);
  assert.ok(c.fertilizer > 0 && c.fertilizer < 1000);   // a fraction back as fertilizer
  assert.deepEqual(compost(-5), { burned: 0, fertilizer: 0 });
});

test('cropTierForCriticality: essentials are fast (day), luxuries are long (year)', () => {
  assert.equal(cropTierForCriticality('essential'), 'day');     // never block a player on a dry market
  assert.equal(cropTierForCriticality('high-burn'), 'day');
  assert.equal(cropTierForCriticality('luxury'), 'year');       // the wait is the value
  assert.equal(cropTierForCriticality('rare'), 'month');
});

test('catalog reports the live season + what is plantable now', () => {
  const cat = catalog(WINTER, 10000);
  assert.equal(cat.season, 'winter');
  assert.ok(cat.plantableNow.includes('frost-auto'));
  assert.ok(!cat.plantableNow.includes('spring-bloom'));
  assert.ok(cat.strains.length >= 10);
  assert.ok(cat.strains.every((s) => typeof s.yield === 'string'));
});
