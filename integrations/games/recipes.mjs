// recipes.mjs — the multi-directional recipe web (queue #192). PURE graph logic, no network.
//
// THE RECIPE GRAPH *IS* THE ECONOMY. Items are not siloed per-game: a recipe can take inputs
// minted by Game A and produce an output spendable in Game B, so value flows in ANY direction
// across the web of games. There is no central "shop" — crafting is the only mint, and every
// craft both creates and DESTROYS. Consumables are the deflation valve: when an item is consumed
// (eaten, burned, spent) it is removed from circulation entirely. That self-draining sink is the
// built-in deflation that keeps the graph from inflating to zero value. No external faucet, no
// money printer — just the graph eating its own tail at a controlled rate.
//
// A recipe is LEARNED by redeeming a recipe-NFT: unlock the recipe → set a permanent account flag
// → the NFT is BURNED (one-time consumable knowledge token). Once learned it cannot be un-learned
// and the NFT cannot be reused — the knowledge is now part of the account, not a tradeable asset.
//
//   import { RECIPES, canCraft, craft, learnRecipe, consume, validateNoMoneyPump } from './recipes.mjs'
//   node integrations/games/recipes.mjs            # print the recipe web + economy audit
//
// Shapes:
//   Recipe    = { id, inputs: [{ item, qty }], output: { item, qty }, station, effort? }
//   Inventory = { [item]: qty }                    // plain map of item -> count
//   User      = { learned: Set<recipeId>, burnedNfts: Set<nftId>, ... }

// ---- the recipe web. Items deliberately cross "stations" (read: games). ----
export const RECIPES = [
  {
    id: 'smelt-ingot',
    inputs: [{ item: 'ore', qty: 3 }, { item: 'coal', qty: 1 }],
    output: { item: 'ingot', qty: 1 },
    station: 'forge',
    effort: 2,
  },
  {
    id: 'forge-blade',
    inputs: [{ item: 'ingot', qty: 2 }, { item: 'hilt', qty: 1 }],
    output: { item: 'blade', qty: 1 },
    station: 'forge',
    effort: 3,
  },
  {
    id: 'brew-potion',
    // herb comes from the garden game; vial from the glassworks game — multi-directional.
    inputs: [{ item: 'herb', qty: 4 }, { item: 'vial', qty: 1 }, { item: 'spark', qty: 1 }],
    output: { item: 'potion', qty: 1 },
    station: 'alchemy',
    effort: 2,
  },
  {
    id: 'bake-bread',
    inputs: [{ item: 'grain', qty: 5 }, { item: 'water', qty: 2 }],
    output: { item: 'bread', qty: 2 },
    station: 'kitchen',
    effort: 1,
  },
];

// ---- item value table (abstract "worth" units). Used only by the money-pump auditor. ----
// Outputs are worth strictly more than their parts ONLY up to the labor (effort) the craft costs;
// the graph must never let you craft your way to free value.
export const ITEM_VALUE = {
  ore: 1, coal: 2, ingot: 6, hilt: 4, blade: 18,
  herb: 1, vial: 3, spark: 2, potion: 11,
  grain: 1, water: 1, bread: 4,
};

const EFFORT_VALUE = 1; // worth of one unit of effort, in the same abstract units

function inventoryHas(inventory, item, qty) {
  return (inventory[item] || 0) >= qty;
}

// canCraft — true iff inventory holds every input in sufficient quantity. PURE (no mutation).
export function canCraft(recipe, inventory = {}) {
  if (!recipe || !Array.isArray(recipe.inputs)) return false;
  return recipe.inputs.every((inp) => inventoryHas(inventory, inp.item, inp.qty));
}

// craft — consume inputs, produce output. Returns a NEW inventory (does not mutate the input map).
// Throws if the recipe can't be crafted, so callers must canCraft() first or catch.
export function craft(recipe, inventory = {}) {
  if (!canCraft(recipe, inventory)) {
    throw new Error(`cannot craft ${recipe && recipe.id}: missing inputs`);
  }
  const next = { ...inventory };
  // consume inputs (these items leave circulation here; the output re-mints fewer/dearer ones)
  for (const inp of recipe.inputs) {
    next[inp.item] = (next[inp.item] || 0) - inp.qty;
    if (next[inp.item] <= 0) delete next[inp.item];
  }
  // produce output
  next[recipe.output.item] = (next[recipe.output.item] || 0) + recipe.output.qty;
  return next;
}

// consume — destroy an item on use (the self-draining sink / built-in deflation).
// Returns a NEW inventory with one unit removed. Throws if the item isn't held.
export function consume(item, inventory = {}, qty = 1) {
  if (!inventoryHas(inventory, item, qty)) {
    throw new Error(`cannot consume ${qty}x ${item}: not in inventory`);
  }
  const next = { ...inventory };
  next[item] -= qty;
  if (next[item] <= 0) delete next[item];
  return next; // the consumed units are gone — not transferred, not refunded. Deflation.
}

// learnRecipe — redeem a recipe-NFT: unlock the recipe on the account (permanent flag) and BURN
// the NFT (mark it spent so it can never be redeemed again). Mutates the user record in place and
// returns it. Throws if the NFT was already burned (double-redeem guard).
export function learnRecipe(user, recipeNftId, nftToRecipe = NFT_RECIPE_MAP) {
  if (!user.learned) user.learned = new Set();
  if (!user.burnedNfts) user.burnedNfts = new Set();
  if (user.burnedNfts.has(recipeNftId)) {
    throw new Error(`recipe-NFT ${recipeNftId} already burned`);
  }
  const recipeId = nftToRecipe[recipeNftId];
  if (!recipeId) throw new Error(`recipe-NFT ${recipeNftId} maps to no known recipe`);
  user.learned.add(recipeId); // permanent account flag — cannot be un-learned
  user.burnedNfts.add(recipeNftId); // NFT consumed: one-time knowledge token
  return user;
}

// Which recipe each recipe-NFT teaches. (In production this lives on-chain in the NFT metadata.)
export const NFT_RECIPE_MAP = {
  'nft-001': 'smelt-ingot',
  'nft-002': 'forge-blade',
  'nft-003': 'brew-potion',
  'nft-004': 'bake-bread',
};

// validateNoMoneyPump — PURE economic safety check over a set of recipes. A recipe is a "money
// pump" if its output is worth MORE than its inputs plus the effort it took (i.e. you'd profit in
// pure value by crafting in a loop, with no sink to pay for it). The graph IS the economy, so a
// single value-positive recipe lets players print value forever. We assert: outputValue <=
// inputValue + effort*EFFORT_VALUE for every recipe. Returns { ok, offenders:[{id, ...}] }.
export function validateNoMoneyPump(recipes = RECIPES, values = ITEM_VALUE) {
  const offenders = [];
  for (const r of recipes) {
    const inputValue = r.inputs.reduce((s, inp) => s + (values[inp.item] || 0) * inp.qty, 0);
    const outputValue = (values[r.output.item] || 0) * r.output.qty;
    const effort = (r.effort || 0) * EFFORT_VALUE;
    const ceiling = inputValue + effort;
    if (outputValue > ceiling) {
      offenders.push({ id: r.id, inputValue, effort, outputValue, ceiling, surplus: outputValue - ceiling });
    }
  }
  return { ok: offenders.length === 0, offenders };
}

// ---- CLI: print the recipe web + run the economy audit ----
if (process.argv[1] && process.argv[1].endsWith('recipes.mjs')) {
  console.log('Recipe web (the graph IS the economy):\n' + '─'.repeat(60));
  for (const r of RECIPES) {
    const ins = r.inputs.map((i) => `${i.qty}x ${i.item}`).join(' + ');
    console.log(`  [${r.station.padEnd(8)}] ${ins}  →  ${r.output.qty}x ${r.output.item}  (effort ${r.effort || 0})`);
  }
  const audit = validateNoMoneyPump();
  console.log('\nMoney-pump audit:', audit.ok ? 'OK — no recipe prints value' : 'FAILED');
  for (const o of audit.offenders) {
    console.log(`  ! ${o.id}: out ${o.outputValue} > in ${o.inputValue} + effort ${o.effort} (surplus ${o.surplus})`);
  }
  console.log('\nConsumables = built-in deflation: every consume() removes units permanently.');
}
