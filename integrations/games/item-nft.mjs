// item-nft.mjs — the supply and mint policy that turns a catalog item into an ownable NFT.
//
// PURE + DETERMINISTIC: state in → new state out. No network, no clock, no disk, no keys, no
// broadcast. Soft-fail-never-throw: an illegal action returns `{ ok:false, reason }`, never an
// exception. THIS MODULE MINTS NOTHING ON CHAIN — it decides what is *allowed*, and the actual
// transfer/mint is a Signer-broadcast op that lives out of scope of this repo.
//
// ── The economy this encodes ─────────────────────────────────────────────────────────────────────
//   Two mint paths for one item, sharing ONE hard supply cap:
//
//     1. SALE — a bootstrap allocation sold directly, so there is something to own and trade before
//        anybody has the skills or materials to make one. This is what gets players started and what
//        seeds the secondary market.
//     2. MANUFACTURE — the in-game path. A player with the skill level, the station and the
//        materials makes the item, and that act mints it.
//
//   The cap is shared on purpose. If the sale could print without bound, manufacturing would be
//   pointless and the crafting skills would be decorative; if manufacture ignored the sale, early
//   buyers would be diluted. So the two paths draw from one number, and the sale is deliberately
//   allocated a MINORITY slice (default 25%) — enough to bootstrap, not enough to be the economy.
//   The remaining supply can only ever come out of the ground and through a forge.
//
//   Every mint records its origin, so provenance is answerable forever: this one was sold in the
//   bootstrap, that one was made by a player.
//
// ── Exports ──────────────────────────────────────────────────────────────────────────────────────
//   PHASES, DEFAULT_POLICY
//   policyFor(variantId, overrides) / metadataFor(variantId)
//   salePrice(variantId, policy)
//   emptyLedger() / supplyOf(ledger, variantId) / remaining(ledger, variantId, policy)
//   canBuy(ledger, variantId, qty, policy) / recordSale(ledger, variantId, qty, buyer, policy)
//   canManufacture(ledger, variantId, ctx, policy) / recordManufacture(ledger, variantId, maker, policy)
//   phaseOf(ledger, variantId, policy)

import { variantById, manufactureRecipe, esc } from './tools-catalog.mjs';

export { esc };

export const PHASES = Object.freeze(['sale', 'manufacture', 'closed']);

export const DEFAULT_POLICY = Object.freeze({
  // Cap for a rank-0 item. Higher ranks are scarcer — see capFor().
  baseCap: 2000,
  // Share of the cap reservable for the bootstrap sale. A minority by design (see the note above).
  salePortion: 0.25,
  // Bootstrap sale price = scrapValue x premium. The premium is what pays for the item existing
  // before anyone can make one; it must stay above scrap or the sale is a melt-for-profit faucet.
  salePremium: 2.5,
  // Whether manufacture is open yet. Sale can run alone; manufacture opening never closes the sale.
  manufactureOpen: true,
});

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

const clampInt = (v, min, max) => {
  const n = Math.trunc(num(v, min));
  return Math.max(min, Math.min(max, n));
};

function mergePolicy(overrides) {
  const p = { ...DEFAULT_POLICY, ...(overrides && typeof overrides === 'object' ? overrides : {}) };
  p.baseCap = Math.max(1, Math.trunc(num(p.baseCap, DEFAULT_POLICY.baseCap)));
  p.salePortion = Math.max(0, Math.min(1, num(p.salePortion, DEFAULT_POLICY.salePortion)));
  p.salePremium = Math.max(1, num(p.salePremium, DEFAULT_POLICY.salePremium));
  p.manufactureOpen = !!p.manufactureOpen;
  return p;
}

// Scarcity curve: each tier rank halves the cap, so a Star-Iron tool is genuinely rare while an
// entry-tier one is common enough to actually onboard people.
function capFor(v, policy) {
  return Math.max(1, Math.round(policy.baseCap / (2 ** Math.max(0, num(v.rank, 0)))));
}

// policyFor(variantId, overrides) → the concrete numbers for one item, or null if it is not a real
// catalog entry. This is the single place supply questions get answered from.
export function policyFor(variantId, overrides) {
  const v = variantById(variantId);
  if (!v) return null;
  const p = mergePolicy(overrides);
  const cap = capFor(v, p);
  const saleAllocation = Math.min(cap, Math.floor(cap * p.salePortion));
  return {
    variantId: v.id,
    cap,
    saleAllocation,
    manufactureAllocation: cap - saleAllocation,
    salePremium: p.salePremium,
    manufactureOpen: p.manufactureOpen,
  };
}

// metadataFor(variantId) → the NFT metadata shape. Attributes are the same numbers the game already
// runs on, so the token is a description of the item rather than a parallel invention.
export function metadataFor(variantId) {
  const v = variantById(variantId);
  if (!v) return null;
  const recipe = manufactureRecipe(v.toolId, v.tierId);
  return {
    id: v.id,
    name: v.name,
    collection: 'Botanica Implements',
    description: `A ${v.name.toLowerCase()} for ${v.skill}. Usable at ${v.skill} level ${v.level}.`,
    attributes: [
      { trait_type: 'Tool', value: v.toolId },
      { trait_type: 'Material', value: v.tierId },
      { trait_type: 'Skill', value: v.skill },
      { trait_type: 'Level', value: v.level },
      { trait_type: 'Speed', value: v.speed },
      { trait_type: 'Durability', value: v.durability },
      { trait_type: 'Rank', value: v.rank },
    ],
    actions: v.actions.slice(),
    recipe,
  };
}

// salePrice(variantId, policy) → the bootstrap sale price in token units, floored above scrap so the
// sale can never be melted back down at a profit.
export function salePrice(variantId, overrides) {
  const v = variantById(variantId);
  if (!v) return 0;
  const p = mergePolicy(overrides);
  const recipe = manufactureRecipe(v.toolId, v.tierId);
  const scrap = recipe ? num(recipe.scrapValue, 1) : 1;
  return Math.max(1, Math.round(scrap * p.salePremium));
}

// ── Ledger ───────────────────────────────────────────────────────────────────────────────────────
// The ledger is a plain, serialisable object: { [variantId]: { sale, manufacture, mints: [...] } }.
// Every function below treats it as immutable and returns a new one.
export const emptyLedger = () => ({});

function entry(ledger, variantId) {
  const e = ledger && ledger[variantId];
  return {
    sale: Math.max(0, Math.trunc(num(e && e.sale, 0))),
    manufacture: Math.max(0, Math.trunc(num(e && e.manufacture, 0))),
    mints: Array.isArray(e && e.mints) ? e.mints : [],
  };
}

export function supplyOf(ledger, variantId) {
  const e = entry(ledger, String(variantId || ''));
  return { sale: e.sale, manufacture: e.manufacture, total: e.sale + e.manufacture };
}

// remaining(ledger, variantId, policy) → what is left, per path and overall. The overall figure is
// authoritative: a path can never mint into another path's headroom past the shared cap.
export function remaining(ledger, variantId, overrides) {
  const p = policyFor(variantId, overrides);
  if (!p) return null;
  const s = supplyOf(ledger, p.variantId);
  const total = Math.max(0, p.cap - s.total);
  return {
    total,
    sale: Math.min(total, Math.max(0, p.saleAllocation - s.sale)),
    manufacture: Math.min(total, Math.max(0, p.manufactureAllocation - s.manufacture)),
  };
}

// phaseOf(ledger, variantId, policy) → which path can still mint right now.
export function phaseOf(ledger, variantId, overrides) {
  const p = policyFor(variantId, overrides);
  if (!p) return 'closed';
  const left = remaining(ledger, p.variantId, overrides);
  if (left.total <= 0) return 'closed';
  if (left.sale > 0) return 'sale';
  return p.manufactureOpen && left.manufacture > 0 ? 'manufacture' : 'closed';
}

// ── Sale path ────────────────────────────────────────────────────────────────────────────────────
export function canBuy(ledger, variantId, qty = 1, overrides) {
  const p = policyFor(variantId, overrides);
  if (!p) return { ok: false, reason: 'unknown_item' };
  const want = clampInt(qty, 0, p.cap);
  if (want <= 0) return { ok: false, reason: 'bad_quantity' };
  const left = remaining(ledger, p.variantId, overrides);
  if (left.total <= 0) return { ok: false, reason: 'sold_out' };
  if (left.sale < want) return { ok: false, reason: 'sale_allocation_exhausted', available: left.sale };
  return { ok: true, qty: want, unitPrice: salePrice(p.variantId, overrides), remaining: left.sale - want };
}

export function recordSale(ledger, variantId, qty = 1, buyer = '', overrides) {
  const check = canBuy(ledger, variantId, qty, overrides);
  if (!check.ok) return { ok: false, reason: check.reason, ledger: ledger || emptyLedger() };
  const vid = policyFor(variantId, overrides).variantId;
  const e = entry(ledger, vid);
  const mints = e.mints.concat(
    Array.from({ length: check.qty }, () => ({ origin: 'sale', owner: String(buyer || '').slice(0, 64) })),
  );
  return {
    ok: true,
    qty: check.qty,
    unitPrice: check.unitPrice,
    total: check.unitPrice * check.qty,
    ledger: { ...(ledger || {}), [vid]: { sale: e.sale + check.qty, manufacture: e.manufacture, mints } },
  };
}

// ── Manufacture path ─────────────────────────────────────────────────────────────────────────────
// canManufacture(ledger, variantId, { inventory, skills, station }, policy)
// Checks, in order: the item is real; manufacture is open; supply is left; the maker is at the
// right station; the maker has the skill level; the maker has every material.
export function canManufacture(ledger, variantId, ctx = {}, overrides) {
  const p = policyFor(variantId, overrides);
  if (!p) return { ok: false, reason: 'unknown_item' };
  if (!p.manufactureOpen) return { ok: false, reason: 'manufacture_closed' };

  const left = remaining(ledger, p.variantId, overrides);
  if (left.total <= 0) return { ok: false, reason: 'sold_out' };
  if (left.manufacture <= 0) return { ok: false, reason: 'manufacture_allocation_exhausted' };

  const v = variantById(p.variantId);
  const recipe = manufactureRecipe(v.toolId, v.tierId);
  if (!recipe) return { ok: false, reason: 'no_recipe' };

  const station = String((ctx && ctx.station) || '').trim().toLowerCase();
  if (station !== recipe.station) return { ok: false, reason: 'wrong_station', need: recipe.station };

  const skills = (ctx && ctx.skills) || {};
  const have = Math.max(1, Math.trunc(num(skills[recipe.skill], 1)));
  if (have < recipe.level) {
    return { ok: false, reason: 'level_too_low', need: recipe.level, skill: recipe.skill, have };
  }

  const inv = (ctx && ctx.inventory) || {};
  const missing = {};
  for (const [mat, need] of Object.entries(recipe.materials)) {
    const held = Math.max(0, Math.trunc(num(inv[mat], 0)));
    if (held < need) missing[mat] = need - held;
  }
  if (Object.keys(missing).length) return { ok: false, reason: 'missing_materials', missing };

  return { ok: true, recipe, remaining: left.manufacture - 1 };
}

// recordManufacture → consumes the materials and mints one. Returns the new ledger AND the new
// inventory, so the caller cannot accidentally mint without paying for it.
export function recordManufacture(ledger, variantId, maker = '', ctx = {}, overrides) {
  const check = canManufacture(ledger, variantId, ctx, overrides);
  if (!check.ok) {
    return { ok: false, reason: check.reason, ledger: ledger || emptyLedger(), inventory: (ctx && ctx.inventory) || {} };
  }
  const vid = policyFor(variantId, overrides).variantId;
  const e = entry(ledger, vid);
  const inv = { ...((ctx && ctx.inventory) || {}) };
  for (const [mat, need] of Object.entries(check.recipe.materials)) {
    inv[mat] = Math.max(0, Math.trunc(num(inv[mat], 0)) - need);
    if (inv[mat] === 0) delete inv[mat];
  }
  const mints = e.mints.concat([{ origin: 'manufacture', owner: String(maker || '').slice(0, 64) }]);
  return {
    ok: true,
    variantId: vid,
    ledger: { ...(ledger || {}), [vid]: { sale: e.sale, manufacture: e.manufacture + 1, mints } },
    inventory: inv,
  };
}

export default {
  PHASES, DEFAULT_POLICY,
  policyFor, metadataFor, salePrice,
  emptyLedger, supplyOf, remaining, phaseOf,
  canBuy, recordSale, canManufacture, recordManufacture, esc,
};
