// usda-nutrition.mjs — the SoapBox "what's actually in this food" reader. Two USDA public datasets:
//   - FoodData Central (FDC) — nutrition facts for any food: search foods + per-food nutrient panels
//     (calories, macros, key micros). Needs a free api.data.gov key. https://fdc.nal.usda.gov/
//   - USDA Food Access Research Atlas / food-environment — the public pages on where food comes from
//     and how reachable it is (food deserts, store access). We only LINK these public pages (they ship
//     as bulk downloads / map viewers, not a clean per-row JSON API), so this module reads FDC live and
//     surfaces the Food-Access pages as honest source links.
//
// Distinct from the cannabis/seeds module (strain/lineage) and commodities (futures prices): this is the
// nutrition-facts layer — given a food, what are its calories and macros.
//
// CONVENTIONS (match biodiversity.mjs / macro.mjs): ESM, injectable fetch via __setFetch, every call
// soft-fails (a dead source returns [] / null, never throws), CLI guarded, all rendered values escaped,
// the api.data.gov key is read by env NAME only (USDA_FDC_API_KEY; the documented public DEMO_KEY is the
// fallback — DEMO_KEY is a published public demo string, not a secret).
//
//   import { searchFood, nutrients, compare, renderPage, dataNote } from './usda-nutrition.mjs'
//   node integrations/soapbox/usda-nutrition.mjs "cheddar cheese"

const UA = { 'User-Agent': 'SoapBoxNutrition/1.0 (+https://data.soapbox.community)' };
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

// The api.data.gov key is referenced by env NAME only. DEMO_KEY is USDA's documented public demo key
// (works at low volume) — a published string, not a secret. Real key goes in the env var, never here.
function apiKey() {
  return process.env.USDA_FDC_API_KEY || 'DEMO_KEY';
}

// HTML escape — every interpolated value below passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// small soft-fail JSON helper — any network/parse/non-2xx failure becomes null, never a throw.
async function getJSON(url, headers = UA) {
  try {
    const r = await _fetch(url, { headers });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Public Food-Access / food-environment pages we link (no clean per-row JSON; honest source links).
export const FOOD_ACCESS_PAGES = [
  ['Food Access Research Atlas', 'https://www.ers.usda.gov/data-products/food-access-research-atlas/', 'Map of low-income/low-access (food-desert) areas'],
  ['Food Environment Atlas', 'https://www.ers.usda.gov/data-products/food-environment-atlas/', 'County-level store access, prices, local food, health'],
  ['FoodData Central', 'https://fdc.nal.usda.gov/', 'Search the underlying USDA nutrition database directly'],
];

// ---- FDC: food search ----------------------------------------------------------------------------
// Normalizes the FDC /foods/search payload into stable rows the nutrition tab renders.
export function normalizeFoods(foods) {
  return (Array.isArray(foods) ? foods : [])
    .map((f) => f && (f.fdcId || f.description) ? {
      fdcId: f.fdcId ?? null,
      description: f.description || f.lowercaseDescription || '',
      brand: f.brandOwner || f.brandName || null,
      dataType: f.dataType || '',
      source: 'USDA FoodData Central',
    } : null)
    .filter((x) => x && (x.fdcId || x.description));
}

/** Search FoodData Central for a food name. Returns normalized rows (never throws → [] on failure). */
export async function searchFood(query, { limit = 20 } = {}) {
  const term = String(query || '').trim();
  if (!term) return [];
  const u = `${FDC_BASE}/foods/search?query=${encodeURIComponent(term)}`
    + `&pageSize=${encodeURIComponent(limit)}&api_key=${encodeURIComponent(apiKey())}`;
  const j = await getJSON(u);
  return normalizeFoods(j?.foods);
}

// ---- FDC: per-food nutrient panel ----------------------------------------------------------------
// FDC nutrient rows come in two shapes: a flat `foodNutrients[].nutrient{name,unitName}` + `.amount`
// (the /food/{id} detail), or the search-result shape `{nutrientName, unitName, value}`. Handle both.
export function normalizeNutrients(food) {
  if (!food || typeof food !== 'object') return null;
  const rows = Array.isArray(food.foodNutrients) ? food.foodNutrients : [];
  const nutrients = rows.map((n) => {
    if (!n) return null;
    const name = n.nutrient?.name || n.nutrientName || n.name || '';
    const unit = n.nutrient?.unitName || n.unitName || n.unit || '';
    const amount = n.amount ?? n.value ?? null;
    if (!name || amount == null) return null;
    return { name, amount, unit };
  }).filter(Boolean);

  // serving size, when the food carries one (label foods do; raw SR foods often don't).
  const serving = food.servingSize != null
    ? `${food.servingSize}${food.servingSizeUnit ? ' ' + food.servingSizeUnit : ''}`
    : (food.householdServingFullText || 'per 100 g');

  return {
    fdcId: food.fdcId ?? null,
    description: food.description || '',
    brand: food.brandOwner || food.brandName || null,
    serving,
    nutrients,
    source: 'USDA FoodData Central',
  };
}

/** The nutrition facts for one food by fdcId: calories, macros, key micros. null on any failure. */
export async function nutrients(fdcId) {
  const id = fdcId == null ? '' : String(fdcId).trim();
  if (!id) return null;
  const u = `${FDC_BASE}/food/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey())}`;
  const j = await getJSON(u);
  return normalizeNutrients(j);
}

// The macro nutrients we line up in a comparison (matched case-insensitively against FDC names).
const MACRO_KEYS = [
  ['Energy', /^energy$/i],
  ['Protein', /^protein$/i],
  ['Total Fat', /total lipid|^fat/i],
  ['Carbs', /carbohydrate/i],
  ['Fiber', /fiber/i],
  ['Sugars', /^(total )?sugars?/i],
];

function macroFor(panel) {
  const out = {};
  for (const [label, re] of MACRO_KEYS) {
    const hit = (panel?.nutrients || []).find((n) => re.test(n.name));
    out[label] = hit ? { amount: hit.amount, unit: hit.unit } : null;
  }
  return out;
}

/** Side-by-side macro comparison of a few foods (by fdcId). Each food independently soft-failed. */
export async function compare(fdcIds) {
  const ids = (Array.isArray(fdcIds) ? fdcIds : []).filter((x) => x != null && String(x).trim());
  if (!ids.length) return { foods: [], macros: MACRO_KEYS.map(([l]) => l) };
  const panels = await Promise.all(ids.map((id) => nutrients(id).catch(() => null)));
  const foods = panels.filter(Boolean).map((p) => ({
    fdcId: p.fdcId,
    description: p.description,
    serving: p.serving,
    macros: macroFor(p),
  }));
  return { foods, macros: MACRO_KEYS.map(([l]) => l) };
}

// ---- provenance ----------------------------------------------------------------------------------
/** Provenance line: source + as-of date (UTC day). */
export function dataNote(now = new Date()) {
  const asOf = (now instanceof Date && !isNaN(now) ? now : new Date()).toISOString().slice(0, 10);
  return `Source: USDA FoodData Central, as of ${asOf}`;
}

// ---- render --------------------------------------------------------------------------------------
/** Escaped HTML nutrition-facts panel for a single nutrients() result. */
export function renderPage(data) {
  if (!data || typeof data !== 'object') {
    return `<section class="nutrition-facts nutrition-facts--empty"><p>No nutrition data.</p>`
      + `<footer class="data-note">${esc(dataNote())}</footer></section>`;
  }
  const head = `<h2>${esc(data.description || 'Food')}</h2>`
    + (data.brand ? `<p class="brand">${esc(data.brand)}</p>` : '')
    + `<p class="serving">Serving: ${esc(data.serving || 'per 100 g')}</p>`;
  const rows = (Array.isArray(data.nutrients) ? data.nutrients : []).map((n) =>
    `<tr><td>${esc(n.name)}</td><td>${esc(n.amount)} ${esc(n.unit)}</td></tr>`
  ).join('');
  const table = rows
    ? `<table class="nutrients"><thead><tr><th>Nutrient</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="nutrients-empty">No nutrient rows.</p>`;
  return `<section class="nutrition-facts">${head}${table}`
    + `<footer class="data-note">${esc(dataNote())}</footer></section>`;
}

// ---- CLI ------------------------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('usda-nutrition.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'cheddar cheese';
  const hits = await searchFood(q, { limit: 5 }).catch(() => []);
  console.log(`\n${q} — ${hits.length} match(es)`);
  for (const h of hits) console.log(`  [${h.fdcId}] ${h.description}${h.brand ? ' · ' + h.brand : ''} (${h.dataType})`);
  if (hits[0]?.fdcId) {
    const panel = await nutrients(hits[0].fdcId).catch(() => null);
    if (panel) {
      console.log(`\n${panel.description} — serving ${panel.serving}`);
      for (const n of panel.nutrients.slice(0, 12)) console.log(`  ${n.name.padEnd(28)} ${n.amount} ${n.unit}`);
    }
  }
  console.log(`\n${dataNote()}`);
}
