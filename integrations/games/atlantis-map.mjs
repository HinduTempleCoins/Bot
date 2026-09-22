// atlantis-map.mjs — the world map: an island in the middle of the Atlantic, and eight bearings out.
//
// Built from the operator's handwritten world notes. `.local/GAME_MAP_MECHANICS.md` calls the map
// "the #1 gap ... the one large piece of the HUD Game that does not exist yet"; this is that piece.
//
// Four things in the notes are NOT the genre default, and they are the reason this is its own
// module rather than a reskin of an existing map:
//
//   1. YOU CANNOT WALK. Travel is by portal or by battle. There is no traversable overworld — the
//      "World Map" is a set of destinations, and quests are explicitly not part of it.
//   2. PETS ARE TOOLS, NOT FIGHTERS. They gate Tasks, Games and Jobs. A separate fighting league
//      may exist later; the pet system itself never battles.
//   3. TECH IS ASYMMETRIC BY REGION. Everyone is Stone Age. Egypt is High Tech. That asymmetry is
//      the setting's engine, not a balance knob.
//   4. EACH PLAYER SEES A DIFFERENT WORLD, and revealing part of yours to someone else requires
//      COMPLETING SOMETHING WITH THEM. Not a trade, not a permission toggle — a shared act.
//      That is the most original idea on the page and `reveal()` exists to serve it.
//
// Pure and deterministic: no clock, no RNG, no I/O. State in, new state out.
//
//   import { newWorld, REGIONS, unlock, travel, visibleTo, reveal, canReveal } from './atlantis-map.mjs';

// ── the map ───────────────────────────────────────────────────────────────────────────────────
// Bearings are the operator's, verbatim from the notes. NOTE: the notes give SOUTH-WEST twice —
// "To the South West is Camino Road" and "south west is Brazil/the Amazon". Both are recorded
// rather than silently reconciled; `bearing` is what was written, and disambiguation is a decision
// for the operator, not for this file.
export const START = 'atlantis';

export const REGIONS = Object.freeze([
  { id: 'atlantis',   name: 'The Island',        bearing: null, tech: 'stone',     era: 0, opensWith: [] },
  { id: 'gibraltar',  name: 'Strait of Gibraltar', bearing: 'NE', tech: 'stone',   era: 1, opensWith: ['atlantis'], note: 'Hercules' },
  { id: 'camino',     name: 'Camino Road',       bearing: 'SW', tech: 'stone',     era: 1, opensWith: ['atlantis'] },
  { id: 'horn',       name: 'Horn of Africa',    bearing: 'SE', tech: 'stone',     era: 1, opensWith: ['atlantis'] },
  { id: 'egypt',      name: 'Egypt',             bearing: 'SE', tech: 'high',      era: 2, opensWith: ['horn'] },
  { id: 'middle_east',name: 'The Middle East',   bearing: 'E',  tech: 'stone',     era: 3, opensWith: ['egypt'] },
  { id: 'israel',     name: 'Israel',            bearing: 'E',  tech: 'stone',     era: 4, opensWith: ['middle_east'] },
  { id: 'greece',     name: 'Greece',            bearing: 'NE', tech: 'stone',     era: 4, opensWith: ['middle_east'] },
  { id: 'norse',      name: 'The Norse Lands',   bearing: 'N',  tech: 'stone',     era: 4, opensWith: ['greece'] },
  { id: 'ireland',    name: 'Ireland',           bearing: 'NE', tech: 'stone',     era: 5, opensWith: ['gibraltar'], note: 'far north east' },
  { id: 'iceland',    name: 'Iceland / the Realm', bearing: 'NW', tech: 'stone',   era: 5, opensWith: ['ireland'] },
  { id: 'uk',         name: 'UK',                bearing: 'NW', tech: 'stone',     era: 5, opensWith: ['ireland'] },
  { id: 'arctic',     name: 'The Arctic',        bearing: 'N',  tech: 'stone',     era: 6, opensWith: ['iceland'] },
  { id: 'antarctica', name: 'Antarctica',        bearing: 'S',  tech: 'stone',     era: 6, opensWith: ['atlantis'] },
  { id: 'amazon',     name: 'Brazil / the Amazon', bearing: 'SW', tech: 'stone',   era: 7, opensWith: ['camino'], note: 'western hemisphere opens here' },
]);

export const BY_ID = Object.freeze(Object.fromEntries(REGIONS.map((r) => [r.id, r])));

// Travel is by portal or by battle. Walking is deliberately absent — see header note 1.
export const TRAVEL_MODES = Object.freeze(['portal', 'battle']);

// ── world state ───────────────────────────────────────────────────────────────────────────────
export function newWorld(player) {
  return {
    player: String(player || 'guest'),
    at: START,
    unlocked: [START],
    done: [],            // completed task ids
    figures: [],         // historical figures drawn to the island
    shared: {},          // otherPlayer -> [objectId] they have been shown
    coop: {},            // otherPlayer -> [taskId] completed TOGETHER
  };
}

const uniq = (a) => [...new Set(a)];
const has = (w, id) => w.unlocked.includes(id);

/** A region opens when every region in its opensWith is already unlocked. */
export function canUnlock(world, regionId) {
  const r = BY_ID[regionId];
  if (!r || has(world, regionId)) return false;
  return r.opensWith.every((dep) => has(world, dep));
}

/** Completing a task unlocks what it gates and draws figures to the island. */
export function complete(world, taskId, { unlocks = [], figures = [] } = {}) {
  const w = { ...world, done: uniq([...world.done, String(taskId)]) };
  w.unlocked = uniq([...world.unlocked, ...unlocks.filter((id) => BY_ID[id] && canUnlock(w, id))]);
  // "the island becomes more populated with various Historical Figures" — they come TO the island.
  w.figures = uniq([...world.figures, ...figures]);
  return w;
}

export function unlock(world, regionId) {
  if (!canUnlock(world, regionId)) return world;
  return { ...world, unlocked: uniq([...world.unlocked, regionId]) };
}

/** Travel. Only to an unlocked region, and only by portal or battle. */
export function travel(world, regionId, mode = 'portal') {
  if (!BY_ID[regionId] || !has(world, regionId)) return { ok: false, reason: 'locked', world };
  if (!TRAVEL_MODES.includes(mode)) return { ok: false, reason: 'no-walking', world };
  return { ok: true, world: { ...world, at: regionId } };
}

// ── per-player visibility ─────────────────────────────────────────────────────────────────────
/**
 * What `viewer` can see of `world`. The owner sees everything. Anyone else sees only the regions
 * the owner has unlocked AND the objects they have been explicitly shown — which is what makes two
 * players' maps genuinely different rather than cosmetically different.
 */
export function visibleTo(world, viewer) {
  const owner = viewer === world.player;
  return {
    player: world.player,
    at: owner ? world.at : null,
    regions: world.unlocked.map((id) => ({ id, name: BY_ID[id].name, bearing: BY_ID[id].bearing, tech: BY_ID[id].tech })),
    figures: owner ? world.figures : [],
    objects: owner ? 'all' : (world.shared[viewer] || []),
  };
}

/**
 * Can the owner show `objectId` to `other`? Only if they have completed something TOGETHER.
 * This is the mechanic from the notes: "must show them some things / Complete some things with
 * them to let them see certain Objects." Access is earned by a shared act, not granted by a toggle.
 */
export function canReveal(world, other, objectId) {
  const together = world.coop[other] || [];
  if (!together.length) return { ok: false, reason: 'nothing-completed-together' };
  if ((world.shared[other] || []).includes(objectId)) return { ok: false, reason: 'already-shown' };
  return { ok: true };
}

/** Record a task the two players completed together. This is what earns reveals. */
export function completeTogether(world, other, taskId) {
  const coop = { ...world.coop, [other]: uniq([...(world.coop[other] || []), String(taskId)]) };
  return { ...world, coop, done: uniq([...world.done, String(taskId)]) };
}

export function reveal(world, other, objectId) {
  const gate = canReveal(world, other, objectId);
  if (!gate.ok) return { ok: false, reason: gate.reason, world };
  const shared = { ...world.shared, [other]: uniq([...(world.shared[other] || []), objectId]) };
  return { ok: true, world: { ...world, shared } };
}

// ── pets are tools ────────────────────────────────────────────────────────────────────────────
// "The pets don't fight but are like Tools that help with or Unlock other Tasks, Games, Jobs."
export const PET_JOBS = Object.freeze({
  dog: ['hunting', 'herding'], cat: ['pest-control'], bird: ['scouting', 'messages'],
  bat: ['caves'], pig: ['foraging', 'truffles'], hog: ['foraging'], wolf: ['hunting', 'tracking'],
});

/** Which jobs a set of pets unlocks. Never combat — by design. */
export function jobsFor(pets = []) {
  return uniq(pets.flatMap((p) => PET_JOBS[p] || []));
}

/** A task gated on a job is available only if a pet supplies it. */
export function canDoTask(world, task, pets = []) {
  if (!task || !BY_ID[task.region]) return false;
  if (!has(world, task.region)) return false;
  if (task.requiresJob && !jobsFor(pets).includes(task.requiresJob)) return false;
  return !world.done.includes(String(task.id));
}

export default { REGIONS, BY_ID, START, TRAVEL_MODES, PET_JOBS, newWorld, canUnlock, unlock, complete, travel, visibleTo, canReveal, completeTogether, reveal, jobsFor, canDoTask };
