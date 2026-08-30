/**
 * deploy-arcade.js — deploy the KULA Arcade play-token DeFi set to PRANA and record the addresses
 * to contracts/deployments-arcade.json. This is the compliant, NON-CASHABLE arcade layer:
 * PlayToken (non-cashable credit) + ArcadeSpin (free daily wheel) + KulaLotto (commit-reveal raffle)
 * + BinaryEventMarket (Yes/No parimutuel). NO real-money anything; PLAY has no cash-out path by
 * construction (see contracts/arcade/PlayToken.sol and .local/PRANA_MAINNET_ARCADE_DEPLOY.md).
 *
 * Mirrors the testnet deploy that is proven end-to-end (.local/PRANA_TESTNET_ARCADE_DEPLOYED.md), so
 * mainnet is the same wiring against chainId 712217.
 *
 * Constructor args (verified against the .sol sources):
 *   - PlayToken(admin)                                  admin gets DEFAULT_ADMIN + MINTER + ARCADE_ADMIN
 *   - ArcadeSpin(play, admin, names[], weights[], payouts[])   admin gets DEFAULT_ADMIN + ADMIN + SPIN_GRANTER
 *   - KulaLotto(play, treasury, admin)                  admin gets DEFAULT_ADMIN + LOTTO_ADMIN + DRAW
 *   - BinaryEventMarket(play, treasury, admin)          admin gets DEFAULT_ADMIN + MARKET_ADMIN + PROPOSER + DISPUTE_RESOLVER
 *
 * Post-deploy wiring (done here):
 *   - PlayToken.grantRole(MINTER_ROLE, ArcadeSpin)                       spin can mint free PLAY
 *   - PlayToken.setArcadeEndpoint(true) for Spin, Lotto, Market, Treasury  PLAY may move to/from these
 *     (non-cashable enforcement: user<->user / user->DEX transfers revert; only arcade endpoints move PLAY)
 *
 * ENV (no secrets committed; supply at run time):
 *   PRANA_DEPLOYER_KEY   the mainnet deployer WIF/hex key (hardhat network `accounts`). REQUIRED on mainnet.
 *   PRANA_MAINNET_RPC    mainnet RPC url (or PRANA_RPC).
 *   ARCADE_ADMIN         admin/role holder for all four contracts. Default: the deployer address.
 *   ARCADE_TREASURY      PLAY fee/burn sink (lotto/market splits). REQUIRED, non-zero. On mainnet this is
 *                        the genesis-sealed HathorFeeTreasury (see the runbook). No default — must be set.
 *   ARCADE_SPIN_NAMES    comma list of prize names.   Default: "No win,1 PLAY,5 PLAY,Jackpot 50 PLAY"
 *   ARCADE_SPIN_WEIGHTS  comma list of integer weights. Default: "50,30,15,5"
 *   ARCADE_SPIN_PAYOUTS  comma list of PLAY base-unit payouts. Default: "0,1000000000000000000,5000000000000000000,50000000000000000000"
 *
 * Usage (DO NOT run until the parent serializes the deploy — shared deployer nonce):
 *   PRANA_DEPLOYER_KEY=0x… PRANA_MAINNET_RPC=… ARCADE_TREASURY=0x… \
 *     npx hardhat run scripts/deploy-arcade.js --network prana_mainnet
 *
 * Robust by design: each step is logged; deployments-arcade.json is written at the end.
 */

const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const ONE = 10n ** 18n;
const DEFAULT_NAMES = ["No win", "1 PLAY", "5 PLAY", "Jackpot 50 PLAY"];
const DEFAULT_WEIGHTS = [50, 30, 15, 5];
const DEFAULT_PAYOUTS = [0n, 1n * ONE, 5n * ONE, 50n * ONE];

function parseList(raw, fallback, cast) {
  if (!raw) return fallback;
  const parts = String(raw).split(",").map((s) => s.trim()).filter((s) => s.length);
  if (!parts.length) return fallback;
  return parts.map(cast);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no signer — set PRANA_DEPLOYER_KEY for this network");
  const deployerAddr = await deployer.getAddress();

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const admin = ethers.getAddress(process.env.ARCADE_ADMIN || deployerAddr);
  const treasuryRaw = process.env.ARCADE_TREASURY;
  if (!treasuryRaw) throw new Error("ARCADE_TREASURY is required (non-zero PLAY fee/burn sink) — refusing to deploy");
  const treasury = ethers.getAddress(treasuryRaw);
  if (treasury === ethers.ZeroAddress) throw new Error("ARCADE_TREASURY must be non-zero");

  const names = parseList(process.env.ARCADE_SPIN_NAMES, DEFAULT_NAMES, (s) => s);
  const weights = parseList(process.env.ARCADE_SPIN_WEIGHTS, DEFAULT_WEIGHTS, (s) => BigInt(s));
  const payouts = parseList(process.env.ARCADE_SPIN_PAYOUTS, DEFAULT_PAYOUTS, (s) => BigInt(s));
  if (names.length !== weights.length || names.length !== payouts.length) {
    throw new Error(`spin prize table mismatch: names=${names.length} weights=${weights.length} payouts=${payouts.length}`);
  }

  console.log(`Network:   ${network.name} (chainId ${chainId})`);
  console.log(`Deployer:  ${deployerAddr}`);
  console.log(`Admin:     ${admin}`);
  console.log(`Treasury:  ${treasury}`);
  console.log(`Spin table: ${names.map((n, i) => `${n}=${weights[i]}w/${payouts[i]}`).join(", ")}`);
  console.log("");

  if (chainId === 712217) {
    console.log("⚠  MAINNET (712217). This spends the deployer key. Ensure no other agent is using this");
    console.log("   deployer concurrently (nonce collisions). Proceeding in 3s — Ctrl-C to abort.");
    await new Promise((r) => setTimeout(r, 3000));
  }

  const contracts = {};
  async function deploy(label, factoryName, args) {
    const Factory = await ethers.getContractFactory(factoryName);
    const c = await Factory.deploy(...args);
    await c.waitForDeployment();
    const addr = await c.getAddress();
    contracts[label] = addr;
    console.log(`  ${label.padEnd(18)} ${addr}`);
    return c;
  }

  console.log("Deploying arcade set:");
  const play = await deploy("PlayToken", "PlayToken", [admin]);
  const spin = await deploy("ArcadeSpin", "ArcadeSpin", [await play.getAddress(), admin, names, weights, payouts]);
  const lotto = await deploy("KulaLotto", "KulaLotto", [await play.getAddress(), treasury, admin]);
  const market = await deploy("BinaryEventMarket", "BinaryEventMarket", [await play.getAddress(), treasury, admin]);

  console.log("\nWiring (admin-signed — the deployer must be, or hold, the admin key):");
  // If admin != deployer, these calls must be sent by the admin account; run this script AS the admin,
  // or perform the wiring separately. We attempt them here (deployer == admin in the default path).
  const wire = async (label, fn) => {
    try { const tx = await fn(); await tx.wait(); console.log(`  ✓ ${label}`); }
    catch (e) { console.error(`  ✗ ${label} FAILED: ${e.message || e}`); }
  };

  const MINTER_ROLE = await play.MINTER_ROLE();
  await wire("PlayToken.grantRole(MINTER_ROLE, ArcadeSpin)", () => play.grantRole(MINTER_ROLE, contracts.ArcadeSpin));
  await wire("PlayToken.setArcadeEndpoint(ArcadeSpin,true)", () => play.setArcadeEndpoint(contracts.ArcadeSpin, true));
  await wire("PlayToken.setArcadeEndpoint(KulaLotto,true)", () => play.setArcadeEndpoint(contracts.KulaLotto, true));
  await wire("PlayToken.setArcadeEndpoint(BinaryEventMarket,true)", () => play.setArcadeEndpoint(contracts.BinaryEventMarket, true));
  await wire("PlayToken.setArcadeEndpoint(Treasury,true)", () => play.setArcadeEndpoint(treasury, true));

  const out = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployerAddr,
    admin,
    treasury,
    spinPrizeTable: { names, weights: weights.map(String), payouts: payouts.map(String) },
    contracts,
  };
  const file = path.join(__dirname, "..", "deployments-arcade.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote ${file}`);
  console.log("\nService env to point the arcade surfaces at these contracts:");
  console.log(`  PRANA_NET=${chainId === 712217 ? "mainnet" : "testnet"}`);
  console.log(`  ARCADE_LOTTO_ADDR=${contracts.KulaLotto || ""}`);
  console.log(`  ARCADE_MARKET_ADDR=${contracts.BinaryEventMarket || ""}`);
  console.log(`  ARCADE_PLAY_ADDR=${contracts.PlayToken || ""}`);
  console.log(`  ARCADE_SPIN_ADDR=${contracts.ArcadeSpin || ""}`);
  console.log("\nNEXT (post-deploy, via MELEK-Signer — NOT in this script):");
  console.log("  • grant PlayToken MINTER_ROLE to the earn/faucet attester(s) so Move/GeoMiner/spin mint free PLAY");
  console.log("  • grant the keeper account KulaLotto DRAW_ROLE + BinaryEventMarket roles (arm autonomous writes)");
  console.log("  • set ARCADE_SIGNER_TOKEN (OAuth-consented keeper bearer) + fund the keeper with gas");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
