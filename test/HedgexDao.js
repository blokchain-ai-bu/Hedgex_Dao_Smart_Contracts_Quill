const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("HedgexDao", function () {
  // Helpers
  const U = (n, decs = 18) => ethers.utils.parseUnits(String(n), decs);
  const ZERO = 0n;

  async function deployFixture() {
    const [owner, alice, bob, carol, pair1, pair2, router, stranger] =
      await ethers.getSigners();

    const name = "HedgexDao";
    const symbol = "HGXD";
    const initialSupply = U("25000000");   // 25_000_000
    const maxSupply     = U("30000000");  // 30_000_000
    const supplyFloor   = U("20000000");    // 20_000_000

    const HedgexToken = await ethers.getContractFactory("HedgexToken");
    const token = await HedgexToken.deploy(
      name,
      symbol,
      initialSupply,
      maxSupply,
      supplyFloor
    );

    return {
      owner,
      alice,
      bob,
      carol,
      pair1,
      pair2,
      router,
      stranger,
      token,
      name,
      symbol,
      initialSupply,
      maxSupply,
      supplyFloor,
    };
  }

  // ------------------------------
  // Deployment & initial state
  // ------------------------------
  it("deploys with correct initial state", async () => {
    const { token, owner, initialSupply, maxSupply, supplyFloor } = await loadFixture(deployFixture);

    expect(await token.name()).to.equal("HedgexDao");
    expect(await token.symbol()).to.equal("HGXD");
    expect(await token.decimals()).to.equal(18);

    expect(await token.totalSupply()).to.equal(initialSupply);
    expect(await token.cap()).to.equal(maxSupply);
    expect(await token.supplyFloor()).to.equal(supplyFloor);

    // Owner & contract are excluded by default (as per constructor)
    expect(await token.isExcludedFromFee(owner.address)).to.equal(true);
    expect(await token.isExcludedFromFee(token.address)).to.equal(true);

    // Holders count: initial mint to owner -> 1
    expect(await token.holdersCount()).to.equal(1);
  });

  // ------------------------------
  // Owner configuration
  // ------------------------------
  it("only owner can set AMM pair and emits event", async () => {
    const { token, owner, pair1, stranger } = await loadFixture(deployFixture);

    await expect(token.connect(stranger).setAutomatedMarketMakerPair(pair1.address, true))
      .to.be.revertedWith("Ownable: caller is not the owner");

    await expect(token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true))
      .to.emit(token, "AutomatedMarketMakerPairSet")
      .withArgs(pair1.address, true);

    expect(await token.automatedMarketMakerPairs(pair1.address)).to.equal(true);

    // Can unset
    await expect(token.setAutomatedMarketMakerPair(pair1.address, false))
      .to.emit(token, "AutomatedMarketMakerPairSet")
      .withArgs(pair1.address, false);

    expect(await token.automatedMarketMakerPairs(pair1.address)).to.equal(false);
  });

  it("only owner can (un)exclude from fee and emits event", async () => {
    const { token, owner, alice, stranger } = await loadFixture(deployFixture);

    await expect(token.connect(stranger).setExcludedFromFee(alice.address, true))
      .to.be.revertedWith("Ownable: caller is not the owner");

    await expect(token.connect(owner).setExcludedFromFee(alice.address, true))
      .to.emit(token, "ExcludedFromFee")
      .withArgs(alice.address, true);

    expect(await token.isExcludedFromFee(alice.address)).to.equal(true);

    await expect(token.setExcludedFromFee(alice.address, false))
      .to.emit(token, "ExcludedFromFee")
      .withArgs(alice.address, false);

    expect(await token.isExcludedFromFee(alice.address)).to.equal(false);
  });

  it("burnTax cannot exceed burnTaxCap; emits BurnTaxUpdated", async () => {
    const { token, owner } = await loadFixture(deployFixture);

    // default cap = 100 (1.00%)
    expect(await token.burnTax()).to.equal(10);      // 0.10% default
    expect(await token.burnTaxCap()).to.equal(100);  // 1.00%

    // success: set to cap
    await expect(token.connect(owner).setBurnTax(100))
      .to.emit(token, "BurnTaxUpdated")
      .withArgs(10, 100);

    expect(await token.burnTax()).to.equal(100);

    // revert if > cap
    await expect(token.connect(owner).setBurnTax(101)).to.be.revertedWith("Burn tax > cap");
  });

  it("only owner can set supply floor; floor must be <= cap()", async () => {
    const { token, owner, maxSupply } = await loadFixture(deployFixture);

    const oldFloor = await token.supplyFloor();
    const newFloor = "30000000000000000000000000";

    await expect(token.connect(owner).setSupplyFloor(newFloor))
      .to.emit(token, "SupplyFloorUpdated")
      .withArgs(oldFloor, newFloor);

    expect(await token.supplyFloor()).to.equal(newFloor);

    await expect(token.connect(owner).setSupplyFloor(maxSupply + U(1)))
      .to.be.revertedWith("Floor > cap");
  });

  // ------------------------------
  // Snapshot (only owner)
  // ------------------------------
  it("owner can snapshot; non-owner cannot read current snapshot", async () => {
    const { token, owner, stranger } = await loadFixture(deployFixture);

    await expect(token.connect(owner).snapshot())
      .to.emit(token, "Snapshot"); // OZ ERC20Snapshot emits Snapshot(uint256)

    const id = await token.connect(owner).getCurrentSnapshot();
    expect(id.gt(ZERO)).to.equal(true);

    await expect(token.connect(stranger).getCurrentSnapshot())
      .to.be.revertedWith("Ownable: caller is not the owner");
  });

  // ------------------------------
  // Mint / Burn / Cap
  // ------------------------------
  it("mint is owner-only and respects cap", async () => {
    const { token, owner, stranger, maxSupply } = await loadFixture(deployFixture);

    // Non-owner revert
    await expect(token.connect(stranger).mint(stranger.address, U(1)))
      .to.be.revertedWith("Ownable: caller is not the owner");

    // Mint up to cap
    const remaining = BigInt(await token.cap()) - BigInt(await token.totalSupply());

    await token.connect(owner).mint(owner.address, remaining);
    expect(await token.totalSupply()).to.equal(maxSupply);

    // Exceed cap reverts
    await expect(token.connect(owner).mint(owner.address, 1)).to.be.reverted; // OZ specific revert
  });

  it("anyone can burn own tokens; burnFrom needs allowance", async () => {
    const { token, owner, alice } = await loadFixture(deployFixture);

    // Give Alice some tokens
    await token.transfer(alice.address, U(100));

    // burn() by Alice
    await token.connect(alice).burn(U(20));
    expect(await token.balanceOf(alice.address)).to.equal(U(80));

    // burnFrom by owner requires approval
    await expect(token.connect(owner).burnFrom(alice.address, U(10))).to.be.reverted; // no allowance
    await token.connect(alice).approve(owner.address, U(10));
    await token.connect(owner).burnFrom(alice.address, U(10));
    expect(await token.balanceOf(alice.address)).to.equal(U(70));
  });

  // ------------------------------
  // Views
  // ------------------------------
  it("isBurnActive / remainingBurnableUntilFloor reflect floor & tax", async () => {
    const { token, owner } = await loadFixture(deployFixture);

    // default burnTax=10 bps and totalSupply > floor => active
    expect(await token.isBurnActive()).to.equal(true);

    // Set tax to 0 => inactive
    await token.connect(owner).setBurnTax(0);
    expect(await token.isBurnActive()).to.equal(false);

    // restore tax
    await token.connect(owner).setBurnTax(10);
    const ts = await token.totalSupply();
    const floor = await token.supplyFloor();
    expect(await token.remainingBurnableUntilFloor()).to.equal(BigInt(ts) - BigInt(floor));

    // Move floor == totalSupply -> inactive
    await token.connect(owner).setSupplyFloor(ts);
    expect(await token.isBurnActive()).to.equal(false);
    expect(await token.remainingBurnableUntilFloor()).to.equal(0n);
  });

  // ------------------------------
  // Transfer & Tax Logic
  // ------------------------------
  describe("Taxed transfers (AMM pairs)", function () {
    it("no tax for regular EOA→EOA transfers", async () => {
      const { token, owner, alice, bob } = await loadFixture(deployFixture);

      await token.transfer(alice.address, U(1000));
      const tsBefore = await token.totalSupply();

      await expect(token.connect(alice).transfer(bob.address, U(100)))
        .to.not.emit(token, "TaxBurnApplied");

      expect(await token.totalSupply()).to.equal(tsBefore);
      expect(await token.balanceOf(bob.address)).to.equal(U(100));
    });

    it("sell (user→pair) burns fee up to floor and emits TaxBurnApplied", async () => {
      const { token, owner, alice, pair1 } = await loadFixture(deployFixture);

      // mark AMM pair
      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);

      // fund Alice
      await token.transfer(alice.address, U(10_000));

      // ensure neither side excluded
      expect(await token.isExcludedFromFee(alice.address)).to.equal(false);
      expect(await token.isExcludedFromFee(pair1.address)).to.equal(false);

      // burnTax defaults to 10 bps (0.10%)
      const amount = U(1_000);
      const tsBefore = await token.totalSupply();
      const burnTax = BigInt(await token.burnTax());
      const denom = 10_000n;

      const expectedFee = (BigInt(amount) * BigInt(burnTax)) / BigInt(denom); // room should be enough here
      const expectedSend = BigInt(amount) - expectedFee;

      await expect(token.connect(alice).transfer(pair1.address, amount))
        .to.emit(token, "TaxBurnApplied")
        .withArgs(alice.address, pair1.address, expectedFee, BigInt(tsBefore) - BigInt(expectedFee));

      // totalSupply reduced by fee
      expect(await token.totalSupply()).to.equal(BigInt(tsBefore) - BigInt(expectedFee));
      // pair receives amount - fee
      expect(await token.balanceOf(pair1.address)).to.equal(expectedSend);
    });

    it("buy (pair→user) also burns unless excluded", async () => {
      const { token, owner, bob, pair1 } = await loadFixture(deployFixture);

      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);

      // owner mints to pair (onlyOwner)
      await token.connect(owner).mint(pair1.address, U(5000));
      const tsBefore = await token.totalSupply();

      const amount = U(1000);
      const burnTax = BigInt(await token.burnTax());
      const denom = 10_000n;
      const expectedFee = (BigInt(amount) * BigInt(burnTax)) / BigInt(denom);
      const expectedSend = BigInt(amount) - BigInt(expectedFee);

      await expect(token.connect(pair1).transfer(bob.address, amount))
        .to.emit(token, "TaxBurnApplied")
        .withArgs(pair1.address, bob.address, expectedFee, BigInt(tsBefore) - BigInt(expectedFee));

      expect(await token.balanceOf(bob.address)).to.equal(expectedSend);
      expect(await token.totalSupply()).to.equal(BigInt(tsBefore) - BigInt(expectedFee));
    });

    it("pair→pair transfer burns (can break multi-hop, but contract allows it)", async () => {
      const { token, owner, pair1, pair2 } = await loadFixture(deployFixture);

      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);
      await token.connect(owner).setAutomatedMarketMakerPair(pair2.address, true);

      await token.connect(owner).mint(pair1.address, U(2000));
      const tsBefore = await token.totalSupply();

      const amount = U(1000);
      const burnTax = BigInt(await token.burnTax());
      const denom = 10_000n;
      const expectedFee = (BigInt(amount) * BigInt(burnTax)) / BigInt(denom);
      const expectedSend = BigInt(amount) - BigInt(expectedFee);

      await expect(token.connect(pair1).transfer(pair2.address, amount))
        .to.emit(token, "TaxBurnApplied")
        .withArgs(pair1.address, pair2.address, expectedFee, BigInt(tsBefore) - BigInt(expectedFee));

      expect(await token.balanceOf(pair2.address)).to.equal(expectedSend);
      expect(await token.totalSupply()).to.equal(BigInt(tsBefore) - BigInt(expectedFee));
    });

    it("exclusion on either side disables tax", async () => {
      const { token, owner, alice, pair1 } = await loadFixture(deployFixture);

      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);
      await token.transfer(alice.address, U(1000));

      // exclude pair
      await token.connect(owner).setExcludedFromFee(pair1.address, true);

      const tsBefore = await token.totalSupply();
      await expect(token.connect(alice).transfer(pair1.address, U(100)))
        .to.not.emit(token, "TaxBurnApplied");

      expect(await token.totalSupply()).to.equal(tsBefore);
    });

    it("clamps fee to not burn below the supply floor", async () => {
      const { token, owner, alice, pair1 } = await loadFixture(deployFixture);

      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);
      await token.transfer(alice.address, U(10_000));

      // raise tax to 1%
      await token.connect(owner).setBurnTax(100);

      const amount = U(1000);       // fee at 1% = 10
      const desiredRoom = U(5);     // set floor so only 5 can be burned
      const tsStart = await token.totalSupply();
      await token.connect(owner).setSupplyFloor(BigInt(tsStart) - BigInt(desiredRoom));

      const expectedFee = desiredRoom; // fee (10) > room (5) => burn only 5
      const expectedSend = BigInt(amount) - BigInt(expectedFee);

      await expect(token.connect(alice).transfer(pair1.address, amount))
        .to.emit(token, "TaxBurnApplied")
        .withArgs(alice.address, pair1.address, expectedFee, BigInt(tsStart) - BigInt(expectedFee));

      expect(await token.balanceOf(pair1.address)).to.equal(expectedSend);
      expect(await token.totalSupply()).to.equal(BigInt(tsStart) - BigInt(expectedFee));
    });

    it("when totalSupply == supplyFloor, no tax applies", async () => {
      const { token, owner, alice, pair1 } = await loadFixture(deployFixture);

      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);
      await token.transfer(alice.address, U(1000));

      // Set floor to current totalSupply
      const ts = await token.totalSupply();
      await token.connect(owner).setSupplyFloor(ts);

      await expect(token.connect(alice).transfer(pair1.address, U(100)))
        .to.not.emit(token, "TaxBurnApplied");

      expect(await token.totalSupply()).to.equal(ts);
    });

    it("when burnTax == 0, no tax applies", async () => {
      const { token, owner, alice, pair1 } = await loadFixture(deployFixture);

      await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);
      await token.transfer(alice.address, U(1000));

      await token.connect(owner).setBurnTax(0);

      const ts = await token.totalSupply();
      await expect(token.connect(alice).transfer(pair1.address, U(100)))
        .to.not.emit(token, "TaxBurnApplied");

      expect(await token.totalSupply()).to.equal(ts);
    });
  });

  // ------------------------------
  // Holders count logic
  // ------------------------------
  describe("Holders count", function () {
    it("increments on first nonzero balance and decrements when a holder goes to zero", async () => {
      const { token, owner, alice, bob } = await loadFixture(deployFixture);

      // initial: 1 (owner)
      expect(await token.holdersCount()).to.equal(1);

      // owner -> alice (EOA transfer, no tax)
      await token.transfer(alice.address, U(100));
      expect(await token.holdersCount()).to.equal(2);

      // alice -> bob (EOA transfer, no tax)
      await token.connect(alice).transfer(bob.address, U(30));
      expect(await token.holdersCount()).to.equal(3);

      // bob -> alice empty bob
      await token.connect(bob).transfer(alice.address, U(30));
      expect(await token.balanceOf(bob.address)).to.equal(0);
      expect(await token.holdersCount()).to.equal(2);

      // burn alice down to zero
      const aBal = await token.balanceOf(alice.address);
      await token.connect(alice).burn(aBal);
      expect(await token.balanceOf(alice.address)).to.equal(0);
      expect(await token.holdersCount()).to.equal(1);
    });

    it("mint to a fresh address increments; burn from that address decrements", async () => {
      const { token, owner, carol } = await loadFixture(deployFixture);

      const before = await token.holdersCount();
      await token.connect(owner).mint(carol.address, U(42));
      expect(await token.holdersCount()).to.equal(BigInt(before) + BigInt(1));

      await token.connect(carol).burn(U(42));
      expect(await token.holdersCount()).to.equal(before);
    });

    it("self-transfer does not change holders count", async () => {
      const { token, owner } = await loadFixture(deployFixture);

      const countBefore = await token.holdersCount();
      await token.transfer(owner.address, U(1)); // self-transfer
      expect(await token.holdersCount()).to.equal(countBefore);
    });
  });

  // ------------------------------
  // ERC20Votes (basic sanity)
  // ------------------------------
  describe("Votes integration", function () {
    it("delegation & vote power track balances across mint/transfer/burn", async () => {
      const { token, owner, alice, bob } = await loadFixture(deployFixture);

      // Mint to Alice and Bob
      await token.connect(owner).mint(alice.address, U(1000));
      await token.connect(owner).mint(bob.address, U(1000));

      // Self-delegate
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);

      // Mine a block so checkpoints are created
      await mine(1);

      expect(await token.getVotes(alice.address)).to.equal(U(1000));
      expect(await token.getVotes(bob.address)).to.equal(U(1000));

      // Alice transfers to Bob
      await token.connect(alice).transfer(bob.address, U(100));
      await mine(1);

      expect(await token.getVotes(alice.address)).to.equal(U(900));
      expect(await token.getVotes(bob.address)).to.equal(U(1100));

      // Bob burns 50
      await token.connect(bob).burn(U(50));
      await mine(1);
      expect(await token.getVotes(bob.address)).to.equal(U(1050));
    });
  });

  // ------------------------------
  // Events / miscellaneous
  // ------------------------------
  it("TaxBurnApplied emits new total supply as 4th arg per implementation", async () => {
    const { token, owner, alice, pair1 } = await loadFixture(deployFixture);

    await token.connect(owner).setAutomatedMarketMakerPair(pair1.address, true);
    await token.transfer(alice.address, U(1000));

    const tsBefore = await token.totalSupply();
    const amount = U(100);
    const burnTax = BigInt(await token.burnTax());
    const denom = 10_000n;
    const fee = (BigInt(amount) * BigInt(burnTax)) / BigInt(denom);

    await expect(token.connect(alice).transfer(pair1.address, amount))
      .to.emit(token, "TaxBurnApplied")
      .withArgs(alice.address, pair1.address, fee, BigInt(tsBefore) - BigInt(fee));
  });
});
