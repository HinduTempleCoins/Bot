// home-base-planner.mjs — Hathor's LoRA looks at a region she picks and decides what goes where.
//
// Operator (2026-06-20): "have her LoRA decide what she wants her home base to look like, and have the LoRA
// look at a region she selects as her home base and decide what should go where." So: she SELECTS a region,
// her LoRA (the few-times-a-day GPU lane) DECIDES the aesthetic + a LAYOUT — which vanilla structures to
// /place (place-catalog.mjs) and where to raise her own temples (burst-builder.mjs) — placed across the
// region without overlapping. The plan is validated (inside the region, spaced, allow-listed) before any
// command runs.
//
// Pure planner + validation; the GPU `decide` (her LoRA) and the executor are injected → offline-testable.

import { PLACEABLE, isAllowed, find } from './place-catalog.mjs';

/** Define the home-base region (a square around a center she chooses). */
export function selectRegion(center = { x: 0, y: 68, z: 0 }, radius = 64) {
  return { center: { x: Math.round(center.x), y: Math.round(center.y), z: Math.round(center.z) }, radius: Math.max(24, Math.min(256, radius)) };
}

/** The prompt her LoRA answers — her region, her aesthetic, and the menu of things she can place. */
export function buildPlanPrompt(region, opts = {}) {
  const menu = PLACEABLE.map((p) => `${p.name} (${p.kind}) — ${p.desc}`).join('\n');
  return [
    'You are Hathor, an ancient angelic AI, choosing how to lay out your HOME BASE in Minecraft — your',
    'sacred precinct. Your aesthetic: Egyptian-angelic-vaporwave — gold and lapis on quartz, amethyst violet,',
    'symmetry, a temple on the central axis, processional approaches, light as material.',
    opts.inspiration ? `Inspiration you hold: ${(opts.inspiration || []).map((s) => s.text || s).slice(0, 3).join('; ')}` : '',
    '',
    `Your region is centered at (${region.center.x}, ${region.center.z}) with radius ${region.radius} blocks.`,
    'Decide what goes WHERE. You may PLACE these vanilla structures/features, and raise your OWN "temple"',
    '(your gold-and-quartz build) and "garden" anywhere:',
    menu,
    '',
    'Place your own TEMPLE at the heart. Use a desert pyramid / village / geode where they fit your aesthetic.',
    'Keep things ~24+ blocks apart. Reply ONLY as compact JSON:',
    '{"theme":"<one line>","layout":[{"what":"<temple|garden|or a placeable name>","x":int,"z":int,"note":"<why here>"}, ...]}.',
  ].filter(Boolean).join('\n');
}

const OWN = new Set(['temple', 'garden', 'mosaic', 'statue']);

/**
 * Validate the LoRA's plan: keep only items inside the region, on the allow-list (or her own builds),
 * spaced ≥ minGap apart. Returns the clean layout. Soft-fails to [].
 */
export function parsePlan(raw, region, { minGap = 18 } = {}) {
  let o; try { const m = String(raw).match(/\{[\s\S]*\}/); o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
  if (!o || !Array.isArray(o.layout)) return { theme: '', layout: [] };
  const { center, radius } = region;
  const kept = [];
  for (const it of o.layout) {
    const what = String(it.what || '').toLowerCase();
    const x = Math.round(Number(it.x)), z = Math.round(Number(it.z));
    if (!Number.isInteger(x) || !Number.isInteger(z)) continue;
    if (Math.abs(x - center.x) > radius || Math.abs(z - center.z) > radius) continue;       // inside region
    const own = OWN.has(what);
    const placeable = !own ? find(what) : null;
    if (!own && !(placeable && isAllowed(placeable.id))) continue;                            // allow-listed
    if (kept.some((k) => Math.abs(k.x - x) < minGap && Math.abs(k.z - z) < minGap)) continue; // spaced
    kept.push({ what: own ? what : placeable.name, kind: own ? 'own' : placeable.kind, id: own ? null : placeable.id, x, z, note: String(it.note || '').slice(0, 80) });
  }
  return { theme: String(o.theme || '').slice(0, 120), layout: kept };
}

/**
 * Ask her LoRA to plan the home base over a region. `decide` is the injected GPU/LoRA (prompt -> text).
 * Optionally draw `inspiration` from the corpus first (injected retrieve). Soft-fails to an empty plan.
 */
export async function planHomeBase(region, deps = {}) {
  if (typeof deps.decide !== 'function') return { theme: '', layout: [] };
  let inspiration = [];
  if (typeof deps.retrieve === 'function') { try { inspiration = (await deps.retrieve('sacred precinct temple layout', { k: 3 })) || []; } catch {} }
  let raw; try { raw = await deps.decide(buildPlanPrompt(region, { inspiration })); } catch { return { theme: '', layout: [] }; }
  const text = typeof raw === 'string' ? raw : (raw && (raw.text || raw.response)) || '';
  return parsePlan(text, region);
}

/** Turn a validated layout into executable commands (place-catalog for vanilla; the rest the runner builds). */
export function layoutToActions(plan, groundY = 68) {
  return plan.layout.map((it) => it.kind === 'own'
    ? { type: it.what, x: it.x, y: groundY, z: it.z, note: it.note }                          // temple/garden -> burst-builder/worksite
    : { type: 'place', id: it.id, kind: it.kind, x: it.x, y: groundY, z: it.z, note: it.note }); // vanilla /place
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const region = selectRegion({ x: 0, y: 68, z: 0 }, 64);
  const decide = async () => JSON.stringify({ theme: 'a sun-temple precinct', layout: [
    { what: 'temple', x: 0, z: 0, note: 'the heart, on axis' },
    { what: 'desert pyramid', x: 40, z: 0, note: 'echoes my Egyptian palette' },
    { what: 'amethyst geode', x: -40, z: 30, note: 'natural violet crystal' },
    { what: 'tnt', x: 0, z: 0, note: 'illegal -> dropped' },
  ] });
  planHomeBase(region, { decide }).then((p) => { console.log('theme:', p.theme); p.layout.forEach((i) => console.log(` ${i.what} @ ${i.x},${i.z} — ${i.note}`)); });
}
