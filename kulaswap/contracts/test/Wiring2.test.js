const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("KulaLottoWiring — one transaction, nobody holding anything", function () {
  let lp, kula, veKula, wiring, mwali, gauge, lotto, admin, alice, bob;
  const RATE = ethers.parseEther("0.01");          // MWALI per second
  const PER_TICKET = ethers.parseEther("10");
  const CAP = ethers.parseEther("3468960");        // 1.1x the ~3.15M lifetime

  beforeEach(async () => {
    [admin, alice, bob] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ERC20Base");
    lp = await T.deploy("LP", "LP", ethers.MaxUint256, admin.address);
    kula = await T.deploy("Kula", "KULA", ethers.MaxUint256, admin.address);
    veKula = await T.deploy("veKula", "veKULA", ethers.MaxUint256, admin.address);
    wiring = await (await ethers.getContractFactory("KulaLottoWiring")).deploy(
      await lp.getAddress(), RATE, CAP, await kula.getAddress(), await veKula.getAddress(),
      PER_TICKET, 30000, ethers.parseEther("1000"));
    mwali = await ethers.getContractAt("MwaliToken", await wiring.mwali());
    gauge = await ethers.getContractAt("MwaliGauge", await wiring.gauge());
    lotto = await ethers.getContractAt("BurnLotto", await wiring.lotto());
  });

  it("⚠ one deploy wires everything and seals it — no admin anywhere", async () => {
    expect(await wiring.isSealed()).to.equal(true);
    expect(await mwali.getRoleMemberCount(await mwali.DEFAULT_ADMIN_ROLE())).to.equal(0n);
    expect(await mwali.getRoleMemberCount(await mwali.MINTER_ROLE())).to.equal(1n);
    expect(await mwali.hasRole(await mwali.MINTER_ROLE(), await gauge.getAddress())).to.equal(true);
  });

  it("⚠ the gauge MINTS MWALI to stakers — no pre-funded pile, no distributor account", async () => {
    await lp.mint(alice.address, ethers.parseEther("100"));
    await lp.connect(alice).approve(await gauge.getAddress(), ethers.MaxUint256);
    expect(await mwali.totalSupply()).to.equal(0n);
    await gauge.connect(alice).stake(ethers.parseEther("100"));
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine");
    expect(await gauge.earned(alice.address)).to.be.greaterThan(0n);
    await gauge.connect(alice).claim();
    const got = await mwali.balanceOf(alice.address);
    expect(got).to.be.greaterThan(ethers.parseEther("9"));     // ~1000s * 0.01
    expect(await mwali.totalSupply()).to.equal(got, "minted into existence, not transferred");
  });

  it("⚠ rewards split pro-rata and LP is never locked in", async () => {
    for (const s of [alice, bob]) {
      await lp.mint(s.address, ethers.parseEther("100"));
      await lp.connect(s).approve(await gauge.getAddress(), ethers.MaxUint256);
    }
    await gauge.connect(alice).stake(ethers.parseEther("75"));
    await gauge.connect(bob).stake(ethers.parseEther("25"));
    await ethers.provider.send("evm_increaseTime", [1000]);
    await ethers.provider.send("evm_mine");
    const a = await gauge.earned(alice.address), b = await gauge.earned(bob.address);
    expect(a).to.be.greaterThan(b * 2n, "75% of the stake earns most of it");
    await gauge.connect(bob).exit();
    expect(await lp.balanceOf(bob.address)).to.equal(ethers.parseEther("100"), "all LP returned");
  });

  it("⚠ FULL LOOP: stake LP, earn MWALI, burn it for tickets, win KULA", async () => {
    await lp.mint(alice.address, ethers.parseEther("100"));
    await lp.connect(alice).approve(await gauge.getAddress(), ethers.MaxUint256);
    await gauge.connect(alice).stake(ethers.parseEther("100"));
    await ethers.provider.send("evm_increaseTime", [10000]);   // ~100 MWALI
    await ethers.provider.send("evm_mine");
    await gauge.connect(alice).claim();

    const minted = await mwali.totalSupply();
    await mwali.connect(alice).approve(await lotto.getAddress(), ethers.MaxUint256);
    await lotto.connect(alice).enter(5);                        // burns 50 MWALI
    expect(await mwali.totalSupply()).to.equal(minted - PER_TICKET * 5n, "MWALI left supply");

    await kula.mint(bob.address, ethers.parseEther("40"));
    await kula.connect(bob).approve(await lotto.getAddress(), ethers.MaxUint256);
    await lotto.connect(bob).fundPrize(ethers.parseEther("40"));  // a stranger funds it

    const salt = ethers.hexlify(ethers.randomBytes(32));
    await lotto.connect(bob).commitDraw(await lotto.saltHashOf(salt));  // a stranger draws
    await ethers.provider.send("evm_mine"); await ethers.provider.send("evm_mine");
    const before = await kula.balanceOf(alice.address);
    await lotto.connect(bob).revealDraw(salt);
    expect(await kula.balanceOf(alice.address) - before).to.equal(ethers.parseEther("40"));
  });

  it("⚠ nobody can ever add a second minter", async () => {
    await expect(mwali.grantRole(await mwali.MINTER_ROLE(), alice.address)).to.be.reverted;
    await expect(mwali.connect(alice).grantRole(await mwali.MINTER_ROLE(), alice.address)).to.be.reverted;
  });

  it("⚠ total emission is BOUNDED — a closed form, not 'forever'", async () => {
    const lifetime = await gauge.lifetimeEmission();
    // first-year / (1 - 0.9) = 10x first year.  0.01/sec * 365d = 315,360 -> 3,153,600
    expect(lifetime).to.equal(RATE * 365n * 24n * 3600n * 10n);
    expect(lifetime).to.be.lessThan(await mwali.cap(), "the cap sits above the schedule");
  });

  it("⚠ the rate DECAYS 10% a year rather than running flat forever", async () => {
    const y0 = await gauge.currentRate();
    expect(y0).to.equal(RATE);
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
    await ethers.provider.send("evm_mine");
    expect(await gauge.currentRate()).to.equal((RATE * 9000n) / 10000n);
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 3600]);
    await ethers.provider.send("evm_mine");
    expect(await gauge.currentRate()).to.equal((RATE * 9000n * 9000n) / 100000000n);
  });

  it("⚠ the CAP is enforced in the token, not trusted to the gauge", async () => {
    const small = await (await ethers.getContractFactory("MwaliToken")).deploy(admin.address, ethers.parseEther("100"));
    await small.grantRole(await small.MINTER_ROLE(), admin.address);
    await small.mint(alice.address, ethers.parseEther("100"));
    await expect(small.mint(alice.address, 1n)).to.be.revertedWithCustomError(small, "CapExceeded");
    expect(await small.remainingMintable()).to.equal(0n);
  });

  it("⚠ burning does NOT raise the ceiling — the cap counts everything ever minted", async () => {
    const small = await (await ethers.getContractFactory("MwaliToken")).deploy(admin.address, ethers.parseEther("100"));
    await small.grantRole(await small.MINTER_ROLE(), admin.address);
    await small.mint(alice.address, ethers.parseEther("100"));
    await small.connect(alice).burn(ethers.parseEther("60"));
    expect(await small.totalSupply()).to.equal(ethers.parseEther("40"));
    expect(await small.remainingMintable()).to.equal(0n, "burned supply is not re-mintable");
    await expect(small.mint(alice.address, 1n)).to.be.revertedWithCustomError(small, "CapExceeded");
  });

  it("the gauge has no admin, owner or pause", async () => {
    const names = gauge.interface.fragments.filter(f => f.type === "function").map(f => f.name);
    for (const banned of ["owner", "transferOwnership", "pause", "grantRole", "setRate"]) {
      expect(names).to.not.include(banned);
    }
  });
});
