// game-console.mjs — the PRANA/MELEK Game Console registry (the "dApp directory" for the hub).
//
// The GTArcade-Hub / Console Overlay design (.local/GTARCADE_HUB_DESIGN.md,
// .local/CONSOLE_OVERLAY_GPU_GAMER.md) needs ONE thing to unify the games: a registry/manifest each
// game declares so the console can list it, launch it, and wire it to the shared identity + market.
// This is that connective tissue, modeled on HOW WAX DOES IT (see WAX_MAPPING):
//
//   WAX Cloud Wallet        → ONE unified MELEK identity/login across every game (no per-game account).
//   AtomicAssets (NFT std)  → ONE shared asset standard (our engine nft.mjs ERC-1155) every game mints to.
//   AtomicHub (marketplace) → ONE shared market spine (KulaSwap) where all game assets trade.
//   dApp directory          → THIS registry: games register a manifest; the console renders the directory.
//   zero-gas UX             → signer-sponsored / L2 so players never hold gas to play.
//
// A game declares its chain, reward token + whether that reward is CASHABLE (real value) or a
// non-cashable PLAY score, its asset standard, and its launch entry. The registry ENFORCES the
// compliance line: a cashable/real-value reward must be flagged and carry a counsel note; everything
// else defaults to the safe non-cashable PLAY lane.
//
// PURE: no network, no I/O. Register() mutates an in-module registry (idempotent by id); everything
// else is read-only. Offline-tested.
//
//   import { registerGame, listGames, getGame, directory, launchDescriptor, WAX_MAPPING } from './games/game-console.mjs'
//   node integrations/games/game-console.mjs      # prints the console directory

// ---------------------------------------------------------------------------
// The unified spine — one identity + one market across every game (the WAX cloud-wallet/AtomicHub idea).
// ---------------------------------------------------------------------------
export const UNIFIED_IDENTITY = {
  provider: 'melek-signer',          // one login (MELEK account) — the WAX Cloud Wallet analog
  card: 'portable-identity',         // cross-surface identity card (avatar + REN + capital + character)
  gasModel: 'signer-sponsored',      // players never hold gas — WAX zero-gas UX analog
};
export const SHARED_MARKET = {
  name: 'KulaSwap',                  // the AtomicHub analog: one marketplace spine for all game assets
  amm: true, auctions: true,         // AMM for fungibles + English/Dutch auctions for scarce NFTs
};
export const ASSET_STANDARDS = ['none', 'erc1155', 'engine-token']; // engine nft.mjs = the AtomicAssets analog
export const CHAINS = ['melek', 'prana'];
export const CATEGORIES = ['move-to-earn', 'farming', 'breeding', 'social', 'arcade', 'strategy', 'collector', 'casino'];

// How WAX does it → what we map each piece onto (documentation the console UI can surface).
export const WAX_MAPPING = {
  'WAX Cloud Wallet': 'UNIFIED_IDENTITY (one MELEK-Signer login across all games)',
  'AtomicAssets (NFT standard)': "engine nft.mjs ERC-1155 — ASSET_STANDARDS 'erc1155'",
  'AtomicHub (marketplace)': 'SHARED_MARKET = KulaSwap (AMM + auctions)',
  'dApp directory': 'this registry — registerGame()/directory()',
  'zero-gas onboarding': 'signer-sponsored gas (UNIFIED_IDENTITY.gasModel)',
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
const REGISTRY = new Map();

function validate(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest must be an object'];
  if (!m.id) errs.push('id required');
  if (!m.name) errs.push('name required');
  if (!CHAINS.includes(m.chain)) errs.push(`chain must be one of ${CHAINS.join('/')}`);
  if (!m.category) errs.push('category required');
  if (m.category && !CATEGORIES.includes(m.category)) errs.push(`unknown category "${m.category}"`);
  if (!m.entry) errs.push('entry (launch route/url) required');
  const r = m.reward || {};
  if (!r.token) errs.push('reward.token required');
  if (typeof r.cashable !== 'boolean') errs.push('reward.cashable (boolean) required');
  // COMPLIANCE GATE: a cashable/real-value reward must be flagged AND carry a counsel note.
  if (r.cashable === true) {
    if (r.realValue !== true) errs.push('a cashable reward must set reward.realValue=true');
    if (!(m.compliance && m.compliance.note)) errs.push('a cashable/real-value reward requires compliance.note (counsel-reviewed)');
  }
  const std = (m.assets && m.assets.standard) || 'none';
  if (!ASSET_STANDARDS.includes(std)) errs.push(`assets.standard must be one of ${ASSET_STANDARDS.join('/')}`);
  return errs;
}

/** Register (or update) a game manifest. Idempotent by id; pass {replace:false} to forbid overwrite. */
export function registerGame(manifest, { replace = true } = {}) {
  const errs = validate(manifest);
  if (errs.length) throw new Error(`invalid game manifest: ${errs.join('; ')}`);
  if (!replace && REGISTRY.has(manifest.id)) throw new Error(`game already registered: ${manifest.id}`);
  const m = {
    icon: '🎮', blurb: '', status: 'live',
    assets: { standard: 'none', collections: [] },
    walletScopes: [], module: null,
    ...manifest,
    reward: { realValue: false, model: '', ...manifest.reward },
    compliance: { lane: manifest.reward?.cashable ? 'real-value' : 'non-cashable-play', ...(manifest.compliance || {}) },
  };
  REGISTRY.set(m.id, m);
  return m;
}

export const getGame = (id) => REGISTRY.get(id) || null;

export function listGames({ category = null, chain = null, cashable = null } = {}) {
  return [...REGISTRY.values()].filter((m) =>
    (category == null || m.category === category) &&
    (chain == null || m.chain === chain) &&
    (cashable == null || !!m.reward.cashable === !!cashable));
}

/** The console directory (WAX dApp-directory analog) — grouped for the hub UI. */
export function directory() {
  const games = listGames();
  const byCategory = {};
  for (const m of games) (byCategory[m.category] ||= []).push({ id: m.id, name: m.name, icon: m.icon, chain: m.chain });
  return {
    identity: UNIFIED_IDENTITY,
    market: SHARED_MARKET,
    counts: { total: games.length, realValue: games.filter((m) => m.reward.cashable).length, play: games.filter((m) => !m.reward.cashable).length },
    byCategory,
    games: games.map((m) => ({
      id: m.id, name: m.name, icon: m.icon, category: m.category, chain: m.chain,
      reward: m.reward.token, lane: m.compliance.lane, status: m.status,
    })),
  };
}

/** Launch handshake — the WAX Cloud-Wallet moment: one identity/scopes + the shared market, per game. */
export function launchDescriptor(id, { account = null } = {}) {
  const g = getGame(id);
  if (!g) throw new Error(`unknown game: ${id}`);
  return {
    game: { id: g.id, name: g.name, entry: g.entry, chain: g.chain, module: g.module },
    identity: { ...UNIFIED_IDENTITY, account },
    walletScopes: g.walletScopes,
    reward: g.reward,
    market: SHARED_MARKET,
    lane: g.compliance.lane,
  };
}

// ---------------------------------------------------------------------------
// Built-in registrations — the games actually built in-repo, MELEK Move first (the operator's ask).
// ---------------------------------------------------------------------------
export function registerBuiltIns() {
  REGISTRY.clear();
  registerGame({
    id: 'melek-move', name: 'MELEK Move', icon: '🚶', category: 'move-to-earn', chain: 'melek',
    blurb: 'Geomining move-to-earn: walk to earn a stake-weighted share of 15% of the MELEK blog pool.',
    reward: { token: 'MELEK', cashable: true, realValue: true, model: 'stake-weighted geomining; 15% of blog pool (~2,106 MELEK/day)' },
    compliance: { note: 'Earns the native MELEK coin (real value). Reward model is emission-bounded (Σ payouts ≤ epoch budget); geomining reward economics reviewed with counsel before any fiat framing.' },
    assets: { standard: 'none', collections: [] }, entry: '/move', walletScopes: ['melek-account'],
    module: 'integrations/games/move-economy.mjs',
  });
  registerGame({
    id: 'kush-farm', name: 'Kush Farm', icon: '🌱', category: 'farming', chain: 'prana',
    blurb: 'Grow strains across growTier × season; seed-return inverse-inflation; harvest KULA.',
    reward: { token: 'KULA', cashable: true, realValue: true, model: 'baseYield × tier × season modifier' },
    compliance: { note: 'Earns KULA (real DeFi token). Emission governed by economy-balance.mjs Rule 0.' },
    assets: { standard: 'erc1155', collections: ['seeds', 'strains'] }, entry: '/farm', walletScopes: ['prana-wallet'],
    module: 'integrations/games/kush-farm.mjs',
  });
  registerGame({
    id: 'kush-breeding', name: 'Kush Genetics', icon: '🧬', category: 'breeding', chain: 'prana',
    blurb: 'Breed strains: heritable stats, mutation-tier "fire" strains, escalating breed-cost supply valve.',
    reward: { token: 'STRAIN-NFT', cashable: true, realValue: true, model: 'bred strain NFTs (rarity-tiered)' },
    compliance: { note: 'Mints tradeable strain NFTs; breeding burns escalating breedFuel (anti-inflation valve).' },
    assets: { standard: 'erc1155', collections: ['strains'] }, entry: '/breed', walletScopes: ['prana-wallet'],
    module: 'integrations/games/plant-genetics.mjs',
  });
  registerGame({
    id: 'pass-a-joint', name: 'Pass a Joint', icon: '🌿', category: 'social', chain: 'prana',
    blurb: 'Social consumption sink: roll a harvested strain, pass the circle, earn non-cashable Vibes.',
    reward: { token: 'VIBES', cashable: false, model: 'non-cashable social score; potency-scaled; moderation-rewarded' },
    assets: { standard: 'none', collections: [] }, entry: '/joint', walletScopes: ['prana-wallet'],
    module: 'integrations/games/pass-a-joint.mjs',
  });
  registerGame({
    id: 'quick-farm', name: 'Quick Farm', icon: '🚜', category: 'farming', chain: 'prana',
    blurb: 'FarmVille-style fast crops with the wither mechanic + Unwither Spray revive sink.',
    reward: { token: 'FARM-COINS', cashable: false, model: 'non-cashable soft coins; wither/urgency loop' },
    assets: { standard: 'none', collections: [] }, entry: '/quickfarm', walletScopes: ['prana-wallet'],
    module: 'integrations/games/farmville-plants.mjs',
  });
  registerGame({
    id: 'kula-arcade', name: 'KULA Arcade', icon: '🕹️', category: 'arcade', chain: 'prana',
    blurb: 'Attester-scored arcade with seasons + prize pools; non-cashable PLAY entertainment layer.',
    reward: { token: 'PLAY', cashable: false, model: 'non-cashable play token; provably-fair; geofenced' },
    assets: { standard: 'none', collections: [] }, entry: '/arcade', walletScopes: ['prana-wallet'],
    module: 'integrations/games/prana-arcade.mjs',
  });
  registerGame({
    id: 'creatures', name: 'Creatures', icon: '🐉', category: 'collector', chain: 'prana',
    blurb: 'Original-IP creature collector: diploid genetics, mutation, rarity — tradeable NFTs.',
    reward: { token: 'CREATURE-NFT', cashable: true, realValue: true, model: 'bred creature NFTs' },
    compliance: { note: 'Mints tradeable NFTs on the shared standard; trades on KulaSwap.' },
    assets: { standard: 'erc1155', collections: ['creatures'] }, entry: '/creatures', walletScopes: ['prana-wallet'],
    module: 'integrations/games/creatures.mjs',
  });
  registerGame({
    id: 'tribulum', name: 'Tribulum', icon: '⚔️', category: 'strategy', chain: 'prana',
    blurb: 'Strategy/territory layer over the shared economy.',
    reward: { token: 'PLAY', cashable: false, model: 'non-cashable strategy rewards' },
    assets: { standard: 'engine-token', collections: [] }, entry: '/tribulum', walletScopes: ['prana-wallet'],
    module: 'integrations/games/tribulum.mjs',
  });
  return REGISTRY.size;
}

// register the built-ins on import so the console has a directory out of the box.
registerBuiltIns();

if (process.argv[1] && process.argv[1].endsWith('game-console.mjs')) {
  console.log('WAX mapping:', WAX_MAPPING);
  console.log('\nconsole directory:', JSON.stringify(directory(), null, 2));
  console.log('\nlaunch MELEK Move:', JSON.stringify(launchDescriptor('melek-move', { account: 'hathor' }), null, 2));
}
