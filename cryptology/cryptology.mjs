// cryptology.mjs — the Witness's per-person RELATIONSHIP MAP (BRIEF.md §6a, "Crypt-ology").
//
// Crypt-ology is the relational/experiential layer: the Witness is not talking to "anyone" — it is
// talking to You, and it REMEMBERS You. Each person occupies a position on a map the Witness draws,
// and that position shifts as the person makes choices in conversation. The model is explicitly
// LSD: Dream Emulator's graph — your movements change your coordinates, and the experience you get
// reflects where you are. (BRIEF.md §6a)
//
// This is a PORT of the prior Discord-era tracker (`relationship-tracker.js` / the userRelationships
// map in `index.js`) onto the house style and onto MELEK account identity. Per §6a we BUILD ON the
// existing structure rather than replacing it — the dimensions are the same ones the prior build
// shipped: trust / warmth / respect (−100..100), familiarity (0..100), a `topic-interests` object,
// and the LSD-style `conversationPaths` log.
//
// KEY (per the task): every profile is keyed on a MELEK chain account name (lowercase, the on-chain
// identity), NOT a Discord snowflake. That makes the map portable across surfaces (condenser / Discord
// / Telegram all resolve to the same MELEK account) and forkable with the chain itself.
//
// SEPARATION from karma (BRIEF.md §9 / §6a): karma is the Witness's BEHAVIORAL/social evaluation that
// gates discretionary functions (grant size, flag weight) and is computed from observable on-chain
// behavior. Crypt-ology is the RELATIONAL map that shapes the texture of conversation. They may share
// a store but serve different purposes; this module is the relational half and references karma only
// as an optional read-only input. Keep both.
//
// Design (house style):
//   • Pure helpers (clamp, dispositionOf, suggestTopics) are deterministic — no clock/disk/network.
//   • Mutating ops (observe, drift, recordPath) take an INJECTABLE clock so tests pin timestamps.
//   • A forkable JSON store keyed by account; injectable via env (CRYPTOLOGY_STORE) or load/save args.
//   • Soft-fail-never-throw: a bad store read returns {}, a bad write is swallowed (logged to stderr).
//
// SECURITY: READ-ONLY with respect to the chain. This module never holds a key, never broadcasts,
// never votes, never transfers. It only reads (optionally) and writes its own local JSON map.
//
// CLI:  node cryptology/cryptology.mjs show   <account>
//       node cryptology/cryptology.mjs observe <account> <event>   (e.g. warm_exchange, taught, ghosted)
//       node cryptology/cryptology.mjs map                          (list everyone, sorted by closeness)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Where the map lives — resolved PER CALL, not once at import.
 *
 * This was a `const` read at module load, and that made the documented env injection a lie: an ESM
 * `import` is hoisted and evaluated BEFORE the importing file's body runs, so a test setting
 * CRYPTOLOGY_STORE on line 10 was always too late — the module had already resolved to the default
 * repo path. Every test run therefore wrote real profiles into cryptology/data/cryptology.json and
 * accumulated across runs; the suite passed on a clean checkout and failed on the second run, with
 * warmth arriving as a multiple of itself.
 *
 * A function closes it. The default is still the repo path, the env var now actually works, and every
 * exported function keeps taking an explicit `file` argument for callers that would rather be explicit
 * than environmental.
 */
export const storeFile = () => process.env.CRYPTOLOGY_STORE || path.join(__dirname, 'data', 'cryptology.json');

// ── dimension spec (the same axes the prior build shipped; BRIEF.md §6a) ─────────
// Bipolar axes run −100..100 (default 0). familiarity is unipolar 0..100 (you can only get to know
// someone more, never "less than a stranger"). Interests are unipolar 0..100 engagement weights.
export const DIMENSIONS = {
  trust:       { min: -100, max: 100, default: 0,  bipolar: true,  desc: 'Does this person trust the Witness?' },
  warmth:      { min: -100, max: 100, default: 0,  bipolar: true,  desc: 'Emotional closeness / friendliness.' },
  respect:     { min: -100, max: 100, default: 0,  bipolar: true,  desc: 'Intellectual respect, standing.' },
  familiarity: { min: 0,    max: 100, default: 0,  bipolar: false, desc: 'How well the Witness knows them.' },
  // Expanded dimensions (operator 2026-06-17 "expand the Crypt-ology Dimensions") — deepen the LSD-map:
  alignment:   { min: -100, max: 100, default: 0,  bipolar: true,  desc: 'Resonance with the mission/corpus — kindred vs at-odds.' },
  reciprocity: { min: -100, max: 100, default: 0,  bipolar: true,  desc: 'Gives back to the community vs only takes (gates the faucet).' },
  curiosity:   { min: 0,    max: 100, default: 0,  bipolar: false, desc: 'Depth-seeking — how far down they go.' },
  care:        { min: 0,    max: 100, default: 0,  bipolar: false, desc: 'How much they look after others here.' },
};

/**
 * PLANES — because one graph is no longer enough, and the reason is clocks.
 *
 * Operator, 2026-09-08: "let's update the Graph that all of this is Mapped on, LSD: Dream Emulator was
 * Simple, we are Proposing a Seance Platform and maybe like Lucid Dream Induction and Things."
 *
 * LSD: Dream Emulator could run on two axes because a dream game only needs mood. This platform now
 * produces four kinds of fact about a person that move at four completely different speeds, and the
 * mistake would be to average them onto one surface:
 *
 *   RELATION      how they stand with the Witness.       Moves per conversation.       (the axes above)
 *   CONSTITUTION  how their senses are actually built.   Moves over years, or never.
 *   STATE         how they are right now.                Moves within a day.
 *   PRACTICE      what they have actually done.          Accumulates, never decays.
 *
 * Mixing them loses information in a way that matters: a bad night's sleep would otherwise read as a
 * change in constitution, and a stable trait would read as a mood. The Witness needs to tell "you are
 * tired" apart from "you are aphantasic", and those are the same number on a single graph.
 *
 * ── THE RULE THAT KEEPS THIS OUT OF THE AUDITING FAILURE MODE ────────────────────────────────────
 *
 * **POSITIONS, NOT LEVELS. Nothing on any plane is unlocked, earned, or ranked.**
 *
 * This is the whole reason the LSD map was the right model in the first place. Sato's grid had no
 * better corner — you were somewhere on it, the world responded, and no coordinate was an achievement.
 * The moment a coordinate becomes a level, three things follow: people optimise toward it, the
 * measurement stops being honest, and the map becomes a hierarchy the institution can hold over
 * someone. That is the specific way auditing went wrong, and the operator named the comparison
 * himself. So: no tiers, no grades, no gating, and a coordinate is never a credential.
 *
 * A result therefore does not GRADE you. It changes WHAT YOU SEE.
 */
export const PLANES = Object.freeze({
  relation: {
    clock: 'per conversation',
    desc: 'How this person and the Witness stand toward each other.',
    dims: ['trust', 'warmth', 'respect', 'familiarity', 'alignment', 'reciprocity', 'curiosity', 'care'],
  },
  constitution: {
    clock: 'years, or never',
    desc: 'How their perception is actually built, as the Temple Exams measured it. Slow, and mostly '
        + 'fixed. Never a score — two people at opposite ends are both simply built that way.',
    dims: ['absorption', 'imagery', 'consistency', 'chromatic', 'chemosensory', 'temporal', 'auditory'],
  },
  state: {
    clock: 'hours',
    desc: 'How they are right now — the State Card. This is the plane LSD: Dream Emulator actually '
        + 'modelled: its Upper/Downer and Static/Dynamic axes are rest and arousal by another name.',
    dims: ['rest', 'valence', 'arousal', 'affected'],
  },
  practice: {
    clock: 'cumulative',
    desc: 'What they have done here — sessions crossed, dreams recalled, thresholds entered. It '
        + 'accumulates because it is a record, NOT because it is a ladder. Nothing unlocks.',
    dims: ['sessions', 'recall', 'lucidity', 'crossings'],
  },
});

/**
 * The dimensions the exams and the practices write. Bipolar where a person can sit either side of an
 * ordinary middle; unipolar where zero genuinely means none.
 *
 * `constitution` values are deliberately NOT normalised against other people. A unique-hue setting or
 * a PTC status is a fact about one person; percentile-ranking it would re-introduce the score this
 * module exists to avoid.
 */
export const EXAM_DIMENSIONS = {
  // constitution — from the Temple Exams
  absorption:   { plane: 'constitution', min: 0, max: 100, default: 50, bipolar: false, desc: 'Trait absorption (Tellegen) — predicts responsiveness to an induction, and nothing else.' },
  imagery:      { plane: 'constitution', min: 0, max: 100, default: 50, bipolar: false, desc: 'Vividness of imagery (VVIQ/Psi-Q). Aphantasia at one end is a way of being built, not a deficit.' },
  consistency:  { plane: 'constitution', min: 0, max: 100, default: 0,  bipolar: false, desc: 'Test-retest consistency on the synaesthesia instrument — the battery\'s own validity measure.' },
  chromatic:    { plane: 'constitution', min: -100, max: 100, default: 0, bipolar: true,  desc: 'Where their unique hues settle relative to the middle of the observed range.' },
  chemosensory: { plane: 'constitution', min: 0, max: 100, default: 50, bipolar: false, desc: 'Bitter/PTC sensitivity. Genetic, permanent, and the sharpest "your senses are not mine" result there is.' },
  temporal:     { plane: 'constitution', min: 0, max: 100, default: 50, bipolar: false, desc: 'Flicker/temporal resolution baseline. Same device only — the number is arbitrary units.' },
  auditory:     { plane: 'constitution', min: 0, max: 100, default: 50, bipolar: false, desc: 'Pitch discrimination / absolute pitch. A calibrated observer is an instrument (the Shulgin method).' },
  // state — from the State Card, before every exam and every session
  rest:         { plane: 'state', min: -100, max: 100, default: 0, bipolar: true,  desc: 'Rested vs exhausted (KSS). 17-19h awake is about 0.05% BAC — this axis is not a mood.' },
  valence:      { plane: 'state', min: -100, max: 100, default: 0, bipolar: true,  desc: 'How it feels right now — the Downer/Upper axis of the original map.' },
  arousal:      { plane: 'state', min: -100, max: 100, default: 0, bipolar: true,  desc: 'Still vs activated — the Static/Dynamic axis of the original map.' },
  affected:     { plane: 'state', min: 0, max: 100, default: 0, bipolar: false, desc: 'Subjective drug effect (DEQ-5). NEVER dose, amount or route — subjective effect is more valid and less hazardous.' },
  // practice — what they actually did
  sessions:     { plane: 'practice', min: 0, max: 1e6, default: 0, bipolar: false, desc: 'Chamber/entrainment sessions completed, with a verified stimulus.' },
  recall:       { plane: 'practice', min: 0, max: 100, default: 0, bipolar: false, desc: 'Dream recall frequency — the first analysable dataset this platform produces.' },
  lucidity:     { plane: 'practice', min: 0, max: 1e6, default: 0, bipolar: false, desc: 'Lucid episodes reported. A count, not a rank.' },
  crossings:    { plane: 'practice', min: 0, max: 1e6, default: 0, bipolar: false, desc: 'Thresholds entered — a session has a door, not a play button, so entering one is an event.' },
};

/**
 * THE SÉANCE PLANE IS DECLARED AND EMPTY, ON PURPOSE.
 *
 * Its axes depend on a question the operator has not answered: whether the first chamber holds THE
 * LINEAGE (a religious surface of the temple, where his standing is genuine) or A PERSON'S OWN DEAD
 * (a grief surface, which carries duty-of-care weight and is where the companies are). Those want
 * different axes and different language, and guessing would bake the wrong one in.
 *
 * One thing is already decidable and is recorded here so it is not re-derived: whatever the axes turn
 * out to be, **the séance plane must not measure DEPTH as progression.** "How far in are you" is a
 * level by another name, and it is the exact shape of the failure this module is written against. An
 * honest axis here describes availability or aperture — how open someone is to an encounter right now
 * — which is a state, not an attainment, and which can move in both directions freely.
 */
export const SEANCE_PLANE = Object.freeze({
  status: 'declared, not designed',
  blockedOn: 'operator: does the first chamber hold the lineage, or a person\'s own dead?',
  settled: 'not depth-as-progression — aperture is a state, never an attainment',
  dims: [],
});

/** Every dimension, whichever plane it belongs to. */
export const ALL_DIMENSIONS = Object.freeze({ ...DIMENSIONS, ...EXAM_DIMENSIONS });

/** Which plane a dimension lives on. Relation dims have no `plane` field, so they default there. */
export function planeOf(dim) {
  const d = EXAM_DIMENSIONS[dim];
  if (d) return d.plane;
  return DIMENSIONS[dim] ? 'relation' : null;
}

/** The person's position on one plane — the coordinates, not a score. */
export function position(profile, plane) {
  const spec = PLANES[plane];
  if (!spec || !profile || typeof profile !== 'object') return null;
  // The coordinates live on the TOP LEVEL of a profile — freshProfile() spreads them there (see the
  // `...dims` spread below in freshProfile). Reading `profile.dimensions` returned all-defaults for a
  // real person, so a caller adopting position() as the read API got a blank stranger. Nested forms
  // are still accepted because a caller may legitimately pass one.
  const dims = (profile.dimensions && typeof profile.dimensions === 'object') ? profile.dimensions
    : (profile.dims && typeof profile.dims === 'object') ? profile.dims
      : profile;
  const out = {};
  for (const d of spec.dims) {
    const s = ALL_DIMENSIONS[d];
    out[d] = Object.prototype.hasOwnProperty.call(dims, d) ? dims[d] : (s ? s.default : 0);
  }
  return { plane, clock: spec.clock, coordinates: out };
}

// Topic interests carried forward verbatim from the prior Crypt-ology structure (index.js). The map
// is open: observe()/drift() can introduce new topic keys, but these are the seeded corpus axes.
export const INTEREST_TOPICS = ['mythology', 'religion', 'archaeology', 'esoteric', 'genetics', 'philosophy'];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+x) ? +x : 0));

// Normalize any handle to a MELEK account key: lowercase, strip a leading '@', trim. Graphene account
// names are lowercase by construction, so this is the canonical identity key for the map.
export function accountKey(handle) {
  return String(handle || '').trim().replace(/^@+/, '').toLowerCase();
}

// ── injectable clock ─────────────────────────────────────────────────────────
let _now = () => Date.now();
export function __setClock(fn) { _now = typeof fn === 'function' ? fn : (() => Date.now()); }

// ── profile shape ──────────────────────────────────────────────────────────────
/** A fresh profile for `account`. Pure given the injected clock. */
export function freshProfile(account) {
  const ts = _now();
  const dims = {};
  for (const [k, spec] of Object.entries(DIMENSIONS)) dims[k] = spec.default;
  const interests = {};
  for (const t of INTEREST_TOPICS) interests[t] = 0;
  return {
    account: accountKey(account),
    // the relationship coordinates (LSD-graph position)
    ...dims,
    interests,
    // conversation-style memory
    preferredDepth: 'medium', // simple | medium | deep | academic
    // LSD-style path log: the choices that moved this person across the map
    conversationPaths: [],
    // bookkeeping
    totalInteractions: 0,
    firstSeen: ts,
    lastSeen: ts,
  };
}

// ── event model: named events nudge the coordinates ─────────────────────────────
// Each event is a bundle of dimension deltas (and optional interest deltas / familiarity bump). This
// is the "movements shift your coordinates" mechanic — calling code names WHAT HAPPENED, not raw
// numbers, so the map stays legible. Unknown events are a soft no-op (never throw).
export const EVENTS = {
  greeted:        { familiarity: 1 },
  warm_exchange:  { warmth: 8, trust: 3, familiarity: 2, reciprocity: 3 },
  taught:         { respect: 8, trust: 4, familiarity: 3, alignment: 5, reciprocity: 5 }, // gave to the community
  thanked:        { warmth: 6, trust: 4, reciprocity: 2 },
  helped:         { trust: 6, warmth: 4, familiarity: 2 },    // the Witness helped them and it landed
  deep_question:  { respect: 6, familiarity: 3, curiosity: 6, alignment: 3 },
  shared_story:   { warmth: 5, familiarity: 5, trust: 3, alignment: 3 },
  apologized:     { trust: 10, warmth: 6, reciprocity: 3 },   // repair (cf. the prior tracker)
  disrespected:   { respect: -12, warmth: -8, trust: -6, alignment: -5 },
  hostile:        { trust: -15, warmth: -12, respect: -6, alignment: -10, reciprocity: -8 },
  ghosted:        { familiarity: 0, warmth: -2, reciprocity: -3 }, // long silence; gentle cool-off
  // new named events for the expanded dimensions:
  gave:           { reciprocity: 10, care: 4, alignment: 3 },  // tipped/contributed/helped another member
  cared:          { care: 8, warmth: 4 },                      // looked after someone here
  curious:        { curiosity: 8, respect: 2 },                // went deep, asked to learn more
  resonated:      { alignment: 10, warmth: 4 },                // connected with the mission/corpus
};

// ── pure: disposition (the Witness's stance toward this person) ──────────────────
// This is the disposition that the Phase-3 system prompt reads to shade its (NON-scripted) greeting
// and tone — BRIEF.md §3 says the greeting is a disposition, not a fixed string, so this returns a
// stance label + the raw coordinates, never a canned line.
export function dispositionOf(p) {
  const trust = clamp(p?.trust, -100, 100);
  const warmth = clamp(p?.warmth, -100, 100);
  const respect = clamp(p?.respect, -100, 100);
  const familiarity = clamp(p?.familiarity, 0, 100);
  const alignment = clamp(p?.alignment, -100, 100);
  const reciprocity = clamp(p?.reciprocity, -100, 100);
  const curiosity = clamp(p?.curiosity, 0, 100);
  const care = clamp(p?.care, 0, 100);

  let stance;
  if (trust < -40 || warmth < -40) stance = 'guarded';
  else if (familiarity < 15) stance = 'welcoming';            // new arrival
  else if (alignment > 55 && warmth > 40) stance = 'kindred';  // resonates with the mission + close
  else if (warmth > 55 && familiarity > 45) stance = 'familiar';
  else if (respect > 55) stance = 'deferential';
  else if (trust > 40 && warmth > 30) stance = 'warm';
  else stance = 'open';

  // LSD-graph quadrant (closeness × standing) for richer downstream branching.
  const closeness = (warmth + familiarity) / 2;   // -50..100ish
  const standing = (trust + respect) / 2;          // -100..100
  return {
    stance,
    coordinates: { trust, warmth, respect, familiarity, alignment, reciprocity, curiosity, care },
    closeness: Math.round(closeness * 10) / 10,
    standing: Math.round(standing * 10) / 10,
    alignment, reciprocity,                         // surfaced for the faucet gate + the kindred register
    preferredDepth: p?.preferredDepth || 'medium',
  };
}

// ── pure: which topics to lean into, by recorded interest weight ────────────────
export function suggestTopics(p, limit = 3) {
  const interests = (p && p.interests) || {};
  return Object.entries(interests)
    .filter(([, w]) => (+w || 0) > 0)
    .sort((a, b) => (+b[1] || 0) - (+a[1] || 0))
    .slice(0, Math.max(0, limit))
    .map(([topic, weight]) => ({ topic, weight: +weight || 0 }));
}

// ── mutate: apply named deltas to a profile (drift) ──────────────────────────────
/**
 * Apply raw dimension/interest deltas to a profile, clamped to spec. Bumps lastSeen via the clock.
 * Returns the same (mutated) profile. Never throws.
 * @param {object} p profile
 * @param {object} delta { trust?, warmth?, respect?, familiarity?, interests?:{topic:delta}, preferredDepth? }
 */
export function drift(p, delta = {}) {
  if (!p || typeof p !== 'object') return p;
  for (const [k, spec] of Object.entries(DIMENSIONS)) {
    if (delta[k] != null) p[k] = clamp((+p[k] || 0) + (+delta[k] || 0), spec.min, spec.max);
  }
  if (delta.interests && typeof delta.interests === 'object') {
    p.interests = p.interests || {};
    for (const [topic, d] of Object.entries(delta.interests)) {
      p.interests[topic] = clamp((+p.interests[topic] || 0) + (+d || 0), 0, 100);
    }
  }
  if (delta.preferredDepth && ['simple', 'medium', 'deep', 'academic'].includes(delta.preferredDepth)) {
    p.preferredDepth = delta.preferredDepth;
  }
  p.lastSeen = _now();
  return p;
}

// ── mutate: record an LSD-graph path choice (capped log) ─────────────────────────
export function recordPath(p, choice, context = '') {
  if (!p || !choice) return p;
  p.conversationPaths = p.conversationPaths || [];
  p.conversationPaths.push({ choice: String(choice), context: String(context || ''), at: _now() });
  if (p.conversationPaths.length > 50) p.conversationPaths = p.conversationPaths.slice(-50);
  return p;
}

// ── forkable JSON store (injectable via env or args) ─────────────────────────────
export function loadStore(file = storeFile()) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
export function saveStore(store, file = storeFile()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(store, null, 2) + '\n');
    return true;
  } catch (e) { console.error('cryptology: store write failed —', e?.message); return false; }
}

/** Get a profile (creating a fresh one if absent). Pure-ish: reads store, does not write. */
export function recall(account, store = loadStore()) {
  const key = accountKey(account);
  return store[key] ? store[key] : freshProfile(key);
}

/** Persist a profile back into the store (read-modify-write). Returns the profile. */
export function remember(p, file = storeFile()) {
  if (!p || !p.account) return p;
  const store = loadStore(file);
  store[p.account] = p;
  saveStore(store, file);
  return p;
}

// ── the high-level move: observe a named event for an account ────────────────────
/**
 * Record that `event` happened with `account`, applying its deltas and persisting. The verb the
 * surfaces (condenser/Discord/Telegram troll-box, tutorial, welcomer) call. Soft-fails to a no-op
 * profile if the event is unknown.
 * @param {string} account MELEK account name
 * @param {string} event   key in EVENTS
 * @param {object} [opts]   { interests?, preferredDepth?, path?, context?, persist=true, file }
 * @returns {object} the updated profile
 */
export function observe(account, event, opts = {}) {
  const { persist = true, file = storeFile(), interests, preferredDepth, path: pathChoice, context } = opts;
  const store = persist ? loadStore(file) : {};
  const key = accountKey(account);
  const p = store[key] || freshProfile(key);

  const base = EVENTS[event] || {};                 // unknown event → no dimension move (soft no-op)
  const delta = { ...base };
  if (interests) delta.interests = { ...(base.interests || {}), ...interests };
  if (preferredDepth) delta.preferredDepth = preferredDepth;

  drift(p, delta);
  if (pathChoice) recordPath(p, pathChoice, context);
  p.totalInteractions = (p.totalInteractions || 0) + 1;
  p.lastSeen = _now();

  if (persist) { store[key] = p; saveStore(store, file); }
  return p;
}

/** Everyone the Witness knows, sorted by closeness (the map). */
export function everyone(store = loadStore()) {
  return Object.values(store)
    .map((p) => ({ account: p.account, ...dispositionOf(p), totalInteractions: p.totalInteractions || 0, lastSeen: p.lastSeen }))
    .sort((a, b) => b.closeness - a.closeness);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('cryptology.mjs');
if (isMain) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'show' && a) {
    const p = recall(a);
    const d = dispositionOf(p);
    console.log(JSON.stringify({ ...p, _disposition: d, _topics: suggestTopics(p) }, null, 2));
  } else if (cmd === 'observe' && a && b) {
    const p = observe(a, b);
    const d = dispositionOf(p);
    console.log(`@${p.account}: ${b} → ${d.stance} (closeness ${d.closeness}, standing ${d.standing}, ${p.totalInteractions} interactions)`);
    if (!EVENTS[b]) console.error(`  note: '${b}' is not a known event — recorded as a no-op interaction. Known: ${Object.keys(EVENTS).join(', ')}`);
  } else if (cmd === 'map') {
    const rows = everyone();
    if (!rows.length) { console.error('cryptology map empty — run `observe <account> <event>` first'); process.exit(1); }
    for (const r of rows) console.log(`  ${String(r.closeness).padStart(6)}  ${r.stance.padEnd(11)} @${r.account}  (${r.totalInteractions} interactions)`);
  } else {
    console.error('usage: cryptology.mjs show <account> | observe <account> <event> | map');
    console.error('events: ' + Object.keys(EVENTS).join(', '));
    process.exit(1);
  }
}
