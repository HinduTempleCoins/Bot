const { expect } = require("chai");
const { ethers } = require("hardhat");

// The KEY cross-check: a Merkle tree built by our OFF-CHAIN scripts/lib/merkle.mjs must produce
// proofs that verify ON-CHAIN in MerkleDistributor.sol. If the leaf scheme or pair-hashing differed
// by a single byte, claim() would revert. This test proves they are identical.
describe("MerkleDistributor (off-chain tree ↔ on-chain claim)", function () {
  let merkleLib, token, dist, owner, r1, r2, r3, entries, tree;

  before(async () => {
    merkleLib = await import("../scripts/lib/merkle.mjs");
  });

  beforeEach(async () => {
    [owner, r1, r2, r3] = await ethers.getSigners();

    entries = [
      { index: 0, account: r1.address, amount: ethers.parseUnits("100", 18).toString() },
      { index: 1, account: r2.address, amount: ethers.parseUnits("250", 18).toString() },
      { index: 2, account: r3.address, amount: ethers.parseUnits("650", 18).toString() },
    ];
    tree = merkleLib.buildTree(entries);

    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Wrapped PRANA", "wPRANA");
    const Dist = await ethers.getContractFactory("MerkleDistributor");
    // deadline 0 = no sweep for the basic tests
    dist = await Dist.deploy(await token.getAddress(), tree.root, 0, owner.address);

    // fund the distributor with the total
    const total = entries.reduce((s, e) => s + BigInt(e.amount), 0n);
    await token.mint(await dist.getAddress(), total);
  });

  it("stores the off-chain root", async () => {
    expect(await dist.merkleRoot()).to.equal(tree.root);
  });

  it("each recipient can claim with the off-chain proof", async () => {
    for (let i = 0; i < tree.entries.length; i++) {
      const e = tree.entries[i];
      const proof = merkleLib.getProof(tree, i);
      await expect(dist.claim(e.index, e.account, e.amount, proof))
        .to.emit(dist, "Claimed")
        .withArgs(e.index, e.account, e.amount);
      expect(await token.balanceOf(e.account)).to.equal(BigInt(e.amount));
    }
  });

  it("double-claim is blocked", async () => {
    const e = tree.entries[0];
    const proof = merkleLib.getProof(tree, 0);
    await dist.claim(e.index, e.account, e.amount, proof);
    await expect(dist.claim(e.index, e.account, e.amount, proof)).to.be.revertedWithCustomError(
      dist,
      "AlreadyClaimed"
    );
  });

  it("a wrong amount is rejected (InvalidProof)", async () => {
    const e = tree.entries[0];
    const proof = merkleLib.getProof(tree, 0);
    await expect(
      dist.claim(e.index, e.account, ethers.parseUnits("999999", 18), proof)
    ).to.be.revertedWithCustomError(dist, "InvalidProof");
  });

  it("owner can sweep unclaimed float only after the deadline", async () => {
    // redeploy with a near-future deadline
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const deadline = now + 3600;
    const Dist = await ethers.getContractFactory("MerkleDistributor");
    const d2 = await Dist.deploy(await token.getAddress(), tree.root, deadline, owner.address);
    await token.mint(await d2.getAddress(), ethers.parseUnits("1000", 18));

    await expect(d2.sweep(owner.address)).to.be.revertedWithCustomError(d2, "SweepTooEarly");

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);
    await expect(d2.sweep(owner.address)).to.emit(d2, "Swept");
    expect(await token.balanceOf(await d2.getAddress())).to.equal(0n);
  });
});
