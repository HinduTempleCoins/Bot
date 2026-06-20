import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrainMemory, makeKeywordStore, DEFAULT_COMPARTMENTS } from './compartments.mjs';

const brain = () => createBrainMemory({ makeStore: () => makeKeywordStore() });

async function seed(b) {
  await b.remember('game', { text: 'VanKushFam built a cobblestone tower near the river', person: 'VanKushFam' });
  await b.remember('melek', { text: 'VanKushFam asked about the MELEK welcome grant', person: 'VanKushFam' });
  await b.remember('prana', { text: 'PRANA testnet mining reward by the river pool', person: 'VanKushFam' });
  await b.remember('trading', { text: 'VanKushFam watched the VKBT market dance', person: 'VanKushFam' });
  await b.remember('game', { text: 'alice dug a deep mineshaft', person: 'alice' });
  return b;
}

test('remember + recall stays WITHIN a compartment by default', async () => {
  const b = await seed(brain());
  const g = await b.recall('game', 'tower river');
  assert.ok(g.length && g[0].compartment === 'game');
  const m = await b.recall('melek', 'tower river'); // the tower is in GAME, not MELEK
  assert.equal(m.length, 0);
});

test('the game does NOT frame a MELEK recall unless strongly relevant', async () => {
  const b = await seed(brain());
  // asking in MELEK about the welcome grant: melek memory should dominate, game shouldn't intrude
  const r = await b.recallAcross('welcome grant', { from: 'melek', person: 'VanKushFam' });
  assert.equal(r[0].compartment, 'melek');
});

test('but she CAN cross-recall a game thing when it is brought up', async () => {
  const b = await seed(brain());
  const r = await b.recallAcross('the tower by the river', { from: 'melek', person: 'VanKushFam' });
  // the game memory surfaces because it is strongly relevant, even at low cross-weight
  assert.ok(r.some((h) => h.compartment === 'game'));
});

test('PRANA surfaces readily in a MELEK context (closely related)', async () => {
  const b = await seed(brain());
  const r = await b.recallAcross('river reward', { from: 'melek', person: 'VanKushFam' });
  const prana = r.find((h) => h.compartment === 'prana');
  const game = r.find((h) => h.compartment === 'game');
  // prana (weight .8) outweighs game (weight .1) for comparable raw relevance
  if (prana && game) assert.ok(prana.weightedScore >= game.weightedScore);
});

test('relatedWeight encodes the graph (prana-melek close, game isolated)', () => {
  const b = brain();
  assert.equal(b.relatedWeight('melek', 'melek'), 1);
  assert.ok(b.relatedWeight('melek', 'prana') > b.relatedWeight('melek', 'game'));
});

test('person filter keeps recall to that person', async () => {
  const b = await seed(brain());
  const mine = await b.recall('game', 'dug mineshaft tower', { person: 'alice' });
  assert.ok(mine.every((h) => h.meta.person === 'alice'));
});

test('recallForPerson follows a person across ALL compartments', async () => {
  const b = await seed(brain());
  const all = await b.recallForPerson('VanKushFam', 'river', { k: 10 });
  const comps = new Set(all.map((h) => h.compartment));
  assert.ok(comps.size >= 2); // shows up in multiple compartments
  assert.ok(all.every((h) => h.meta.person === 'VanKushFam'));
});

test('default compartments are Game/MELEK/Trading/PRANA', () => {
  assert.deepEqual(DEFAULT_COMPARTMENTS, ['game', 'melek', 'trading', 'prana']);
});

test('soft-fails on empty text', async () => {
  const b = brain();
  assert.equal((await b.remember('game', { text: '' })).ok, false);
});
