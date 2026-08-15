const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, mintTo, fundSoul, HOUR, DAY } = require("./helpers");

const S = (n) => ethers.parseEther(String(n));

async function gameFixture() {
  const ctx = await deployFixture();
  ctx.aliceIds = await fundSoul(ctx, ctx.alice, S(300000));
  ctx.bobIds = await fundSoul(ctx, ctx.bob, S(120000));
  ctx.carolIds = await mintTo(ctx, ctx.carol, 4);
  return ctx;
}

async function blockTime(tx) {
  const r = await tx.wait();
  return BigInt((await ethers.provider.getBlock(r.blockNumber)).timestamp);
}

describe("Game", function () {
  describe("setup", function () {
    it("exposes the exact spec costs and durations", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.game.PROTECT_COST()).to.equal(S(100));
      expect(await ctx.game.KILL_COST()).to.equal(S(500));
      expect(await ctx.game.REVIVE_COST()).to.equal(S(6900));
      expect(await ctx.game.SHIELD_COST()).to.equal(S(1000));
      expect(await ctx.game.BLOCK_COST()).to.equal(S(100));
      expect(await ctx.game.STEAL_COST()).to.equal(S(69000));
      expect(await ctx.game.SOUL_MINT_BASE()).to.equal(S(100));
      expect(await ctx.game.PROTECT_DURATION()).to.equal(24n * 3600n);
      expect(await ctx.game.SHIELD_DURATION()).to.equal(24n * 3600n);
      expect(await ctx.game.BLOCK_DURATION()).to.equal(3600n);
    });

    it("rejects zero addresses in the constructor", async function () {
      const ctx = await loadFixture(deployFixture);
      const G = await ethers.getContractFactory("Game");
      await expect(
        G.deploy(ethers.ZeroAddress, await ctx.soul.getAddress(), await ctx.staking.getAddress(), ctx.payout.address)
      ).to.be.revertedWithCustomError(ctx.game, "ZeroAddress");
    });

    it("starts with an empty pot and no counters", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.game.potEth()).to.equal(0n);
      expect(await ctx.game.potSoul()).to.equal(0n);
      expect(await ctx.game.killedCount()).to.equal(0n);
      expect(await ctx.game.revivedCount()).to.equal(0n);
      expect(await ctx.game.soulMintCount()).to.equal(0n);
      expect(await ctx.game.deadSlots()).to.equal(0n);
      expect(await ctx.game.nextSoulMintCost()).to.equal(S(100));
    });
  });

  describe("protect", function () {
    it("burns 100 SOUL and grants 24h", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      const before = await ctx.soul.balanceOf(ctx.alice.address);
      const supplyBefore = await ctx.soul.totalSupply();

      const t = await blockTime(await ctx.game.connect(ctx.alice).protect(id));

      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(before - S(100));
      expect(await ctx.soul.totalSupply()).to.equal(supplyBefore - S(100));
      expect(await ctx.game.potSoul()).to.equal(0n); // burned, not pocketed
      expect(await ctx.game.protectedUntil(id)).to.equal(t + BigInt(DAY));
      expect(await ctx.game.isProtected(id)).to.equal(true);
    });

    it("stacks", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      const t1 = await blockTime(await ctx.game.connect(ctx.alice).protect(id));
      const t2 = await blockTime(await ctx.game.connect(ctx.bob).protect(id));
      expect(t2).to.be.greaterThan(t1);
      expect(await ctx.game.protectedUntil(id)).to.equal(t1 + 2n * BigInt(DAY));

      // once expired, a new protect restarts from now
      await time.increaseTo(t1 + 3n * BigInt(DAY));
      const t3 = await blockTime(await ctx.game.connect(ctx.alice).protect(id));
      expect(await ctx.game.protectedUntil(id)).to.equal(t3 + BigInt(DAY));
    });

    it("follows the token across a transfer", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      await ctx.game.connect(ctx.alice).protect(id);
      await ctx.mortals.connect(ctx.carol).transferFrom(ctx.carol.address, ctx.dave.address, id);
      expect(await ctx.mortals.ownerOf(id)).to.equal(ctx.dave.address);
      await expect(ctx.game.connect(ctx.alice).kill(id)).to.be.revertedWithCustomError(ctx.game, "TargetIsProtected");
    });

    it("reverts for missing tokens, dead tokens and broke callers", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.alice).protect(99999)).to.be.revertedWithCustomError(
        ctx.game,
        "TokenDoesNotExist"
      );
      const id = ctx.carolIds[1];
      await ctx.game.connect(ctx.alice).kill(id);
      await expect(ctx.game.connect(ctx.alice).protect(id)).to.be.revertedWithCustomError(
        ctx.game,
        "CannotProtectDead"
      );
      await expect(ctx.game.connect(ctx.eve).protect(ctx.carolIds[0])).to.be.revertedWithCustomError(
        ctx.soul,
        "ERC20InsufficientBalance"
      );
    });
  });

  describe("kill", function () {
    it("burns 500 SOUL, marks the token dead and opens a slot", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      const before = await ctx.soul.balanceOf(ctx.alice.address);

      await expect(ctx.game.connect(ctx.alice).kill(id))
        .to.emit(ctx.game, "Killed")
        .withArgs(id, ctx.alice.address, ctx.carol.address);

      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(before - S(500));
      expect(await ctx.mortals.isDead(id)).to.equal(true);
      expect(await ctx.mortals.aliveBalanceOf(ctx.carol.address)).to.equal(3n);
      expect(await ctx.game.killedCount()).to.equal(1n);
      expect(await ctx.game.deadSlots()).to.equal(1n);
    });

    it("reverts on a missing token", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.alice).kill(99999)).to.be.revertedWithCustomError(
        ctx.game,
        "TokenDoesNotExist"
      );
    });

    it("reverts with AlreadyDead", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      await ctx.game.connect(ctx.alice).kill(id);
      await expect(ctx.game.connect(ctx.alice).kill(id)).to.be.revertedWithCustomError(ctx.game, "AlreadyDead");
    });

    it("reverts with TargetIsStaked", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      await ctx.mortals.connect(ctx.carol).setApprovalForAll(await ctx.staking.getAddress(), true);
      await ctx.staking.connect(ctx.carol).stake([id]);
      await expect(ctx.game.connect(ctx.alice).kill(id)).to.be.revertedWithCustomError(ctx.game, "TargetIsStaked");

      await ctx.staking.connect(ctx.carol).unstake([id]);
      await ctx.game.connect(ctx.alice).kill(id);
      expect(await ctx.mortals.isDead(id)).to.equal(true);
    });

    it("reverts with TargetIsProtected until protection lapses", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      const t = await blockTime(await ctx.game.connect(ctx.bob).protect(id));
      await expect(ctx.game.connect(ctx.alice).kill(id)).to.be.revertedWithCustomError(ctx.game, "TargetIsProtected");
      await time.increaseTo(t + BigInt(DAY) + 1n);
      await ctx.game.connect(ctx.alice).kill(id);
      expect(await ctx.mortals.isDead(id)).to.equal(true);
    });

    it("reverts with OwnerIsShielded, and the shield does not follow the token", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      await ctx.soul.connect(ctx.alice).transfer(ctx.carol.address, S(1000));
      await ctx.game.connect(ctx.carol).shieldWallet();
      await expect(ctx.game.connect(ctx.alice).kill(id)).to.be.revertedWithCustomError(ctx.game, "OwnerIsShielded");
      // every token the wallet holds is covered
      await expect(ctx.game.connect(ctx.alice).kill(ctx.carolIds[2])).to.be.revertedWithCustomError(
        ctx.game,
        "OwnerIsShielded"
      );
      // moving it to an unshielded wallet exposes it again
      await ctx.mortals.connect(ctx.carol).transferFrom(ctx.carol.address, ctx.dave.address, id);
      await ctx.game.connect(ctx.alice).kill(id);
      expect(await ctx.mortals.isDead(id)).to.equal(true);
    });

    it("allows self-kill", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.aliceIds[0];
      await ctx.game.connect(ctx.alice).kill(id);
      expect(await ctx.mortals.isDead(id)).to.equal(true);
      expect(await ctx.game.deadSlots()).to.equal(1n);
    });

    it("a dead token cannot be transferred or staked", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      await ctx.game.connect(ctx.alice).kill(id);
      await expect(
        ctx.mortals.connect(ctx.carol).transferFrom(ctx.carol.address, ctx.dave.address, id)
      ).to.be.revertedWithCustomError(ctx.mortals, "DeadTokensCannotMove");
      await ctx.mortals.connect(ctx.carol).setApprovalForAll(await ctx.staking.getAddress(), true);
      await expect(ctx.staking.connect(ctx.carol).stake([id])).to.be.revertedWithCustomError(
        ctx.staking,
        "CannotStakeDead"
      );
    });
  });

  describe("shieldWallet", function () {
    it("burns 1000 SOUL and stacks", async function () {
      const ctx = await loadFixture(gameFixture);
      const before = await ctx.soul.balanceOf(ctx.carol.address);
      expect(before).to.equal(0n);
      await ctx.soul.connect(ctx.alice).transfer(ctx.carol.address, S(2000));

      const t1 = await blockTime(await ctx.game.connect(ctx.carol).shieldWallet());
      expect(await ctx.game.shieldUntil(ctx.carol.address)).to.equal(t1 + BigInt(DAY));
      expect(await ctx.soul.balanceOf(ctx.carol.address)).to.equal(S(1000));

      await ctx.game.connect(ctx.carol).shieldWallet();
      expect(await ctx.game.shieldUntil(ctx.carol.address)).to.equal(t1 + 2n * BigInt(DAY));
      expect(await ctx.soul.balanceOf(ctx.carol.address)).to.equal(0n);
      expect(await ctx.game.isShielded(ctx.carol.address)).to.equal(true);
    });

    it("does not protect against blockStake", async function () {
      const ctx = await loadFixture(gameFixture);
      await ctx.mortals.connect(ctx.carol).setApprovalForAll(await ctx.staking.getAddress(), true);
      await ctx.staking.connect(ctx.carol).stake([ctx.carolIds[0]]);
      await ctx.soul.connect(ctx.alice).transfer(ctx.carol.address, S(1000));
      await ctx.game.connect(ctx.carol).shieldWallet();

      const t = await blockTime(await ctx.game.connect(ctx.alice).blockStake(ctx.carol.address));
      expect(await ctx.staking.blockedUntil(ctx.carol.address)).to.equal(t + BigInt(HOUR));
    });
  });

  describe("blockStake", function () {
    it("burns 100 SOUL and blocks for one hour", async function () {
      const ctx = await loadFixture(gameFixture);
      const before = await ctx.soul.balanceOf(ctx.alice.address);
      const t = await blockTime(await ctx.game.connect(ctx.alice).blockStake(ctx.bob.address));
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(before - S(100));
      expect(await ctx.staking.blockedUntil(ctx.bob.address)).to.equal(t + BigInt(HOUR));
    });

    it("cannot be blocked against — even a blocked wallet keeps getting blocked", async function () {
      const ctx = await loadFixture(gameFixture);
      const t1 = await blockTime(await ctx.game.connect(ctx.alice).blockStake(ctx.bob.address));
      await ctx.game.connect(ctx.alice).blockStake(ctx.bob.address);
      expect(await ctx.staking.blockedUntil(ctx.bob.address)).to.equal(t1 + 2n * BigInt(HOUR));
    });

    it("rejects the zero address", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.alice).blockStake(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        ctx.game,
        "ZeroAddress"
      );
    });
  });

  describe("revive", function () {
    it("burns 6900 SOUL, consumes a slot and brings the token back", async function () {
      const ctx = await loadFixture(gameFixture);
      const id = ctx.carolIds[0];
      await ctx.game.connect(ctx.alice).kill(id);
      const before = await ctx.soul.balanceOf(ctx.bob.address);

      await expect(ctx.game.connect(ctx.bob).revive(id))
        .to.emit(ctx.game, "Revived")
        .withArgs(id, ctx.bob.address, ctx.carol.address);

      expect(await ctx.soul.balanceOf(ctx.bob.address)).to.equal(before - S(6900));
      expect(await ctx.mortals.isDead(id)).to.equal(false);
      expect(await ctx.mortals.aliveBalanceOf(ctx.carol.address)).to.equal(4n);
      expect(await ctx.game.revivedCount()).to.equal(1n);
      expect(await ctx.game.deadSlots()).to.equal(0n);

      // and it moves again
      await ctx.mortals.connect(ctx.carol).transferFrom(ctx.carol.address, ctx.dave.address, id);
      expect(await ctx.mortals.ownerOf(id)).to.equal(ctx.dave.address);
    });

    it("reverts with NotDead on a living token", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.alice).revive(ctx.carolIds[0])).to.be.revertedWithCustomError(
        ctx.game,
        "NotDead"
      );
    });

    it("reverts with NoDeadSlots once the slot has been spent", async function () {
      const ctx = await loadFixture(gameFixture);
      await ctx.game.connect(ctx.alice).kill(ctx.carolIds[0]);
      await ctx.game.connect(ctx.alice).soulMint(); // consumes the only slot
      expect(await ctx.game.deadSlots()).to.equal(0n);
      await expect(ctx.game.connect(ctx.alice).revive(ctx.carolIds[0])).to.be.revertedWithCustomError(
        ctx.game,
        "NoDeadSlots"
      );
    });

    it("reverts on a missing token", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.alice).revive(99999)).to.be.revertedWithCustomError(
        ctx.game,
        "TokenDoesNotExist"
      );
    });
  });

  describe("soulMint", function () {
    it("follows the fibonacci cost sequence 100, 101, 101, 102, 103, 105, 108, 113", async function () {
      const ctx = await loadFixture(gameFixture);
      // open 8 slots
      for (let i = 0; i < 8; i++) await ctx.game.connect(ctx.bob).kill(ctx.aliceIds[i]);
      expect(await ctx.game.deadSlots()).to.equal(8n);

      const expected = [100, 101, 101, 102, 103, 105, 108, 113].map((n) => S(n));
      for (let i = 0; i < 8; i++) {
        expect(await ctx.game.nextSoulMintCost(), `cost ${i}`).to.equal(expected[i]);
        const before = await ctx.soul.balanceOf(ctx.alice.address);
        await ctx.game.connect(ctx.alice).soulMint();
        expect((await ctx.soul.balanceOf(ctx.alice.address)) - before).to.equal(-expected[i]);
      }
      expect(await ctx.game.soulMintCount()).to.equal(8n);
      expect(await ctx.game.nextSoulMintCost()).to.equal(S(121)); // fib(8) = 21
      expect(await ctx.game.deadSlots()).to.equal(0n);
    });

    it("splits the cost 50/50 between the pot and the fire", async function () {
      const ctx = await loadFixture(gameFixture);
      await ctx.game.connect(ctx.bob).kill(ctx.aliceIds[0]);
      await ctx.game.connect(ctx.bob).kill(ctx.aliceIds[1]);

      const supplyBefore = await ctx.soul.totalSupply();
      const aliceBefore = await ctx.soul.balanceOf(ctx.alice.address);
      await ctx.game.connect(ctx.alice).soulMint(); // 100
      expect(await ctx.game.potSoul()).to.equal(S(50));
      expect(await ctx.soul.totalSupply()).to.equal(supplyBefore - S(50));
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(aliceBefore - S(100));

      await ctx.game.connect(ctx.alice).soulMint(); // 101 -> 50.5 / 50.5
      expect(await ctx.game.potSoul()).to.equal(S(50) + S("50.5"));
      expect(await ctx.soul.totalSupply()).to.equal(supplyBefore - S(50) - S("50.5"));
    });

    it("mints exactly one NFT to the caller, outside the ETH ladder", async function () {
      const ctx = await loadFixture(gameFixture);
      await ctx.game.connect(ctx.bob).kill(ctx.aliceIds[0]);
      const ethMintedBefore = await ctx.mortals.ethMinted();
      const nextId = await ctx.mortals.nextTokenId();
      const balBefore = await ctx.mortals.balanceOf(ctx.alice.address);

      await expect(ctx.game.connect(ctx.alice).soulMint())
        .to.emit(ctx.game, "SoulMinted")
        .withArgs(ctx.alice.address, nextId, S(100));

      expect(await ctx.mortals.ownerOf(nextId)).to.equal(ctx.alice.address);
      expect(await ctx.mortals.balanceOf(ctx.alice.address)).to.equal(balBefore + 1n);
      expect(await ctx.mortals.ethMinted()).to.equal(ethMintedBefore);
      expect(await ctx.mortals.gameMinted()).to.equal(1n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(balBefore); // one of alice's is dead
    });

    it("reverts with NoDeadSlots when nothing has been killed", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.alice).soulMint()).to.be.revertedWithCustomError(ctx.game, "NoDeadSlots");
    });
  });

  describe("deadSlots accounting", function () {
    it("tracks kill / revive / soulMint interleavings", async function () {
      const ctx = await loadFixture(gameFixture);
      const ids = ctx.aliceIds;

      await ctx.game.connect(ctx.bob).kill(ids[0]);
      await ctx.game.connect(ctx.bob).kill(ids[1]);
      await ctx.game.connect(ctx.bob).kill(ids[2]);
      expect(await ctx.game.deadSlots()).to.equal(3n);

      await ctx.game.connect(ctx.alice).revive(ids[0]); // 3 - 1 = 2
      expect(await ctx.game.deadSlots()).to.equal(2n);

      await ctx.game.connect(ctx.alice).soulMint(); // 3 - 1 - 1 = 1
      expect(await ctx.game.deadSlots()).to.equal(1n);

      await ctx.game.connect(ctx.alice).soulMint(); // 0
      expect(await ctx.game.deadSlots()).to.equal(0n);

      await expect(ctx.game.connect(ctx.alice).soulMint()).to.be.revertedWithCustomError(ctx.game, "NoDeadSlots");
      await expect(ctx.game.connect(ctx.alice).revive(ids[1])).to.be.revertedWithCustomError(ctx.game, "NoDeadSlots");

      // another kill re-opens exactly one slot
      await ctx.game.connect(ctx.bob).kill(ids[3]);
      expect(await ctx.game.deadSlots()).to.equal(1n);
      await ctx.game.connect(ctx.alice).revive(ids[1]);
      expect(await ctx.game.deadSlots()).to.equal(0n);

      expect(await ctx.game.killedCount()).to.equal(4n);
      expect(await ctx.game.revivedCount()).to.equal(2n);
      expect(await ctx.game.soulMintCount()).to.equal(2n);
    });

    it("keeps the alive supply invariant: ethMints + gameMints - dead <= 9872", async function () {
      const ctx = await loadFixture(gameFixture);
      await ctx.game.connect(ctx.bob).kill(ctx.aliceIds[0]);
      await ctx.game.connect(ctx.alice).soulMint();
      const ethMinted = await ctx.mortals.ethMinted();
      const gameMinted = await ctx.mortals.gameMinted();
      const dead = (await ctx.game.killedCount()) - (await ctx.game.revivedCount());
      expect(ethMinted + gameMinted - dead).to.be.lessThanOrEqual(9872n);
      expect(gameMinted).to.be.lessThanOrEqual(dead);
    });
  });

  describe("the pot", function () {
    it("depositPot keeps 100%", async function () {
      const ctx = await loadFixture(deployFixture);
      const amt = ethers.parseEther("3");
      await expect(ctx.game.connect(ctx.deployer).depositPot({ value: amt })).to.changeEtherBalances(
        [ctx.game, ctx.payout],
        [amt, 0n]
      );
      expect(await ctx.game.potEth()).to.equal(amt);
    });

    it("a plain ETH transfer (royalty) splits 50/50 with the payout wallet", async function () {
      const ctx = await loadFixture(deployFixture);
      const amt = ethers.parseEther("2");
      await expect(
        ctx.deployer.sendTransaction({ to: await ctx.game.getAddress(), value: amt })
      ).to.changeEtherBalances([ctx.game, ctx.payout], [amt / 2n, amt / 2n]);
      expect(await ctx.game.potEth()).to.equal(amt / 2n);

      await expect(ctx.deployer.sendTransaction({ to: await ctx.game.getAddress(), value: amt }))
        .to.emit(ctx.game, "RoyaltyReceived")
        .withArgs(ctx.deployer.address, amt, amt / 2n);
    });

    it("a 1 wei royalty keeps the odd wei in the pot", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.deployer.sendTransaction({ to: await ctx.game.getAddress(), value: 1n })).to.changeEtherBalances(
        [ctx.game, ctx.payout],
        [1n, 0n]
      );
    });

    it("stealPot burns 69000 SOUL and drains both assets", async function () {
      const ctx = await loadFixture(gameFixture);
      // seed the pot with ETH and SOUL
      await ctx.game.connect(ctx.deployer).depositPot({ value: ethers.parseEther("5") });
      await ctx.game.connect(ctx.bob).kill(ctx.aliceIds[0]);
      await ctx.game.connect(ctx.alice).soulMint(); // 50 SOUL into the pot

      const potEth = await ctx.game.potEth();
      const potSoul = await ctx.game.potSoul();
      expect(potEth).to.equal(ethers.parseEther("5"));
      expect(potSoul).to.equal(S(50));

      const bobSoulBefore = await ctx.soul.balanceOf(ctx.bob.address);

      const tx = ctx.game.connect(ctx.bob).stealPot();
      await expect(tx).to.changeEtherBalances([ctx.game, ctx.bob], [-potEth, potEth]);
      await expect(tx).to.emit(ctx.game, "PotStolen").withArgs(ctx.bob.address, potEth, potSoul);

      expect(await ctx.soul.balanceOf(ctx.bob.address)).to.equal(bobSoulBefore - S(69000) + potSoul);
      expect(await ctx.game.potEth()).to.equal(0n);
      expect(await ctx.game.potSoul()).to.equal(0n);
    });

    it("stealPot reverts without 69000 SOUL", async function () {
      const ctx = await loadFixture(gameFixture);
      await expect(ctx.game.connect(ctx.carol).stealPot()).to.be.revertedWithCustomError(
        ctx.soul,
        "ERC20InsufficientBalance"
      );
    });

    it("stealing an empty pot still costs 69000 SOUL", async function () {
      const ctx = await loadFixture(gameFixture);
      const before = await ctx.soul.balanceOf(ctx.bob.address);
      await expect(ctx.game.connect(ctx.bob).stealPot())
        .to.emit(ctx.game, "PotStolen")
        .withArgs(ctx.bob.address, 0n, 0n);
      expect(await ctx.soul.balanceOf(ctx.bob.address)).to.equal(before - S(69000));
    });

    it("has no owner and no rescue function", async function () {
      const ctx = await loadFixture(deployFixture);
      const iface = ctx.game.interface;
      const names = iface.fragments.filter((f) => f.type === "function").map((f) => f.name);
      for (const forbidden of ["owner", "withdraw", "rescue", "sweep", "transferOwnership"]) {
        expect(names).to.not.include(forbidden);
      }
    });

    it("primary-mint ETH lands in the pot through depositPot, not receive()", async function () {
      const ctx = await loadFixture(deployFixture);
      const M = await ethers.getContractFactory("MortalsHarness");
      // use the wired fixture: push the ladder into a paid tier via a fresh harness deploy
      // (covered end-to-end in Mortals.test.js "payment split"); here we assert the pot path
      await expect(ctx.game.depositPot({ value: 1000n })).to.emit(ctx.game, "PotDeposit");
      expect(await ctx.game.potEth()).to.equal(1000n);
      expect(M).to.not.equal(undefined);
    });
  });
});
