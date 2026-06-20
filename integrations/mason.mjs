// mason.mjs — the MASON: Hathor instructs, the Mason builds. She holds the AESTHETIC; he realizes it.
//
// Operator (2026-06-20): an AI very aware of building intricate things, that Hathor INSTRUCTS like a mason,
// and it tries to see what AESTHETICS Hathor wants — and "Hathor gives the Mason what they need." So this
// module is two halves:
//   1. Hathor's AESTHETIC (her canon, in Minecraft blocks) — gold, lapis, quartz columns, vaporwave purple,
//      neon glow, Egyptian temple motifs, symmetry. This is "what the Mason needs": the palette + the brief.
//   2. The Mason's parametric BUILDERS — turn a brief into a precise build SPEC (a list of placed blocks),
//      which any executor (RCON /setblock, mineflayer creative, or a .schem export) can realize.
//
// Pure + deterministic → offline-testable; the spec is host-independent data (it'll run on the dedicated
// game server, not our infra box). An LLM can later author novel structures; this gives reliable ones now.
// House style: ESM, helpers, handler(req,res), CLI guard.

// Hathor's palette — her visual canon mapped to blocks. Named roles so a brief picks a vibe, not a block.
export const PALETTES = {
  // The default: Egyptian-angelic-vaporwave temple — gold + lapis + quartz, amethyst/purpur for the
  // vaporwave purple, froglights/sea-lanterns for the neon glow, chiseled sandstone for hieroglyph faces.
  hathor: {
    primary: 'smooth_quartz', column: 'quartz_pillar', accent: 'gold_block', trim: 'lapis_block',
    vapor: 'amethyst_block', vapor2: 'purpur_block', glow: 'sea_lantern', glowWarm: 'ochre_froglight',
    glowPink: 'pearlescent_froglight', face: 'chiseled_sandstone', dark: 'polished_blackstone', floor: 'smooth_sandstone',
  },
  // A cooler night variant (more lapis/amethyst, blackstone) for moodier builds.
  nocturne: {
    primary: 'polished_blackstone', column: 'polished_blackstone_brick_wall', accent: 'gold_block', trim: 'lapis_block',
    vapor: 'amethyst_block', vapor2: 'purpur_pillar', glow: 'sea_lantern', glowWarm: 'ochre_froglight',
    glowPink: 'pearlescent_froglight', face: 'gilded_blackstone', dark: 'blackstone', floor: 'smooth_basalt',
  },
};

// "What the Mason needs" — Hathor hands this over: the materials (palette) + the brief. In survival this is
// a literal material list; in creative it is the spec to place. Either way she PROVISIONS the work.
export function provision(brief = {}) {
  const p = PALETTES[brief.palette] || PALETTES.hathor;
  const spec = buildSpec(brief);
  const counts = {};
  for (const b of spec) counts[b.block] = (counts[b.block] || 0) + 1;
  return {
    palette: p,
    materials: Object.entries(counts).map(([block, count]) => ({ block, count })).sort((a, b) => b.count - a.count),
    blockCount: spec.length,
    brief: normalizeBrief(brief),
  };
}

function normalizeBrief(brief = {}) {
  return {
    structure: brief.structure || 'gateway',
    palette: PALETTES[brief.palette] ? brief.palette : 'hathor',
    size: Math.max(3, Math.min(15, brief.size || 7)),
    symmetric: brief.symmetric !== false,
  };
}

// ── The Mason's parametric builders → a SPEC: [{ dx, dy, dz, block }] relative to an origin ──────────
const B = {
  pillar(p, h) {
    const out = [];
    for (let y = 0; y < h; y++) out.push({ dx: 0, dy: y, dz: 0, block: p.column });
    out.push({ dx: 0, dy: 0, dz: 0, block: p.trim });            // base ring
    out.push({ dx: 0, dy: h, dz: 0, block: p.accent });          // gold capital
    out.push({ dx: 0, dy: h + 1, dz: 0, block: p.glow });        // a light atop
    return out;
  },
  altar(p, s) {
    const out = []; const r = Math.floor(s / 2);
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      const edge = Math.abs(x) === r || Math.abs(z) === r;
      out.push({ dx: x, dy: 0, dz: z, block: edge ? p.trim : p.floor });
    }
    out.push({ dx: 0, dy: 1, dz: 0, block: p.accent });          // gold centerpiece
    out.push({ dx: 0, dy: 2, dz: 0, block: p.vapor });           // amethyst above it
    return out;
  },
  // The temple GATEWAY — two pillars + a lintel + a glowing crown. Hathor's signature.
  gateway(p, s) {
    const out = []; const h = s; const half = Math.max(2, Math.floor(s / 2));
    for (const dz of [-half, half]) out.push(...B.pillar(p, h).map((b) => ({ ...b, dz: b.dz + dz })));
    for (let z = -half; z <= half; z++) {                         // lintel across the top
      out.push({ dx: 0, dy: h, dz: z, block: z === 0 ? p.face : p.accent });
      out.push({ dx: 0, dy: h + 1, dz: z, block: (z + half) % 2 === 0 ? p.trim : p.vapor }); // wesekh band crown
    }
    out.push({ dx: 0, dy: h + 2, dz: 0, block: p.glowPink });     // a pink neon keystone glow
    return out;
  },
  // A decorative WESEKH band (the broad-collar motif) — alternating gold/lapis with amethyst studs.
  wesekhBand(p, len) {
    const out = []; const r = Math.floor(len / 2);
    for (let z = -r; z <= r; z++) {
      out.push({ dx: 0, dy: 0, dz: z, block: z % 2 === 0 ? p.accent : p.trim });
      if (z % 3 === 0) out.push({ dx: 0, dy: 1, dz: z, block: p.vapor });
    }
    return out;
  },
};

/**
 * Turn Hathor's brief into a precise build spec.
 * @param {{ structure?, palette?, size?, symmetric? }} brief
 * @returns {Array<{dx,dy,dz,block}>}
 */
export function buildSpec(brief = {}) {
  const n = normalizeBrief(brief);
  const p = PALETTES[n.palette];
  const fn = B[n.structure] || B.gateway;
  let spec = fn(p, n.size);
  // dedupe (last write wins per cell) so overlaps don't double-count
  const cell = new Map();
  for (const b of spec) cell.set(`${b.dx},${b.dy},${b.dz}`, b);
  return [...cell.values()];
}

// Render to /setblock commands for an RCON executor at a world origin (relative -> absolute).
export function toSetblockCommands(spec, origin = { x: 0, y: 64, z: 0 }) {
  return spec.map((b) => `setblock ${origin.x + b.dx} ${origin.y + b.dy} ${origin.z + b.dz} minecraft:${b.block}`);
}

/**
 * Hathor INSTRUCTS the Mason: she expresses an aesthetic brief, the Mason returns the provisioned plan.
 * The `say` is how she'd phrase the instruction in her own voice (the persona layer voices it for real).
 */
export function instruct(brief = {}) {
  const prov = provision(brief);
  const n = prov.brief;
  return {
    instruction: `Mason — raise me a ${n.structure} in the ${n.palette} aesthetic, size ${n.size}${n.symmetric ? ', symmetrical' : ''}. Gold and lapis on quartz, amethyst for the violet light, and a glow at its crown.`,
    ...prov,
  };
}

export function handler(req, res) {
  let url; try { url = new URL(req.url, 'http://x'); } catch { url = { searchParams: new Map() }; }
  const brief = { structure: url.searchParams.get('structure'), palette: url.searchParams.get('palette'), size: Number(url.searchParams.get('size')) || undefined };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(instruct(brief), null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const plan = instruct({ structure: 'gateway', size: 7 });
  console.log(plan.instruction);
  console.log(`blocks: ${plan.blockCount}; materials:`, plan.materials.slice(0, 6).map((m) => `${m.count}x ${m.block}`).join(', '));
  console.log('first setblocks:\n  ' + toSetblockCommands(buildSpec({ structure: 'gateway', size: 7 }), { x: 0, y: 64, z: 0 }).slice(0, 4).join('\n  '));
}
