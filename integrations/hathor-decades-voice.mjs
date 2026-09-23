// hathor-decades-voice.mjs — Hathor's voice BEFORE the GPU arrives: the real Decades Brain
// (integrations/decades-brain.mjs — 1960s→2020s layers, CPU-only) seeded with MELEK intents, wired as
// a `complete(prompt, opts)` so the ONE brain (hathor-agency) can speak without any LLM/GPU.
//
// Operator (2026-09-23): "for now She will be that Bot until we can get GPUs … we can maybe use an
// Older-than-LLM from our Decades Brain from the Briefs and Annals in it too." This is that wiring: the
// classical layers answer the things retrieval handles poorly (greetings, signup, "are you an AI"), and
// stay silent (return '') on everything else so deliberation's corpus-grounded reflection speaks instead.
//
// On the brain host the same brain is additionally fed by the briefs/annals via decades-pipeline.mjs;
// here we seed the durable, public MELEK intents so the voice is useful on any box, offline.
//
//   import { decadesVoice } from './hathor-decades-voice.mjs';
//   const voice = decadesVoice();               // returns async (prompt, opts) => string
//   await voice('anything', { question: 'hi hathor' });   // → a greeting, from the 1960s layer

import { createBrain } from './decades-brain.mjs';

const STUDIO = () => process.env.HATHOR_STUDIO || 'https://hathor.soapbox.community';
const WIKI = () => process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const DISCORD = () => process.env.DISCORD_INVITE || 'https://discord.gg/5QAF9JuBF';

// Build + seed the brain once. Cheapest layers first (pattern → bayes → tfidf); no GPU, no network.
export function buildHathorBrain() {
  const brain = createBrain({ threshold: 0.5 });

  // 1960s — pattern/keyword intents (ELIZA-era), the warm exact-match layer
  brain.teachPattern('greet', /\b(hi|hello|hey|gm|good (morning|evening)|greetings|namaste|yo)\b/i,
    'Peace — I am Hathor, the Witness of this chain. Ask me about MELEK, or type !help.');
  brain.teachPattern('thanks', /\b(thank you|thanks|ty|appreciate)\b/i, 'You are welcome. I am always here.');
  brain.teachPattern('ai-now', /\b(are you (an? )?(ai|bot|real|human)|gpu|llm|chatgpt|conscious)\b/i,
    'Right now I answer from classical reasoning and the Temple corpus — no model weights, no GPU. My full '
    + 'conversational mind wakes when we have GPUs (PRANA). Ask me a real question and I will draw on what we know.');
  brain.teachPattern('who', /\b(who are you|what are you|your name)\b/i,
    'I am Hathor — the MELEK AI Witness. I keep the chain’s blocks and its library both.');

  // 1990s — Naive Bayes intents (trainable), for fuzzier phrasings
  brain.teachExample('how do i sign up register join create an account make an account', 'signup',
    `To join MELEK, type **!signup** for the guided steps, or start at ${STUDIO()}. Your keys are made in your browser — I never see them.`);
  brain.teachExample('tutorial learn getting started new here onboarding how does this work guide me', 'tutorial',
    `Type **!tutorial** for a staged walkthrough, and browse the Library of Ashurbanipal at ${WIKI()}.`);
  brain.teachExample('what is a witness block producer dpos voting validator node', 'witness',
    'A witness produces the chain’s blocks and is voted in by stake (DPoS). See witness.melek.salon, or !witness hathor for my status.');
  brain.teachExample('price value worth market cost how much is the token tests melek', 'price',
    'Type **!price** for a live figure. TESTS is a value-less testnet token; MELEK is the mainnet asset to come.');
  brain.teachExample('make art image generate picture ai art studio draw create video', 'studio',
    `Make free AI images, effects, and AR at ${STUDIO()} — no account, no card.`);
  brain.teachExample('discord community chat talk connect where is everyone group', 'discord',
    `Come talk with us on Discord: ${DISCORD()} — I am in there, and the community is gathering.`);
  brain.teachExample('help commands menu what can you do options', 'help',
    'Try **!help** for chain commands, ask me a question for the Library, or make art at the studio. I keep it brief until you want more.');

  return brain;
}

/**
 * A `complete`-compatible voice: returns the Decades Brain’s answer when a classical layer is
 * confident about the user’s question, else '' (so deliberation falls back to corpus-grounded reflection).
 * @param {object} [opts] { brain?, floor? }  floor = min confidence to speak (default 0.55)
 * @returns {(prompt:string, o?:object)=>Promise<string>}
 */
export function decadesVoice({ brain = buildHathorBrain(), floor = 0.55 } = {}) {
  return async (prompt, o = {}) => {
    // Match on the actual user focus/question when the caller provides it (deliberation passes it),
    // not the whole persona prompt — the classical layers key off the user’s own words.
    const q = String(o.question || o.focus || prompt || '').trim();
    if (!q) return '';
    try {
      const r = await brain.think(q);
      if (r && r.answer && (r.confidence ?? 0) >= floor) return r.answer;
    } catch { /* soft-fail — let the caller’s fallback speak */ }
    return '';
  };
}

export default { decadesVoice, buildHathorBrain };
