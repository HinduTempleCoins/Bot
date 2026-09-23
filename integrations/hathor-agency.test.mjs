import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHathor, SURFACES } from './hathor-agency.mjs';
import { createBrainMemory, makeKeywordStore } from '../memory/compartments.mjs';

const mkMem = () => createBrainMemory({ makeStore: () => makeKeywordStore() });
const corpus = async () => [{ text: 'A gateway is a threshold — pylons framed the sacred.', source: 'knowledge/architecture' }];

test('one self answers on any surface, drawing on the full corpus', async () => {
  const h = createHathor({ compartments: mkMem(), retrieve: corpus });
  const g = await h.perceive('game', { from: 'Van', text: 'what is the gateway for?' });
  assert.ok(g.reply.length);
  assert.ok(g.drewFrom.includes('knowledge/architecture')); // corpus available in the game
  const d = await h.perceive('discord', { from: 'Van', text: 'tell me about the gateway' });
  assert.ok(d.drewFrom.includes('knowledge/architecture')); // SAME corpus on discord
});

test('episodic memory is COMPARTMENTALIZED per surface', async () => {
  const mem = mkMem();
  const h = createHathor({ compartments: mem, retrieve: corpus });
  await h.perceive('game', { from: 'Van', text: 'I built a cobblestone tower by the river' });
  // the game memory should NOT surface as the focus of a fresh MELEK welcome-grant question
  const m = await h.perceive('melek', { from: 'Van', text: 'how do welcome grants work' });
  const fromGame = m.recalled.filter((r) => r.compartment === 'game' && /tower/.test(r.text));
  // game tower is low-weight in a MELEK context (compartmentalized), not the dominant recall
  assert.ok(m.recalled.every((r) => r.weightedScore !== undefined));
  assert.ok(!fromGame.length || m.recalled[0].compartment !== 'game');
});

test('but she CAN cross-recall a game thing when it is brought up elsewhere', async () => {
  const mem = mkMem();
  const h = createHathor({ compartments: mem, retrieve: corpus });
  await h.perceive('game', { from: 'Van', text: 'I built a cobblestone tower by the river' });
  const d = await h.perceive('melek', { from: 'Van', text: 'remember the tower by the river?' });
  assert.ok(d.recalled.some((r) => r.compartment === 'game' && /tower/.test(r.text)));
});

test('memory of a PERSON follows them across surfaces', async () => {
  const mem = mkMem();
  const h = createHathor({ compartments: mem, retrieve: corpus });
  await h.perceive('discord', { from: 'Van', text: 'my favorite block is amethyst' });
  const acrossForVan = await mem.recallForPerson('Van', 'amethyst', { k: 5 });
  assert.ok(acrossForVan.some((r) => /amethyst/.test(r.text)));
});

test('she remembers her own replies (so the thread has continuity)', async () => {
  const mem = mkMem();
  const h = createHathor({ compartments: mem, retrieve: corpus });
  await h.perceive('game', { from: 'Van', text: 'hello' });
  const recall = await mem.recall('game', 'Hathor', { k: 5 });
  assert.ok(recall.some((r) => r.meta && r.meta.role === 'self'));
});

test('autonomy: tick lets her initiate on a salient surface, bounded', async () => {
  const h = createHathor({ compartments: mkMem(), retrieve: corpus });
  const out = await h.tick({
    now: 1_000_000,
    surfaces: [
      { name: 'game', recent: ['a creeper is about to explode next to Van'] },
      { name: 'melek', recent: ['the weather is calm'] },
    ],
    budget: 2,
  });
  assert.ok(out.initiatives.length >= 1);
  assert.ok(out.initiatives.some((i) => i.surface === 'game')); // the danger pulls her to speak up
});

test('autonomy stays quiet when nothing is salient (no spam)', async () => {
  const h = createHathor({ compartments: mkMem(), retrieve: corpus });
  const out = await h.tick({ now: 1, surfaces: [{ name: 'melek', recent: ['the grass is green', 'a cloud drifts'] }], floor: 0.5 });
  assert.equal(out.initiatives.length, 0);
});

test('autonomy respects a per-surface cooldown after she speaks', async () => {
  const h = createHathor({ compartments: mkMem(), retrieve: corpus });
  await h.perceive('game', { from: 'Van', text: 'hi' }, { now: 1000 });
  const out = await h.tick({ now: 1500, surfaces: [{ name: 'game', recent: ['urgent crash danger explode'] }], cooldownMs: 60000 });
  assert.equal(out.initiatives.length, 0); // spoke 500ms ago, still on cooldown
});

test('SURFACES includes discord + melek + game', () => {
  for (const s of ['discord', 'melek', 'game']) assert.ok(SURFACES.includes(s));
});

test('soft-fails on empty input', async () => {
  const h = createHathor({ compartments: mkMem() });
  const r = await h.perceive('game', { from: 'x', text: '' });
  assert.equal(r.reply, '');
});

test('Crypt-ology: recall feeds the disposition into her thought, and the exchange updates the map', async () => {
  const seen = [];
  const crypt = {
    recall: (acct) => acct === 'ryan' ? { account: 'ryan' } : null,
    dispositionOf: () => 'a trusted teacher',
    suggestTopics: () => ['mythology', 'genetics'],
    observe: (acct, ev, opts) => seen.push({ acct, ev, surface: opts && opts.surface }),
  };
  const h = createHathor({ compartments: mkMem(), retrieve: corpus, cryptology: crypt });
  const r = await h.perceive('discord', { from: 'ryan', text: 'Hathor, why do pylons frame the sacred?' });
  assert.ok(r.cryptology, 'exposes the recalled relationship');
  assert.equal(r.cryptology.disposition, 'a trusted teacher');
  assert.deepEqual(r.cryptology.topics, ['mythology', 'genetics']);
  // the exchange updated the relationship map with the right event
  assert.equal(seen.length, 1);
  assert.equal(seen[0].acct, 'ryan');
  assert.equal(seen[0].ev, 'deep_question'); // "why…?" classified
  assert.equal(seen[0].surface, 'discord');
});

test('Crypt-ology stays soft: a broken map never silences her', async () => {
  const crypt = { recall: () => { throw new Error('store gone'); }, observe: () => { throw new Error('nope'); } };
  const h = createHathor({ compartments: mkMem(), retrieve: corpus, cryptology: crypt });
  const r = await h.perceive('melek', { from: 'x', text: 'hello' });
  assert.ok(typeof r.reply === 'string');
});
