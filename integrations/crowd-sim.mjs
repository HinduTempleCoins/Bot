// crowd-sim.mjs — our OWN native crowd-dynamics engine: the Helbing–Molnár SOCIAL FORCE MODEL in pure JS.
// Pedestrians are particles under a driving force (toward a goal at a desired speed) plus repulsion from
// other people (and optional walls). From the trajectories we read the safety-relevant quantities: local
// DENSITY, CRUSH RISK (people/m² in the worst spot), mean speed, and how many have reached the goal.
// Used to reason about crowd flow, bottlenecks, and evacuation — crowd SAFETY, not control.
//
// Pure + deterministic (no RNG unless you seed positions) + no deps. Soft inputs, never throws.
//
//   import { createCrowd } from './crowd-sim.mjs';
//   const c = createCrowd({ agents, goal:[10,0], exits:[{x:10,y:0,width:1}] , bounds:{w:12,h:8} });
//   c.run(200); c.summary();  // { reached, meanSpeed, maxDensity, crushRisk, step }

const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  scale: (a, s) => [a[0] * s, a[1] * s],
  len: (a) => Math.hypot(a[0], a[1]),
  unit: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
};

const DEFAULTS = {
  tau: 0.5,          // relaxation time (s) for the driving force
  A: 2.0,            // repulsion strength (N-ish)
  B: 0.3,            // repulsion range (m)
  desiredSpeed: 1.3, // m/s (normal walking)
  radius: 0.25,      // body radius (m)
  maxSpeed: 2.5,     // cap
  dt: 0.05,          // integration step (s)
};

/** Create a crowd. agents: [{pos:[x,y], vel?, goal?, desiredSpeed?, radius?}]; shared goal if per-agent absent. */
export function createCrowd({ agents = [], goal = [0, 0], bounds = null, params = {} } = {}) {
  const P = { ...DEFAULTS, ...params };
  const A = agents.map((a, i) => ({
    id: a.id ?? i,
    pos: [...(a.pos || [0, 0])],
    vel: [...(a.vel || [0, 0])],
    goal: a.goal || goal,
    desiredSpeed: a.desiredSpeed ?? P.desiredSpeed,
    radius: a.radius ?? P.radius,
    reached: false,
  }));
  let step = 0;

  function forces(agent) {
    // driving force toward goal
    const toGoal = V.sub(agent.goal, agent.pos);
    const desired = V.scale(V.unit(toGoal), agent.desiredSpeed);
    let f = V.scale(V.sub(desired, agent.vel), 1 / P.tau);
    // repulsion from others
    for (const other of A) {
      if (other === agent) continue;
      const d = V.sub(agent.pos, other.pos);
      const dist = V.len(d) || 1e-6;
      const overlap = (agent.radius + other.radius) - dist;        // >0 means touching/pushing
      const mag = P.A * Math.exp(overlap / P.B);
      f = V.add(f, V.scale(V.unit(d), mag));
    }
    // soft walls (bounds box) push inward
    if (bounds) {
      const m = 0.4;
      if (agent.pos[0] < m) f[0] += P.A * Math.exp((m - agent.pos[0]) / P.B);
      if (agent.pos[0] > bounds.w - m) f[0] -= P.A * Math.exp((agent.pos[0] - (bounds.w - m)) / P.B);
      if (agent.pos[1] < m) f[1] += P.A * Math.exp((m - agent.pos[1]) / P.B);
      if (agent.pos[1] > bounds.h - m) f[1] -= P.A * Math.exp((agent.pos[1] - (bounds.h - m)) / P.B);
    }
    return f;
  }

  function tick() {
    for (const a of A) {
      if (a.reached) continue;
      const f = forces(a);
      a.vel = V.add(a.vel, V.scale(f, P.dt));
      const sp = V.len(a.vel);
      if (sp > P.maxSpeed) a.vel = V.scale(a.vel, P.maxSpeed / sp);
      a.pos = V.add(a.pos, V.scale(a.vel, P.dt));
      if (V.len(V.sub(a.goal, a.pos)) < 0.4) { a.reached = true; a.vel = [0, 0]; }
    }
    step++;
  }

  /** People per square metre within `r` of each still-active agent; returns the max (the crush hot-spot). */
  function maxLocalDensity(r = 1.0) {
    let max = 0;
    const active = A.filter((a) => !a.reached);
    for (const a of active) {
      let n = 1;
      for (const b of active) if (b !== a && V.len(V.sub(a.pos, b.pos)) <= r) n++;
      const density = n / (Math.PI * r * r);
      if (density > max) max = density;
    }
    return max;
  }

  return {
    params: P,
    agents: () => A.map((a) => ({ id: a.id, pos: [...a.pos], reached: a.reached, speed: V.len(a.vel) })),
    step: () => tick(),
    run(steps = 100) { for (let i = 0; i < steps; i++) tick(); return this.summary(); },
    maxLocalDensity,
    /** Safety readout. crushRisk thresholds follow crowd-safety literature (~>4-5 ppl/m² = dangerous). */
    summary() {
      const reached = A.filter((a) => a.reached).length;
      const active = A.filter((a) => !a.reached);
      const meanSpeed = active.length ? active.reduce((s, a) => s + V.len(a.vel), 0) / active.length : 0;
      const maxDensity = maxLocalDensity();
      const crushRisk = maxDensity >= 5 ? 'dangerous' : maxDensity >= 3.5 ? 'high' : maxDensity >= 2 ? 'moderate' : 'low';
      return { step, agents: A.length, reached, active: active.length,
        meanSpeed: Math.round(meanSpeed * 100) / 100, maxDensity: Math.round(maxDensity * 10) / 10, crushRisk };
    },
  };
}

/** Helper: a block of N agents on a grid starting at (x0,y0), heading to `goal`. */
export function gridAgents({ n = 20, x0 = 0, y0 = 0, cols = 5, spacing = 0.6, goal = [10, 0] } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ pos: [x0 + (i % cols) * spacing, y0 + Math.floor(i / cols) * spacing], goal });
  return out;
}
