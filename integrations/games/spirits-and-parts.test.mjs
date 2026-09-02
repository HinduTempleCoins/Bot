// spirits-and-parts.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTS, SPIRIT_TIERS, SPIRIT_AFFINITIES, harvestRemains, captureSpirit,
  identifyPart, usesOfPart, useSpirit, partKind,
} from './spirits-and-parts.mjs';

const natural = (extra = {}) => ({ species: 'oyster', id: 'o1', cause: 'natural', ...extra });

test('parts are obscure by default but carry hidden uses', () => {
  assert.ok(Object.keys(PARTS).length >= 8);
  assert.ok(usesOfPart('gland').includes('lab-poison'));
  assert.equal(partKind('nope'), null);
});

test('remains come ONLY from a natural/combat death (never rewards killing for parts)', () => {
  assert.equal(harvestRemains({ species: 'oyster' }, { natural: false }).reason, 'not-natural-death');
  assert.equal(harvestRemains(natural(), { ctx: { blockId: '0x1', txId: '0x1' } }).ok, true);
  assert.equal(harvestRemains({ species: 'fish', cause: 'combat' }, { ctx: { blockId: '0x1', txId: '0x1' } }).ok, true);
});

test('harvest yields obscure parts (kinds → counts) and is deterministic', () => {
  const ctx = { blockId: '0xabc', txId: '0x9' };
  const a = harvestRemains(natural({ traits: { size: 80, hardiness: 74, fertility: 60 }, rarity: 'rare' }), { ctx });
  const b = harvestRemains(natural({ traits: { size: 80, hardiness: 74, fertility: 60 }, rarity: 'rare' }), { ctx });
  assert.deepEqual(a.parts, b.parts);            // same L1 context → same remains
  for (const k of Object.keys(a.parts)) assert.ok(PARTS[k], `unknown part ${k}`);
  assert.ok(Object.values(a.parts).reduce((n, q) => n + q, 0) >= 2);
});

test('obscured genetics: a rarer/stronger creature yields MORE parts than a common one', () => {
  const ctx = { blockId: '0x1', txId: '0x1' };
  const common = harvestRemains(natural({ traits: { size: 50, hardiness: 50, fertility: 50 }, rarity: 'common' }), { ctx });
  const rare = harvestRemains(natural({ traits: { size: 90, hardiness: 90, fertility: 90 }, rarity: 'legendary' }), { ctx });
  const sum = (o) => Object.values(o.parts).reduce((n, q) => n + q, 0);
  assert.ok(sum(rare) > sum(common));
});

test('identifyPart reveals uses (Oblivion-style, skill-gated)', () => {
  assert.equal(identifyPart('nope').reason, 'unknown-part');
  assert.equal(identifyPart('gland', { skill: 0 }).revealed.length, 1);
  assert.equal(identifyPart('gland', { skill: 100 }).revealed.length, PARTS.gland.uses.length);
});

test('captureSpirit stores a portable spirit vessel with tier + affinity', () => {
  const s = captureSpirit(natural({ traits: { size: 80, hardiness: 74, fertility: 60 }, rarity: 'rare' }), { ctx: { blockId: '0x1', txId: '0x2' } });
  assert.equal(s.kind, 'animal-spirit');
  assert.ok(SPIRIT_TIERS.includes(s.tier));
  assert.ok(SPIRIT_AFFINITIES.includes(s.affinity));
  assert.ok(s.id.startsWith('spirit-oyster-'));
});

test('a stored spirit is used in OTHER games — summon / ritual / boost', () => {
  const s = { id: 'spirit-x', kind: 'animal-spirit', species: 'fish', tier: 'grand', affinity: 'tide' };
  const summon = useSpirit(s, 'summon');
  assert.equal(summon.kind, 'familiar');
  assert.equal(summon.power, 40); // grand = tier index 3 → (3+1)*10
  const ritual = useSpirit(s, 'ritual');
  assert.equal(ritual.kind, 'soul-fuel');
  const boon = useSpirit(s, 'boost');
  assert.equal(boon.kind, 'boon');
  assert.equal(boon.stat, 'tide');
  assert.equal(boon.pct, 40);
  assert.throws(() => useSpirit({}, 'boost'), /animal spirit/);
});
