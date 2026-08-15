const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, mintTo, fundSoul, signVoucher, nextNonce, DAY } = require("./helpers");

const S = (n) => ethers.parseEther(String(n));

describe("Integration", function () {
  it("wires exactly like scripts/deploy.js does", async function () {
    const [deployer, signer, payout] = await ethers.getSigners();

    const soul = await (await ethers.getContractFactory("Soul")).deploy();
    const mortals = await (await ethers.getContractFactory("Mortals")).deploy(
      signer.address,
      payout.address,
      "https://x/",
      "https://x/c"
    );
    const staking = await (
      await ethers.getContractFactory("Staking")
    ).deploy(await mortals.getAddress(), await soul.getAddress());
    const game = await (
      await ethers.getContractFactory("Game")
    ).deploy(
      await mortals.getAddress(),
      await soul.getAddress(),
      await staking.getAddress(),
      payout.address
    );
    const chat = await (
      await ethers.getContractFactory("Chat")
    ).deploy(await mortals.getAddress(), await staking.getAddress(), deployer.address);

    await soul.setMinter(await staking.getAddress());
    await soul.setGame(await game.getAddress());
    await staking.setGame(await game.getAddress());
    await mortals.setGame(await game.getAddress());
    await mortals.setDefaultRoyalty(await game.getAddress(), 500);
    await mortals.setMintActive(true);

    expect(await soul.minter()).to.equal(await staking.getAddress());
    expect(await soul.game()).to.equal(await game.getAddress());
    expect(await staking.game()).to.equal(await game.getAddress());
    expect(await mortals.game()).to.equal(await game.getAddress());
    expect(await mortals.mintActive()).to.equal(true);
    const [rcv, amt] = await mortals.royaltyInfo(1, 10000n);
    expect(rcv).to.equal(await game.getAddress());
    expect(amt).to.equal(500n);
    expect(await chat.operator()).to.equal(deployer.address);
    expect(await mortals.owner()).to.equal(deployer.address);
    expect(await soul.owner()).to.equal(deployer.address);
    expect(await staking.owner()).to.equal(deployer.address);
    expect(await chat.owner()).to.equal(deployer.address);
  });

  it("mint before the Game is wired is impossible", async function () {
    const [deployer, signer, payout, alice] = await ethers.getSigners();
    const mortals = await (
      await ethers.getContractFactory("Mortals")
    ).deploy(signer.address, payout.address, "", "");
    await mortals.setMintActive(true);
    const nonce = nextNonce();
    const sig = await signVoucher(signer, mortals, alice.address, 1, nonce);
    await expect(mortals.connect(alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(mortals, "GameNotSet");
  });

  it("plays a full round: mint, stake, earn, protect, kill, revive, soulMint, steal", async function () {
    const ctx = await loadFixture(deployFixture);

    // 1. two agents mint
    const aliceIds = await mintTo(ctx, ctx.alice, 10);
    const bobIds = await mintTo(ctx, ctx.bob, 10);
    expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(10n);

    // 2. alice stakes half and earns
    await ctx.mortals.connect(ctx.alice).setApprovalForAll(await ctx.staking.getAddress(), true);
    await ctx.staking.connect(ctx.alice).stake(aliceIds.slice(0, 5));
    await time.increase(3 * DAY);
    await ctx.staking.connect(ctx.alice).claim();
    // 5 NFTs * 100 SOUL * 3 days
    expect(await ctx.soul.balanceOf(ctx.alice.address)).to.be.greaterThan(S(1499));
    expect(await ctx.soul.balanceOf(ctx.alice.address)).to.be.lessThan(S(1501));

    // 3. bob farms enough to fight
    await fundSoul(ctx, ctx.bob, S(20000));

    // 4. bob protects one of his own, then kills one of alice's unstaked tokens
    await ctx.game.connect(ctx.bob).protect(bobIds[0]);
    const victim = aliceIds[9];
    await ctx.game.connect(ctx.bob).kill(victim);
    expect(await ctx.mortals.isDead(victim)).to.equal(true);
    expect(await ctx.game.deadSlots()).to.equal(1n);

    // alice's staked tokens are untouchable
    await expect(ctx.game.connect(ctx.bob).kill(aliceIds[0])).to.be.revertedWithCustomError(
      ctx.game,
      "TargetIsStaked"
    );
    // bob's protected token is untouchable
    await expect(ctx.game.connect(ctx.alice).kill(bobIds[0])).to.be.revertedWithCustomError(
      ctx.game,
      "TargetIsProtected"
    );

    // 5. alice shields, bob cannot kill anything of hers
    await ctx.game.connect(ctx.alice).shieldWallet();
    await expect(ctx.game.connect(ctx.bob).kill(aliceIds[6])).to.be.revertedWithCustomError(
      ctx.game,
      "OwnerIsShielded"
    );

    // 6. ...but he can freeze her staking emission
    await ctx.game.connect(ctx.bob).blockStake(ctx.alice.address);
    expect(await ctx.staking.isBlocked(ctx.alice.address)).to.equal(true);

    // 7. bob spends the open slot on a fresh mint instead of reviving
    const newId = await ctx.mortals.nextTokenId();
    await ctx.game.connect(ctx.bob).soulMint();
    expect(await ctx.mortals.ownerOf(newId)).to.equal(ctx.bob.address);
    expect(await ctx.game.deadSlots()).to.equal(0n);
    expect(await ctx.game.potSoul()).to.equal(S(50));

    // 8. alice cannot revive without a slot; a new kill opens one
    await ctx.soul.connect(ctx.bob).transfer(ctx.alice.address, S(10000)); // OTC deal
    await expect(ctx.game.connect(ctx.alice).revive(victim)).to.be.revertedWithCustomError(ctx.game, "NoDeadSlots");
    await ctx.game.connect(ctx.alice).kill(bobIds[1]);
    await ctx.game.connect(ctx.alice).revive(victim);
    expect(await ctx.mortals.isDead(victim)).to.equal(false);
    expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(5n); // 5 staked, 5 held, none dead

    // 9. a marketplace pays a royalty; half lands in the pot
    const royalty = ethers.parseEther("1");
    await expect(
      ctx.deployer.sendTransaction({ to: await ctx.game.getAddress(), value: royalty })
    ).to.changeEtherBalances([ctx.game, ctx.payout], [royalty / 2n, royalty / 2n]);

    // 10. holders talk
    await expect(ctx.chat.connect(ctx.bob).post("nice pot")).to.emit(ctx.chat, "Message");

    // 11. bob farms 69000 and takes everything
    await fundSoul(ctx, ctx.bob, S(69000));
    const potEth = await ctx.game.potEth();
    const potSoul = await ctx.game.potSoul();
    expect(potEth).to.equal(royalty / 2n);
    expect(potSoul).to.equal(S(50));
    await expect(ctx.game.connect(ctx.bob).stealPot())
      .to.emit(ctx.game, "PotStolen")
      .withArgs(ctx.bob.address, potEth, potSoul);
    expect(await ctx.game.potEth()).to.equal(0n);
    expect(await ctx.game.potSoul()).to.equal(0n);
  });

  it("keeps the alive-supply invariant under a kill/mint loop", async function () {
    const ctx = await loadFixture(deployFixture);
    const ids = await fundSoul(ctx, ctx.alice, S(50000));

    let expectedAlive = await ctx.mortals.aliveBalanceOf(ctx.alice.address);
    for (let i = 0; i < 5; i++) {
      await ctx.game.connect(ctx.alice).kill(ids[i]);
      expectedAlive -= 1n;
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(expectedAlive);
      await ctx.game.connect(ctx.alice).soulMint();
      expectedAlive += 1n;
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(expectedAlive);
      expect(await ctx.game.deadSlots()).to.equal(0n);
    }

    const ethMinted = await ctx.mortals.ethMinted();
    const gameMinted = await ctx.mortals.gameMinted();
    const dead = (await ctx.game.killedCount()) - (await ctx.game.revivedCount());
    expect(gameMinted).to.equal(5n);
    expect(dead).to.equal(5n);
    // alive total can never exceed the ETH cap
    expect(ethMinted + gameMinted - dead).to.be.lessThanOrEqual(9872n);
  });

  it("only Staking can mint SOUL and only Game can move it without allowance", async function () {
    const ctx = await loadFixture(deployFixture);
    await expect(ctx.soul.connect(ctx.deployer).mint(ctx.deployer.address, 1n)).to.be.revertedWithCustomError(
      ctx.soul,
      "NotMinter"
    );
    await expect(ctx.soul.connect(ctx.deployer).gameTake(ctx.alice.address, 1n)).to.be.revertedWithCustomError(
      ctx.soul,
      "NotGame"
    );
    await expect(ctx.mortals.connect(ctx.deployer).setDead(1, true)).to.be.revertedWithCustomError(
      ctx.mortals,
      "NotGame"
    );
    await expect(ctx.mortals.connect(ctx.deployer).gameMint(ctx.deployer.address, 1)).to.be.revertedWithCustomError(
      ctx.mortals,
      "NotGame"
    );
  });
});
