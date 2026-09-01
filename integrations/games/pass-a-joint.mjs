// pass-a-joint.mjs — the "Pass a Joint" social game. The CONSUMPTION SINK the farm economy needs.
//
// The Kush Farm PRODUCES strains (plant-genetics.mjs: potency/aroma/rarity). "Pass a Joint" is where
// they get CONSUMED: a harvested strain is rolled into a joint (burns the product = a real material
// sink, gap A5.5 in the economy research) and passed around a circle of players. Each puff earns
// non-cashable VIBES scaled by the strain's genetics; the joint burns down to a roach.
//
// It also teaches the etiquette: "puff, puff, PASS." Hogging a third hit is a BOGART (a vibe penalty),
// and overdoing a high-potency strain greens you out (couch-lock = diminishing/negative vibes) — a
// moderation/harm-reduction mechanic, not a glorification. Purely digital; VIBES are a non-cashable
// play score, never money, never a wager.
//
// PURE + deterministic: no network, no clock, no rng — state in, new state out. Safe for on-chain
// reproducibility and offline tests.
//
//   import { rollJoint, openCircle, puff, bogart, pass, tally, PUFF_LIMIT } from './games/pass-a-joint.mjs'
//   node integrations/games/pass-a-joint.mjs      # demo: a 3-person session smokes a joint down

// Roll kinds — the beachhead is "send each other joints AND blunts" (Facebook social-gifting pattern).
// A blunt is wrapped bigger: it holds more, so more hits per gram.
export const KINDS = { joint: { hitsMult: 1, label: 'Joint' }, blunt: { hitsMult: 1.6, label: 'Blunt' } };

export const HITS_PER_GRAM = 6;     // a rolled gram ≈ this many hits
export const PUFF_LIMIT = 2;        // puff, puff, then you MUST pass
export const BOGART_PENALTY = 5;    // vibes lost for hogging a 3rd+ consecutive hit
export const GREENOUT_HITS = 8;     // cumulative hits per player before couch-lock sets in
export const AROMA_BONUS_MIN = 60;  // aroma at/above this adds a small "smells great" room bonus

const clampInt = (n) => Math.max(0, Math.round(Number(n) || 0));

// ---------------------------------------------------------------------------
// rollJoint — turn a harvested strain into a joint. Accepts a plant-genetics phenotype
// ({ potency, aroma }) or explicit values, plus grams (more grams = more hits).
// ---------------------------------------------------------------------------
export function rollJoint({ potency = 50, aroma = 50, grams = 1, id = 'joint', strain = null, kind = 'joint' } = {}) {
  const k = KINDS[kind] ? kind : 'joint';
  const pot = Math.max(0, Math.min(100, Math.round(potency)));
  const aro = Math.max(0, Math.min(100, Math.round(aroma)));
  const hits = Math.max(1, clampInt(grams * HITS_PER_GRAM * KINDS[k].hitsMult));
  return { id, strain, kind: k, potency: pot, aroma: aro, hits, hitsTotal: hits, roach: false };
}

/** Roll a blunt (holds more than a joint). Convenience over rollJoint. */
export function rollBlunt(opts = {}) { return rollJoint({ ...opts, kind: 'blunt' }); }

/**
 * gift — the social-gifting primitive: pass a rolled joint/blunt from one player to another (the
 * "send each other joints and blunts" beachhead loop). PURE: returns a transfer record the caller
 * uses to move the item NFT; a spent roach can't be gifted.
 */
export function gift(joint, from, to) {
  if (!joint || joint.hits == null) throw new Error('gift needs a rolled joint');
  if (!from || !to) throw new Error('gift needs a from and a to');
  if (from === to) throw new Error('cannot gift to yourself');
  if (joint.roach || joint.hits <= 0) return { ok: false, reason: 'spent-roach' };
  return { ok: true, from, to, kind: joint.kind || 'joint', joint: { ...joint } };
}

// ---------------------------------------------------------------------------
// openCircle — start a session. players = array of ids (order = the circle). The first player holds.
// ---------------------------------------------------------------------------
export function openCircle({ players = [], joint } = {}) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('pass-a-joint needs >= 2 players');
  if (!joint || joint.hits == null) throw new Error('openCircle needs a rolled joint');
  const zero = Object.fromEntries(players.map((p) => [p, 0]));
  return {
    players: [...players],
    holder: 0,
    consecutive: 0,               // consecutive puffs by the current holder
    joint: { ...joint },
    vibes: { ...zero },           // non-cashable score per player
    hitsTaken: { ...zero },       // cumulative hits per player (drives greenout)
    over: false,
    log: [],
  };
}

export const holderId = (s) => s.players[s.holder];
export const canPuff = (s) => !s.over && s.joint.hits > 0 && s.consecutive < PUFF_LIMIT;

// vibe gained for one hit given the smoker's cumulative hits so far (greenout = negative).
function vibeGain(potency, aroma, cumulativeBefore) {
  if (cumulativeBefore >= GREENOUT_HITS) return -Math.max(1, Math.round(potency / 20)); // couch-lock
  const base = Math.round(potency / 10);           // 0..10 by potency
  const roomBonus = aroma >= AROMA_BONUS_MIN ? 1 : 0;
  return base + roomBonus;
}

function endIfSpent(s) {
  if (s.joint.hits <= 0) { s.joint.roach = true; s.over = true; }
  return s;
}

// ---------------------------------------------------------------------------
// puff — the current holder takes a legal hit (within the puff-puff-pass limit).
// Returns { session, event }. event: 'puff' | 'must-pass' | 'roach' | 'over'.
// ---------------------------------------------------------------------------
export function puff(session) {
  const s = clone(session);
  if (s.over) return { session: s, event: 'over' };
  if (s.joint.hits <= 0) return { session: endIfSpent(s), event: 'roach' };
  if (s.consecutive >= PUFF_LIMIT) return { session: s, event: 'must-pass' }; // etiquette: you must pass now
  const who = holderId(s);
  const gain = vibeGain(s.joint.potency, s.joint.aroma, s.hitsTaken[who]);
  s.joint.hits -= 1;
  s.hitsTaken[who] += 1;
  s.consecutive += 1;
  s.vibes[who] += gain;
  s.log.push({ who, action: 'puff', gain, hitsLeft: s.joint.hits });
  return { session: endIfSpent(s), event: 'puff' };
}

// ---------------------------------------------------------------------------
// bogart — deliberately hog a 3rd+ consecutive hit. Takes the hit but costs a penalty (breaks
// etiquette). Models the social cost of not passing.
// ---------------------------------------------------------------------------
export function bogart(session) {
  const s = clone(session);
  if (s.over || s.joint.hits <= 0) return { session: endIfSpent(s), event: 'roach' };
  if (s.consecutive < PUFF_LIMIT) {
    // not actually hogging yet — treat as a normal puff
    return puff(session);
  }
  const who = holderId(s);
  const gain = vibeGain(s.joint.potency, s.joint.aroma, s.hitsTaken[who]) - BOGART_PENALTY;
  s.joint.hits -= 1;
  s.hitsTaken[who] += 1;
  s.consecutive += 1;
  s.vibes[who] += gain;
  s.log.push({ who, action: 'bogart', gain, hitsLeft: s.joint.hits });
  return { session: endIfSpent(s), event: 'bogart' };
}

// ---------------------------------------------------------------------------
// pass — hand the joint to the next player. Resets the consecutive-puff counter.
// ---------------------------------------------------------------------------
export function pass(session) {
  const s = clone(session);
  if (s.over) return { session: s, event: 'over' };
  s.holder = (s.holder + 1) % s.players.length;
  s.consecutive = 0;
  s.log.push({ action: 'pass', to: holderId(s) });
  return { session: endIfSpent(s), event: 'pass' };
}

// ---------------------------------------------------------------------------
// tally — final standings. Returns players ranked by vibes (desc), plus totals.
// ---------------------------------------------------------------------------
export function tally(session) {
  const rows = session.players.map((p) => ({ player: p, vibes: session.vibes[p], hits: session.hitsTaken[p] }));
  rows.sort((a, b) => b.vibes - a.vibes || a.hits - b.hits);
  return {
    over: session.over,
    roach: session.joint.roach,
    hitsSmoked: session.joint.hitsTotal - session.joint.hits,
    standings: rows,
    totalVibes: rows.reduce((n, r) => n + r.vibes, 0),
  };
}

function clone(s) {
  return {
    ...s,
    joint: { ...s.joint },
    vibes: { ...s.vibes },
    hitsTaken: { ...s.hitsTaken },
    players: [...s.players],
    log: [...s.log],
  };
}

// ---------------------------------------------------------------------------
// CLI demo (guarded) — polite circle: everyone puffs twice then passes until the roach.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('pass-a-joint.mjs')) {
  const joint = rollJoint({ potency: 72, aroma: 66, grams: 1, id: 'kailash-frost-x-nataraja' });
  let s = openCircle({ players: ['ravi', 'maya', 'leo'], joint });
  let guard = 0;
  while (!s.over && guard++ < 100) {
    let r = puff(s); s = r.session;
    if (r.event === 'must-pass' || r.event === 'roach') { s = pass(s).session; continue; }
    r = puff(s); s = r.session;         // second puff
    s = pass(s).session;                 // ...then pass
  }
  console.log('joint:', joint);
  console.log('result:', tally(s));
}
