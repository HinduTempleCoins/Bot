// botanica-registry.mjs — the single canonical registry of the Botanica economy.
//
// EVERYTHING COMES FROM BOTANICA. The materials, the plants that yield them, the recipes that turn
// them into goods, and the stations the work happens at are all already modelled — but they live in
// nine separate modules, and every consumer has had to know which one to ask. That is fine for one
// web surface and impossible for several clients.
//
// This module collects them into ONE normalized, versioned registry, so a client — the web game, a
// Minecraft mod, a Luanti mod, the NFT supply policy — reads one shape and does not care which
// module a given item came from. Botanica is the source of truth; a world is a renderer.
//
// PURE: no network, no clock, no disk, no keys. Soft-fail-never-throw; a module that changes shape
// contributes nothing rather than breaking the registry.
//
// ── What a registry entry is ─────────────────────────────────────────────────────────────────────
//   item   = { id, name, kind, domains[], sources[] }   kind: material | good | plant
//   recipe = { id, inputs[{item,qty}], output{item,qty}, station, effort, source }
//   plant  = { id, name, category, yields[] }
//
// `sources` records which catalog an item came from, because two modules naming the same item is a
// fact about the economy (fiber is grown in plant-catalog and consumed in plant-products), not a
// collision to be silently resolved.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   REGISTRY_VERSION
//   buildRegistry()                  -> { version, items, recipes, plants, stations, domains }
//   itemsById(reg) / recipesFor(reg, itemId) / producedBy(reg, itemId) / consumedBy(reg, itemId)
//   chainTo(reg, itemId, depth)      -> the production chain that ends at an item
//   validate(reg)                    -> { ok, orphanInputs[], unreachable[], duplicateRecipeIds[] }
//   esc(s)

import * as plantCatalog from './plant-catalog.mjs';
import * as plantProducts from './plant-products.mjs';
import * as industrial from './industrial-alchemical.mjs';
import * as botanica from './botanica.mjs';
import * as insects from './insect-ecosystem.mjs';
import * as microbes from './microbe-lab.mjs';
import * as spirits from './spirits-and-parts.mjs';

export const REGISTRY_VERSION = 1;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const id = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
const titleize = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Read a named export from a module without letting a shape change throw. */
function grab(mod, key, fallback) {
  try {
    const v = mod && mod[key];
    return v == null ? fallback : v;
  } catch { return fallback; }
}

/** Add an item to the registry, merging domains and recording every source that named it. */
function addItem(items, rawId, { name, kind, domains, source } = {}) {
  const key = id(rawId);
  if (!key) return;
  const cur = items.get(key) || { id: key, name: '', kind: kind || 'material', domains: [], sources: [] };
  if (name && !cur.name) cur.name = String(name);
  // A good outranks a material: if anything crafts it, it is a good.
  if (kind === 'good') cur.kind = 'good';
  else if (kind === 'plant' && cur.kind !== 'good') cur.kind = 'plant';
  for (const d of domains || []) if (d && !cur.domains.includes(d)) cur.domains.push(String(d));
  if (source && !cur.sources.includes(source)) cur.sources.push(source);
  if (!cur.name) cur.name = titleize(key);
  items.set(key, cur);
}

/** Normalize any of the several recipe shapes in the catalogs into one. */
function addRecipe(recipes, raw, source) {
  if (!raw || typeof raw !== 'object') return;
  const rid = id(raw.id);
  const out = raw.output || {};
  const outItem = id(out.item);
  if (!rid || !outItem) return;
  const inputs = (Array.isArray(raw.inputs) ? raw.inputs : [])
    .map((i) => ({ item: id(i && i.item), qty: Math.max(1, Math.trunc(Number(i && i.qty) || 1)) }))
    .filter((i) => i.item);
  recipes.push({
    id: rid,
    inputs,
    output: { item: outItem, qty: Math.max(1, Math.trunc(Number(out.qty) || 1)) },
    station: id(raw.station) || 'bench',
    effort: Math.max(0, Math.trunc(Number(raw.effort) || 0)),
    source,
  });
}

/** buildRegistry() — walk every catalog and produce the one canonical view. */
export function buildRegistry() {
  const items = new Map();
  const recipes = [];
  const plants = [];

  // ── plants and the raw materials they yield ────────────────────────────────────────────────────
  for (const m of grab(plantCatalog, 'MATERIALS', [])) {
    addItem(items, m && m.item, { name: m && m.name, kind: 'material', domains: (m && m.domains) || [], source: 'plant-catalog' });
  }
  for (const p of grab(plantCatalog, 'PLANTS', [])) {
    if (!p || !p.id) continue;
    const yields = (Array.isArray(p.yields) ? p.yields : []).map(id).filter(Boolean);
    plants.push({ id: id(p.id), name: p.name || titleize(p.id), category: id(p.category) || 'plant', yields });
    addItem(items, p.id, { name: p.name, kind: 'plant', source: 'plant-catalog' });
    for (const y of yields) addItem(items, y, { kind: 'material', source: 'plant-catalog' });
  }

  // ── processed goods ────────────────────────────────────────────────────────────────────────────
  for (const m of grab(plantProducts, 'MATERIALS', [])) {
    addItem(items, m && m.item, { name: m && m.name, kind: 'material', domains: (m && m.domains) || [], source: 'plant-products' });
  }
  for (const p of grab(plantProducts, 'PRODUCTS', [])) {
    addItem(items, p && p.item, { name: p && p.name, kind: 'good', domains: p && p.domain ? [p.domain] : [], source: 'plant-products' });
  }
  for (const r of grab(plantProducts, 'RECIPES', [])) addRecipe(recipes, r, 'plant-products');

  // ── the industrial / alchemical chains (ash → potash → lye, resin → rosin) ──────────────────────
  const indMats = grab(industrial, 'MATERIALS', {});
  for (const k of Object.keys(indMats || {})) addItem(items, k, { kind: 'material', source: 'industrial-alchemical' });
  for (const k of Object.keys(grab(industrial, 'EXTERNAL', {}) || {})) {
    addItem(items, k, { kind: 'material', domains: ['external'], source: 'industrial-alchemical' });
  }
  for (const r of grab(industrial, 'RECIPES', [])) addRecipe(recipes, r, 'industrial-alchemical');

  // ── the apothecary goods Botanica itself crafts ────────────────────────────────────────────────
  for (const i of grab(botanica, 'ITEMS', [])) {
    addItem(items, i && i.id, { name: i && i.name, kind: 'good', domains: i && i.type ? [i.type] : [], source: 'botanica' });
  }
  for (const r of grab(botanica, 'ITEM_RECIPES', [])) addRecipe(recipes, r, 'botanica');

  // ── living materials ───────────────────────────────────────────────────────────────────────────
  for (const [mod, name] of [[insects, 'insect-ecosystem'], [microbes, 'microbe-lab'], [spirits, 'spirits-and-parts']]) {
    for (const key of ['MATERIALS', 'PRODUCTS', 'PARTS']) {
      const v = grab(mod, key, null);
      if (!v) continue;
      const entries = Array.isArray(v) ? v.map((x) => [x && (x.item || x.id), x]) : Object.entries(v);
      for (const [k, val] of entries) {
        addItem(items, k, { name: val && val.name, kind: 'material', source: name });
      }
    }
  }

  // Anything a recipe produces is a good, and anything a recipe consumes must exist as an item.
  for (const r of recipes) {
    addItem(items, r.output.item, { kind: 'good', source: r.source });
    for (const i of r.inputs) addItem(items, i.item, { kind: 'material', source: r.source });
  }

  const stations = [...new Set(recipes.map((r) => r.station))].sort();
  const domains = [...new Set([...items.values()].flatMap((i) => i.domains))].sort();

  return {
    version: REGISTRY_VERSION,
    items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)),
    recipes: recipes.sort((a, b) => a.id.localeCompare(b.id)),
    plants: plants.sort((a, b) => a.id.localeCompare(b.id)),
    stations,
    domains,
  };
}

// ── queries ──────────────────────────────────────────────────────────────────────────────────────
export const itemsById = (reg) => Object.fromEntries((reg && reg.items ? reg.items : []).map((i) => [i.id, i]));

export const producedBy = (reg, itemId) =>
  (reg && reg.recipes ? reg.recipes : []).filter((r) => r.output.item === id(itemId));

export const consumedBy = (reg, itemId) =>
  (reg && reg.recipes ? reg.recipes : []).filter((r) => r.inputs.some((i) => i.item === id(itemId)));

export const recipesFor = (reg, itemId) => producedBy(reg, itemId);

/**
 * chainTo(reg, itemId, depth) — the production chain that ends at an item, walked backwards.
 * This is the thing a cottage industry actually needs to see: what has to happen, and in what
 * order, before this good can exist. Cycles are cut rather than followed.
 */
export function chainTo(reg, itemId, depth = 6) {
  const seen = new Set();
  const out = [];
  const walk = (target, d) => {
    const t = id(target);
    if (!t || d < 0 || seen.has(t)) return;
    seen.add(t);
    for (const r of producedBy(reg, t)) {
      out.push(r);
      for (const i of r.inputs) walk(i.item, d - 1);
    }
  };
  walk(itemId, Math.max(0, Math.trunc(Number(depth) || 0)));
  return out;
}

/**
 * validate(reg) — cross-catalog integrity. These are real economy defects, not style issues:
 *   orphanInputs   an input nothing grows, yields or crafts — a chain that cannot start
 *   unreachable    a good with no recipe and no plant yielding it — an item nobody can obtain
 *   duplicateRecipeIds  two catalogs claiming the same recipe id
 */
export function validate(reg) {
  const items = itemsById(reg);
  const recipes = (reg && reg.recipes) || [];
  const plants = (reg && reg.plants) || [];

  const obtainable = new Set();
  for (const p of plants) for (const y of p.yields) obtainable.add(y);
  for (const r of recipes) obtainable.add(r.output.item);
  for (const i of Object.values(items)) if ((i.domains || []).includes('external')) obtainable.add(i.id);

  const orphanInputs = [];
  for (const r of recipes) {
    for (const i of r.inputs) {
      if (!obtainable.has(i.item) && !items[i.item]) orphanInputs.push({ recipe: r.id, input: i.item });
    }
  }

  const unreachable = Object.values(items)
    .filter((i) => i.kind === 'good' && !obtainable.has(i.id))
    .map((i) => i.id);

  const counts = {};
  for (const r of recipes) counts[r.id] = (counts[r.id] || 0) + 1;
  const duplicateRecipeIds = Object.keys(counts).filter((k) => counts[k] > 1);

  return {
    ok: orphanInputs.length === 0 && unreachable.length === 0 && duplicateRecipeIds.length === 0,
    orphanInputs,
    unreachable,
    duplicateRecipeIds,
    counts: { items: Object.keys(items).length, recipes: recipes.length, plants: plants.length },
  };
}

export default {
  REGISTRY_VERSION, buildRegistry, itemsById, producedBy, consumedBy, recipesFor, chainTo, validate, esc,
};

if (process.argv[1] && process.argv[1].endsWith('botanica-registry.mjs')) {
  const reg = buildRegistry();
  const v = validate(reg);
  console.log(`Botanica registry v${reg.version}`);
  console.log(`  items ${reg.items.length} · recipes ${reg.recipes.length} · plants ${reg.plants.length}`);
  console.log(`  stations: ${reg.stations.join(', ')}`);
  console.log(`  domains:  ${reg.domains.join(', ')}`);
  console.log(`  valid: ${v.ok}`);
  if (v.orphanInputs.length) console.log(`  orphan inputs: ${v.orphanInputs.slice(0, 12).map((o) => `${o.input}(${o.recipe})`).join(', ')}`);
  if (v.unreachable.length) console.log(`  unreachable goods: ${v.unreachable.slice(0, 12).join(', ')}`);
}
