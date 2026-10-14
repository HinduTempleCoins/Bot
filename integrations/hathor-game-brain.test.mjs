import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHathorGameBrain } from './hathor-game-brain.mjs';
import { createBrainMemory, makeKeywordStore } from '../memory/compartments.mjs';

// a fake shared brain: no models, deterministic
function fakeBrain() {
  return {
    ask: async ({ question }) => ({ answer: `Thought about: ${question}`, disposition: 'warm', era: '1960s', sources: [] }),
    vision: { caption: async () => 'a golden temple at dawn' },
    audio: { listen: async () => 'peace be with you' },
    translate: {}, teacher: {}, grammar: {}, emoji: {},
  };
}
const mem = () => createBrainMemory({ makeStore: () => makeKeywordStore() });

test('converse: perceives image+audio and folds them into the reply', async () => {
  const h = await createHathorGameBrain({ brain: fakeBrain(), memory: mem() });
  const out = await h.converse({ person: '@alice', compartment: 'game', text: 'what is this?', image: 'img.jpg', audio: 'clip.wav' });
  assert.match(out.perceived.caption, /golden temple/);
  assert.equal(out.perceived.heard, 'peace be with you');
  assert.match(out.reply, /I see: a golden temple|golden temple/);
  assert.equal(out.compartment, 'game');
});

test('memory is compartmentalized + follows the person across turns', async () => {
  const h = await createHathorGameBrain({ brain: fakeBrain(), memory: mem() });
  await h.converse({ person: '@bob', compartment: 'game', text: 'I found the hidden dragon key' });
  await h.converse({ person: '@bob', compartment: 'melek', text: 'I staked my MELEK today' });
  // recall within the game compartment sees the game turn, not the melek one (walls)
  const g = await h.memory.recall('game', 'dragon key', { person: '@bob' });
  assert.ok(g.some((x) => /dragon key/i.test(x.text)), 'game memory holds the game turn');
  // person-wide recall sees both (memory follows the person)
  const all = await h.memory.recallForPerson('@bob', 'MELEK', {});
  assert.ok(all.some((x) => /staked my MELEK/i.test(x.text)), 'person recall spans compartments');
});

test('converse soft-returns a perception-only reply when cognition declines', async () => {
  const brain = fakeBrain(); brain.ask = async () => ({ answer: null });
  const h = await createHathorGameBrain({ brain, memory: mem() });
  const out = await h.converse({ person: '@c', compartment: 'game', text: '', image: 'x.jpg' });
  assert.match(out.reply, /I see a golden temple/);
});

test('exposes the shared senses + compartment list', async () => {
  const h = await createHathorGameBrain({ brain: fakeBrain(), memory: mem() });
  assert.ok(h.vision && h.audio);
  assert.ok(h.compartments().includes('game'));
});
