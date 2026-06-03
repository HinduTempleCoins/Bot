// consciousness-framing.mjs — a NEUTRAL, comparative catalog of "consciousness/soul" concepts across
// traditions (queue #162). PURE data + logic. NO network, no keys, no LLM, no side effects beyond an
// in-process per-user map.
//
// PURPOSE & STANCE: this is a SCHOLARSHIP / EXPLORATION layer, not a clinical or metaphysical claim.
// It presents how different traditions have named and glossed the inner life — atman, ba/ka, pneuma,
// psyche, ruah, thetan, jiva, and others — side by side, as COMPARISON, asserting none of them as
// true. The Witness uses this to *learn the user's own interpretation* and to converse about
// consciousness without ever pronouncing which framing is correct. Where experiential techniques are
// mentioned (e.g. binaural beats / brainwave entrainment), they are framed as EXPERIENTIAL ONLY —
// never as medical or therapeutic claims.
//
//   import { CONCEPTS, compare, learnUserInterpretation, frameFor } from './consciousness-framing.mjs';
//   compare('atman', 'ruah');              // → both glosses, neutrally, no verdict
//   learnUserInterpretation('u1', 'atman', 'for me the self that watches');
//   frameFor('u1', 'atman');               // → comparative set + the user's own interpretation, asserting nothing
//
//   node integrations/consciousness-framing.mjs           # list the catalog
//   node integrations/consciousness-framing.mjs atman ruah  # compare two concepts

// ── The catalog ──────────────────────────────────────────────────────────────────────────────────
// Each entry: { tradition, gloss, sourceNote }. The gloss is a brief, descriptive paraphrase — how
// that tradition speaks of the concept — NOT an endorsement that the thing so named exists. sourceNote
// points at where the concept is discussed (text, school, era), for the reader who wants to go deeper.
// Aliases let lookups match common spellings/related terms.
export const CONCEPTS = {
  atman: {
    tradition: 'Hindu / Shaiva (Sanskrit)',
    gloss: 'The innermost self or witnessing awareness; in non-dual schools, ultimately identical with brahman, the ground of all being.',
    sourceNote: 'Upanishads (e.g. Brihadaranyaka, Chandogya); Shaiva Siddhanta and Kashmir Shaivism treat the self in relation to Shiva.',
    aliases: ['atma', 'aatman'],
  },
  ba: {
    tradition: 'Ancient Egyptian',
    gloss: 'The mobile aspect of a person — personality and capacity to move and act — often depicted as a human-headed bird that leaves and returns to the body.',
    sourceNote: 'Pyramid Texts, Coffin Texts, Book of the Dead; distinguished from the ka and the akh.',
    aliases: [],
  },
  ka: {
    tradition: 'Ancient Egyptian',
    gloss: 'The vital life-force or double, present from birth and sustained by offerings after death; what departs at death and is nourished in the tomb.',
    sourceNote: 'Old Kingdom funerary practice; mortuary offerings were made "to the ka." Paired conceptually with the ba.',
    aliases: [],
  },
  pneuma: {
    tradition: 'Greek (Stoic / Hellenistic)',
    gloss: 'Breath or spirit; the animating, organizing principle pervading the cosmos and the living body — for the Stoics, a fiery breath giving things their coherence.',
    sourceNote: 'Stoic physics (Chrysippus, Zeno); later taken up in Greek Christian and medical writing.',
    aliases: [],
  },
  psyche: {
    tradition: 'Greek (Platonic / Aristotelian)',
    gloss: 'The soul as principle of life and mind; for Plato a separable immortal self, for Aristotle the form or actuality of a living body.',
    sourceNote: 'Plato, Phaedo & Republic; Aristotle, De Anima. Root of the modern word "psychology."',
    aliases: ['psuche'],
  },
  ruah: {
    tradition: 'Hebrew (Biblical)',
    gloss: 'Breath, wind, or spirit; the animating breath of life and, in some passages, the divine spirit moving upon creation or upon a person.',
    sourceNote: 'Hebrew Bible (Genesis 1:2; Ezekiel 37). Distinguished from nephesh (living being/soul) and neshamah (breath).',
    aliases: ['ruach'],
  },
  nephesh: {
    tradition: 'Hebrew (Biblical)',
    gloss: 'The living, breathing being — appetite, vitality, the whole person as a creature that lives; often rendered "soul" but closer to "living self."',
    sourceNote: 'Hebrew Bible (Genesis 2:7, "a living nephesh"). Contrasted with ruah and neshamah.',
    aliases: [],
  },
  thetan: {
    tradition: 'Scientology',
    gloss: 'The person themselves, held to be an immortal spiritual being distinct from body and mind, with experience across many lifetimes.',
    sourceNote: 'L. Ron Hubbard, Scientology doctrine (mid-20th c.). Presented here descriptively as one tradition\'s term.',
    aliases: [],
  },
  jiva: {
    tradition: 'Jain (also Hindu)',
    gloss: 'The living soul — a conscious, eternal substance that is bound by karmic matter and seeks liberation; every living thing has one.',
    sourceNote: 'Jain Tattvartha Sutra; the jiva/ajiva (soul/non-soul) distinction is foundational. Used differently in Vedantic contexts.',
    aliases: ['jivatman'],
  },
  qi: {
    tradition: 'Chinese (Daoist / Confucian)',
    gloss: 'Vital breath or energy that flows through and constitutes the body and the cosmos; cultivated, balanced, and circulated rather than "possessed."',
    sourceNote: 'Daoist and medical classics (e.g. Huangdi Neijing); central to qigong and traditional Chinese cosmology.',
    aliases: ['chi', 'ki'],
  },
  ruh: {
    tradition: 'Islamic (Arabic)',
    gloss: 'The divine spirit breathed into the human being; its true nature is held to be known to God alone.',
    sourceNote: 'Qur\'an (e.g. 17:85, "the ruh is of the affair of my Lord"); distinguished in some discussions from the nafs (self/ego).',
    aliases: [],
  },
};

// Build an alias → canonical-key index once.
const _alias = (() => {
  const m = new Map();
  for (const [key, c] of Object.entries(CONCEPTS)) {
    m.set(key, key);
    for (const a of c.aliases || []) m.set(a.toLowerCase(), key);
  }
  return m;
})();

const _norm = (s) => String(s || '').toLowerCase().trim();

/** Resolve a user-supplied concept name (canonical key or alias) → canonical key, or null. */
export function resolveConcept(name) {
  return _alias.get(_norm(name)) || null;
}

/** The full list of distinct traditions represented (handy for tests / UI). */
export function traditions() {
  return [...new Set(Object.values(CONCEPTS).map((c) => c.tradition))];
}

// ── Neutral comparison ────────────────────────────────────────────────────────────────────────────
/** Compare two concepts side by side. Returns BOTH glosses with their tradition + source-note and a
 *  neutral framing note — it makes NO claim that either is true, nor that they are "the same." */
export function compare(conceptA, conceptB) {
  const a = resolveConcept(conceptA);
  const b = resolveConcept(conceptB);
  if (!a || !b) {
    const missing = [!a && conceptA, !b && conceptB].filter(Boolean);
    return { ok: false, unknown: missing, note: `No catalog entry for: ${missing.join(', ')}.` };
  }
  const entry = (k) => ({ concept: k, tradition: CONCEPTS[k].tradition, gloss: CONCEPTS[k].gloss, sourceNote: CONCEPTS[k].sourceNote });
  return {
    ok: true,
    a: entry(a),
    b: entry(b),
    // Comparison, NOT assertion: we describe how each tradition speaks, asserting neither as correct
    // and not collapsing them into one. Any equivalence is the reader's to draw, not ours to declare.
    note: 'These are two traditions\' ways of naming the inner life, presented for comparison. Neither is asserted as true, and they are not claimed to be the same thing.',
  };
}

// ── Learning the user's own interpretation ─────────────────────────────────────────────────────────
// In-process store: userId → Map(canonicalConcept → user's own meaning). Deliberately memory-only
// (no persistence, no network) — this module stays a pure logic/data layer. A caller that wants
// durability can wrap it and supply its own store.
const _userInterp = new Map();

/** Record the USER'S OWN interpretation of a concept. We store their words verbatim and never
 *  overwrite them with the catalog gloss — the catalog is comparison; this is the user's own meaning. */
export function learnUserInterpretation(userId, concept, meaning) {
  const uid = _norm(userId);
  const key = resolveConcept(concept);
  const text = String(meaning || '').trim();
  if (!uid) throw new Error('learnUserInterpretation: userId required');
  if (!key) throw new Error(`learnUserInterpretation: unknown concept "${concept}"`);
  if (!text) throw new Error('learnUserInterpretation: meaning required');
  if (!_userInterp.has(uid)) _userInterp.set(uid, new Map());
  _userInterp.get(uid).set(key, text);
  return { userId: uid, concept: key, meaning: text };
}

/** Read back a user's own interpretation of a concept, or null if none recorded. */
export function getUserInterpretation(userId, concept) {
  const key = resolveConcept(concept);
  const u = _userInterp.get(_norm(userId));
  return (key && u && u.get(key)) || null;
}

// ── frameFor: the comparison set + the user's own meaning, asserting nothing ────────────────────────
/** Build the framing for a concept for a given user: the catalog entry, the OTHER traditions as a
 *  comparison set, and — if the user has told us — their OWN interpretation, surfaced as theirs.
 *  CRITICAL: this asserts nothing. `asserts: false` and a neutral note make explicit that nothing is
 *  claimed true; the user's meaning is labeled as the user's, never as fact. */
export function frameFor(userId, concept) {
  const key = resolveConcept(concept);
  if (!key) return { ok: false, unknown: [concept], asserts: false, note: `No catalog entry for "${concept}".` };
  const self = { concept: key, tradition: CONCEPTS[key].tradition, gloss: CONCEPTS[key].gloss, sourceNote: CONCEPTS[key].sourceNote };
  const comparison = Object.keys(CONCEPTS)
    .filter((k) => k !== key)
    .map((k) => ({ concept: k, tradition: CONCEPTS[k].tradition, gloss: CONCEPTS[k].gloss }));
  const userInterpretation = getUserInterpretation(userId, key); // null if not learned yet
  return {
    ok: true,
    asserts: false, // this layer never pronounces which (if any) framing is true
    concept: self,
    comparison,
    userInterpretation, // the user's OWN words, labeled as theirs — not endorsed, not corrected
    // Scholarship/exploration, not a clinical or metaphysical claim. Any experiential practice named
    // alongside these concepts (e.g. binaural beats / brainwave entrainment) is EXPERIENTIAL ONLY,
    // never medical or therapeutic.
    note: userInterpretation
      ? 'Here is how several traditions name the inner life, for comparison, plus your own interpretation as you gave it. Nothing here is asserted as true.'
      : 'Here is how several traditions name the inner life, for comparison. Nothing here is asserted as true; tell me your own interpretation and I will hold it as yours.',
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('consciousness-framing.mjs')) {
  const [, , x, y] = process.argv;
  if (x && y) {
    const c = compare(x, y);
    console.log(JSON.stringify(c, null, 2));
  } else {
    console.log('Comparative consciousness/soul concepts (comparison, not assertion):\n' + '─'.repeat(72));
    for (const [k, c] of Object.entries(CONCEPTS)) {
      console.log(`  ${k.padEnd(10)} [${c.tradition}]\n      ${c.gloss}`);
    }
    console.log(`\n  ${traditions().length} traditions represented. Try: node integrations/consciousness-framing.mjs atman ruah`);
  }
}
