// deploy.js — OPERATOR-GATED hardhat deploy runner for one outside-token leg. DOES NOT RUN in CI and
// is NOT invoked by any test. It is the script the operator runs, with a funded deployer key supplied
// via env (never committed), AFTER reviewing this package. Left here as the exact, reviewed deploy
// ORDER — running it broadcasts real transactions, so it is gated behind the operator explicitly
// invoking it against a network with a key.
//
//   OT_DEPLOYER_KEY=0x... npx hardhat run scripts/deploy.js --network base
//   OT_DEPLOYER_KEY=0x... npx hardhat run scripts/deploy.js --network polygon
//
// It reads intent from env so nothing sensitive is hard-coded. Every value below is a placeholder the
// operator sets. No amounts are broadcast for the airdrop or the pool here — those are separate,
// deliberately manual steps (build-merkle.mjs → fund distributor; add-liquidity.mjs → seed pool) so
// each money-moving action is reviewed on its own.

const hre = require("hardhat");

async function main() {
  const net = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Network: ${net}`);
  console.log(`Deployer: ${deployer.address}`);

  const owner = process.env.OT_OWNER || deployer.address; // treasury/multisig recommended
  const leg = (process.env.OT_LEG || "base").toLowerCase(); // base | polygon

  // 1) wPRANA (the universal reserve base) — deploy FIRST; both legs need it.
  const Wrapped = await hre.ethers.getContractFactory("WrappedReserveToken");
  const wprana = await Wrapped.deploy(
    "Wrapped PRANA",
    "wPRANA",
    owner,
    process.env.OT_WPRANA_RESERVE_LOCATOR || "prana:<declared-reserve-address>"
  );
  await wprana.waitForDeployment();
  console.log("wPRANA           :", await wprana.getAddress());
  console.log("  -> NEXT (operator): attestReserve(amountLocked, proofURI) BEFORE any mint.");

  if (leg === "base") {
    // 2) EnvironmentalToken (the new themed native). Rename via env.
    const Env = await hre.ethers.getContractFactory("EnvironmentalToken");
    const env = await Env.deploy(
      process.env.OT_TOKEN_NAME || "Gilead Balm",
      process.env.OT_TOKEN_SYMBOL || "BALM",
      hre.ethers.parseUnits(process.env.OT_TOKEN_CAP || "100000000", 18), // 100M default cap
      owner
    );
    await env.waitForDeployment();
    console.log("EnvironmentalToken:", await env.getAddress());

    // 3) Airdrop tooling (both options deployed; operator picks per list size).
    const Batch = await hre.ethers.getContractFactory("BatchDisperse");
    const batch = await Batch.deploy();
    await batch.waitForDeployment();
    console.log("BatchDisperse    :", await batch.getAddress());

    const root = process.env.OT_MERKLE_ROOT; // from scripts/build-merkle.mjs
    if (root) {
      const Merkle = await hre.ethers.getContractFactory("MerkleDistributor");
      const deadline = process.env.OT_CLAIM_DEADLINE || "0";
      const merkle = await Merkle.deploy(await env.getAddress(), root, deadline, owner);
      await merkle.waitForDeployment();
      console.log("MerkleDistributor:", await merkle.getAddress());
    } else {
      console.log("MerkleDistributor: SKIPPED (set OT_MERKLE_ROOT from build-merkle.mjs to deploy).");
    }
  }

  if (leg === "polygon") {
    // 2) wVKBT + wCURE (custodied, proof-of-reserve). Reserve = Hive-Engine holding account.
    for (const [sym, locEnv] of [["wVKBT", "OT_VKBT_RESERVE_LOCATOR"], ["wCURE", "OT_CURE_RESERVE_LOCATOR"]]) {
      const w = await Wrapped.deploy(
        `Wrapped ${sym.slice(1)}`,
        sym,
        owner,
        process.env[locEnv] || `hive-engine:@<reserve-account>/${sym.slice(1)}`
      );
      await w.waitForDeployment();
      console.log(`${sym.padEnd(17)}:`, await w.getAddress());
    }
    const Batch = await hre.ethers.getContractFactory("BatchDisperse");
    const batch = await Batch.deploy();
    await batch.waitForDeployment();
    console.log("BatchDisperse    :", await batch.getAddress());
  }

  console.log("\nDEPLOY COMPLETE (contracts only). Money-moving steps remain — see README:");
  console.log("  A) attestReserve on each wrapper (with published proof) BEFORE minting.");
  console.log("  B) mint allocations; fund the airdrop tool; run the airdrop.");
  console.log("  C) create pair + seed with add-liquidity.mjs params.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
