const { expect } = require("chai");
const { ethers } = require("hardhat");

// Proves the anti-orphan invariant: the wrapper REFUSES to mint more than the attested reserve, and
// requires a non-empty proof URI on every attestation. This is what stops a fake/orphan wrap.
describe("WrappedReserveToken (custodied wPRANA + proof-of-reserve)", function () {
  let w, admin, minter, attester, alice;
  const M = (n) => ethers.parseUnits(String(n), 18);

  beforeEach(async () => {
    [admin, minter, attester, alice] = await ethers.getSigners();
    const W = await ethers.getContractFactory("WrappedReserveToken");
    w = await W.deploy("Wrapped PRANA", "wPRANA", admin.address, "prana:0xReserveAcct");
  });

  it("starts with zero reserve and refuses to mint (invariant holds at 0)", async () => {
    await expect(w.mint(alice.address, M(1))).to.be.revertedWithCustomError(w, "ExceedsAttestedReserve");
    expect(await w.totalSupply()).to.equal(0n);
  });

  it("mints up to — but never beyond — the attested reserve", async () => {
    await expect(w.attestReserve(M(1000), "ipfs://proof-1"))
      .to.emit(w, "ReserveAttested")
      .withArgs(1n, M(1000), "ipfs://proof-1", admin.address);

    await w.mint(alice.address, M(600));
    expect(await w.totalSupply()).to.equal(M(600));

    // 600 + 500 = 1100 > 1000 attested → revert
    await expect(w.mint(alice.address, M(500))).to.be.revertedWithCustomError(w, "ExceedsAttestedReserve");

    // exactly to the ceiling is allowed
    await w.mint(alice.address, M(400));
    expect(await w.totalSupply()).to.equal(M(1000));
  });

  it("requires a non-empty proof URI on attestation", async () => {
    await expect(w.attestReserve(M(100), "")).to.be.revertedWithCustomError(w, "EmptyProof");
  });

  it("raising the attestation (with fresh proof) lets minting continue", async () => {
    await w.attestReserve(M(1000), "ipfs://proof-1");
    await w.mint(alice.address, M(1000));
    await expect(w.mint(alice.address, M(1))).to.be.revertedWithCustomError(w, "ExceedsAttestedReserve");

    await w.attestReserve(M(2000), "ipfs://proof-2");
    await w.mint(alice.address, M(1000)); // now allowed
    expect(await w.totalSupply()).to.equal(M(2000));
    expect(await w.attestationId()).to.equal(2n);
  });

  it("collateralizationBps reports backing health", async () => {
    expect(await w.collateralizationBps()).to.equal(10000n); // 0 supply reads fully backed
    await w.attestReserve(M(1000), "ipfs://p");
    await w.mint(alice.address, M(500));
    expect(await w.collateralizationBps()).to.equal(20000n); // 1000 reserve / 500 supply = 200%
  });

  it("burn (redemption) reduces supply and emits the bridge event", async () => {
    await w.attestReserve(M(1000), "ipfs://p");
    await w.mint(alice.address, M(1000));
    await expect(w.connect(alice).burn(M(400))).to.emit(w, "WrappedBurned").withArgs(alice.address, M(400));
    expect(await w.totalSupply()).to.equal(M(600));
  });

  it("role separation: only ATTESTER attests, only MINTER mints", async () => {
    const ATT = await w.ATTESTER_ROLE();
    const MIN = await w.MINTER_ROLE();
    await w.grantRole(ATT, attester.address);
    await w.grantRole(MIN, minter.address);
    await w.revokeRole(MIN, admin.address);
    await w.revokeRole(ATT, admin.address);

    await expect(w.attestReserve(M(1), "ipfs://p")).to.be.reverted; // admin no longer attester
    await w.connect(attester).attestReserve(M(1000), "ipfs://p");
    await expect(w.connect(alice).mint(alice.address, M(1))).to.be.reverted; // alice not minter
    await w.connect(minter).mint(alice.address, M(500));
    expect(await w.balanceOf(alice.address)).to.equal(M(500));
  });

  it("admin can update the public reserve locator", async () => {
    await expect(w.setReserveLocator("prana:0xNewReserve"))
      .to.emit(w, "ReserveLocatorSet")
      .withArgs("prana:0xNewReserve");
    expect(await w.reserveLocator()).to.equal("prana:0xNewReserve");
  });
});
