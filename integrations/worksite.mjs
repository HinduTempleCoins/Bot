// worksite.mjs — a SHARED PROJECT the agents work on, so the world is always busy.
//
// Operator (2026-06-20): "they need some kind of survival-mode logic — they have something they are
// working on, and the aesthetics and art and building go into it, just so something is happening." This is
// that: ONE settlement (the temple precinct) the agents collaboratively build, broken into many SMALL
// varied tasks — lay a path, raise a wall, set lanterns, clear a terrace, plant a garden, raise a sacred
// structure, set a mosaic. Tasks are assigned by role (Hathor: sacred builds + art; Andy: paths/walls/
// clearing/lights — the laborer; Sophia: gardens/decoration). Each task is small so it runs every few
// minutes = constant visible progress toward a growing settlement.
//
// Pure planner → deterministic, offline-testable. The box worker executes each task's block ops via RCON.

// palette shorthands
const P = { path: 'smooth_quartz', pathEdge: 'chiseled_sandstone', wall: 'cut_sandstone', wallTrim: 'lapis_block', light: 'sea_lantern', terrace: 'smooth_sandstone', leaf: 'azalea_leaves', flower: 'amethyst_cluster', glow: 'ochre_froglight' };

// Each generator returns block ops [{dx,dy,dz,block}] relative to a task origin. Small + cheap.
const TASKS = {
  path(seed) {                                   // a 5-long processional path segment + edges
    const o = [];
    for (let i = 0; i < 5; i++) { o.push({ dx: 0, dy: 0, dz: i, block: P.path }); if (i % 2 === 0) { o.push({ dx: -1, dy: 0, dz: i, block: P.pathEdge }); o.push({ dx: 1, dy: 0, dz: i, block: P.pathEdge }); } }
    return { verb: 'laid a stretch of the processional path', ops: o };
  },
  wall(seed) {                                   // a low boundary wall with lapis trim
    const o = [];
    for (let i = 0; i < 5; i++) { o.push({ dx: 0, dy: 0, dz: i, block: P.wall }); o.push({ dx: 0, dy: 1, dz: i, block: i % 2 ? P.wallTrim : P.wall }); }
    return { verb: 'raised a length of the precinct wall', ops: o };
  },
  lights(seed) {                                 // lanterns on posts — illuminate the grounds
    const o = [];
    for (let i = 0; i < 3; i++) { o.push({ dx: i * 2, dy: 0, dz: 0, block: P.wall }); o.push({ dx: i * 2, dy: 1, dz: 0, block: P.light }); }
    return { verb: 'set lanterns along the way', ops: o };
  },
  terrace(seed) {                                // clear/level a 5x5 platform (the ground floor of the precinct)
    const o = [];
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) o.push({ dx: x, dy: 0, dz: z, block: P.terrace });
    return { verb: 'levelled a terrace of pale stone', ops: o };
  },
  garden(seed) {                                 // a little garden — leaves, blossoms, a warm glow
    const o = [{ dx: 0, dy: 0, dz: 0, block: P.glow }, { dx: 1, dy: 0, dz: 0, block: P.leaf }, { dx: -1, dy: 0, dz: 0, block: P.leaf }, { dx: 0, dy: 1, dz: 0, block: P.flower }, { dx: 0, dy: 0, dz: 1, block: P.leaf }];
    return { verb: 'planted a small garden', ops: o };
  },
};

// who does what — survival roles. Hathor's sacred builds/art come from pursuits.mjs + mason-designer.
export const ROLES = {
  Hathor: ['sacred', 'art', 'terrace'],          // designs + raises the holy things, makes art
  Andy: ['path', 'wall', 'lights', 'terrace'],   // the laborer — infrastructure
  Sophia: ['garden', 'lights', 'path'],          // tends + decorates
};

const TASK_KEYS = Object.keys(TASKS);

/**
 * The next task for an agent. Cycles its role's task types and walks the worksite outward so the settlement
 * GROWS rather than piling up in one spot.
 * @param {string} agent
 * @param {{done:number, base?:{x,y,z}, step?}} state  how many tasks this agent has done
 * @returns {{ type, origin:{x,y,z}, verb, ops:[{dx,dy,dz,block}] } | null}
 */
export function nextTask(agent, state = {}) {
  const roles = ROLES[agent] || ['terrace'];
  const done = Math.max(0, state.done | 0);
  const type = roles[done % roles.length];
  if (type === 'sacred' || type === 'art') return { type, origin: spot(agent, done, state), verb: type === 'sacred' ? 'raised a sacred structure' : 'set a mosaic', ops: [], defer: type }; // handled by pursuits/designer
  const gen = TASKS[type] || TASKS.terrace;
  const t = gen(done);
  return { type, origin: spot(agent, done, state), verb: t.verb, ops: t.ops };
}

// each agent works its own corridor of the site, walking outward as it goes
function spot(agent, done, state) {
  const base = state.base || { x: 0, y: 68, z: 50 };
  const step = state.step ?? 6;
  const lane = { Hathor: 0, Andy: -12, Sophia: 12 }[agent] ?? 0;
  return { x: Math.round(base.x + lane), y: Math.round(base.y), z: Math.round(base.z + done * step) };
}

export function journalLine(agent, task) {
  const o = task.origin;
  return `${agent} ${task.verb} at ${o.x} ${o.y} ${o.z}`;
}

export function taskKeys() { return TASK_KEYS.slice(); }

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const agent of ['Andy', 'Sophia', 'Hathor']) {
    for (let d = 0; d < 3; d++) { const t = nextTask(agent, { done: d }); console.log(`${journalLine(agent, t)} (${t.ops.length} blocks${t.defer ? `, defers to ${t.defer}` : ''})`); }
  }
}
