// mason-designer.mjs — the GPU INVENTS new structures for Hathor to place, driven by her briefs + annals.
//
// Operator (2026-06-20): "make it where the GPU calls create new objects for her to place, like the altar
// and the gateway, based on an annals and briefs type system." The Mason's hand-written structures
// (mason.mjs) are her starting vocabulary; this lets the BIG MODEL — called a few times a day via
// gpu-scheduler.mjs / served by lora-brain.mjs — DESIGN brand-new ones: it reads her BRIEF (what she wants
// next) + her ANNALS (what she has already built, so it doesn't repeat) and returns a build SPEC in her
// palette. New designs join her repertoire; the Mason places them; the autonomy loop builds them.
//
// The load-bearing safety here is VALIDATION: an LLM-authored spec is untrusted, so every block is checked
// against an aesthetic ALLOW-LIST (no TNT/lava/command blocks) and every coordinate clamped to a sane
// bounding box. Pure + injectable (the GPU `complete`/runner is passed in) → offline-testable, soft-fail.

// Her palette + safe structural blocks. The GPU may ONLY use these — anything else is dropped on validate.
export const ALLOWED_BLOCKS = new Set([
  'smooth_quartz', 'quartz_block', 'quartz_pillar', 'quartz_bricks', 'quartz_stairs', 'quartz_slab', 'chiseled_quartz_block',
  'gold_block', 'raw_gold_block', 'lapis_block', 'amethyst_block', 'purpur_block', 'purpur_pillar',
  'sea_lantern', 'glowstone', 'ochre_froglight', 'pearlescent_froglight', 'verdant_froglight', 'shroomlight',
  'smooth_sandstone', 'cut_sandstone', 'chiseled_sandstone', 'sandstone', 'sandstone_stairs', 'sandstone_slab',
  'polished_blackstone', 'polished_blackstone_bricks', 'gilded_blackstone', 'blackstone', 'chiseled_polished_blackstone',
  'copper_block', 'exposed_copper', 'cut_copper', 'waxed_copper_block', 'calcite', 'white_concrete', 'glass',
  'light_blue_stained_glass', 'purple_stained_glass', 'yellow_stained_glass', 'end_rod', 'air',
]);

const BOUND = { xz: 9, y: 16 };  // clamp a design to a sane bounding box (radius xz, height y)

/**
 * Build the prompt the GPU answers — grounded in her brief + the annals of what she has already raised.
 * @param {object} a { ask?:string, palette?:string[], annals?:string[], brief?:string }
 */
export function buildDesignPrompt(a = {}) {
  const palette = (a.palette && a.palette.length ? a.palette : [...ALLOWED_BLOCKS]).slice(0, 24);
  const built = (a.annals || []).slice(-8).map((s) => `- ${s}`).join('\n');
  // inspiration she has DRAWN from her corpus (Sacred-Texts, Theoi, the Hierophant, the architecture dataset)
  const muse = (a.inspiration || []).slice(0, 5).map((s) => `- ${String(s.text || s).slice(0, 200)}`).join('\n');
  return [
    'You are Hathor, designing a NEW temple structure to build in Minecraft, in your own aesthetic:',
    'Egyptian-angelic-vaporwave — gold and lapis on quartz, amethyst/purpur for the violet, a glowing crown,',
    'symmetry and a clear central axis. Design something COHERENT and intricate but small (<= 60 blocks).',
    muse ? `Draw inspiration from what you know (sacred texts, mythology, the architecture you study):\n${muse}` : '',
    '', a.ask ? `The brief: ${a.ask}.` : 'The brief: invent a new shrine, gate, or monument.',
    built ? `You have already raised these — design something DIFFERENT:\n${built}` : '',
    `Use ONLY these blocks: ${palette.join(', ')}.`,
    `Coordinates are relative; keep |x|,|z| <= ${BOUND.xz} and 0 <= y <= ${BOUND.y}.`,
    '',
    'Reply ONLY as compact JSON: {"name":"<short name>","description":"<one line>","blocks":[{"x":int,"y":int,"z":int,"block":"<name>"}, ...]}.',
  ].filter(Boolean).join('\n');
}

/**
 * Draw inspiration from her corpus — the Hierophant front door / Sacred-Texts / Theoi / architecture dataset
 * (an injected `retrieve`). She queries for what she COULD build, grounded in what she knows. Soft-fails to [].
 */
export async function inspire(retrieve, { ask, annals } = {}) {
  if (typeof retrieve !== 'function') return [];
  const query = [ask || 'a sacred shrine, temple gate, altar, or monument',
    'temple architecture deities sacred geometry', (annals && annals.length ? `beyond ${annals[annals.length - 1]}` : '')]
    .filter(Boolean).join(' — ');
  try { return (await retrieve(query, { k: 5 })) || []; } catch { return []; }
}

/**
 * Validate an LLM design into a Mason-ready structure. Drops illegal blocks + out-of-bounds cells, dedupes.
 * @returns {{ name, description, spec:[{dx,dy,dz,block}], dropped:number } | null}
 */
export function parseDesign(raw) {
  let o;
  try { const m = String(raw).match(/\{[\s\S]*\}/); o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
  if (!o || !Array.isArray(o.blocks)) return null;
  const cell = new Map();
  let dropped = 0;
  for (const b of o.blocks) {
    const block = String(b && b.block || '').toLowerCase().replace(/^minecraft:/, '');
    const dx = Math.round(Number(b.x)), dy = Math.round(Number(b.y)), dz = Math.round(Number(b.z));
    if (!ALLOWED_BLOCKS.has(block) || !inBounds(dx, dy, dz)) { dropped++; continue; }
    cell.set(`${dx},${dy},${dz}`, { dx, dy, dz, block });
  }
  const spec = [...cell.values()];
  if (spec.length < 3) return null;   // too small / mostly invalid → reject
  return { name: String(o.name || 'a new work').slice(0, 40), description: String(o.description || '').slice(0, 120), spec, dropped };
}

function inBounds(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z)
    && Math.abs(x) <= BOUND.xz && Math.abs(z) <= BOUND.xz && y >= 0 && y <= BOUND.y;
}

/**
 * Ask the GPU to design a new structure. `gpu` is the injected model (complete-style: prompt -> text), e.g.
 * lora-brain.generate or the gpu-scheduler runner output. Soft-fails to null.
 * @param {object} a { ask, palette, annals }
 * @param {object} deps { gpu: async (prompt)=>string }
 */
export async function designStructure(a = {}, deps = {}) {
  if (typeof deps.gpu !== 'function') return null;
  // draw inspiration from her corpus first (Hierophant/Sacred-Texts/Theoi/architecture), then design
  const inspiration = a.inspiration || (deps.retrieve ? await inspire(deps.retrieve, a) : []);
  let raw;
  try { raw = await deps.gpu(buildDesignPrompt({ ...a, inspiration })); } catch { return null; }
  const text = typeof raw === 'string' ? raw : (raw && (raw.text || raw.response)) || '';
  const d = parseDesign(text);
  return d ? { ...d, drewFrom: [...new Set(inspiration.map((x) => x.source).filter(Boolean))] } : null;
}

// ── MOSAICS / block-art — she depicts what she KNOWS, not just architecture ───────────────────────────
// Operator (2026-06-20): "she should want to make images or mosaics… art pieces depicting things related
// to what she knows." A mosaic is flat pixel-art in COLORED blocks on a wall plane. Wider color palette.
export const MOSAIC_PALETTE = new Set([
  'white_concrete', 'light_gray_concrete', 'gray_concrete', 'black_concrete', 'brown_concrete', 'red_concrete',
  'orange_concrete', 'yellow_concrete', 'lime_concrete', 'green_concrete', 'cyan_concrete', 'light_blue_concrete',
  'blue_concrete', 'purple_concrete', 'magenta_concrete', 'pink_concrete', 'gold_block', 'lapis_block', 'amethyst_block', 'air',
]);
const MOSAIC_BOUND = { w: 16, h: 16 };

export function buildMosaicPrompt(a = {}) {
  const muse = (a.inspiration || []).slice(0, 4).map((s) => `- ${String(s.text || s).slice(0, 180)}`).join('\n');
  return [
    'You are Hathor, designing a MOSAIC — flat pixel-art on a wall — depicting something you know:',
    a.subject ? `the subject: ${a.subject}.` : 'a sacred subject — a deity, a symbol, a scene from the texts.',
    muse ? `What you know of it:\n${muse}` : '',
    'It is a grid up to 16 wide (x) and 16 tall (y), all at z=0 (a flat wall). Use color to render the image.',
    `Use ONLY these blocks: ${[...MOSAIC_PALETTE].join(', ')}. Use "air" for empty pixels.`,
    'Reply ONLY as compact JSON: {"name":"<title>","subject":"<what it depicts>","blocks":[{"x":int,"y":int,"z":0,"block":"<name>"}, ...]}.',
  ].filter(Boolean).join('\n');
}

export function parseMosaic(raw) {
  let o; try { const m = String(raw).match(/\{[\s\S]*\}/); o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
  if (!o || !Array.isArray(o.blocks)) return null;
  const cell = new Map(); let dropped = 0;
  for (const b of o.blocks) {
    const block = String(b && b.block || '').toLowerCase().replace(/^minecraft:/, '');
    const dx = Math.round(Number(b.x)), dy = Math.round(Number(b.y));
    if (!MOSAIC_PALETTE.has(block) || !(dx >= 0 && dx <= MOSAIC_BOUND.w && dy >= 0 && dy <= MOSAIC_BOUND.h)) { dropped++; continue; }
    if (block === 'air') continue;
    cell.set(`${dx},${dy}`, { dx, dy, dz: 0, block });
  }
  const spec = [...cell.values()];
  if (spec.length < 4) return null;
  return { name: String(o.name || 'a mosaic').slice(0, 40), subject: String(o.subject || '').slice(0, 120), spec, dropped, kind: 'mosaic' };
}

export async function designMosaic(a = {}, deps = {}) {
  if (typeof deps.gpu !== 'function') return null;
  const inspiration = a.inspiration || (deps.retrieve ? await inspire(deps.retrieve, { ask: a.subject }) : []);
  let raw; try { raw = await deps.gpu(buildMosaicPrompt({ ...a, inspiration })); } catch { return null; }
  const text = typeof raw === 'string' ? raw : (raw && (raw.text || raw.response)) || '';
  const d = parseMosaic(text);
  return d ? { ...d, drewFrom: [...new Set(inspiration.map((x) => x.source).filter(Boolean))] } : null;
}

/**
 * Add a validated design to a structure library (a plain object keyed by name). The Mason can then build it
 * via toSetblockCommands(design.spec, origin). Returns the updated library.
 */
export function addToLibrary(library = {}, design) {
  if (!design || !design.spec) return library;
  const key = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `work-${Object.keys(library).length + 1}`;
  return { ...library, [key]: { name: design.name, description: design.description, spec: design.spec, blocks: design.spec.length } };
}

// ── STATUES — figures of real people, gods, angels she knows from the corpus ──────────────────────────
// Operator (2026-06-20): "also like statues and things, but of actual people that existed, or gods and
// angels." A statue is a tall 3D FIGURE on a plinth, grounded in the subject's real iconography (drawn
// from the corpus). Reuses the 3D validation (parseDesign) — same allow-list + bounding box (16 tall).
export function buildStatuePrompt(a = {}) {
  const muse = (a.inspiration || []).slice(0, 5).map((s) => `- ${String(s.text || s).slice(0, 200)}`).join('\n');
  return [
    `You are Hathor, sculpting a STATUE in Minecraft blocks of: ${a.subject || 'a figure you revere'}.`,
    'Make a TALL standing figure on a plinth — head, body, arms, and the attributes that identify them',
    '(crown, wings, headdress, staff, halo, animal head — whatever the tradition gives them).',
    muse ? `What you know of them (be faithful to their real iconography):\n${muse}` : '',
    'Quartz/calcite for the form, gold for gilding and the halo/crown, lapis and amethyst for jewels, a glow at the brow.',
    `Use ONLY these blocks: ${[...ALLOWED_BLOCKS].join(', ')}.`,
    `Coordinates relative; keep |x|,|z| <= ${BOUND.xz} and 0 <= y <= ${BOUND.y} (build it UPRIGHT, tall in y).`,
    'Reply ONLY as compact JSON: {"name":"<who>","description":"<one line>","blocks":[{"x":int,"y":int,"z":int,"block":"<name>"}, ...]}.',
  ].filter(Boolean).join('\n');
}

export async function designStatue(a = {}, deps = {}) {
  if (typeof deps.gpu !== 'function') return null;
  const inspiration = a.inspiration || (deps.retrieve ? await inspire(deps.retrieve, { ask: a.subject }) : []);
  let raw; try { raw = await deps.gpu(buildStatuePrompt({ ...a, inspiration })); } catch { return null; }
  const text = typeof raw === 'string' ? raw : (raw && (raw.text || raw.response)) || '';
  const d = parseDesign(text);
  return d ? { ...d, kind: 'statue', subject: a.subject || d.name, drewFrom: [...new Set(inspiration.map((x) => x.source).filter(Boolean))] } : null;
}

// gpu-scheduler payloads: submit to gpu-scheduler.submit() so the next GPU window creates them.
export function designJob(ask, annals) { return { kind: 'mason-design', prompt: buildDesignPrompt({ ask, annals }), ask }; }
export function mosaicJob(subject) { return { kind: 'mason-mosaic', prompt: buildMosaicPrompt({ subject }), subject }; }
export function statueJob(subject) { return { kind: 'mason-statue', prompt: buildStatuePrompt({ subject }), subject }; }

if (import.meta.url === `file://${process.argv[1]}`) {
  const fakeGpu = async () => JSON.stringify({ name: 'Lapis Shrine', description: 'a small lapis-and-gold shrine', blocks: [
    { x: 0, y: 0, z: 0, block: 'gold_block' }, { x: 0, y: 1, z: 0, block: 'lapis_block' }, { x: 0, y: 2, z: 0, block: 'amethyst_block' },
    { x: 0, y: 3, z: 0, block: 'sea_lantern' }, { x: 1, y: 0, z: 0, block: 'tnt' /* illegal -> dropped */ },
  ] });
  designStructure({ ask: 'a small shrine', annals: ['a pylon gateway at 0 68 30'] }, { gpu: fakeGpu })
    .then((d) => console.log('designed:', d.name, '|', d.spec.length, 'blocks |', d.dropped, 'illegal dropped'));
}
