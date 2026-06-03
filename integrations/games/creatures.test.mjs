// creatures.test.mjs — OFFLINE. Pure genetics, deterministic rng, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  SPECIES,
  GENES,
  createCreature,
  breed,
  traits,
  tradeable,
  rarityTier,
  makeRng,
} from './creatures.mjs';

test('SPECIES are original creatures with genomes', () => {
  const keys = Object.keys(SPECIES);
  assert.ok(keys.length >= 3, 'a few species defined');
  for (const k of keys) {
    const c = createCreature({ species: k });
    for (const g of Object.keys(GENES)) {
      assert.equal(c.genome[g].length, 2, `${k}.${g} is diploid`);
    }
  }
});

test('createCreature rejects unknown species and alleles', () => {
  assert.throws(() => createCreature({ species: 'nope' }));
  assert.throws(() => createCreature({ species: 'pyrelisk', genes: { hue: ['ember', 'bogus'] } }));
});

test('traits expresses dominant allele and computes rarity', () => {
  const c = createCreature({ species: 'pyrelisk' });
  const t = traits(c);
  assert.equal(t.species, 'pyrelisk');
  assert.ok(GENES.hue.includes(t.hue));
  assert.equal(typeof t.rarityWeight, 'number');
  assert.ok(['common', 'uncommon', 'rare', 'epic', 'mythic'].includes(t.rarity));
});

test('rarityTier is monotonic', () => {
  assert.equal(rarityTier(0), 'common');
  assert.ok(['epic', 'mythic'].includes(rarityTier(40)));
});

test('breed is deterministic with a fixed rng', () => {
  const a = createCreature({ species: 'pyrelisk' });
  const b = createCreature({ species: 'cinderox' });
  const c1 = breed(a, b, { rng: makeRng(7) });
  const c2 = breed(a, b, { rng: makeRng(7) });
  assert.deepEqual(c1.genome, c2.genome, 'same seed => same offspring');
  assert.deepEqual(c1.species, c2.species);
});

test('offspring inherits alleles present in the parents', () => {
  const a = createCreature({ species: 'pyrelisk' });
  const b = createCreature({ species: 'mossquill' });
  const child = breed(a, b, { rng: makeRng(3), mutationRate: 0 }); // no mutation => pure inheritance
  for (const g of Object.keys(GENES)) {
    const parentAlleles = new Set([...a.genome[g], ...b.genome[g]]);
    for (const allele of child.genome[g]) {
      assert.ok(parentAlleles.has(allele), `${g} allele ${allele} came from a parent`);
    }
  }
  assert.equal(child.generation, 1);
});

test('mutation can occur (rarity can rise across a line)', () => {
  const a = createCreature({ species: 'pyrelisk' });
  const b = createCreature({ species: 'pyrelisk' });
  // High mutation rate + scan seeds: at least one offspring must differ from both parents.
  let mutated = false;
  for (let seed = 1; seed <= 50 && !mutated; seed++) {
    const child = breed(a, b, { rng: makeRng(seed), mutationRate: 1 });
    for (const g of Object.keys(GENES)) {
      const parentAlleles = new Set([...a.genome[g], ...b.genome[g]]);
      if (child.genome[g].some((al) => !parentAlleles.has(al))) mutated = true;
    }
  }
  assert.ok(mutated, 'mutation produced an allele not in either parent');
});

test('tradeable emits NFT/economy metadata with rarity', () => {
  const c = createCreature({ species: 'tidewren' });
  const meta = tradeable(c);
  assert.equal(meta.kind, 'melek-creature');
  assert.ok(Array.isArray(meta.attributes) && meta.attributes.length === Object.keys(GENES).length);
  assert.ok(typeof meta.rarityWeight === 'number');
  assert.ok(['common', 'uncommon', 'rare', 'epic', 'mythic'].includes(meta.rarity));
  assert.ok(meta.genomeFingerprint.includes('hue:'));
});
