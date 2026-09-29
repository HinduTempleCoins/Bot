// genai-compose.mjs — MULTI-REFERENCE composition. Take several uploaded references, each tagged with a
// ROLE (character / object / scene), and (a) build ONE labeled "reference sheet" image the generator can
// condition on, and (b) build the instruction that tells the model to place each element into one scene.
//
// The operator's spec: "Several Characters and Objects … Upload them into the Right Spot and have them be
// Generated in the same Image together." A generator conditions on ONE image, so we tile the references
// into a single labeled sheet (CHARACTER 1, JEWELRY, SCENE …) and prompt by slot. Pure CPU (sharp), no
// network, no key. Objects (jewelry, hair, a shirt, a tree, a building) are just references with a role.
//
//   import { buildReferenceSheet, composePrompt, ROLES } from './genai-compose.mjs'
//   const sheet = await buildReferenceSheet([{ buffer, role:'character', label:'Ava' }, …]) // -> PNG Buffer
//   const prompt = composePrompt(refs, 'golden hour, cinematic')                              // -> string

export const ROLES = {
  character: { label: 'CHARACTER', tint: '#c86bff' },
  object: { label: 'OBJECT', tint: '#ffcf5b' },
  scene: { label: 'SCENE', tint: '#5bd0ff' },
};
export function normRole(r) { return ROLES[String(r || '').toLowerCase()] ? String(r).toLowerCase() : 'object'; }

const TILE = 460;      // each reference is fit into a TILE×TILE cell
const PAD = 16;
const CAP = 40;        // caption bar height
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Assign per-role running numbers so labels read "CHARACTER 1", "CHARACTER 2", "SCENE".
export function labelRefs(refs) {
  const counts = {};
  return (refs || []).map((r) => {
    const role = normRole(r.role);
    counts[role] = (counts[role] || 0) + 1;
    const many = (refs.filter((x) => normRole(x.role) === role).length) > 1;
    const slot = `${ROLES[role].label}${many ? ' ' + counts[role] : ''}`;
    return { ...r, role, slot, name: (r.label || '').trim() };
  });
}

// Build a single labeled reference sheet (PNG Buffer) from N references. Grid is up to 3 columns.
export async function buildReferenceSheet(refs, { sharp } = {}) {
  const S = sharp || (await import('sharp')).default;
  const items = labelRefs(refs).filter((r) => r.buffer && r.buffer.length);
  if (!items.length) throw new Error('no references');
  const cols = Math.min(3, items.length);
  const rows = Math.ceil(items.length / cols);
  const cellW = TILE + PAD * 2;
  const cellH = TILE + CAP + PAD * 2;
  const W = cols * cellW;
  const H = rows * cellH;
  const composites = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const cx = (i % cols) * cellW;
    const cy = Math.floor(i / cols) * cellH;
    // fit the reference into the tile (contain, on transparent)
    let tile;
    try {
      tile = await S(it.buffer, { failOn: 'none' }).rotate()
        .resize({ width: TILE, height: TILE, fit: 'contain', background: { r: 20, g: 20, b: 28, alpha: 1 } })
        .png().toBuffer();
    } catch { continue; } // skip an unreadable reference, never throw
    composites.push({ input: tile, left: cx + PAD, top: cy + PAD + CAP });
    // caption bar (role slot + optional name) as an SVG overlay
    const tint = ROLES[it.role].tint;
    const cap = `<svg width="${cellW}" height="${CAP}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${tint}"/>
      <text x="12" y="27" font-family="sans-serif" font-size="22" font-weight="700" fill="#12121a">${esc(it.slot)}${it.name ? '  ·  ' + esc(it.name) : ''}</text></svg>`;
    composites.push({ input: Buffer.from(cap), left: cx, top: cy + PAD });
  }
  if (!composites.length) throw new Error('no readable references');
  return S({ create: { width: W, height: H, channels: 3, background: { r: 12, g: 12, b: 18 } } })
    .composite(composites).png().toBuffer();
}

// The instruction: tell the model the labeled reference panels are separate elements to merge into ONE
// image. Kept COMPACT — the prompt rides in the provider's URL alongside the reference-image param, and a
// long prompt makes keyless flux-kontext return HTTP 500. No slashes/newlines; capped length.
export function composePrompt(refs, userPrompt = '') {
  const items = labelRefs(refs);
  const chars = items.filter((r) => r.role === 'character');
  const objs = items.filter((r) => r.role === 'object');
  const scenes = items.filter((r) => r.role === 'scene');
  const name = (r) => r.name ? `${r.slot} ${r.name}` : r.slot;
  const bits = ['One image merging the labeled reference panels'];
  if (chars.length) bits.push(`${chars.map(name).join(' and ')} together`);
  if (objs.length) bits.push(`with ${objs.map(name).join(', ')}`);
  if (scenes.length) bits.push(`in ${scenes.map(name).join(' ')}`);
  const style = (userPrompt || '').replace(/[\r\n]+/g, ' ').trim();
  if (style) bits.push(style);
  bits.push('unified scene, no panels, no text');
  return bits.join(', ').replace(/\s+/g, ' ').slice(0, 300);
}

// Plain-language prompt for engines that take each reference separately (our CPU engine): no "panels" or slot
// labels — those make the model paint the sheet itself, text and all.
export function composePromptPlain(refs, userPrompt = '') {
  const items = labelRefs(refs);
  const nm = (r, fallback) => (r.name ? r.name : fallback);
  const chars = items.filter((r) => r.role === 'character').map((r) => nm(r, 'a person'));
  const objs = items.filter((r) => r.role === 'object').map((r) => nm(r, 'the object'));
  const scenes = items.filter((r) => r.role === 'scene').map((r) => nm(r, 'the place'));
  const bits = [];
  if (chars.length) bits.push(chars.join(' and '));
  if (objs.length) bits.push(`with ${objs.join(', ')}`);
  if (scenes.length) bits.push(`in ${scenes.join(', ')}`);
  const style = (userPrompt || '').replace(/[\r\n]+/g, ' ').trim();
  if (style) bits.push(style);
  bits.push('one unified photorealistic scene, highly detailed');
  return bits.join(', ').replace(/\s+/g, ' ').slice(0, 400);
}

if (process.argv[1] && process.argv[1].endsWith('genai-compose.mjs')) {
  console.log(composePrompt([
    { role: 'character', label: 'Ava' }, { role: 'character', label: 'Kai' },
    { role: 'object', label: 'gold wesekh' }, { role: 'scene', label: 'temple courtyard' },
  ], 'golden hour'));
}
