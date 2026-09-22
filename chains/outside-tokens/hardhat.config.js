require("@nomicfoundation/hardhat-toolbox");

/**
 * outside-tokens — Hardhat config (mirrors PRANA/contracts/hardhat.config.js).
 * Solidity 0.8.24, optimizer on. Tests run on the in-memory `hardhat` network (no external network,
 * no keys). The Base/Polygon networks are for the OPERATOR-GATED deploy only and carry NO default
 * key — supply one via OT_DEPLOYER_KEY at deploy time (never committed).
 */
const DEPLOYER = process.env.OT_DEPLOYER_KEY ? [process.env.OT_DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Base & Polygon are post-Shanghai; keep the default EVM (paris/shanghai) — do NOT pin london
      // here (that was for PRANA's local PoW fork). Left default so it targets the L2s correctly.
    },
  },
  networks: {
    hardhat: {},
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: DEPLOYER,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts: DEPLOYER,
    },
    // Public testnets for a dry run before mainnet (still operator-gated, still needs OT_DEPLOYER_KEY).
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: DEPLOYER,
    },
    polygonAmoy: {
      url: process.env.POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts: DEPLOYER,
    },
  },
};
