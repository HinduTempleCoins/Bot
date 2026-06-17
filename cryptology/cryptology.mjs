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
const STORE = process.env.CRYPTOLOGY_STORE || path.join(__dirname, 'data', 'cryptology.json');

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
export function loadStore(file = STORE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
export function saveStore(store, file = STORE) {
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
export function remember(p, file = STORE) {
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
  const { persist = true, file = STORE, interests, preferredDepth, path: pathChoice, context } = opts;
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
