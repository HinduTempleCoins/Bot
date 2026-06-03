// economy.mjs — the SHARED game economy primitive (queue #187). ONE uniform loop that every
// sub-game reuses, so a player learns the loop ONCE and it works in every sub-game:
//
//   acquire → listForSale → sell → (new owner) → acquire ... — the same four verbs, everywhere.
//
// The HUD is just the owned-asset roster (ownedBy) — your assets ARE the doorways into a sub-game.
// Buy an asset on-chain and it unlocks on your profile; list it, someone buys it, ownership moves.
//
// PURE logic, no network. Broadcast / payment settlement live elsewhere (a sub-game wires this to
// MELEK-Signer); here we only model the lifecycle over an injectable in-memory store so the rules
// can be unit-tested offline and reused identically by Chess, Cards, Dungeon, whatever.
//
//   import { RARITY, rarityWeight, createAsset, acquire, listForSale, sell, ownedBy, createStore } from './economy.mjs'
//   node integrations/games/economy.mjs            # print the rarity ladder

// ---- RARITY ladder: Common → Legendary, weights are drop-likelihood (higher = more common) ----
export const RARITY = Object.freeze({
  COMMON: 'Common',
  UNCOMMON: 'Uncommon',
  RARE: 'Rare',
  EPIC: 'Epic',
  LEGENDARY: 'Legendary',
});

// ordered rarest-to-most-common reflected by weight: Common most likely, Legendary least.
const WEIGHTS = Object.freeze({
  [RARITY.COMMON]: 100,
  [RARITY.UNCOMMON]: 40,
  [RARITY.RARE]: 15,
  [RARITY.EPIC]: 5,
  [RARITY.LEGENDARY]: 1,
});

// drop weight for a rarity tier (0 for anything unknown).
export function rarityWeight(r) {
  return WEIGHTS[r] || 0;
}

// the ladder rarest-last, for HUD / drop-table rendering.
export const RARITY_LADDER = Object.freeze([
  RARITY.COMMON, RARITY.UNCOMMON, RARITY.RARE, RARITY.EPIC, RARITY.LEGENDARY,
]);

// ---- injectable in-memory store ----
// shape: { assets: Map<id, asset> }. Pass your own for isolation; default makes a fresh one.
export function createStore() {
  return { assets: new Map() };
}
const _default = createStore();

// asset = { id, type, rarity, ownerId, listed, price }
let _seq = 0;
function nextId() { return `asset_${Date.now().toString(36)}_${(++_seq).toString(36)}`; }

// createAsset — mint an unowned, unlisted asset. ownerId null until acquired.
export function createAsset({ id, type, rarity, ownerId = null } = {}) {
  if (!type) throw new Error('createAsset: type is required');
  if (!(rarity in WEIGHTS)) throw new Error(`createAsset: unknown rarity "${rarity}"`);
  return {
    id: id || nextId(),
    type,
    rarity,
    ownerId,
    listed: false,
    price: 0,
  };
}

function get(store, assetId) {
  const a = store.assets.get(assetId);
  if (!a) throw new Error(`unknown asset "${assetId}"`);
  return a;
}

// acquire(asset, owner) — buy on-chain → unlocks on profile. Records the asset in the store
// under the new owner, unlisted. Accepts an asset object or an existing asset id.
export function acquire(asset, ownerId, store = _default) {
  if (!ownerId) throw new Error('acquire: ownerId is required');
  let a = typeof asset === 'string' ? get(store, asset) : asset;
  if (!store.assets.has(a.id)) store.assets.set(a.id, a);
  a.ownerId = ownerId;
  a.listed = false;
  a.price = 0;
  return a;
}

// listForSale(asset, price) — put an owned asset on the market.
export function listForSale(asset, price, store = _default) {
  const a = typeof asset === 'string' ? get(store, asset) : get(store, asset.id);
  if (!a.ownerId) throw new Error(`cannot list unowned asset "${a.id}"`);
  if (!(price > 0)) throw new Error('listForSale: price must be > 0');
  a.listed = true;
  a.price = price;
  return a;
}

// sell(asset, buyer) — transfer a listed asset to the buyer, clearing the listing.
export function sell(asset, buyerId, store = _default) {
  if (!buyerId) throw new Error('sell: buyerId is required');
  const a = typeof asset === 'string' ? get(store, asset) : get(store, asset.id);
  if (!a.ownerId) throw new Error(`cannot sell unowned asset "${a.id}"`);
  if (!a.listed) throw new Error(`asset "${a.id}" is not listed for sale`);
  a.ownerId = buyerId;
  a.listed = false;
  a.price = 0;
  return a;
}

// ownedBy(owner) — the owned-asset roster = the HUD = the doorways into the sub-games.
export function ownedBy(ownerId, store = _default) {
  return [...store.assets.values()].filter((a) => a.ownerId === ownerId);
}

// ---- CLI: print the rarity ladder ----
if (process.argv[1] && process.argv[1].endsWith('economy.mjs')) {
  console.log('Rarity ladder (weight = drop likelihood):');
  for (const r of RARITY_LADDER) {
    console.log(`  ${r.padEnd(10)} weight ${rarityWeight(r)}`);
  }
}
