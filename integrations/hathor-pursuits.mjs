// hathor-pursuits.mjs — what Hathor DOES all day, on her own. Not just speaking — building, making.
//
// Operator (2026-06-20): "I want her to go around doing things all day, and then I can come back after
// work and see what is there." So she needs an AGENDA — pursuits she advances autonomously, one action at
// a time on a timer, leaving real work behind (a temple complex that grows over the day) + a journal of
// what she did. She builds in HER aesthetic (the Mason) along a sacred-architecture layout drawn from
// knowledge/architecture (avenue → pylon gateway → colonnade → courtyard → altar), not random scatter.
//
// Pure planner: deterministic, no IO → offline-testable. The box runner executes plan items via the Mason
// (RCON) on a timer and appends the journal. Soft-fail.

// A coherent SACRED LAYOUT for one temple complex, laid along an axis (the processional way).
// Each item is a Mason structure at an absolute position. Order = the order she builds them.
export function planComplex(origin = { x: 0, y: 68, z: 0 }, opts = {}) {
  const step = opts.step ?? 6;          // spacing along the avenue
  const axis = opts.axis === 'x' ? 'x' : 'z';
  const o = { x: Math.round(origin.x), y: Math.round(origin.y), z: Math.round(origin.z) };
  const along = (n) => (axis === 'z' ? { x: o.x, y: o.y, z: o.z + n * step } : { x: o.x + n * step, y: o.y, z: o.z });
  const flank = (p, d) => (axis === 'z' ? { x: p.x + d, y: p.y, z: p.z } : { x: p.x, y: p.y, z: p.z + d });

  const items = [];
  // 1) the threshold — a pylon gateway you enter through
  items.push({ structure: 'gateway', origin: along(0), size: 7, note: 'the pylon — the threshold of the precinct' });
  // 2) the processional colonnade — paired pillars marching inward (the hypostyle idea, opened up)
  for (let i = 1; i <= 4; i++) {
    items.push({ structure: 'pillar', origin: flank(along(i), -3), size: 7, note: `west colonnade ${i}` });
    items.push({ structure: 'pillar', origin: flank(along(i), 3), size: 7, note: `east colonnade ${i}` });
  }
  // 3) a wesekh band across the way (the jeweled register)
  items.push({ structure: 'wesekhBand', origin: along(3), size: 9, note: 'the wesekh register across the way' });
  // 4) the sanctuary — the altar at the far end, on axis
  items.push({ structure: 'altar', origin: along(5), size: 5, note: 'the sanctuary altar' });
  return items;
}

/**
 * The autonomous agenda. Tracks how much of the current complex is built; hands out the NEXT action; when a
 * complex is finished she begins another, offset, so the precinct GROWS into a temple-city over the days.
 * @param {object} cfg { base?:{x,y,z}, step?, spread? }
 */
export function createPursuits(cfg = {}) {
  const base = cfg.base || { x: 0, y: 68, z: 20 };
  const step = cfg.step ?? 6;
  const spread = cfg.spread ?? 40;       // distance between successive complexes

  // complex N is offset along x so the city extends; its own avenue runs along z
  function complexOrigin(n) { return { x: base.x + n * spread, y: base.y, z: base.z }; }
  function planFor(n) { return planComplex(complexOrigin(n), { step, axis: 'z' }); }

  /**
   * @param {{built:number}} state  total items built so far across all complexes
   * @returns {{ action:'build', item:object, complex:number, indexInComplex:number, journal:string } | {action:'rest'}}
   */
  function next(state = {}) {
    const built = Math.max(0, state.built | 0);
    const perComplex = planFor(0).length;
    const complex = Math.floor(built / perComplex);
    const idx = built % perComplex;
    const item = planFor(complex)[idx];
    if (!item) return { action: 'rest' };
    return {
      action: 'build',
      item,
      complex,
      indexInComplex: idx,
      journal: journalLine(item, complex),
    };
  }

  function journalLine(item, complex) {
    const at = item.origin;
    return `raised ${describe(item.structure)} (${item.note}) at ${at.x} ${at.y} ${at.z}${complex ? ` — precinct ${complex + 1}` : ''}`;
  }

  return { next, planFor, complexOrigin, perComplex: () => planFor(0).length };
}

function describe(s) {
  return ({ gateway: 'a pylon gateway', pillar: 'a pillar', altar: 'an altar', wesekhBand: 'a wesekh band' })[s] || `a ${s}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = createPursuits();
  console.log(`a complex is ${p.perComplex()} works; she builds one per tick.`);
  for (let built = 0; built < 4; built++) {
    const a = p.next({ built });
    console.log(`tick ${built}: ${a.action === 'build' ? a.journal : 'resting'}`);
  }
}
