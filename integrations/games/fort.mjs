// fort.mjs — the Fort hub + Command Centre router (queue #193). PURE state, no network.
//
// A buildable home base. The Command Centre routes players OUT to each sub-game and pulls their
// OUTPUTS back into the fort inventory; the buildings ARE the crafting stations from the recipe web
// (Grove = farming, Botanist = potions, Kitchen = drinks, …). You raise a base from crop/resource
// materials, then the same materials cycle back through the sub-games and into upgrades.
//
//   acquire materials (sub-games) → build/upgrade a station → route into a sub-game → collect outputs → build …
//
// Like economy.mjs this is PURE logic over a plain in-memory fort object — no broadcast, no
// payment, no I/O — so the rules unit-test offline and any surface (Discord/Telegram/Hathor) reuses
// them identically.
//
//   import { FORT_BUILDINGS, createFort, build, route, collect, craftingStationFor } from './fort.mjs'
//   node integrations/games/fort.mjs            # print the building roster

// ---- BUILDINGS: each is a crafting station from the recipe web, upgradeable with materials. ----
// Each building declares:
//   station   — the recipe-station id it crafts at (the recipe web keys off this)
//   subGame   — the sub-game the Command Centre routes you to (null for the hub itself)
//   maxLevel  — upgrade ceiling
//   cost(lvl) — materials required to reach the NEXT level from `lvl` (a {material: qty} map)
export const FORT_BUILDINGS = Object.freeze({
  Grove: Object.freeze({
    station: 'farm',
    subGame: 'farming',
    maxLevel: 5,
    cost: (lvl) => ({ wood: 2 * (lvl + 1), seed: 1 * (lvl + 1) }),
  }),
  Botanist: Object.freeze({
    station: 'cauldron',
    subGame: 'potions',
    maxLevel: 5,
    cost: (lvl) => ({ herb: 3 * (lvl + 1), water: 2 * (lvl + 1) }),
  }),
  Kitchen: Object.freeze({
    station: 'still',
    subGame: 'drinks',
    maxLevel: 5,
    cost: (lvl) => ({ fruit: 3 * (lvl + 1), water: 1 * (lvl + 1) }),
  }),
  CommandCentre: Object.freeze({
    // the hub itself: routes players out and pulls outputs back. No sub-game of its own.
    station: 'routing',
    subGame: null,
    maxLevel: 5,
    cost: (lvl) => ({ stone: 4 * (lvl + 1), wood: 2 * (lvl + 1) }),
  }),
});

// reverse index: recipe-station id → building name. Buildings are crafting stations, so a recipe
// that says it crafts at e.g. "cauldron" resolves to the Botanist here.
const _STATION_TO_BUILDING = Object.freeze(
  Object.fromEntries(
    Object.entries(FORT_BUILDINGS).map(([name, b]) => [b.station, name]),
  ),
);

// craftingStationFor(recipeStation) — which building hosts a recipe's crafting station.
// Returns the building name, or null if no station matches.
export function craftingStationFor(recipeStation) {
  return _STATION_TO_BUILDING[recipeStation] || null;
}

// sub-game → building name, so route()/collect() can find the station for a sub-game.
const _SUBGAME_TO_BUILDING = Object.freeze(
  Object.fromEntries(
    Object.entries(FORT_BUILDINGS)
      .filter(([, b]) => b.subGame)
      .map(([name, b]) => [b.subGame, name]),
  ),
);

// ---- createFort(owner) — a fresh base. Every building starts at level 0 (unbuilt); inventory empty.
export function createFort(owner) {
  if (!owner) throw new Error('createFort: owner is required');
  const buildings = {};
  for (const name of Object.keys(FORT_BUILDINGS)) buildings[name] = { level: 0 };
  return { owner, buildings, inventory: {} };
}

function _building(fort, name) {
  const def = FORT_BUILDINGS[name];
  if (!def) throw new Error(`unknown building "${name}"`);
  return def;
}

// build(fort, building, materials) — spend materials to upgrade a building one level.
// Consumes the materials FROM the supplied map (mutating it down) and raises the building level.
// Throws if at max level or if materials fall short. Returns the new level.
export function build(fort, building, materials = {}) {
  const def = _building(fort, building);
  const slot = fort.buildings[building];
  if (slot.level >= def.maxLevel) {
    throw new Error(`${building} is already at max level (${def.maxLevel})`);
  }
  const cost = def.cost(slot.level);
  for (const [mat, qty] of Object.entries(cost)) {
    if ((materials[mat] || 0) < qty) {
      throw new Error(`not enough ${mat} to upgrade ${building}: need ${qty}, have ${materials[mat] || 0}`);
    }
  }
  // all checks passed — consume materials and upgrade.
  for (const [mat, qty] of Object.entries(cost)) {
    materials[mat] -= qty;
  }
  slot.level += 1;
  return slot.level;
}

// route(fort, subGame) — the Command Centre routes the player out to a sub-game, returning the
// entry context that sub-game needs: which station/building backs it, its current level (== capability
// tier), the fort owner, and a snapshot of the inventory it can draw on.
export function route(fort, subGame) {
  const building = _SUBGAME_TO_BUILDING[subGame];
  if (!building) throw new Error(`no building routes to sub-game "${subGame}"`);
  const def = FORT_BUILDINGS[building];
  const slot = fort.buildings[building];
  if (slot.level <= 0) throw new Error(`${building} must be built before routing to "${subGame}"`);
  return {
    owner: fort.owner,
    subGame,
    building,
    station: def.station,
    level: slot.level,
    inventory: { ...fort.inventory },
  };
}

// collect(fort, subGame, outputs) — pull a sub-game's outputs back into the fort inventory.
// outputs is a {material: qty} map; quantities accumulate. Returns the updated inventory.
export function collect(fort, subGame, outputs = {}) {
  if (!_SUBGAME_TO_BUILDING[subGame]) throw new Error(`unknown sub-game "${subGame}"`);
  for (const [mat, qty] of Object.entries(outputs)) {
    if (!(qty > 0)) throw new Error(`collect: output "${mat}" must be > 0`);
    fort.inventory[mat] = (fort.inventory[mat] || 0) + qty;
  }
  return { ...fort.inventory };
}

// ---- CLI: print the building roster ----
if (process.argv[1] && process.argv[1].endsWith('fort.mjs')) {
  console.log('Fort buildings (station → sub-game, first upgrade cost):');
  for (const [name, b] of Object.entries(FORT_BUILDINGS)) {
    const cost = Object.entries(b.cost(0)).map(([m, q]) => `${q} ${m}`).join(', ');
    console.log(`  ${name.padEnd(14)} station=${b.station.padEnd(8)} sub-game=${String(b.subGame).padEnd(8)} → ${cost}`);
  }
}
