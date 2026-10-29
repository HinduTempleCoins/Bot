const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MwaliToken — the liquidity token, made", function () {
  let mwali, admin, gauge, user;
  beforeEach(async () => {
    [admin, gauge, user] = await ethers.getSigners();
    mwali = await (await ethers.getContractFactory("MwaliToken")).deploy(admin.address, ethers.parseEther("3468960"));
  });

  it("is MWALI, and starts at zero — no premine", async () => {
    expect(await mwali.name()).to.equal("Mwali");
    expect(await mwali.symbol()).to.equal("MWALI");
    expect(await mwali.totalSupply()).to.equal(0n);
  });

  it("⚠ the admin CANNOT mint — only a gauge it grants the role to", async () => {
    expect(await mwali.hasRole(await mwali.MINTER_ROLE(), admin.address)).to.equal(false);
    await expect(mwali.mint(user.address, 1n)).to.be.reverted;
  });

  it("a granted gauge mints; nobody else can", async () => {
    await mwali.grantRole(await mwali.MINTER_ROLE(), gauge.address);
    await mwali.connect(gauge).mint(user.address, ethers.parseEther("5"));
    expect(await mwali.balanceOf(user.address)).to.equal(ethers.parseEther("5"));
    await expect(mwali.connect(user).mint(user.address, 1n)).to.be.reverted;
  });

  it("⚠ burning is open to holders — the lotto sink needs no permission", async () => {
    await mwali.grantRole(await mwali.MINTER_ROLE(), gauge.address);
    await mwali.connect(gauge).mint(user.address, ethers.parseEther("10"));
    await mwali.connect(user).burn(ethers.parseEther("4"));
    expect(await mwali.totalSupply()).to.equal(ethers.parseEther("6"));
  });

  it("burnFrom works with an allowance, so a sink contract can pull and burn", async () => {
    await mwali.grantRole(await mwali.MINTER_ROLE(), gauge.address);
    await mwali.connect(gauge).mint(user.address, ethers.parseEther("10"));
    await mwali.connect(user).approve(admin.address, ethers.parseEther("3"));
    await mwali.burnFrom(user.address, ethers.parseEther("3"));
    expect(await mwali.totalSupply()).to.equal(ethers.parseEther("7"));
  });

  it("admin can be handed to a timelock later without redeploying", async () => {
    await mwali.grantRole(await mwali.DEFAULT_ADMIN_ROLE(), gauge.address);
    await mwali.renounceRole(await mwali.DEFAULT_ADMIN_ROLE(), admin.address);
    expect(await mwali.hasRole(await mwali.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(false);
    expect(await mwali.hasRole(await mwali.DEFAULT_ADMIN_ROLE(), gauge.address)).to.equal(true);
  });
});
