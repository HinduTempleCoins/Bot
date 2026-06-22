// seed-tokens.mjs — the bridge between the Kush Farm grow game and the token layer.
//
// SEEDS ARE TOKENS. Operator's model (2026-06-22): a Seed is a PRANA token that **mints through
// MELEK-Engine** (the Hive-Engine-style side-token layer) — so a player's Seeds show up as engine token
// balances, and the Seeds page (seeds.soapbox.community) is a tokens.melek.salon-style WALLET view
// filtered to just these. This module is the canonical map: each Kush Farm strain → its engine token SYMBOL
// (A-Z, ≤10 chars, the engine's SYMBOL_RE), enriched with the grow metadata (tier/season/rarity/flags).
//
// Minting path (for the issuance flow, wired later): MELEK-Engine `tokens.create` once per seed symbol, then
// `tokens.issue` to the grower on harvest/seed-return. This module names the symbols; it signs nothing.
//
// House style: ESM, pure, soft-fail, env-overridable. No chain calls here.

import { STRAINS, getStrain, TIERS } from './kush-farm.mjs';

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
    out.push({
      id: s.id, symbol: sym, name: s.name,
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

/** Filter a list of engine balances ({symbol,balance,stake}) down to just the seed tokens, enriched. */
export function filterSeedBalances(balances = []) {
  const cat = new Map(seedCatalog().map((s) => [s.symbol, s]));
  const out = [];
  for (const b of Array.isArray(balances) ? balances : []) {
    const sym = String(b.symbol || '').toUpperCase();
    const seed = cat.get(sym);
    if (!seed) continue;
    out.push({
      ...seed,
      liquid: String(b.balance ?? b.liquid ?? '0'),
      staked: String(b.stake ?? b.staked ?? '0'),
    });
  }
  return out;
}

export { getStrain };
