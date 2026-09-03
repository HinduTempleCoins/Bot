// plant-genetics.test.mjs — offline, deterministic. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRAINS, STAT_GENES, LINEAGE, LINEAGE_GROW_MULT,
  createStrain, phenotype, rarityTier, breedCost, cooldownBlocks,
  canBreed, breedStrains, tradeable, rngFromCtx,
  BREED_COST_SCHEDULE, MAX_BREEDS, COOLDOWN_BASE_BLOCKS, COOLDOWN_MAX_BLOCKS,
} from './plant-genetics.mjs';

test('createStrain builds a Gen-0 plant from a founder strain', () => {
  const p = createStrain({ strain: 'kailash_frost', id: 'm1' });
  assert.equal(p.strain, 'kailash_frost');
  assert.equal(p.generation, 0);
  assert.equal(p.breedCount, 0);
  assert.equal(p.readyBlock, 0);
  assert.equal(p.id, 'm1');
  for (const g of STAT_GENES) assert.equal(p.genome[g].length, 2);
  assert.equal(p.genome.lineage.length, 2);
});

test('createStrain rejects unknown strain and unknown lineage', () => {
  assert.throws(() => createStrain({ strain: 'nope' }), /unknown strain/);
  assert.throws(() => createStrain({ strain: 'nataraja', genes: { lineage: ['martian', 'hybrid'] } }), /unknown lineage/);
});

test('createStrain clamps stat alleles to 0..100', () => {
  const p = createStrain({ strain: 'nataraja', genes: { potency: [150, -5] } });
  assert.deepEqual(p.genome.potency, [100, 0]);
});

test('phenotype expresses the dominant (higher) stat allele and sums them', () => {
  const p = createStrain({ strain: 'kailash_frost' });
  const ph = phenotype(p);
  assert.equal(ph.potency, 58); // max(58,54)
  assert.equal(ph.yield, 78);   // max(78,70)
  assert.equal(ph.resilience, 82);
  assert.equal(ph.aroma, 36);
  assert.equal(ph.statSum, 254);
  assert.equal(ph.rarity, 'rare');
});

test('phenotype expresses dominant lineage and its grow multiplier', () => {
  const p = createStrain({ strain: 'ganga_green' }); // lineage ['ruderalis','indica'] -> indica dominant (earlier in list)
  const ph = phenotype(p);
  assert.equal(ph.lineage, 'indica');
  assert.equal(ph.growMult, LINEAGE_GROW_MULT.indica);
});

test('rarityTier boundaries', () => {
  assert.equal(rarityTier(0), 'common');
  assert.equal(rarityTier(159), 'common');
  assert.equal(rarityTier(160), 'uncommon');
  assert.equal(rarityTier(220), 'rare');
  assert.equal(rarityTier(280), 'epic');
  assert.equal(rarityTier(340), 'legendary');
  assert.equal(rarityTier(400), 'legendary');
});

test('founder strain rarities are as designed', () => {
  assert.equal(phenotype(createStrain({ strain: 'kailash_frost' })).rarity, 'rare');
  assert.equal(phenotype(createStrain({ strain: 'nataraja' })).rarity, 'rare');
  assert.equal(phenotype(createStrain({ strain: 'soma_rising' })).rarity, 'uncommon');
  assert.equal(phenotype(createStrain({ strain: 'ganga_green' })).rarity, 'uncommon');
});

test('breedCost follows the Axie-style escalating schedule and caps', () => {
  assert.equal(breedCost(0), BREED_COST_SCHEDULE[0]);
  assert.equal(breedCost(3), 500);
  assert.equal(breedCost(6), 2100);
  assert.equal(breedCost(10), 2100); // capped at last
});

test('cooldownBlocks doubles per breed and is capped', () => {
  assert.equal(cooldownBlocks(0), COOLDOWN_BASE_BLOCKS);
  assert.equal(cooldownBlocks(1), COOLDOWN_BASE_BLOCKS * 2);
  assert.equal(cooldownBlocks(2), COOLDOWN_BASE_BLOCKS * 4);
  assert.equal(cooldownBlocks(100), COOLDOWN_MAX_BLOCKS);
});

test('rngFromCtx is deterministic for the same ids', () => {
  const a = rngFromCtx({ blockId: '0xabc', txId: '0x1', motherId: 'm', fatherId: 'f' });
  const b = rngFromCtx({ blockId: '0xabc', txId: '0x1', motherId: 'm', fatherId: 'f' });
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('rngFromCtx differs for different ids', () => {
  const a = rngFromCtx({ blockId: '0xabc', txId: '0x1' });
  const b = rngFromCtx({ blockId: '0xabc', txId: '0x2' });
  assert.notEqual(a(), b());
});

test('canBreed passes when both parents qualify', () => {
  const mother = createStrain({ strain: 'kailash_frost', id: 'm1' });
  const father = createStrain({ strain: 'nataraja', id: 'f1' });
  const res = canBreed(mother, father, { nowBlock: 0 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.reasons, []);
});

test('canBreed enforces the rarity gate (two uncommon parents fail)', () => {
  const a = createStrain({ strain: 'soma_rising', id: 'a' });
  const b = createStrain({ strain: 'ganga_green', id: 'b' });
  const res = canBreed(a, b, { nowBlock: 0 });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('rarity-gate'));
});

test('canBreed blocks self-breed, breed cap, and cooldown', () => {
  const m = createStrain({ strain: 'kailash_frost', id: 'm1' });
  assert.ok(canBreed(m, m, { nowBlock: 0 }).reasons.includes('self-breed'));

  const capped = { ...createStrain({ strain: 'kailash_frost', id: 'm2' }), breedCount: MAX_BREEDS };
  const f = createStrain({ strain: 'nataraja', id: 'f1' });
  assert.ok(canBreed(capped, f, { nowBlock: 0 }).reasons.includes('mother-breed-cap'));

  const cooling = { ...createStrain({ strain: 'kailash_frost', id: 'm3' }), readyBlock: 5000 };
  assert.ok(canBreed(cooling, f, { nowBlock: 1000 }).reasons.includes('mother-cooldown'));
});

test('breedStrains produces a Gen+1 offspring, charges scheduled cost, advances parents', () => {
  const mother = createStrain({ strain: 'kailash_frost', id: 'm1' });
  const father = createStrain({ strain: 'nataraja', id: 'f1' });
  const res = breedStrains(mother, father, { ctx: { blockId: '0xabc', txId: '0x001' }, nowBlock: 1000 });
  assert.equal(res.ok, true);
  assert.equal(res.offspring.generation, 1);
  assert.equal(res.offspring.breedCount, 0);
  assert.deepEqual(res.offspring.parents, ['m1', 'f1']);
  assert.equal(res.cost, breedCost(0));
  assert.equal(res.motherAfter.breedCount, 1);
  assert.equal(res.fatherAfter.breedCount, 1);
  assert.equal(res.motherAfter.readyBlock, 1000 + cooldownBlocks(1));
  // offspring stats stay in range
  for (const g of STAT_GENES) for (const a of res.offspring.genome[g]) {
    assert.ok(a >= 0 && a <= 100, `${g} allele ${a} out of range`);
  }
});

test('breedStrains is deterministic for the same L1 context', () => {
  const mother = createStrain({ strain: 'kailash_frost', id: 'm1' });
  const father = createStrain({ strain: 'nataraja', id: 'f1' });
  const ctx = { blockId: '0xabc', txId: '0x001' };
  const r1 = breedStrains(mother, father, { ctx, nowBlock: 1000 });
  const r2 = breedStrains(mother, father, { ctx, nowBlock: 1000 });
  assert.deepEqual(r1.offspring.genome, r2.offspring.genome);
});

test('breedStrains differs for a different transaction id', () => {
  const mother = createStrain({ strain: 'kailash_frost', id: 'm1' });
  const father = createStrain({ strain: 'nataraja', id: 'f1' });
  const r1 = breedStrains(mother, father, { ctx: { blockId: '0xabc', txId: '0x001' }, nowBlock: 1000 });
  const r2 = breedStrains(mother, father, { ctx: { blockId: '0xabc', txId: '0x999' }, nowBlock: 1000 });
  assert.notDeepEqual(r1.offspring.genome, r2.offspring.genome);
});

test('breedStrains refuses a blocked cross and reports reasons', () => {
  const a = createStrain({ strain: 'soma_rising', id: 'a' });
  const b = createStrain({ strain: 'ganga_green', id: 'b' });
  const res = breedStrains(a, b, { ctx: { blockId: '0x1', txId: '0x1' }, nowBlock: 0 });
  assert.equal(res.ok, false);
  assert.ok(res.reasons.includes('rarity-gate'));
  assert.equal(res.offspring, undefined);
});

test('a line hits the hard breed cap after MAX_BREEDS parentings', () => {
  let mother = createStrain({ strain: 'kailash_frost', id: 'm1' });
  const father = createStrain({ strain: 'nataraja', id: 'f1' });
  let nowBlock = 0;
  let bred = 0;
  for (let i = 0; i < MAX_BREEDS + 3; i++) {
    const res = breedStrains(mother, { ...father, breedCount: 0, readyBlock: 0, id: `f${i}` }, {
      ctx: { blockId: '0xblk', txId: `0x${i}` }, nowBlock,
    });
    if (!res.ok) { assert.ok(res.reasons.includes('mother-breed-cap')); break; }
    mother = res.motherAfter;
    nowBlock = mother.readyBlock; // wait out the cooldown
    bred++;
  }
  assert.equal(bred, MAX_BREEDS);
  assert.equal(mother.breedCount, MAX_BREEDS);
});

test('tradeable emits NFT metadata with rarity, stats, lineage, and a fingerprint', () => {
  const t = tradeable(createStrain({ strain: 'kailash_frost' }));
  assert.equal(t.kind, 'melek-strain-seed');
  assert.equal(t.name, 'Kailash Frost');
  assert.equal(t.rarity, 'rare');
  assert.equal(t.statSum, 254);
  const traitTypes = t.attributes.map((a) => a.trait_type);
  for (const g of STAT_GENES) assert.ok(traitTypes.includes(g));
  assert.ok(traitTypes.includes('lineage'));
  assert.match(t.genomeFingerprint, /lineage:/);
});
