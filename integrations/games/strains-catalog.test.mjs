// strains-catalog.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDRACES, HYBRIDS, BRAND_FLAGGED, allStrains, byType, lineageOf,
  pickStrainName, namingPolicies,
} from './strains-catalog.mjs';

const VALID_TYPES = new Set(['indica', 'sativa', 'hybrid', 'ruderalis']);

// deterministic rng for tests
function makeRng(seed = 7) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff;
}

test('landraces are well-formed and all real geographic roots', () => {
  assert.ok(LANDRACES.length >= 14);
  for (const s of LANDRACES) {
    assert.ok(s.key && s.name && s.region, `landrace missing field: ${JSON.stringify(s)}`);
    assert.ok(VALID_TYPES.has(s.type));
    assert.equal(s.era, 'landrace');
  }
});

test('hybrids have lineage arrays and valid types', () => {
  for (const s of HYBRIDS) {
    assert.ok(Array.isArray(s.lineage) && s.lineage.length >= 1, `no lineage: ${s.name}`);
    assert.ok(VALID_TYPES.has(s.type));
    assert.ok(['classic', 'modern'].includes(s.era));
  }
});

test('allStrains = landraces + hybrids; keys are unique', () => {
  const all = allStrains();
  assert.equal(all.length, LANDRACES.length + HYBRIDS.length);
  const keys = new Set(all.map((s) => s.key));
  assert.equal(keys.size, all.length);
});

test('byType partitions the catalog', () => {
  const total = ['indica', 'sativa', 'hybrid', 'ruderalis'].reduce((n, t) => n + byType(t).length, 0);
  assert.equal(total, allStrains().length);
});

test('lineageOf resolves by key and by name, null for unknown', () => {
  assert.deepEqual(lineageOf('skunk_1'), ['Afghani', 'Acapulco Gold', 'Colombian Gold']);
  assert.deepEqual(lineageOf('Skunk #1'), ['Afghani', 'Acapulco Gold', 'Colombian Gold']);
  assert.equal(lineageOf('nonexistent-strain'), null);
});

test('every brand-flagged strain carries owner/reason and a MELEK-original alt', () => {
  assert.ok(BRAND_FLAGGED.length >= 3);
  for (const s of BRAND_FLAGGED) {
    assert.ok(s.brand.owner && s.brand.reason && s.brand.alt, `incomplete brand flag: ${s.name}`);
    assert.notEqual(s.brand.alt, s.name);
  }
});

test('pickStrainName is deterministic for the same rng seed', () => {
  const a = pickStrainName({ rng: makeRng(11), rarity: 'legendary' });
  const b = pickStrainName({ rng: makeRng(11), rarity: 'legendary' });
  assert.deepEqual(a, b);
});

test("policy 'safe' swaps brand-flagged names to their alt; 'real' never swaps", () => {
  const altByName = Object.fromEntries(BRAND_FLAGGED.map((s) => [s.name, s.brand.alt]));
  for (let i = 0; i < 200; i++) {
    const safe = pickStrainName({ rng: makeRng(i * 3 + 1), rarity: 'legendary', policy: 'safe' });
    if (safe.swapped) {
      assert.ok(altByName[safe.from], `swapped a non-brand strain: ${safe.from}`);
      assert.equal(safe.name, altByName[safe.from]);
    } else {
      assert.equal(altByName[safe.name], undefined, `left a brand name unswapped: ${safe.name}`);
    }
    const real = pickStrainName({ rng: makeRng(i * 3 + 1), rarity: 'legendary', policy: 'real' });
    assert.equal(real.swapped, false);
  }
});

test("policy 'melek' returns null so the caller falls back to invented names", () => {
  assert.equal(pickStrainName({ rarity: 'rare', policy: 'melek' }), null);
});

test('rarity pools bias toward era (common → landrace only)', () => {
  for (let i = 0; i < 50; i++) {
    const pick = pickStrainName({ rng: makeRng(i + 1), rarity: 'common', policy: 'real' });
    const strain = allStrains().find((s) => s.key === pick.key);
    assert.equal(strain.era, 'landrace');
  }
});

test('namingPolicies documents the three modes', () => {
  const p = namingPolicies();
  assert.deepEqual(Object.keys(p).sort(), ['melek', 'real', 'safe']);
});
