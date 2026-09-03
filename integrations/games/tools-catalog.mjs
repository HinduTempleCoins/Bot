// tools-catalog.mjs — the implement/tool catalog behind Botanica and the wider MELEK game economy.
//
// PURE + DETERMINISTIC: data + queries, no network, no clock, no disk, no keys. Soft-fail-never-throw
// (house style — a surface must always render, even on garbage input).
//
// ── What this is ─────────────────────────────────────────────────────────────────────────────────
//   Skill games (the RuneScape lineage, and the farm-sim lineage Botanica sits in) are held together
//   by TOOLS: an action is gated on holding the right implement, and the implement's MATERIAL TIER
//   sets how fast and how well the action resolves. That single pattern is what turns a set of
//   minigames into one economy — a pickaxe is worth something because mining is worth something,
//   and mining is worth something because smithing needs ore.
//
//   This module is the catalog for that. Every entry is a (tool x tier) VARIANT — `copper_pickaxe`,
//   `star_iron_pickaxe` — with a skill gate, a speed/yield multiplier, a durability budget, and a
//   manufacture recipe. Each variant is deliberately shaped to be mintable as an NFT later: see
//   item-nft.mjs, which owns the supply policy (sell first to bootstrap, manufacture-mint after).
//
// ── IP SAFETY (LOAD-BEARING — .local/HUD_GAME_DESIGN.md §7) ──────────────────────────────────────
//   Genre-inspired, never asset-copied. Mechanics and genres are not copyrightable; specific names,
//   characters and assets are. So: the implements here are GENERIC real-world tools (a spade is a
//   spade), and the material ladder is ORIGINAL and MELEK-native (temple-tech / Ashurbanipal flavour)
//   rather than any published game's tier names. No franchise names, anywhere, ever.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   SKILLS, TIERS, TOOLS
//   tierById(id) / toolById(id)
//   toolsForSkill(skill) / toolsForAction(action)
//   variantId(toolId, tierId) / variant(toolId, tierId) / allVariants()
//   speedMultiplier(tierId) / yieldBonus(tierId)
//   canUse(variantOrId, skillLevels) / bestUsable(action, ownedIds, skillLevels)
//   manufactureRecipe(toolId, tierId) / esc(s)

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const id = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

// ── Skills ───────────────────────────────────────────────────────────────────────────────────────
// The skill list is deliberately small and maps onto loops Botanica already runs (plant → grow →
// harvest → craft) plus the extraction skills the production chain needs.
export const SKILLS = Object.freeze([
  { id: 'cultivation', name: 'Cultivation', about: 'Sowing, tending and harvesting planted ground.' },
  { id: 'foraging', name: 'Foraging', about: 'Gathering wild plants, resin and fungi.' },
  { id: 'woodcutting', name: 'Woodcutting', about: 'Felling and sectioning timber.' },
  { id: 'mining', name: 'Mining', about: 'Extracting ore, clay, salt and stone.' },
  { id: 'fishing', name: 'Fishing', about: 'Taking fish and shellfish from water.' },
  { id: 'smithing', name: 'Smithing', about: 'Smelting ore and forging metal goods — including tools.' },
  { id: 'crafting', name: 'Crafting', about: 'Working leather, glass, clay and fibre into goods.' },
  { id: 'textiles', name: 'Textiles', about: 'Spinning, weaving and dyeing fibre.' },
  { id: 'apothecary', name: 'Apothecary', about: 'Extracting, distilling and compounding plant preparations.' },
  { id: 'cooking', name: 'Cooking', about: 'Milling, brewing and preparing food and drink.' },
]);
const SKILL_IDS = new Set(SKILLS.map((s) => s.id));

// ── Material tiers ───────────────────────────────────────────────────────────────────────────────
// ORIGINAL ladder (see the IP note above). `speed` multiplies action rate; `yieldBonus` is an
// additive chance of an extra unit; `level` is the skill level needed to USE the tier.
export const TIERS = Object.freeze([
  { id: 'clay', name: 'Fired Clay', rank: 0, level: 1, speed: 1.00, yieldBonus: 0.00, scrapValue: 1 },
  { id: 'copper', name: 'Copper', rank: 1, level: 5, speed: 1.15, yieldBonus: 0.02, scrapValue: 4 },
  { id: 'bronze', name: 'Bronze', rank: 2, level: 15, speed: 1.35, yieldBonus: 0.05, scrapValue: 10 },
  { id: 'iron', name: 'Iron', rank: 3, level: 30, speed: 1.60, yieldBonus: 0.08, scrapValue: 22 },
  { id: 'steel', name: 'Steel', rank: 4, level: 45, speed: 1.90, yieldBonus: 0.12, scrapValue: 48 },
  { id: 'electrum', name: 'Electrum', rank: 5, level: 60, speed: 2.25, yieldBonus: 0.17, scrapValue: 105 },
  { id: 'orichalcum', name: 'Orichalcum', rank: 6, level: 75, speed: 2.70, yieldBonus: 0.23, scrapValue: 240 },
  { id: 'star_iron', name: 'Star-Iron', rank: 7, level: 90, speed: 3.25, yieldBonus: 0.30, scrapValue: 560 },
]);
const TIER_BY_ID = Object.fromEntries(TIERS.map((t) => [t.id, t]));

// The metal bar each tier is forged from. Fired Clay is shaped, not forged, hence its own material.
const TIER_STOCK = Object.freeze({
  clay: 'clay_block', copper: 'copper_bar', bronze: 'bronze_bar', iron: 'iron_bar',
  steel: 'steel_bar', electrum: 'electrum_bar', orichalcum: 'orichalcum_bar', star_iron: 'star_iron_bar',
});

// ── Tools ────────────────────────────────────────────────────────────────────────────────────────
// `stock` = units of tier material per tool; `parts` = extra non-tier materials; `durability` = base
// uses before the tool wears out (scaled by tier rank); `tiers` limits which tiers can exist where a
// full ladder makes no sense (a watering can is not forged from star-iron).
export const TOOLS = Object.freeze([
  { id: 'spade', name: 'Spade', skill: 'cultivation', actions: ['dig', 'clear_plot'], stock: 2, parts: ['timber'], durability: 120 },
  { id: 'rake', name: 'Rake', skill: 'cultivation', actions: ['clear_weeds'], stock: 2, parts: ['timber'], durability: 140 },
  { id: 'dibber', name: 'Seed Dibber', skill: 'cultivation', actions: ['sow'], stock: 1, parts: ['timber'], durability: 200 },
  { id: 'secateurs', name: 'Secateurs', skill: 'cultivation', actions: ['prune', 'take_cutting'], stock: 2, parts: [], durability: 90 },
  { id: 'sickle', name: 'Sickle', skill: 'cultivation', actions: ['reap'], stock: 2, parts: ['timber'], durability: 110 },
  { id: 'watering_can', name: 'Watering Can', skill: 'cultivation', actions: ['water'], stock: 3, parts: [], durability: 160, tiers: ['clay', 'copper', 'bronze', 'iron'] },
  { id: 'shears', name: 'Shears', skill: 'foraging', actions: ['shear', 'gather_herb'], stock: 2, parts: [], durability: 100 },
  { id: 'hatchet', name: 'Hatchet', skill: 'woodcutting', actions: ['fell', 'section_timber'], stock: 3, parts: ['timber'], durability: 130 },
  { id: 'pruning_saw', name: 'Pruning Saw', skill: 'woodcutting', actions: ['saw'], stock: 2, parts: ['timber'], durability: 115 },
  { id: 'pickaxe', name: 'Pickaxe', skill: 'mining', actions: ['mine_ore', 'quarry'], stock: 3, parts: ['timber'], durability: 125 },
  { id: 'chisel', name: 'Chisel', skill: 'crafting', actions: ['cut_stone', 'cut_gem'], stock: 1, parts: [], durability: 150 },
  { id: 'hammer', name: 'Hammer', skill: 'smithing', actions: ['forge', 'rivet'], stock: 3, parts: ['timber'], durability: 180 },
  { id: 'tongs', name: 'Tongs', skill: 'smithing', actions: ['smelt'], stock: 2, parts: [], durability: 220 },
  { id: 'net', name: 'Hand Net', skill: 'fishing', actions: ['net_fish'], stock: 1, parts: ['cordage'], durability: 80, tiers: ['clay', 'copper', 'bronze', 'iron', 'steel'] },
  { id: 'harpoon', name: 'Harpoon', skill: 'fishing', actions: ['spear_fish'], stock: 2, parts: ['timber'], durability: 95 },
  { id: 'needle', name: 'Needle', skill: 'textiles', actions: ['stitch'], stock: 1, parts: [], durability: 140 },
  { id: 'spindle', name: 'Spindle', skill: 'textiles', actions: ['spin'], stock: 1, parts: ['timber'], durability: 170 },
  { id: 'mortar', name: 'Pestle and Mortar', skill: 'apothecary', actions: ['grind'], stock: 2, parts: [], durability: 200, tiers: ['clay', 'copper', 'bronze', 'iron', 'electrum'] },
  { id: 'alembic', name: 'Alembic', skill: 'apothecary', actions: ['distil', 'extract_oil'], stock: 4, parts: ['glass'], durability: 90, tiers: ['clay', 'copper', 'bronze', 'electrum', 'orichalcum'] },
  { id: 'quern', name: 'Quern', skill: 'cooking', actions: ['mill'], stock: 4, parts: [], durability: 240, tiers: ['clay', 'copper', 'bronze', 'iron'] },
  { id: 'cauldron', name: 'Cauldron', skill: 'cooking', actions: ['brew', 'boil'], stock: 4, parts: [], durability: 210, tiers: ['clay', 'copper', 'bronze', 'iron', 'steel'] },
]);
const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

// ── Lookups ──────────────────────────────────────────────────────────────────────────────────────
export const tierById = (v) => TIER_BY_ID[id(v)] || null;
export const toolById = (v) => TOOL_BY_ID[id(v)] || null;

export function toolsForSkill(skill) {
  const s = id(skill);
  return SKILL_IDS.has(s) ? TOOLS.filter((t) => t.skill === s) : [];
}

export function toolsForAction(action) {
  const a = id(action);
  return a ? TOOLS.filter((t) => t.actions.includes(a)) : [];
}

// Which tiers a given tool can exist in (the full ladder unless the tool restricts it).
export function tiersForTool(toolId) {
  const tool = toolById(toolId);
  if (!tool) return [];
  return tool.tiers ? TIERS.filter((t) => tool.tiers.includes(t.id)) : TIERS.slice();
}

export const variantId = (toolId, tierId) => {
  const tool = toolById(toolId);
  const tier = tierById(tierId);
  return tool && tier ? `${tier.id}_${tool.id}` : '';
};

// ── Multipliers ──────────────────────────────────────────────────────────────────────────────────
export function speedMultiplier(tierId) {
  const t = tierById(tierId);
  return t ? t.speed : 1;
}

export function yieldBonus(tierId) {
  const t = tierById(tierId);
  return t ? t.yieldBonus : 0;
}

// ── Variants (the catalog rows that become NFTs) ──────────────────────────────────────────────────
// A variant is one concrete, ownable item: this tool, in this material. Durability scales with tier
// so a better tool is both faster and longer-lived — the reason a player upgrades rather than
// hoarding the cheap one.
export function variant(toolId, tierId) {
  const tool = toolById(toolId);
  const tier = tierById(tierId);
  if (!tool || !tier) return null;
  if (tool.tiers && !tool.tiers.includes(tier.id)) return null;
  return {
    id: `${tier.id}_${tool.id}`,
    name: `${tier.name} ${tool.name}`,
    toolId: tool.id,
    tierId: tier.id,
    skill: tool.skill,
    actions: tool.actions.slice(),
    level: tier.level,
    speed: tier.speed,
    yieldBonus: tier.yieldBonus,
    durability: Math.round(tool.durability * (1 + tier.rank * 0.25)),
    rank: tier.rank,
  };
}

export function allVariants() {
  const out = [];
  for (const tool of TOOLS) for (const tier of tiersForTool(tool.id)) out.push(variant(tool.id, tier.id));
  return out.filter(Boolean);
}

const VARIANT_BY_ID = Object.fromEntries(allVariants().map((v) => [v.id, v]));
export const variantById = (v) => VARIANT_BY_ID[id(v)] || null;

// ── Use gate ─────────────────────────────────────────────────────────────────────────────────────
// canUse(variant, skillLevels) → whether the holder's level in the tool's skill meets the tier gate.
// Accepts a variant object or an id; a missing skill level reads as 1 (a new account), never a throw.
export function canUse(variantOrId, skillLevels = {}) {
  const v = typeof variantOrId === 'string' ? variantById(variantOrId) : variantOrId;
  if (!v || !v.skill) return false;
  const have = Math.max(1, Math.trunc(num(skillLevels && skillLevels[v.skill], 1)));
  return have >= num(v.level, 1);
}

// bestUsable(action, ownedIds, skillLevels) → the highest-rank owned variant that performs `action`
// and that the holder is actually allowed to use. Null when they own nothing that qualifies.
export function bestUsable(action, ownedIds = [], skillLevels = {}) {
  const a = id(action);
  if (!a) return null;
  const owned = Array.isArray(ownedIds) ? ownedIds : [];
  let best = null;
  for (const oid of owned) {
    const v = variantById(oid);
    if (!v || !v.actions.includes(a) || !canUse(v, skillLevels)) continue;
    if (!best || v.rank > best.rank) best = v;
  }
  return best;
}

// ── Manufacture ──────────────────────────────────────────────────────────────────────────────────
// manufactureRecipe(toolId, tierId) → what it takes to MAKE the tool in-game. This is the second
// mint path in item-nft.mjs: a variant first sold to bootstrap the economy can later be produced by
// a player who has the smithing level, the station and the materials.
export function manufactureRecipe(toolId, tierId) {
  const tool = toolById(toolId);
  const tier = tierById(tierId);
  if (!tool || !tier) return null;
  if (tool.tiers && !tool.tiers.includes(tier.id)) return null;
  const materials = { [TIER_STOCK[tier.id]]: tool.stock };
  for (const p of tool.parts) materials[p] = (materials[p] || 0) + 1;
  return {
    variantId: `${tier.id}_${tool.id}`,
    station: tier.id === 'clay' ? 'kiln' : 'forge',
    skill: 'smithing',
    level: tier.level,
    materials,
    // Scrap value of the inputs — the floor a sane sale price has to clear, and the refund on melt.
    scrapValue: tier.scrapValue * tool.stock,
  };
}

export default {
  SKILLS, TIERS, TOOLS,
  tierById, toolById, toolsForSkill, toolsForAction, tiersForTool,
  variant, variantId, variantById, allVariants,
  speedMultiplier, yieldBonus, canUse, bestUsable, manufactureRecipe, esc,
};
