// world-memory.mjs — Hathor's SPATIAL memory: mapping an expansive game world by LANDMARKS.
//
// Operator (2026-06-20): in the game "she needs to be mapping the world… landmarks, and remembers what is
// going on here or there… Minecraft worlds are kind of expansive, so that itself is like a whole memory
// system." This is that subsystem — the place-cell layer of the hippocampus. She records named landmarks
// with positions and notes, finds what's NEAR a position ("what's going on here"), navigates by "the
// nearest X", and recalls places by description. Keyed by world (she plays more than one).
//
// Pure + deterministic (distance math + keyword match) → offline, no embeddings needed for space. Tagged
// by person so "the tower VanKushFam built" is attributable. Soft-fails. House style: ESM, CLI guard.

export function createWorldMemory() {
  const worlds = new Map(); // world -> [{name, pos:{x,y,z}, note, person, kind, at}]
  let seq = 0;

  function list(world) { if (!worlds.has(world)) worlds.set(world, []); return worlds.get(world); }

  /** Record (or update) a landmark. */
  function addLandmark(world, name, pos, { note = '', person = null, kind = 'place', at = null } = {}) {
    if (!world || !name || !pos || !isFinite(pos.x) || !isFinite(pos.z)) return { ok: false };
    const marks = list(world);
    const existing = marks.find((m) => m.name.toLowerCase() === String(name).toLowerCase());
    const rec = { id: ++seq, name: String(name), pos: { x: +pos.x, y: +(pos.y ?? 0), z: +pos.z }, note: String(note), person, kind, at };
    if (existing) Object.assign(existing, rec, { id: existing.id });
    else marks.push(rec);
    return { ok: true, name: rec.name };
  }

  function dist(a, b) { const dx = a.x - b.x, dy = (a.y ?? 0) - (b.y ?? 0), dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

  /** The k nearest landmarks to a position (with distance) — "where am I, what's around me". */
  function nearest(world, pos, { k = 3 } = {}) {
    return list(world)
      .map((m) => ({ ...m, distance: Math.round(dist(m.pos, pos)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }

  /** Landmarks within `radius` blocks — "what is going on HERE". */
  function here(world, pos, { radius = 32 } = {}) {
    return nearest(world, pos, { k: 999 }).filter((m) => m.distance <= radius);
  }

  /** Recall a place by description (name/note/person keyword match). */
  function recallPlace(world, query) {
    const q = new Set(String(query).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
    return list(world).map((m) => {
      const hay = `${m.name} ${m.note} ${m.person || ''} ${m.kind}`.toLowerCase();
      let n = 0; for (const w of q) if (hay.includes(w)) n++;
      return { ...m, score: q.size ? n / q.size : 0 };
    }).filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
  }

  /** A short spoken-ready orientation line for where she is. */
  function describeHere(world, pos, opts = {}) {
    const near = nearest(world, pos, { k: 2 });
    if (!near.length) return 'This part of the world is new to me — no landmarks yet.';
    const [a] = near;
    if (a.distance <= 3) return `I am at ${a.name}${a.note ? ` — ${a.note}` : ''}.`;
    return `I am about ${a.distance} blocks from ${a.name}${near[1] ? `, ${near[1].distance} from ${near[1].name}` : ''}.`;
  }

  return { addLandmark, nearest, here, recallPlace, describeHere, landmarks: (world) => [...list(world)], worlds: () => [...worlds.keys()] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wm = createWorldMemory();
  wm.addLandmark('hathor-world', 'spawn', { x: 0, y: 64, z: 0 }, { note: 'where everyone arrives', kind: 'hub' });
  wm.addLandmark('hathor-world', "VanKush's tower", { x: 40, y: 70, z: 10 }, { note: 'tall cobblestone tower', person: 'VanKushFam' });
  wm.addLandmark('hathor-world', 'the river', { x: 55, y: 62, z: 8 }, { note: 'water, good for fishing' });
  console.log('near (50,66,5):', wm.nearest('hathor-world', { x: 50, y: 66, z: 5 }).map((m) => `${m.name}@${m.distance}`).join(', '));
  console.log('orientation:', wm.describeHere('hathor-world', { x: 41, y: 70, z: 10 }));
  console.log('recall "tower":', wm.recallPlace('hathor-world', 'tower').map((m) => m.name).join(', '));
}
