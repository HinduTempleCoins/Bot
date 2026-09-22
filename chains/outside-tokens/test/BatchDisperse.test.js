const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchDisperse", function () {
  let token, disp, sender, r1, r2, r3;

  beforeEach(async () => {
    [sender, r1, r2, r3] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockERC20");
    token = await Mock.deploy("Env", "BALM");
    const D = await ethers.getContractFactory("BatchDisperse");
    disp = await D.deploy();
    await token.mint(sender.address, ethers.parseUnits("1000000", 18));
  });

  it("disperses per-recipient amounts and holds no balance", async () => {
    const recipients = [r1.address, r2.address, r3.address];
    const amounts = [100n, 250n, 650n];
    const total = 1000n;
    await token.connect(sender).approve(await disp.getAddress(), total);
    await expect(disp.connect(sender).disperse(await token.getAddress(), recipients, amounts))
      .to.emit(disp, "Dispersed")
      .withArgs(await token.getAddress(), sender.address, 3n, total);

    expect(await token.balanceOf(r1.address)).to.equal(100n);
    expect(await token.balanceOf(r2.address)).to.equal(250n);
    expect(await token.balanceOf(r3.address)).to.equal(650n);
    expect(await token.balanceOf(await disp.getAddress())).to.equal(0n);
  });

  it("disperseEqual sends the same amount to all", async () => {
    const recipients = [r1.address, r2.address, r3.address];
    const each = 500n;
    await token.connect(sender).approve(await disp.getAddress(), each * 3n);
    await disp.connect(sender).disperseEqual(await token.getAddress(), recipients, each);
    expect(await token.balanceOf(r2.address)).to.equal(each);
  });

  it("reverts on length mismatch and empty list", async () => {
    await token.connect(sender).approve(await disp.getAddress(), 1000n);
    await expect(
      disp.connect(sender).disperse(await token.getAddress(), [r1.address, r2.address], [100n])
    ).to.be.revertedWithCustomError(disp, "LengthMismatch");
    await expect(
      disp.connect(sender).disperse(await token.getAddress(), [], [])
    ).to.be.revertedWithCustomError(disp, "EmptyRecipients");
  });
});
