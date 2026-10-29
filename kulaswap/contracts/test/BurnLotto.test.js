const { expect } = require("chai");
const { ethers } = require("hardhat");

// The property under test is the one the no-loss design got wrong:
// entry money must LEAVE SUPPLY, not come back.
describe("BurnLotto — burn MWALI, win KULA", function () {
  let kula, mwali, veKula, lotto, admin, a, b;
  const PRICE = ethers.parseEther("10");       // MWALI per base ticket
  const K_HALF = ethers.parseEther("1000");    // veKULA half-way point

  beforeEach(async () => {
    [admin, a, b] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ERC20Base");
    kula = await T.deploy("Kula", "KULA", ethers.MaxUint256, admin.address);
    mwali = await T.deploy("Soma", "MWALI", ethers.MaxUint256, admin.address);
    veKula = await T.deploy("veKula", "veKULA", ethers.MaxUint256, admin.address);
    const L = await ethers.getContractFactory("BurnLotto");
    lotto = await L.deploy(await mwali.getAddress(), await kula.getAddress(), await veKula.getAddress(),
      PRICE, 30000, K_HALF);
    for (const s of [a, b, admin]) {
      await mwali.mint(s.address, ethers.parseEther("1000"));
      await kula.mint(s.address, ethers.parseEther("1000"));
      await mwali.connect(s).approve(await lotto.getAddress(), ethers.MaxUint256);
      await kula.connect(s).approve(await lotto.getAddress(), ethers.MaxUint256);
    }
  });

  it("⚠ entering burns MWALI — MWALI supply falls, KULA supply does NOT", async () => {
    const somaBefore = await mwali.totalSupply(), kulaBefore = await kula.totalSupply();
    await lotto.connect(a).enter(3);
    expect(somaBefore - await mwali.totalSupply()).to.equal(PRICE * 3n);
    expect(await kula.totalSupply()).to.equal(kulaBefore, "KULA is not burned here");
    expect(await lotto.totalBurned()).to.equal(PRICE * 3n);
  });

  it("⚠ burning the reward token, not the prize token — the two are different on purpose", async () => {
    expect(await lotto.mwali()).to.equal(await mwali.getAddress());
    expect(await lotto.kula()).to.equal(await kula.getAddress());
    expect(await lotto.mwali()).to.not.equal(await lotto.kula());
  });

  it("⚠ veKULA boosts tickets per MWALI burned, and the MWALI cost does not change", async () => {
    await veKula.mint(b.address, K_HALF);            // exactly the half-way point -> 2x
    expect(await lotto.boostBpsOf(a.address)).to.equal(10000n);
    expect(await lotto.boostBpsOf(b.address)).to.equal(20000n);
    const somaBefore = await mwali.balanceOf(b.address);
    await lotto.connect(a).enter(10);
    await lotto.connect(b).enter(10);
    expect(await lotto.ticketsOf(a.address)).to.equal(10n);
    expect(await lotto.ticketsOf(b.address)).to.equal(20n, "same MWALI, double the tickets");
    expect(somaBefore - await mwali.balanceOf(b.address)).to.equal(PRICE * 10n, "boost is free weight");
  });

  it("the boost curve matches kula-farm.mjs: 1 + (max-1)*v/(v+k), capped", async () => {
    await veKula.mint(b.address, K_HALF * 9n);       // v/(v+k) = 0.9 -> 1 + 2*0.9 = 2.8x
    expect(await lotto.boostBpsOf(b.address)).to.equal(28000n);
  });

  it("⚠ the contract holds NO MWALI afterwards — there is nothing to give back", async () => {
    await lotto.connect(a).enter(5);
    expect(await mwali.balanceOf(await lotto.getAddress())).to.equal(0n);
  });

  it("⚠ there is no way to withdraw an entry", async () => {
    expect(lotto.interface.fragments.some(f => f.type === "function" && /withdraw|refund|exit/i.test(f.name || "")))
      .to.equal(false);
  });

  it("the prize pot is funded separately and is not entry money", async () => {
    await lotto.connect(a).enter(2);
    await lotto.fundPrize(ethers.parseEther("100"));
    expect(await lotto.prizePool()).to.equal(ethers.parseEther("100"));
    expect(await kula.balanceOf(await lotto.getAddress())).to.equal(ethers.parseEther("100"));
  });

  it("pays the whole pot to a ticket holder and resets the round", async () => {
    await lotto.connect(a).enter(4);
    await lotto.fundPrize(ethers.parseEther("50"));
    const salt = ethers.hexlify(ethers.randomBytes(32));
    await lotto.commitDraw(await lotto.saltHashOf(salt));
    await ethers.provider.send("evm_mine"); await ethers.provider.send("evm_mine");
    const before = await kula.balanceOf(a.address);
    await lotto.revealDraw(salt);
    expect(await kula.balanceOf(a.address) - before).to.equal(ethers.parseEther("50"));
    expect(await lotto.prizePool()).to.equal(0n);
    expect(await lotto.ticketCount()).to.equal(0n);
    expect(await lotto.ticketsOf(a.address)).to.equal(0n);
    expect(await lotto.roundId()).to.equal(1n);
  });

  it("⚠ a full round: MWALI supply falls, KULA only moves", async () => {
    const somaStart = await mwali.totalSupply(), kulaStart = await kula.totalSupply();
    await lotto.connect(a).enter(10);
    await lotto.fundPrize(ethers.parseEther("40"));
    const salt = ethers.hexlify(ethers.randomBytes(32));
    await lotto.commitDraw(await lotto.saltHashOf(salt));
    await ethers.provider.send("evm_mine"); await ethers.provider.send("evm_mine");
    await lotto.revealDraw(salt);
    expect(somaStart - await mwali.totalSupply()).to.equal(ethers.parseEther("100"), "MWALI sunk");
    expect(await kula.totalSupply()).to.equal(kulaStart, "KULA redistributed, never destroyed");
  });

  it("refuses a draw with no tickets or no pot", async () => {
    const h = await lotto.saltHashOf(ethers.hexlify(ethers.randomBytes(32)));
    await expect(lotto.commitDraw(h)).to.be.revertedWithCustomError(lotto, "NothingToDraw");
    await lotto.connect(a).enter(1);
    await expect(lotto.commitDraw(h)).to.be.revertedWithCustomError(lotto, "NothingToDraw");
  });

  it("⚠ nobody can buy in after the draw is committed", async () => {
    await lotto.connect(a).enter(1);
    await lotto.fundPrize(ethers.parseEther("5"));
    await lotto.commitDraw(await lotto.saltHashOf(ethers.hexlify(ethers.randomBytes(32))));
    await expect(lotto.connect(b).enter(1)).to.be.revertedWithCustomError(lotto, "DrawOpen");
  });

  it("a wrong salt cannot reveal", async () => {
    await lotto.connect(a).enter(1);
    await lotto.fundPrize(ethers.parseEther("5"));
    await lotto.commitDraw(await lotto.saltHashOf(ethers.hexlify(ethers.randomBytes(32))));
    await ethers.provider.send("evm_mine"); await ethers.provider.send("evm_mine");
    await expect(lotto.revealDraw(ethers.hexlify(ethers.randomBytes(32))))
      .to.be.revertedWithCustomError(lotto, "BadSalt");
  });

  it("reveal is refused before the delay", async () => {
    await lotto.connect(a).enter(1);
    await lotto.fundPrize(ethers.parseEther("5"));
    const salt = ethers.hexlify(ethers.randomBytes(32));
    await lotto.commitDraw(await lotto.saltHashOf(salt));
    await expect(lotto.revealDraw(salt)).to.be.revertedWithCustomError(lotto, "TooEarly");
  });

  it("⚠ an expired commit is cleared WITHOUT eating the tickets or the pot", async () => {
    await lotto.connect(a).enter(3);
    await lotto.fundPrize(ethers.parseEther("7"));
    await lotto.commitDraw(await lotto.saltHashOf(ethers.hexlify(ethers.randomBytes(32))));
    for (let i = 0; i < 260; i++) await ethers.provider.send("evm_mine");
    await lotto.clearExpiredDraw();
    expect(await lotto.ticketCount()).to.equal(3n);
    expect(await lotto.prizePool()).to.equal(ethers.parseEther("7"));
  });

  it("⚠ NOBODY custodies it — no owner, no admin, no roles at all", async () => {
    const names = lotto.interface.fragments.filter(f => f.type === "function").map(f => f.name);
    for (const banned of ["owner", "transferOwnership", "grantRole", "hasRole", "renounceRole", "DEFAULT_ADMIN_ROLE"]) {
      expect(names).to.not.include(banned, `BurnLotto must not expose ${banned}`);
    }
  });

  it("⚠ funding the pot is permissionless — a stranger or a contract can push KULA in", async () => {
    await lotto.connect(a).enter(1);
    await lotto.connect(b).fundPrize(ethers.parseEther("25"));
    expect(await lotto.prizePool()).to.equal(ethers.parseEther("25"));
  });

  it("⚠ drawing is permissionless — a stranger can commit and reveal", async () => {
    await lotto.connect(a).enter(2);
    await lotto.connect(b).fundPrize(ethers.parseEther("9"));
    const salt = ethers.hexlify(ethers.randomBytes(32));
    await lotto.connect(b).commitDraw(await lotto.saltHashOf(salt));
    await ethers.provider.send("evm_mine"); await ethers.provider.send("evm_mine");
    const before = await kula.balanceOf(a.address);
    await lotto.connect(b).revealDraw(salt);
    expect(await kula.balanceOf(a.address) - before).to.equal(ethers.parseEther("9"),
      "the only ticket holder won, even though a stranger ran the draw");
  });

  it("⚠ a griefer who commits and never reveals only stalls one window", async () => {
    await lotto.connect(a).enter(2);
    await lotto.fundPrize(ethers.parseEther("9"));
    await lotto.connect(b).commitDraw(await lotto.saltHashOf(ethers.hexlify(ethers.randomBytes(32))));
    for (let i = 0; i < 260; i++) await ethers.provider.send("evm_mine");
    await lotto.connect(a).clearExpiredDraw();        // anyone clears it
    expect(await lotto.ticketCount()).to.equal(2n, "tickets survive");
    expect(await lotto.prizePool()).to.equal(ethers.parseEther("9"), "pot survives");
  });

  it("more tickets means more weight", async () => {
    await lotto.connect(a).enter(1);
    await lotto.connect(b).enter(9);
    expect(await lotto.ticketCount()).to.equal(10n);
    expect(await lotto.ticketsOf(b.address)).to.equal(9n);
  });
});
