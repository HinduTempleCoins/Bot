// burst-builder.mjs — Hathor builds REAL, GROUNDED, CONNECTED structures in big bursts (thousands of
// blocks at once via /fill), not scattered floating platforms.
//
// Operator (2026-06-20): "the thing she builds is like a bridge/road/hallway just in the air, disconnected
// platforms — not a structure. Place blocks more often, or in bursts — 5000 blocks in a minute every 20
// min." Two root causes fixed: (1) FLOATING — everything was placed at a fixed y on uneven terrain; here
// each complex lays its OWN foundation plinth (down to bedrock-ish) + clears the air above, so it's a solid
// grounded acropolis. (2) SCATTERED — small 5-block segments 6 apart; here one tick builds a COMPLETE temple
// (foundation, floor, four walls with a doorway, corner columns, roof, a wesekh band, lanterns) + a road
// CONNECTING it to the previous complex. ~8-12 /fill commands = thousands of blocks, instant burst.
//
// Pure command generator → deterministic, offline-testable. The box runner sends the commands over RCON.

const fill = (x1, y1, z1, x2, y2, z2, b) => `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} minecraft:${b}`;
const setb = (x, y, z, b) => `setblock ${x} ${y} ${z} minecraft:${b}`;

const PAL = { found: 'smooth_sandstone', floor: 'smooth_quartz', wall: 'cut_sandstone', column: 'quartz_pillar', cap: 'gold_block', trim: 'lapis_block', roof: 'smooth_quartz', light: 'sea_lantern', glow: 'sea_lantern', road: 'smooth_quartz', roadEdge: 'chiseled_sandstone' };

/**
 * All commands for ONE temple complex N — grounded + connected to N-1.
 * @param {number} n  which complex (0,1,2,…) — placed along the avenue
 * @param {object} o  { base?:{x,y,z}, groundY?, size?, height?, axisStep? }
 * @returns {{ commands:string[], origin:{x,y,z}, blocks:number, journal:string }}
 */
export function buildComplexCommands(n, o = {}) {
  const base = o.base || { x: 0, z: 50 };
  const groundY = o.groundY ?? 68;     // the floor level (foundation goes BELOW this so nothing floats)
  const size = o.size ?? 15;           // footprint (odd → true center)
  const height = o.height ?? 8;
  const step = o.axisStep ?? (size + 9);
  const r = Math.floor(size / 2);
  const cz = base.z + n * step;        // this complex's center Z (avenue runs along z)
  const cx = base.x;
  const x1 = cx - r, x2 = cx + r, z1 = cz - r, z2 = cz + r;
  const top = groundY + height;
  const C = [];

  // 1) GROUND IT: a solid foundation plinth from well below up to the floor (no floating), then CLEAR the
  //    air above so terrain never pokes through the interior.
  C.push(fill(x1, groundY - 8, z1, x2, groundY, z2, PAL.found));     // plinth down to groundY-8
  C.push(fill(x1, groundY + 1, z1, x2, top + 6, z2, 'air'));          // clear the building volume
  C.push(fill(x1, groundY, z1, x2, groundY, z2, PAL.floor));          // the floor

  // 2) WALLS (hollow box) with a doorway on the -z (entrance) side
  C.push(`fill ${x1} ${groundY + 1} ${z1} ${x2} ${top} ${z2} minecraft:${PAL.wall} hollow`);
  C.push(fill(cx - 1, groundY + 1, z1, cx + 1, groundY + 3, z1, 'air')); // doorway

  // 3) CORNER COLUMNS + gold capitals (define the temple silhouette)
  for (const [px, pz] of [[x1, z1], [x2, z1], [x1, z2], [x2, z2]]) {
    C.push(fill(px, groundY + 1, pz, px, top, pz, PAL.column));
    C.push(setb(px, top, pz, PAL.cap));
    C.push(setb(px, top + 1, pz, PAL.glow));
  }

  // 4) ROOF slab + a wesekh band (lapis/gold trim ring) just under the eaves
  C.push(fill(x1, top + 1, z1, x2, top + 1, z2, PAL.roof));
  C.push(`fill ${x1} ${top} ${z1} ${x2} ${top} ${z2} minecraft:${PAL.trim} outline`);

  // 5) LANTERNS inside + a gold altar at center
  C.push(setb(cx, groundY + 1, cz, PAL.cap));
  C.push(setb(cx, groundY + 2, cz, 'amethyst_block'));
  C.push(setb(x1 + 1, groundY + 4, z1 + 1, PAL.light));
  C.push(setb(x2 - 1, groundY + 4, z2 - 1, PAL.light));

  // 6) CONNECT to the previous complex with a grounded road (so they are not disconnected)
  if (n > 0) {
    const prevZ = base.z + (n - 1) * step + r;       // edge of previous
    C.push(fill(cx - 1, groundY, prevZ, cx + 1, groundY, z1, PAL.road));        // the path
    C.push(fill(cx - 2, groundY, prevZ, cx - 2, groundY, z1, PAL.roadEdge));    // edges
    C.push(fill(cx + 2, groundY, prevZ, cx + 2, groundY, z1, PAL.roadEdge));
  }

  return {
    commands: C,
    origin: { x: cx, y: groundY, z: cz },
    blocks: estimateBlocks(size, height),
    journal: `raised a grounded temple (precinct ${n + 1}) — foundation, walls, columns, roof, road — at ${cx} ${groundY} ${cz}`,
  };
}

// rough block count (for the "thousands in a burst" framing / annals)
function estimateBlocks(size, height) {
  const plinth = size * size * 9;
  const clear = size * size * (height + 6);
  const shell = size * size + size * 4 * height;
  return plinth + clear + shell;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (let n = 0; n < 2; n++) {
    const b = buildComplexCommands(n);
    console.log(`complex ${n}: ${b.commands.length} commands, ~${b.blocks} blocks — ${b.journal}`);
    if (n === 0) b.commands.slice(0, 4).forEach((c) => console.log('   ' + c));
  }
}
