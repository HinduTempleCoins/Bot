// chains.mjs — per-chain launch config for the outside-token legs. ADDRESSES ARE ENV PLACEHOLDERS
// (left blank / zero) until the operator deploys and fills them in — mirrors kulaswap/
// kula-config-addresses.mjs (public addresses only, never a key). PURE data + tiny helpers; no chain,
// no network, no keys.
//
// Two legs, per the plan:
//   base    — FLAGSHIP: new EnvironmentalToken + wPRANA, paired NEW/wPRANA on a UniV2 DEX (Aerodrome
//             v2 / Uniswap v2-style). Run on Base (an Ethereum L2) because a wide airdrop on L1 is
//             unaffordable (plan Part 1).
//   polygon — VKBT/CURE onto Polygon as wVKBT/wCURE + wPRANA, paired wVKBT/wPRANA and wCURE/wPRANA on
//             QuickSwap (UniV2 fork → KulaSwap logic ports). START HERE (plan Part 6): cheapest ground.
//
// The `router`/`factory` are the target DEX's canonical UniV2 Router02 + Factory. Fill from the DEX
// docs at deploy time. Everything defaults to a zero address so any not-yet-deployed piece reads as
// "not live" (same guard convention as kula-config-addresses: a zero address = refuse to build a tx).

const Z = "0x0000000000000000000000000000000000000000";
const env = (k, d = "") => (typeof process !== "undefined" && process.env && process.env[k]) || d;

export const CHAINS = Object.freeze({
  base: Object.freeze({
    key: "base",
    label: "Base (Ethereum L2) — FLAGSHIP",
    chainId: 8453,
    rpcEnv: "BASE_RPC_URL",
    rpc: env("BASE_RPC_URL", "https://mainnet.base.org"),
    explorer: "https://basescan.org",
    nativeSymbol: "ETH",
    // Aerodrome/Uniswap-v2-style router+factory on Base. FILL AT DEPLOY.
    router: env("BASE_ROUTER", Z),
    factory: env("BASE_FACTORY", Z),
    // Our deployed pieces (fill after each operator-gated deploy step).
    contracts: Object.freeze({
      environmentalToken: env("BASE_ENV_TOKEN", Z), // EnvironmentalToken (the new themed native)
      wPRANA: env("BASE_WPRANA", Z),                // WrappedReserveToken (wPRANA)
      merkleDistributor: env("BASE_MERKLE_DISTRIBUTOR", Z),
      batchDisperse: env("BASE_BATCH_DISPERSE", Z),
      pairNewWprana: env("BASE_PAIR_NEW_WPRANA", Z),
    }),
    // Proof-of-reserve for wPRANA on this chain (published, human-auditable).
    reserve: Object.freeze({
      locator: env("BASE_WPRANA_RESERVE_LOCATOR", "prana:<declared-reserve-address>"),
      proofURI: env("BASE_WPRANA_PROOF_URI", "ipfs://<reserve-snapshot>"),
    }),
  }),

  polygon: Object.freeze({
    key: "polygon",
    label: "Polygon — VKBT/CURE leg (START HERE)",
    chainId: 137,
    rpcEnv: "POLYGON_RPC_URL",
    rpc: env("POLYGON_RPC_URL", "https://polygon-rpc.com"),
    explorer: "https://polygonscan.com",
    nativeSymbol: "POL",
    // QuickSwap v2 router+factory on Polygon. FILL AT DEPLOY.
    router: env("POLYGON_ROUTER", Z),
    factory: env("POLYGON_FACTORY", Z),
    contracts: Object.freeze({
      wVKBT: env("POLYGON_WVKBT", Z),   // WrappedReserveToken (wVKBT), reserve = Hive-Engine VKBT
      wCURE: env("POLYGON_WCURE", Z),   // WrappedReserveToken (wCURE), reserve = Hive-Engine CURE
      wPRANA: env("POLYGON_WPRANA", Z), // WrappedReserveToken (wPRANA), the universal quote base
      merkleDistributor: env("POLYGON_MERKLE_DISTRIBUTOR", Z),
      batchDisperse: env("POLYGON_BATCH_DISPERSE", Z),
      pairVkbtWprana: env("POLYGON_PAIR_VKBT_WPRANA", Z),
      pairCureWprana: env("POLYGON_PAIR_CURE_WPRANA", Z),
    }),
    reserve: Object.freeze({
      vkbtLocator: env("POLYGON_WVKBT_RESERVE_LOCATOR", "hive-engine:@<reserve-account>/VKBT"),
      cureLocator: env("POLYGON_WCURE_RESERVE_LOCATOR", "hive-engine:@<reserve-account>/CURE"),
      pranaLocator: env("POLYGON_WPRANA_RESERVE_LOCATOR", "prana:<declared-reserve-address>"),
      proofURI: env("POLYGON_RESERVE_PROOF_URI", "ipfs://<reserve-snapshot>"),
    }),
  }),
});

export const ZERO = Z;

/** True when an address is real (non-zero) — the "is this piece live?" guard. */
export const isLive = (addr) => !!addr && addr !== Z;

/** Get a chain config by key ('base'|'polygon'); throws on unknown so a typo can't silently no-op. */
export function chain(key) {
  const c = CHAINS[String(key).toLowerCase()];
  if (!c) throw new Error(`unknown chain: ${key} (expected base|polygon)`);
  return c;
}
