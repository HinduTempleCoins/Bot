const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EnvironmentalToken", function () {
  let token, owner, treasury, alice;
  const CAP = ethers.parseUnits("100000000", 18); // 100M

  beforeEach(async () => {
    [owner, treasury, alice] = await ethers.getSigners();
    const T = await ethers.getContractFactory("EnvironmentalToken");
    token = await T.deploy("Gilead Balm", "BALM", CAP, owner.address);
  });

  it("deploys with zero supply, correct name/symbol/cap", async () => {
    expect(await token.name()).to.equal("Gilead Balm");
    expect(await token.symbol()).to.equal("BALM");
    expect(await token.cap()).to.equal(CAP);
    expect(await token.totalSupply()).to.equal(0n);
  });

  it("owner mints allocations; non-owner cannot", async () => {
    const amt = ethers.parseUnits("1000000", 18);
    await token.mint(treasury.address, amt);
    expect(await token.balanceOf(treasury.address)).to.equal(amt);
    await expect(token.connect(alice).mint(alice.address, amt)).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
  });

  it("enforces the hard cap", async () => {
    await token.mint(treasury.address, CAP);
    await expect(token.mint(treasury.address, 1n)).to.be.revertedWithCustomError(token, "ERC20ExceededCap");
  });

  it("renounceMinting permanently freezes supply", async () => {
    await token.mint(treasury.address, ethers.parseUnits("5000000", 18));
    await token.renounceMinting();
    expect(await token.mintingRenounced()).to.equal(true);
    await expect(token.mint(treasury.address, 1n)).to.be.revertedWithCustomError(token, "MintingIsRenounced");
  });

  it("is burnable (a supply sink)", async () => {
    const amt = ethers.parseUnits("100", 18);
    await token.mint(alice.address, amt);
    await token.connect(alice).burn(amt);
    expect(await token.totalSupply()).to.equal(0n);
  });

  it("supports EIP-2612 permit (has a DOMAIN_SEPARATOR + nonces)", async () => {
    expect(await token.nonces(owner.address)).to.equal(0n);
    expect(await token.DOMAIN_SEPARATOR()).to.match(/^0x[0-9a-f]{64}$/);
  });
});
