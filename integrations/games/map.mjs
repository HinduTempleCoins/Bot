// map.mjs — the persistent-world MAP layer for the HUD Game (the #1 gap in HUD_GAME_DESIGN §2c).
//
// A SMALL, BOUNDED HEX BOARD in AXIAL coordinates ({q,r}), the Catan "typed tiles + adjacency"
// model married to the Infinity-Kingdom "claim outward" expansion axis, on idle-game timers. This is
// the one genuinely-new LOGIC module the map needs; the surface (site/map/) renders it, and everything
// downstream (farm/mine/craft) already exists as pure modules we import or mirror here.
//
// PURE: no network, no I/O, no wall clock of its own — the clock is INJECTED ({ now }) everywhere so
// offline accrual is deterministic and unit-testable (same pattern as crops.mjs/tribulum). Functions
// SOFT-FAIL: they return { ok:false, reason } rather than throwing, so a hostile/garbage input can
// never crash a caller (the surface handler must never 500 on a bad map action).
//
// ZERO WIF. Claiming a tile does NOT broadcast — it returns a call-DESCRIPTOR ({ contract, fn, args,
// broadcast:false, note }) in the repo's mint-nothing pattern (see prana-farm.mjs). The edge / a
// server-side MELEK-Signer re-validates and settles the deed; this module signs nothing and holds no key.
//
//   import { generateBoard, createPlayer, claim, placeNode, staffNode, collect, resolveExpedition,
//            neighbors, hexDistance, axialToPixel, hexCorners, AFFINITIES, NODE_KINDS } from './map.mjs'
//   node integrations/games/map.mjs            # demo: build a board, claim + place + collect

import { makeRng, traits } from './creatures.mjs';

// ---------------------------------------------------------------------------
// Affinities — the production chain mapped onto PLACE. Original MELEK/temple-tech flavor; the
// EXPRESSION is ours (names/blurbs), the mechanic (typed tiles) is free game-design math.
// Each affinity gates which extraction node a tile can host (HUD_GAME_DESIGN §4b).
// ---------------------------------------------------------------------------
export const AFFINITIES = Object.freeze({
  home:    { label: 'Home',    blurb: 'Your seat — hosts the Fort. Routes, does not extract.', node: null },
  fertile: { label: 'Fertile', blurb: 'Loam that takes a seed. Farm here.',        node: 'farm' },
  ore:     { label: 'Ore-rich', blurb: 'A lode under the crust. Mine here.',        node: 'mine' },
  timber:  { label: 'Timber',  blurb: 'Old grove, standing wood. Fell here.',       node: 'timber' },
  water:   { label: 'Water',   blurb: 'A spring — feeds farms and refineries.',     node: 'water' },
  wild:    { label: 'Wild',    blurb: 'Unbroken frontier. Send an expedition.',     node: 'expedition' },
});

// Non-home affinities that a generated tile may roll, with relative weights (fertile most common,
// wild rarer). Deterministic given the board seed.
const AFFINITY_TABLE = Object.freeze([
  ['fertile', 5], ['timber', 4], ['water', 3], ['ore', 3], ['wild', 2],
]);

// ---------------------------------------------------------------------------
// Node kinds — the EXTRACTION stages that sit ON the map (transformation stays in the Fort/menus).
// baseYield per interval; intervalMs is the check-in cadence (timers, not ticks). resource is the
// raw the node produces into player.resources. Expedition is special (resolved, not accrued).
// ---------------------------------------------------------------------------
export const NODE_KINDS = Object.freeze({
  farm:       { label: 'Farm',       affinity: 'fertile', resource: 'crop',  baseYield: 5, intervalMs: 3600_000 },
  mine:       { label: 'Mine',       affinity: 'ore',     resource: 'ore',   baseYield: 3, intervalMs: 3600_000 },
  timber:     { label: 'Timber Camp', affinity: 'timber', resource: 'wood',  baseYield: 4, intervalMs: 3600_000 },
  water:      { label: 'Wellspring', affinity: 'water',   resource: 'water', baseYield: 6, intervalMs: 3600_000 },
  expedition: { label: 'Expedition', affinity: 'wild',    resource: null,    baseYield: 0, intervalMs: 0 },
});

// Cap "while you were away" accrual so a long absence can't mint an unbounded pile (anti-faucet).
export const MAX_ACCRUAL_INTERVALS = 24;

// ---------------------------------------------------------------------------
// Axial-coordinate helpers. Pointy-top hexes; 6 uniform neighbors (no diagonal ambiguity).
// ---------------------------------------------------------------------------
const DIRECTIONS = Object.freeze([
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
]);

const isInt = (n) => Number.isInteger(n);

/** Canonical string key for a hex — "q,r". One hex ↔ one key (so a tile can't be double-claimed). */
export function hexKey(coord) {
  if (!coord || !isInt(coord.q) || !isInt(coord.r)) return null;
  return `${coord.q},${coord.r}`;
}

/** Parse a "q,r" key back to {q,r}; null on junk. */
export function parseHexKey(key) {
  if (typeof key !== 'string') return null;
  const m = /^(-?\d+),(-?\d+)$/.exec(key.trim());
  if (!m) return null;
  return { q: Number(m[1]), r: Number(m[2]) };
}

/** The 6 neighbor coordinates of a hex (unfiltered by board bounds). */
export function neighbors(coord) {
  if (!coord || !isInt(coord.q) || !isInt(coord.r)) return [];
  return DIRECTIONS.map((d) => ({ q: coord.q + d.q, r: coord.r + d.r }));
}

/** Axial hex distance between two coords (∞ on junk, so callers can bound safely). */
export function hexDistance(a, b) {
  if (!a || !b || !isInt(a.q) || !isInt(a.r) || !isInt(b.q) || !isInt(b.r)) return Infinity;
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** Every hex within `radius` of the origin (a bounded hexagonal region). radius 2 → 19 hexes. */
export function hexRange(radius) {
  const R = Math.max(0, Math.min(6, Math.floor(Number(radius) || 0)));
  const out = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      out.push({ q, r });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SVG pixel math (pointy-top). Pure — used by the surface to lay out <polygon> hexes.
// ---------------------------------------------------------------------------
const SQRT3 = Math.sqrt(3);

/** Axial → pixel center for a pointy-top hex of side `size`. */
export function axialToPixel(coord, size = 32) {
  const s = Number(size) || 32;
  const q = coord && isInt(coord.q) ? coord.q : 0;
  const r = coord && isInt(coord.r) ? coord.r : 0;
  return { x: s * SQRT3 * (q + r / 2), y: s * 1.5 * r };
}

/** The 6 corner points "x,y x,y …" for a pointy-top hex centered at (cx,cy) — feeds an SVG polygon. */
export function hexCorners(cx, cy, size = 32) {
  const s = Number(size) || 32;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${(cx + s * Math.cos(ang)).toFixed(2)},${(cy + s * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// ---------------------------------------------------------------------------
// Board generation — a fixed, seeded, bounded region. Deterministic given { seed, radius }:
// the same seed always yields the same affinity layout (so a saved player state re-derives its board).
// ---------------------------------------------------------------------------
function rollAffinity(rng) {
  const total = AFFINITY_TABLE.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [name, w] of AFFINITY_TABLE) {
    if ((x -= w) < 0) return name;
  }
  return AFFINITY_TABLE[0][0];
}

export function generateBoard(opts) {
  const { seed = 1, radius = 2 } = (opts && typeof opts === 'object') ? opts : {};
  const R = Math.max(1, Math.min(6, Math.floor(Number(radius) || 2)));
  const s = Number.isFinite(Number(seed)) ? (Number(seed) >>> 0) : 1;
  const rng = makeRng(s || 1);
  const hexes = {};
  for (const c of hexRange(R)) {
    const key = hexKey(c);
    // origin is always Home; everything else rolls an affinity deterministically.
    const affinity = (c.q === 0 && c.r === 0) ? 'home' : rollAffinity(rng);
    hexes[key] = { q: c.q, r: c.r, affinity };
  }
  return { seed: s, radius: R, home: { q: 0, r: 0 }, hexes };
}

/** True if a coord is a tile on this board. */
export function inBounds(board, coord) {
  const key = hexKey(coord);
  return !!(board && board.hexes && key && board.hexes[key]);
}

/** Affinity of a board tile (null if off-board). */
export function affinityAt(board, coord) {
  const key = hexKey(coord);
  const h = board && board.hexes ? board.hexes[key] : null;
  return h ? h.affinity : null;
}

// ---------------------------------------------------------------------------
// Player state — a plain JSON object (localStorage-friendly on the surface). Solo-instanced (§4c:
// Phase 1 is single-player-plus, no PvP). Home is owned + revealed from the start; its neighbors are
// revealed (fog lifts one ring out) so the first claim decision is seeded.
// ---------------------------------------------------------------------------
export function createPlayer({ owner = 'player', seed = 1, radius = 2 } = {}) {
  const board = generateBoard({ seed, radius });
  const home = hexKey(board.home);
  const revealed = { [home]: true };
  for (const n of neighbors(board.home)) {
    if (inBounds(board, n)) revealed[hexKey(n)] = true;
  }
  return {
    owner: String(owner || 'player'),
    seed: board.seed,
    radius: board.radius,
    owned: { [home]: true },       // claimed tiles (Home claimed by default)
    revealed,                       // fog: which tiles' affinities are known
    nodes: {},                      // key → { kind, placedAt }
    staff: {},                      // key → unit summary (traits-derived multiplier)
    resources: {},                  // raw stock: { crop, ore, wood, water, ... }
    log: [],                        // append-only breadcrumbs (expedition finds etc.)
  };
}

/** Re-derive the board for a (possibly deserialized) player state. */
export function boardFor(state) {
  return generateBoard({ seed: state && state.seed, radius: state && state.radius });
}

const owns = (state, key) => !!(state && state.owned && state.owned[key]);
// A usable player state must be a plain object we can mutate (reject 42, "x", null, arrays…).
const badState = (s) => !s || typeof s !== 'object' || Array.isArray(s);

// ---------------------------------------------------------------------------
// Fog — reveal a tile and the ring beyond it (Infinity-Kingdom "clear outward" as a data flag).
// ---------------------------------------------------------------------------
export function reveal(state, coord, board = boardFor(state)) {
  if (badState(state)) return { ok: false, reason: 'no state' };
  if (!inBounds(board, coord)) return { ok: false, reason: 'off-board' };
  state.revealed = state.revealed || {};
  state.revealed[hexKey(coord)] = true;
  for (const n of neighbors(coord)) {
    if (inBounds(board, n)) state.revealed[hexKey(n)] = true;
  }
  return { ok: true, state };
}

// ---------------------------------------------------------------------------
// Claim cost — the map's core SINK. Scales with distance-from-home + tiles-already-owned (§4c), so a
// contiguous "kingdom" is a real, escalating investment. Utility, never a return promise.
// ---------------------------------------------------------------------------
export function claimCost(state, coord, board = boardFor(state)) {
  if (!state || !inBounds(board, coord)) return null;
  const ownedCount = state.owned ? Object.keys(state.owned).length : 0;
  const dist = hexDistance(board.home, coord);
  const d = Number.isFinite(dist) ? dist : 1;
  return { stone: 2 * ownedCount + d, wood: 1 + d };
}

const canAfford = (have, cost) => Object.entries(cost).every(([m, q]) => (Number(have && have[m]) || 0) >= q);

// ---------------------------------------------------------------------------
// claim — validate (adjacent to an owned tile, unowned, in-bounds, affordable) → deduct materials →
// own the tile → reveal outward → return a mint-nothing DEED DESCRIPTOR the edge settles on-chain.
// `materials` is mutated down (spent). NEVER throws; NEVER broadcasts.
// ---------------------------------------------------------------------------
export function claim(state, coord, board = boardFor(state), opts = {}) {
  if (badState(state)) return { ok: false, reason: 'no state' };
  if (!inBounds(board, coord)) return { ok: false, reason: 'off-board' };
  const key = hexKey(coord);
  if (owns(state, key)) return { ok: false, reason: 'already owned' };
  // must be adjacent to a tile you already own (frontier growth only).
  const adjacentToOwned = neighbors(coord).some((n) => owns(state, hexKey(n)));
  if (!adjacentToOwned) return { ok: false, reason: 'not adjacent to your territory' };

  const cost = claimCost(state, coord, board);
  const materials = opts.materials || {};
  if (!canAfford(materials, cost)) return { ok: false, reason: 'insufficient materials', cost };

  for (const [m, q] of Object.entries(cost)) materials[m] = (Number(materials[m]) || 0) - q;
  state.owned = state.owned || {};
  state.owned[key] = true;
  reveal(state, coord, board);

  return {
    ok: true,
    state,
    cost,
    deed: deedDescriptor(state.owner, coord, affinityAt(board, coord)),
  };
}

/**
 * deedDescriptor — a CALL DESCRIPTOR for the Tile-Deed mint, NOT a broadcast. Mirrors prana-farm.mjs:
 * the edge / MELEK-Signer re-validates and submits it. broadcast:false + a human note make the
 * "will settle on-chain" boundary explicit. The id encodes the canonical coord so one hex = one deed.
 */
export function deedDescriptor(owner, coord, affinity) {
  return {
    contract: (typeof process !== 'undefined' && process.env && process.env.TILE_DEED_ADDRESS) || '',
    fn: 'mintDeed',
    args: [String(owner || ''), hexKey(coord) || '', String(affinity || '')],
    broadcast: false,
    note: 'will settle on-chain — the edge re-validates the claim and mints the Tile-Deed (utility deed, a production-capacity sink, not a price bet)',
  };
}

// ---------------------------------------------------------------------------
// placeNode — put an extraction node on an OWNED tile whose affinity matches the node kind.
// ---------------------------------------------------------------------------
export function placeNode(state, coord, kind, board = boardFor(state), opts = {}) {
  if (badState(state)) return { ok: false, reason: 'no state' };
  const def = NODE_KINDS[kind];
  if (!def) return { ok: false, reason: `unknown node kind "${kind}"` };
  if (!inBounds(board, coord)) return { ok: false, reason: 'off-board' };
  const key = hexKey(coord);
  if (!owns(state, key)) return { ok: false, reason: 'you do not own this tile' };
  if (affinityAt(board, coord) !== def.affinity) {
    return { ok: false, reason: `${def.label} needs a ${def.affinity} tile` };
  }
  state.nodes = state.nodes || {};
  if (state.nodes[key]) return { ok: false, reason: 'a node already stands here' };
  const now = nowOf(opts);
  state.nodes[key] = { kind, placedAt: now, lastCollectedAt: now };
  return { ok: true, state, node: state.nodes[key] };
}

// ---------------------------------------------------------------------------
// unitMultiplier — thin wrap over creatures.traits(): a bigger/rarer worker raises a node's yield
// (the idle "assign a hero to the mine" pattern, §4e). Missing/garbage unit → 1.0 (no bonus).
// ---------------------------------------------------------------------------
const SIZE_BONUS = { small: 0, medium: 0.15, large: 0.3, colossal: 0.5 };
const RARITY_BONUS = { common: 0, uncommon: 0.1, rare: 0.2, epic: 0.35, mythic: 0.5 };

export function unitMultiplier(creature) {
  if (!creature) return 1;
  let t;
  try { t = creature.genome ? traits(creature) : creature; } catch { return 1; }
  if (!t || typeof t !== 'object') return 1;
  const size = SIZE_BONUS[t.size] || 0;
  const rarity = RARITY_BONUS[t.rarity] || 0;
  const m = 1 + size + rarity;
  return Math.round(m * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// staffNode — assign a creature to a node so its multiplier applies to accrual. Stores a small,
// serializable summary (species + multiplier) on the tile; the on-chain unit-ownership check happens
// at settle time server-side (§4g), never here.
// ---------------------------------------------------------------------------
export function staffNode(state, coord, creature, board = boardFor(state)) {
  if (badState(state)) return { ok: false, reason: 'no state' };
  const key = hexKey(coord);
  state.nodes = state.nodes || {};
  if (!state.nodes[key]) return { ok: false, reason: 'no node to staff here' };
  const mult = unitMultiplier(creature);
  const species = creature && (creature.species || (creature.genome && creature.species)) || null;
  state.staff = state.staff || {};
  state.staff[key] = { species: species || 'unit', multiplier: mult };
  return { ok: true, state, multiplier: mult };
}

// ---------------------------------------------------------------------------
// Offline accrual — "while you were away". A node produces baseYield * staffing-multiplier per
// interval elapsed since it was last collected, capped at MAX_ACCRUAL_INTERVALS. Injectable clock.
// ---------------------------------------------------------------------------
const nowOf = (opts) => {
  const n = opts && opts.now;
  const t = n instanceof Date ? n.getTime() : Number(n ?? Date.now());
  return Number.isFinite(t) ? t : Date.now();
};

export function accrue(state, coord, opts = {}) {
  if (badState(state)) return { ok: false, reason: 'no state', amount: 0 };
  const key = hexKey(coord);
  const node = state.nodes && state.nodes[key];
  if (!node) return { ok: false, reason: 'no node here', amount: 0 };
  const def = NODE_KINDS[node.kind];
  if (!def || !def.resource || !(def.intervalMs > 0)) {
    return { ok: false, reason: 'node does not accrue', amount: 0 };
  }
  const now = nowOf(opts);
  const since = Number(node.lastCollectedAt ?? node.placedAt ?? now);
  const elapsed = Math.max(0, now - since);
  const intervals = Math.min(MAX_ACCRUAL_INTERVALS, Math.floor(elapsed / def.intervalMs));
  const mult = (state.staff && state.staff[key] && Number(state.staff[key].multiplier)) || 1;
  const amount = Math.floor(intervals * def.baseYield * mult);
  return { ok: true, amount, resource: def.resource, intervals, multiplier: mult };
}

/** collect — settle a node's accrued yield into player.resources and advance its clock. */
export function collect(state, coord, opts = {}) {
  const a = accrue(state, coord, opts);
  if (!a.ok) return a;
  const key = hexKey(coord);
  if (a.intervals > 0) {
    const def = NODE_KINDS[state.nodes[key].kind];
    state.resources = state.resources || {};
    state.resources[a.resource] = (Number(state.resources[a.resource]) || 0) + a.amount;
    // advance the clock by whole intervals consumed (keep the remainder ticking).
    state.nodes[key].lastCollectedAt = Number(state.nodes[key].lastCollectedAt ?? nowOf(opts)) + a.intervals * def.intervalMs;
  }
  return { ok: true, state, gained: a.amount, resource: a.resource, intervals: a.intervals };
}

// ---------------------------------------------------------------------------
// Expedition — send a unit into a Wild/fogged tile; a SEEDED RNG resolve (deterministic) SOURCES new
// materials, a rare seed, or a creature encounter (the map↔collectible binding, §4e). Server-seeded at
// settle time for anti-cheat (§4g); here we resolve deterministically for the demo + tests.
// ---------------------------------------------------------------------------
const EXPEDITION_OUTCOMES = Object.freeze([
  { kind: 'materials', weight: 5 },
  { kind: 'seed',      weight: 2 },
  { kind: 'creature',  weight: 2 },
  { kind: 'nothing',   weight: 1 },
]);
// original species pool for encounters (mirrors creatures.SPECIES keys; kept as flavor, not a port).
const WILD_SPECIES = Object.freeze(['pyrelisk', 'mossquill', 'tidewren', 'cinderox']);

export function resolveExpedition(state, coord, opts = {}) {
  if (badState(state)) return { ok: false, reason: 'no state' };
  const board = opts.board || boardFor(state);
  if (!inBounds(board, coord)) return { ok: false, reason: 'off-board' };
  // seed the resolve deterministically: a caller-supplied seed, else derived from coord + board seed.
  const c = parseHexKey(hexKey(coord)) || { q: 0, r: 0 };
  const baseSeed = Number.isFinite(Number(opts.seed))
    ? (Number(opts.seed) >>> 0)
    : (((state.seed >>> 0) ^ ((c.q + 100) * 73856093) ^ ((c.r + 100) * 19349663)) >>> 0);
  const rng = makeRng(baseSeed || 1);
  const mult = unitMultiplier(opts.creature);

  const total = EXPEDITION_OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let x = rng() * total;
  let picked = EXPEDITION_OUTCOMES[EXPEDITION_OUTCOMES.length - 1].kind;
  for (const o of EXPEDITION_OUTCOMES) { if ((x -= o.weight) < 0) { picked = o.kind; break; } }

  let reward = { kind: picked };
  if (picked === 'materials') {
    const wood = Math.max(1, Math.floor((1 + rng() * 4) * mult));
    const stone = Math.max(1, Math.floor((1 + rng() * 4) * mult));
    reward = { kind: 'materials', materials: { wood, stone } };
    state.resources = state.resources || {};
    state.resources.wood = (Number(state.resources.wood) || 0) + wood;
  } else if (picked === 'seed') {
    reward = { kind: 'seed', seed: { rarity: rng() < 0.3 ? 'rare' : 'uncommon', id: `seed-${baseSeed}` } };
  } else if (picked === 'creature') {
    reward = { kind: 'creature', encounter: { species: WILD_SPECIES[Math.floor(rng() * WILD_SPECIES.length)] } };
  }

  reveal(state, coord, board);
  state.log = state.log || [];
  state.log.push({ at: nowOf(opts), coord: hexKey(coord), expedition: reward.kind });
  return { ok: true, state, reward, multiplier: mult };
}

// ---------------------------------------------------------------------------
// A compact view the surface serializes into the page shell (board + player overlay, ready to draw).
// ---------------------------------------------------------------------------
export function mapView(state, board = boardFor(state)) {
  const tiles = Object.values(board.hexes).map((h) => {
    const key = hexKey(h);
    const revealed = !!(state && state.revealed && state.revealed[key]);
    const px = axialToPixel(h);
    return {
      key, q: h.q, r: h.r,
      affinity: revealed ? h.affinity : 'fog',
      owned: owns(state, key),
      node: (state && state.nodes && state.nodes[key]) ? state.nodes[key].kind : null,
      staffed: !!(state && state.staff && state.staff[key]),
      x: Math.round(px.x * 100) / 100, y: Math.round(px.y * 100) / 100,
    };
  });
  return { seed: board.seed, radius: board.radius, owner: state && state.owner, tiles, resources: (state && state.resources) || {} };
}

// ---------------------------------------------------------------------------
// CLI demo (guarded).
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('map.mjs')) {
  const p = createPlayer({ owner: 'alice', seed: 7, radius: 2 });
  const board = boardFor(p);
  console.log('Board tiles:', Object.keys(board.hexes).length, '(radius', board.radius + ')');
  // find a fertile neighbor of home to claim + farm.
  const target = neighbors(board.home).map((n) => ({ n, a: affinityAt(board, n) })).find((x) => x.a === 'fertile');
  if (target) {
    const mats = { stone: 20, wood: 20 };
    const c = claim(p, target.n, board, { materials: mats });
    console.log('claim:', c.ok, c.reason || '', 'deed(broadcast=' + (c.deed && c.deed.broadcast) + ')');
    const pn = placeNode(p, target.n, 'farm', board);
    console.log('placeNode farm:', pn.ok, pn.reason || '');
    const got = collect(p, target.n, { now: (pn.node.placedAt) + 5 * 3600_000 });
    console.log('collect after 5h:', got.gained, got.resource);
  }
  const ex = resolveExpedition(p, board.home, { seed: 42 });
  console.log('expedition@home:', JSON.stringify(ex.reward));
}
