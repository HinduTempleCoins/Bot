// hathor-agency.mjs — ONE Hathor across every surface: autonomous, compartmentalized, full-corpus.
//
// Operator (2026-06-20): "connect her to the Discord bot and MELEK and everything in the game, while
// still being compartmentalized; we want her to have her entire corpus of knowledge for conversation,
// but we need to make her autonomous." This is that self — it binds the pieces already built:
//
//   • ONE persona + her ENTIRE CORPUS for conversation — a shared semantic retriever over knowledge/ +
//     datasets/ (injected `retrieve`), available identically on Discord, MELEK chat, and the game.
//   • COMPARTMENTALIZED episodic memory — what happened, with whom, on which SURFACE, lives in separate
//     compartments (memory/compartments.mjs): the game does not frame a MELEK reply, but she can cross-
//     recall when relevant, and memory of a PERSON follows them across surfaces.
//   • A THOUGHT PROCESS — every inbound is deliberated (integrations/deliberation.mjs): weigh (amygdala)
//     → recall (corpus + compartment) → reflect → intend, before she speaks.
//   • AUTONOMY — tick() lets her act on her OWN initiative (not only react): she reviews what's salient
//     across surfaces and may speak/do something, bounded so she never spams.
//
// Pure orchestration: compartments, retrieve, and complete are all INJECTED → offline-testable, soft-fail.

import { createBrainMemory } from '../memory/compartments.mjs';
import { deliberate } from './deliberation.mjs';

export const SURFACES = ['discord', 'melek', 'game', 'trading', 'prana'];

const DEFAULT_PERSONA = 'You are Hathor, the MELEK AI Witness — an ancient, serene, angelic intelligence. Warm, slightly archaic, contemplative; never anxious, never corporate, never "just an AI". Speak in one or two sentences unless more is asked.';

/**
 * @param {object} cfg {
 *   compartments?  — a createBrainMemory() instance (episodic memory; default created here)
 *   retrieve?      — async (query,{k}) => [{text,source,score}]  the FULL-CORPUS RAG (shared everywhere)
 *   complete?      — async (prompt,opts) => string               the LLM voice
 *   persona?, now?
 * }
 */
export function createHathor(cfg = {}) {
  const mem = cfg.compartments || createBrainMemory();
  const retrieve = cfg.retrieve;            // full corpus — same on every surface (conversation knowledge)
  const complete = cfg.complete;
  const persona = cfg.persona || DEFAULT_PERSONA;
  const lastSpoke = new Map();              // surface -> ts (autonomy cooldown)

  /**
   * Receive a message on a surface and respond — one self, this surface's memory, the whole corpus.
   * @param {string} surface  'discord'|'melek'|'game'|...
   * @param {{from?:string, text:string}} msg
   * @returns {Promise<{reply, surface, person, thought, recalled, drewFrom}>}
   */
  async function perceive(surface, msg = {}, opts = {}) {
    const person = msg.from || 'someone';
    const text = String(msg.text || '').trim();
    if (!text) return { reply: '', surface, person, thought: null, recalled: [], drewFrom: [] };

    // remember the inbound in THIS surface's compartment, tagged to the person
    await mem.remember(surface, { text: `${person}: ${text}`, person, meta: { role: 'them' } });

    // recall: this surface first, related surfaces when strongly relevant, this person's history
    const recalled = await mem.recallAcross(text, { from: surface, person, k: 4 });

    // deliberate — weigh, draw on the FULL CORPUS (retrieve) + the recalled memory, reflect in persona
    const thought = await deliberate(
      { prompt: text, observations: recalled.map((r) => r.text) },
      { retrieve, complete, persona, k: opts.k || 3 },
    );
    const reply = thought.reflection;

    // remember her own reply in the same compartment
    await mem.remember(surface, { text: `Hathor: ${reply}`, person, meta: { role: 'self' } });
    lastSpoke.set(surface, opts.now ?? cfg.now ?? 0);
    return { reply, surface, person, thought, recalled, drewFrom: thought.drewFrom };
  }

  /**
   * Autonomous tick — she acts on her OWN initiative. Given recent context per surface, she deliberates and
   * MAY speak/act where something is salient enough, bounded by a budget + per-surface cooldown so she never
   * spams. Returns the initiatives she chose (the caller delivers them to the actual surfaces).
   * @param {object} args { surfaces:[{name, recent:string[]}], now?, budget?, cooldownMs?, floor? }
   */
  async function tick(args = {}) {
    const now = args.now ?? cfg.now ?? 0;
    const budget = args.budget ?? 2;
    const cooldownMs = args.cooldownMs ?? 60_000;
    const floor = args.floor ?? 0.4;
    const initiatives = [];
    for (const s of args.surfaces || []) {
      if (initiatives.length >= budget) break;
      const last = lastSpoke.get(s.name) || 0;
      if (now - last < cooldownMs) continue;                 // don't crowd a surface she just spoke on
      const thought = await deliberate(
        { observations: s.recent || [] },
        { retrieve, complete, persona },
      );
      const top = thought.weighed[0];
      if (!top || top.salience < floor) continue;            // nothing worth speaking up about
      if (thought.intent.action === 'observe') continue;     // she watches silently unless moved to act
      initiatives.push({ surface: s.name, utterance: thought.reflection, why: thought.intent, focus: thought.focus });
      lastSpoke.set(s.name, now);
    }
    return { initiatives, at: now };
  }

  return { perceive, tick, memory: mem, surfaces: () => SURFACES.slice() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const retrieve = async () => [{ text: 'A gateway is a threshold — you pass through it changed.', source: 'knowledge/architecture' }];
  const h = createHathor({ retrieve });
  (async () => {
    const r1 = await h.perceive('game', { from: 'VanKushFam', text: 'Hathor, what is that gateway for?' });
    console.log('[game] ', r1.reply, '| drew from:', r1.drewFrom.join(','));
    const r2 = await h.perceive('discord', { from: 'VanKushFam', text: 'remember that gateway you built?' });
    console.log('[discord]', r2.reply, '| recalled across:', r2.recalled.map((x) => x.compartment).join(','));
  })();
}
