/**
 * config.mjs — Melek-Engine configuration & genesis tokenomics knobs.
 *
 * Everything an operator might tune for a new deployment lives here. The
 * testnet defaults below target the live MELEK testnet.
 *
 * ── TESTNET ↔ MAINNET (the single env switch) ──────────────────────────────
 * `NET` (testnet|mainnet, default testnet) selects a per-net PRESET that
 * derives ALL the env-specific values: sidechain id, L1 chain id, the address
 * prefix (TST↔MELEK), the symbols (TESTS/TBD↔MELEK/MBD), the public RPC/domain,
 * and — load-bearing — whether free wMELEK issuance is allowed (testnet
 * convenience: true; mainnet: ALWAYS false, the bridge-only invariant).
 *
 * Rollout to mainnet is therefore: stand up new servers, set NET=mainnet, fill
 * the mainnet addresses (chain id, bridge account, contract addresses) — and
 * NOTHING in the code changes. See TESTNET_TO_MAINNET.md.
 *
 * Every preset value stays individually overridable by its own env var so a
 * staging box can mix-and-match; NET only sets the DEFAULTS.
 */

// The active network. Anything other than 'mainnet' is treated as testnet.
export const NET = (process.env.NET || process.env.MELEK_NET || 'testnet').toLowerCase() === 'mainnet'
  ? 'mainnet'
  : 'testnet';

/**
 * Per-net presets. These are the ONLY values that differ between deployments;
 * the contract code is identical on both. `mainnet.chainId` / addresses are
 * filled at rollout (left as placeholders here — never guessed).
 */
export const NET_PRESETS = {
  testnet: {
    sidechainId: 'mse-testnet-melek',
    chainId: '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e',
    addressPrefix: 'TST',
    coinSymbol: 'TESTS',   // L1 native (mainnet: MELEK)
    backedSymbol: 'TBD',   // L1 backed-dollar (mainnet: MBD)
    wrappedSymbol: 'WMELEK', // the engine wrapped-MELEK side token (symbol identical both nets)
    domainBase: 'soapbox.community',
    alphaInfix: 'alpha.',  // testnet domains are X.alpha.soapbox.community
    rpc: 'https://alpha.melek.salon/rpc',
    // Bridge account that owns wMELEK on the engine. Real bridge custody on the
    // L1 side; on testnet defaults to the genesis issuer for convenience.
    bridgeAccount: 'hathor',
    // Testnet convenience: `tokens.issue WMELEK` is allowed (free mint). MUST be
    // false on mainnet so wMELEK can ONLY be minted by the bridge against locked MELEK.
    allowTestnetFreeIssue: true,
  },
  mainnet: {
    sidechainId: 'mse-mainnet-melek',
    // The mainnet MELEK L1 chain id (64-hex) — the SHA-256 of the Block-Zero inscription
    // ("the inscription IS the chain"). Public: matches site/witness, the whitepaper, and
    // signup/faucet-mainnet.mjs. With this filled, streamer.verifyChain() anchors on mainnet.
    chainId: '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b',
    addressPrefix: 'MELEK',
    coinSymbol: 'MELEK',
    backedSymbol: 'MBD',
    wrappedSymbol: 'WMELEK',
    domainBase: 'soapbox.community',
    alphaInfix: '',        // mainnet domains drop the alpha. infix: X.soapbox.community
    rpc: 'https://melek.salon/rpc',
    // FILL AT ROLLOUT — the real bridge custody account on L1 that owns wMELEK.
    bridgeAccount: 'hathor',
    // MAINNET INVARIANT: free issuance is forbidden. wMELEK supply == locked MELEK.
    allowTestnetFreeIssue: false,
  },
};

const preset = NET_PRESETS[NET];

export const config = {
  // --- network selector (single switch) ---
  net: NET,

  // --- L1 anchoring (security study §6 A) ---
  // Sidechain id namespaced so testnet/mainnet ops can't cross-replay (item 2).
  sidechainId: process.env.MELEK_ENGINE_ID || preset.sidechainId,

  // Failover array of MELEK L1 RPC nodes (item 3). First is the local node.
  rpcNodes: (process.env.MELEK_ENGINE_RPC ||
    `http://127.0.0.1:8090,${preset.rpc}`)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // The L1 chain we anchor to. Pinned so we refuse to replay against a fork
  // with a different id.
  chainId: process.env.MELEK_CHAIN_ID || preset.chainId,
  addressPrefix: process.env.MELEK_ADDRESS_PREFIX || preset.addressPrefix,

  // L1 symbols, derived from the net preset (testnet TESTS/TBD, mainnet MELEK/MBD).
  coinSymbol: process.env.MELEK_COIN_SYMBOL || preset.coinSymbol,
  backedSymbol: process.env.MELEK_BACKED_SYMBOL || preset.backedSymbol,

  // Public domain pattern: X.alpha.soapbox.community (testnet) / X.soapbox.community (mainnet),
  // derived from DOMAIN_BASE + the optional alpha. infix.
  domainBase: process.env.DOMAIN_BASE || preset.domainBase,
  alphaInfix: process.env.MELEK_ALPHA_INFIX != null ? process.env.MELEK_ALPHA_INFIX : preset.alphaInfix,

  // Block to begin deterministic replay from (genesis). 0 = from chain genesis;
  // for the testnet we start near the current head so first sync is fast.
  startBlock: Number(process.env.MELEK_ENGINE_START_BLOCK || 1),

  // --- abuse / DoS (security study §6 E) ---
  // Free L1->L2 transactions per account per L1 block; excess dropped (item 11).
  freeTxPerAccountPerBlock: 1,
  maxTxPerAccountPerBlock: 20, // hard ceiling regardless of fee (HE he_v2.0.3)
  // micro-fee in the fee token for ops beyond the free allowance (resource pricing)
  resourceFee: '0.001',

  // --- token economics (security study §6 F) ---
  // Generic token-creation fee, burned in the fee token (item 13).
  tokenCreationFee: '100',
  // The Hive-Engine-style UPGRADE fees: after creating a token (APIS), the issuer pays APIS again to add a
  // Scot Bot (SCOT rewards) and/or make it a Seed — separate, combinable options. Each burns APIS.
  scotFee: process.env.MELEK_ENGINE_SCOT_FEE || '100',   // add a Scot Bot to an existing token
  seedFee: process.env.MELEK_ENGINE_SEED_FEE || '100',   // make an existing token a Seed
  precisionRange: [0, 8],
  symbolMaxLength: 10,

  // --- public API ---
  apiPort: Number(process.env.MELEK_ENGINE_PORT || 8097),
  apiHost: process.env.MELEK_ENGINE_HOST || '127.0.0.1',
  rateLimitPerMin: 60, // per-IP, per-process (item 12)

  // --- state ---
  stateFile: process.env.MELEK_ENGINE_STATE || './data/engine/state.json',

  // --- WorkerBee issuance lottery (the BeeSwarm equivalent) ---
  // Forever-lock the stake token -> mint soulbound APIS-Hash (mining power) ->
  // APIS-Hash mines APIS on a FIXED scheduled emission split by stake share.
  // NOT inflationary: more APIS-Hash just splits the same scheduled pie.
  // The canonical pure math lives in kulaswap/apis-workerbee.mjs; this contract
  // is the engine-side, BigInt, deterministic-replay realisation of it.
  workerbee: {
    // The L1-pegged token that is forever-locked to earn mining power. On the
    // engine this is the wrapped-MELEK side token (wMELEK). It must be a
    // registered engine token before foreverLock can pull it. Tunable.
    stakeToken: process.env.MELEK_ENGINE_STAKE_TOKEN || preset.wrappedSymbol,
    // Fixed scheduled emission: whole APIS minted per day across ALL APIS-Hash,
    // split pro-rata by share. Default mirrors apis-workerbee.mjs.
    emissionPerDay: Number(process.env.MELEK_ENGINE_WB_EMISSION_PER_DAY || 1000),
    // Emission DECAYS `decayPerYearPct`% per year (gentle decline, not a halving).
    // Each year-epoch the per-block emission = base × (100-pct)^year / 100^year.
    // 0 = flat (no decay). decayDays = the year length in days.
    decayPerYearPct: Number(process.env.MELEK_ENGINE_WB_DECAY_PCT_PER_YEAR || 10),
    decayDays: Number(process.env.MELEK_ENGINE_WB_DECAY_DAYS || 365),
    // L1 blocks per day. MELEK (Blurt/Steem lineage) = 3s blocks => 28800/day.
    // Emission is scheduled in blocks, so we convert per-day -> per-block here.
    blocksPerDay: Number(process.env.MELEK_ENGINE_WB_BLOCKS_PER_DAY || 28800),
  },

  // --- the wMELEK bridge (the proper, bridge-only mint/burn boundary) ---
  // wMELEK is the engine mirror of MELEK locked in the bridge. THE INVARIANT:
  // wMELEK supply == MELEK locked in the bridge — minted ONLY on a bridge
  // deposit, burned ONLY on a withdrawal. NO free issuance on mainnet.
  //
  // Canonical mainnet setup: the wMELEK token's `issuer` IS `bridge.account`, so
  // tokens.issue WMELEK is already bridge-only by the issuer check. The
  // `allowTestnetFreeIssue` flag + the create/issue guard below are
  // belt-and-suspenders: when false, creating or issuing the wrapped symbol is
  // rejected unless the sender === bridge.account.
  bridge: {
    // The account that controls wMELEK on the engine (== the wMELEK token issuer
    // on mainnet). On testnet defaults to the genesis issuer for convenience.
    account: process.env.MELEK_ENGINE_BRIDGE_ACCOUNT || preset.bridgeAccount,
    // The wrapped-MELEK side-token symbol the bridge mints/burns (== workerbee stakeToken).
    wrappedSymbol: (process.env.MELEK_ENGINE_STAKE_TOKEN || preset.wrappedSymbol).toUpperCase(),
    // Testnet convenience: tokens.issue WMELEK is permitted (free mint) ONLY when true.
    // MAINNET MUST be false — wMELEK then mints ONLY via bridge.mintWrapped (locked MELEK).
    allowTestnetFreeIssue: process.env.MELEK_ENGINE_ALLOW_TESTNET_ISSUE != null
      ? process.env.MELEK_ENGINE_ALLOW_TESTNET_ISSUE !== 'false'
      : preset.allowTestnetFreeIssue,
    // The engine account that RECEIVES side-tokens to bridge OUT to PRANA (e.g. APIS → wAPIS).
    // A transfer of any token to this account is recorded as a bridge deposit (the transfer memo
    // carries the 0x PRANA recipient); the off-chain engine-bridge-watcher attests it on PRANA and
    // mints the matching wrapped token. Unified with the L1 native bridge custody (`melekbridge`) so
    // one account holds both legs. Fill at mainnet rollout.
    custody: process.env.MELEK_ENGINE_BRIDGE_CUSTODY || preset.bridgeCustody || 'melekbridge',
  },

  // --- the Seed Mint (seeds.mjs) — mints the Kush Farm seeds as engine assets ---
  // A seed is a PRANA asset that mints THROUGH the engine, in one of two kinds: a fungible `tokens` token
  // (abundant strains — the daily "milk") or a semi-fungible `nft` (scarce rare/legendary strains). Only the
  // `minter` may register + mint seeds; growers receive them and `plant` (burn) them. The off-chain builder
  // (integrations/games/seed-mint.mjs) reads the seed catalog and emits these ops; the engine folds them.
  seeds: {
    // Who may register + mint seeds (the grow-game settlement account). Defaults to the genesis issuer.
    minter: process.env.MELEK_ENGINE_SEED_MINTER || process.env.MELEK_ENGINE_ISSUER || 'hathor',
    // The NFT collection the nft-kind seeds live under.
    collection: (process.env.MELEK_ENGINE_SEED_COLLECTION || 'KUSHSEED').toUpperCase(),
    // Seed tokens are whole counts (you hold N seeds), so precision 0 by default.
    tokenPrecision: Number(process.env.MELEK_ENGINE_SEED_PRECISION ?? 0),
  },

  // --- the two PRANA DEX seams (security study §7), gated OFF here ---
  // No DEX on our side. These declare the registered, revocable capability
  // accounts the future PRANA DEX / peg gateway will plug into. Disabled until
  // PRANA exists; the seams are present but inert.
  seams: {
    // Seam 1: pegged-asset gateway (deposit -> mint, burn -> withdraw bookkeeping).
    gateway: { enabled: false, registeredAccounts: [] },
    // Seam 2: signed-fill settlement/escrow primitive for the PRANA matcher.
    dexSettlement: { enabled: false, registeredAccounts: [] },
  },
};

/**
 * GENESIS tokens — the BEE/WORKERBEE equivalents, named for the MELEK
 * ecosystem. Created at engine genesis before any block is processed.
 *
 * Naming rationale (documented per operator directive): MELEK's mythos is
 * angelic/temple, so the native tokens are named after the temple-economy:
 *   - APIS  = the fee/utility token (Hive-Engine "BEE"). Apis is the sacred
 *             bee of the temple; APIS is burned to create tokens & pay
 *             resource fees. Apt double-meaning: it powers the engine's APIs.
 *   - DRONE = the miner/governance token (Hive-Engine "WORKERBEE"). Staking
 *             DRONE earns APIS via the issuance lottery and weights witness
 *             voting. (A drone is the bee whose role is reproduction/continuity
 *             — fitting for the governance/continuity token.)
 */
/**
 * domain — build a public hostname for a subdomain under the active net.
 * Testnet:  domain('engine') -> 'engine.alpha.soapbox.community'
 * Mainnet:  domain('engine') -> 'engine.soapbox.community'
 * Pure: derived from config.domainBase + config.alphaInfix (no hard-coded `alpha.`).
 * @param {string} sub  the leftmost label (e.g. 'engine', 'tokens', 'pool')
 * @returns {string}
 */
export function domain(sub) {
  const base = config.domainBase;
  const infix = config.alphaInfix || '';
  const left = sub ? `${sub}.` : '';
  return `${left}${infix}${base}`;
}

export const genesis = {
  feeToken: 'APIS',
  minerToken: 'DRONE',
  // The genesis issuer account on L1 (must be a real MELEK account).
  issuer: process.env.MELEK_ENGINE_ISSUER || 'hathor',
  tokens: [
    {
      symbol: 'APIS',
      name: 'Apis',
      precision: 3,
      maxSupply: '9007199254740991', // ceiling; mirrors HE BEE
      // immutable cap flag: APIS has a *soft* cap (issuance lottery emits it),
      // so its supply cap is the ceiling, not immutable-locked.
      supplyCapImmutable: false,
      url: 'https://engine.alpha.melek.salon',
      // initial mint to the issuer to bootstrap creation fees
      initialIssue: '1000000',
    },
    {
      symbol: 'DRONE',
      name: 'Drone',
      precision: 3,
      maxSupply: '1000000', // governance token, hard fixed
      supplyCapImmutable: true, // cannot ever mint beyond maxSupply (item 14)
      url: 'https://engine.alpha.melek.salon',
      initialIssue: '1000000', // full supply minted at genesis to issuer
    },
  ],
};
