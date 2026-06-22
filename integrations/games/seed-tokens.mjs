// seed-tokens.mjs — the bridge between the Kush Farm grow game and the token layer.
//
// SEEDS MINT THROUGH MELEK-Engine, and a seed is one of TWO kinds (operator 2026-06-22: "some won't be NFTs
// and some will — some we'll have just trade like tokens and plant (burn) like seeds"):
//   • kind 'token' — a FUNGIBLE engine token. The abundant ones (the daily "milk" you carpet landscapes
//     with): trade them on the market, plant = BURN them. Volume, not scarcity.
//   • kind 'nft'   — a semi-fungible NFT (ERC-1155, the SeasonalFarm standard): scarce, collectable, carries
//     traits. The rare/legendary strains. You own editions; planting still burns.
// Default kind follows rarity (common/uncommon → token, rare/legendary → nft); override per strain with
// SEED_KINDS_JSON. EITHER way a seed has a SYMBOL/token-id (A-Z, ≤10, the engine SYMBOL_RE) + grow traits, so
// the Seeds page (seeds.soapbox.community) is a tokens.melek.salon-style WALLET showing which seeds you hold —
// both the fungible balances and the NFT collection — filtered to just seeds.
//
// This module names the types/kinds/traits; it signs nothing. (Minting + the plant=burn op are wired later.)
//
// House style: ESM, pure, soft-fail, env-overridable. No chain calls here.

import { STRAINS, getStrain, TIERS } from './kush-farm.mjs';

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';

// The collection NFT-kind seeds live under (env-overridable). Fungible-kind seeds are plain engine tokens.
export const SEED_COLLECTION = env('SEED_COLLECTION') || 'KUSHSEED';

// Default: scarce strains are NFTs, abundant ones are fungible tokens. Override per strain id via
// SEED_KINDS_JSON, e.g. {"kush-apple":"nft","frost-auto":"token"}.
const NFT_RARITIES = new Set(['rare', 'legendary']);
function kindForStrain(strain) {
  try {
    const o = JSON.parse(env('SEED_KINDS_JSON') || '{}');
    const k = o && o[strain.id];
    if (k === 'token' || k === 'nft') return k;
  } catch { /* fall through */ }
  return NFT_RARITIES.has(strain.rarity) ? 'nft' : 'token';
}

// Canonical strain.id → engine SYMBOL. Kept here (not in the model) so the grow game stays chain-agnostic.
// Override/extend with SEED_SYMBOLS_JSON env (e.g. {"auto-sour":"AUTOSOUR"}). All must match /^[A-Z]{1,10}$/.
const DEFAULT_SYMBOLS = {
  'auto-sour': 'AUTOSOUR',
  'daily-diesel': 'DIESEL',
  'van-kush': 'VANKUSH',
  'kush-og': 'KUSHOG',
  'frost-auto': 'FROSTAUTO',
  'spring-bloom': 'BLOOM',
  'wild-ditchweed': 'DITCHWEED',
  'kush-apple': 'KUSHAPPLE',
  'harvest-haze': 'HAZE',
  'punic-gold': 'PUNICGOLD',
  'heirloom-melek': 'HEIRLOOM',
};

const SYMBOL_RE = /^[A-Z]{1,10}$/;

function envOverrides() {
  try {
    const raw = (typeof process !== 'undefined' && process.env && process.env.SEED_SYMBOLS_JSON) || '';
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

/** Build the seed-token catalog: every strain that has a valid engine symbol, enriched for display. */
export function seedCatalog() {
  const over = envOverrides();
  const out = [];
  for (const s of STRAINS) {
    const sym = String(over[s.id] || DEFAULT_SYMBOLS[s.id] || '').toUpperCase();
    if (!SYMBOL_RE.test(sym)) continue;            // no symbol assigned / invalid → not a tradable seed yet
    const tier = TIERS[s.growTier] || null;
    const kind = kindForStrain(s);
    out.push({
      id: s.id, symbol: sym, tokenId: sym, name: s.name,
      kind, collection: kind === 'nft' ? SEED_COLLECTION : null,
      growTier: s.growTier, tierLabel: tier ? tier.label : s.growTier,
      season: s.season || 'year-round', rarity: s.rarity || 'common',
      multiHarvest: s.multiHarvest || 1, volunteer: !!s.volunteer, flower: !!s.flower, festival: !!s.festival,
      seedReturn: tier ? tier.seedReturn : 0,
    });
  }
  return out;
}

/** The set of seed token symbols (uppercase). */
export function seedSymbols() { return new Set(seedCatalog().map((s) => s.symbol)); }

/** Is `symbol` a Kush Farm seed token? */
export function isSeedSymbol(symbol) { return seedSymbols().has(String(symbol || '').toUpperCase()); }

/** Look up the seed catalog entry for an engine symbol (or null). */
export function seedForSymbol(symbol) {
  const want = String(symbol || '').toUpperCase();
  return seedCatalog().find((s) => s.symbol === want) || null;
}

/** Engine SYMBOL for a strain id (or '' if none / invalid). */
export function symbolForStrain(id) {
  const over = envOverrides();
  const sym = String(over[id] || DEFAULT_SYMBOLS[id] || '').toUpperCase();
  return SYMBOL_RE.test(sym) ? sym : '';
}

/** From a wallet's NFT holdings (engine/1155 balances: {symbol|tokenId, balance|count|qty}), keep just the
 *  seed NFTs the player owns (count > 0), enriched with traits + the owned quantity. Each seed is one NFT
 *  type; `owned` is how many of that type the wallet holds (semi-fungible). Soft-fails to []. */
export function ownedSeeds(holdings = []) {
  const cat = new Map(seedCatalog().map((s) => [s.symbol, s]));
  const seen = new Set();
  const out = [];
  for (const b of Array.isArray(holdings) ? holdings : []) {
    const sym = String(b.symbol || b.tokenId || '').toUpperCase();
    const seed = cat.get(sym);
    if (!seed || seen.has(sym)) continue;        // a seed is exactly one kind — first source wins
    const owned = String(b.balance ?? b.count ?? b.qty ?? b.amount ?? '0');
    if (!(Number(owned) > 0)) continue;          // only what you actually hold
    seen.add(sym);
    out.push({ ...seed, owned });
  }
  return out;
}

export { getStrain };
