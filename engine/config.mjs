/**
 * config.mjs — Melek-Engine configuration & genesis tokenomics knobs.
 *
 * Everything an operator might tune for a new deployment lives here. The
 * testnet defaults below target the live MELEK testnet.
 */

export const config = {
  // --- L1 anchoring (security study §6 A) ---
  // Sidechain id namespaced so testnet/mainnet ops can't cross-replay (item 2).
  sidechainId: process.env.MELEK_ENGINE_ID || 'mse-testnet-melek',

  // Failover array of MELEK L1 RPC nodes (item 3). First is the local node.
  rpcNodes: (process.env.MELEK_ENGINE_RPC ||
    'http://127.0.0.1:8090,https://alpha.melek.salon/rpc')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // The L1 chain we anchor to. Pinned so we refuse to replay against a fork
  // with a different id.
  chainId: process.env.MELEK_CHAIN_ID ||
    '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e',
  addressPrefix: 'TST',

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
    stakeToken: process.env.MELEK_ENGINE_STAKE_TOKEN || 'WMELEK',
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
