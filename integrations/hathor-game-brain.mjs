// hathor-game-brain.mjs — THE tie-in: Hathor's game + conversation COMPARTMENTALIZATION brain. It binds
// the two halves we built:
//   • the cognition/senses — crypt-ology-brain (decades-brain + heads: grammar, emoji, translate, teacher,
//     VISION, AUDIO, and the whole-estate map) — ONE shared mind, and
//   • the compartmented memory — memory/compartments.mjs (game / melek / trading / prana, person-indexed,
//     permeable-on-demand by how related the compartments are).
//
// Operator: she can host a GAME with people 24/7 AND meet the same person in MELEK chat — the same senses
// and cognition, but conversations are COMPARTMENTALIZED so the game doesn't frame everything she says.
// Memory follows the PERSON across compartments, weighted by relatedness (the Crypt-ology relationship graph).
//
// converse() perceives (image->caption, audio->transcript), recalls within+across the compartment, thinks
// with the shared brain, then remembers the turn in that compartment. Pure-ish + injectable (pass a brain
// and memory in tests so nothing loads a model) + soft-fail: a broken sense/recall degrades, never throws.
//
//   import { createHathorGameBrain } from './hathor-game-brain.mjs';
//   const h = await createHathorGameBrain();                 // real brain + compartments
//   await h.converse({ person: '@alice', compartment: 'game', text: 'what did we trade last time?', image });

import { createBrainMemory } from '../memory/compartments.mjs';

export async function createHathorGameBrain(opts = {}) {
  // shared cognition + senses (inject `brain` in tests to avoid loading anything)
  let brain = opts.brain;
  if (!brain) {
    const { createCryptologyBrain } = await import('../cryptology/crypt-ology-brain.mjs');
    brain = await createCryptologyBrain({ recall: opts.recall || (async () => []), ...opts.brainOpts });
  }
  // compartmented memory (inject `memory` or a `makeStore` in tests)
  const memory = opts.memory || createBrainMemory({
    compartments: opts.compartments, edges: opts.edges, makeStore: opts.makeStore,
  });

  /** Perceive an incoming image/audio into text the brain can reason over. Soft-fails to ''. */
  async function perceive({ image = null, audio = null } = {}) {
    const bits = {};
    if (image && brain.vision) {
      try { bits.caption = await brain.vision.caption(image); } catch { /* ignore */ }
    }
    if (audio && brain.audio) {
      try { bits.heard = await brain.audio.listen(audio); } catch { /* ignore */ }
    }
    return bits;
  }

  /**
   * One conversational turn, scoped to a compartment and a person.
   * @param {object} turn { person, compartment='game', text='', image?, audio?, event?, k? }
   * @returns {Promise<{reply, compartment, person, perceived, recalled, disposition, era}>}
   */
  async function converse({ person = null, compartment = 'game', text = '', image = null, audio = null, event = 'curious', k = 5 } = {}) {
    const perceived = await perceive({ image, audio });
    // the effective query: what they typed + what she saw/heard
    const query = [text, perceived.caption ? `(I see: ${perceived.caption})` : '', perceived.heard ? `(I hear: ${perceived.heard})` : '']
      .filter(Boolean).join(' ').trim();

    // recall PRIMARILY from this compartment, letting related ones surface (permeable walls)
    let recalled = [];
    try { recalled = await memory.recallAcross(query || text, { from: compartment, person, k }); } catch { recalled = []; }

    // think with the shared brain (crypt-ology ask moves the person's map + frames by Rule 1)
    let answer = null, disposition = null, era = null, sources = [];
    try {
      const r = await brain.ask({ account: person, question: query || text, event, k });
      answer = r && r.answer; disposition = r && r.disposition; era = r && r.era; sources = (r && r.sources) || [];
    } catch { /* soft-fail: she can still reflect what she perceived */ }
    if (!answer && perceived.caption) answer = `I see ${perceived.caption}.`;
    if (!answer && perceived.heard) answer = `I heard: "${perceived.heard}".`;

    // remember this turn in the person's compartment (so it follows them, isolated to this context)
    if (person && (query || answer)) {
      try { await memory.remember(compartment, { text: `${person}: ${text}${answer ? ` / Hathor: ${answer}` : ''}`, person, meta: { event } }); }
      catch { /* soft-fail */ }
    }

    return { reply: answer, compartment, person, perceived, recalled, disposition, era, sources };
  }

  return {
    brain, memory, converse, perceive,
    // expose the shared senses/cognition for direct use by game/NPC/chat surfaces
    vision: brain.vision, audio: brain.audio, translate: brain.translate, teacher: brain.teacher,
    grammar: brain.grammar, emoji: brain.emoji,
    compartments: () => memory.compartments(),
  };
}
