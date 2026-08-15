const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, mintTo, asGame, asAddress, HOUR, DAY } = require("./helpers");

const RATE = (100n * 10n ** 18n) / 86400n; // 1157407407407407 wei of SOUL per second per NFT

async function ts(tx) {
  const r = await tx.wait();
  return BigInt((await ethers.provider.getBlock(r.blockNumber)).timestamp);
}

async function stakeAll(ctx, wallet, qty) {
  const ids = await mintTo(ctx, wallet, qty);
  await ctx.mortals.connect(wallet).setApprovalForAll(await ctx.staking.getAddress(), true);
  const tx = await ctx.staking.connect(wallet).stake(ids);
  return { ids, t0: await ts(tx) };
}

describe("Staking", function () {
  it("uses the specified per-second rate", async function () {
    const ctx = await loadFixture(deployFixture);
    expect(await ctx.staking.RATE()).to.equal(RATE);
    expect(RATE).to.equal(1157407407407407n);
    // 1 NFT for exactly one day = 100 SOUL, minus integer-division dust
    expect(RATE * 86400n).to.equal(99999999999999964800n);
  });

  describe("stake / unstake", function () {
    it("custodies the tokens and tracks the wallet's staked list", async function () {
      const ctx = await loadFixture(deployFixture);
      const { ids } = await stakeAll(ctx, ctx.alice, 4);

      expect(await ctx.staking.stakedCountOf(ctx.alice.address)).to.equal(4n);
      expect(await ctx.staking.stakedTokensOf(ctx.alice.address)).to.deep.equal(ids);
      for (const id of ids) {
        expect(await ctx.mortals.ownerOf(id)).to.equal(await ctx.staking.getAddress());
        expect(await ctx.staking.stakerOf(id)).to.equal(ctx.alice.address);
      }
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(0n);
    });

    it("swap-removes from the staked list on unstake", async function () {
      const ctx = await loadFixture(deployFixture);
      const { ids } = await stakeAll(ctx, ctx.alice, 5); // [1,2,3,4,5]

      await ctx.staking.connect(ctx.alice).unstake([ids[1]]); // remove 2 -> [1,5,3,4]
      let list = await ctx.staking.stakedTokensOf(ctx.alice.address);
      expect(list.length).to.equal(4);
      expect(new Set(list.map(String))).to.deep.equal(new Set(["1", "3", "4", "5"]));
      expect(await ctx.staking.stakerOf(ids[1])).to.equal(ethers.ZeroAddress);
      expect(await ctx.mortals.ownerOf(ids[1])).to.equal(ctx.alice.address);

      await ctx.staking.connect(ctx.alice).unstake([ids[0], ids[4]]);
      list = await ctx.staking.stakedTokensOf(ctx.alice.address);
      expect(new Set(list.map(String))).to.deep.equal(new Set(["3", "4"]));
      expect(await ctx.staking.stakedCountOf(ctx.alice.address)).to.equal(2n);
    });

    it("refuses to stake a dead token", async function () {
      const ctx = await loadFixture(deployFixture);
      const ids = await mintTo(ctx, ctx.alice, 2);
      const g = await asGame(ctx);
      await ctx.mortals.connect(g).setDead(ids[0], true);
      await ctx.mortals.connect(ctx.alice).setApprovalForAll(await ctx.staking.getAddress(), true);
      await expect(ctx.staking.connect(ctx.alice).stake(ids)).to.be.revertedWithCustomError(
        ctx.staking,
        "CannotStakeDead"
      );
    });

    it("refuses to unstake tokens you did not stake, and empty arrays", async function () {
      const ctx = await loadFixture(deployFixture);
      const { ids } = await stakeAll(ctx, ctx.alice, 2);
      await expect(ctx.staking.connect(ctx.bob).unstake([ids[0]])).to.be.revertedWithCustomError(
        ctx.staking,
        "NotStaker"
      );
      await expect(ctx.staking.connect(ctx.alice).unstake([])).to.be.revertedWithCustomError(
        ctx.staking,
        "EmptyArray"
      );
      await expect(ctx.staking.connect(ctx.alice).stake([])).to.be.revertedWithCustomError(ctx.staking, "EmptyArray");
    });
  });

  describe("accrual", function () {
    it("accrues exactly rate * count * elapsed", async function () {
      const ctx = await loadFixture(deployFixture);
      const { t0 } = await stakeAll(ctx, ctx.alice, 3);

      await time.increase(1000);
      const tx = await ctx.staking.connect(ctx.alice).claim();
      const t1 = await ts(tx);

      expect(t1 - t0).to.equal(1001n);
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(3n * RATE * (t1 - t0));
    });

    it("pays ~100 SOUL per NFT per day", async function () {
      const ctx = await loadFixture(deployFixture);
      const { t0 } = await stakeAll(ctx, ctx.alice, 1);
      await time.increaseTo(t0 + BigInt(DAY));
      const tx = await ctx.staking.connect(ctx.alice).claim();
      const t1 = await ts(tx);
      const bal = await ctx.soul.balanceOf(ctx.alice.address);
      expect(bal).to.equal(RATE * (t1 - t0));
      // within a rounding hair of 100 SOUL for one day + 1s
      expect(bal).to.be.greaterThan(ethers.parseEther("99.99"));
      expect(bal).to.be.lessThan(ethers.parseEther("100.01"));
    });

    it("pendingRewards matches what claim mints", async function () {
      const ctx = await loadFixture(deployFixture);
      await stakeAll(ctx, ctx.alice, 2);
      await time.increase(5000);
      const pending = await ctx.staking.pendingRewards(ctx.alice.address);
      const before = await ctx.soul.balanceOf(ctx.alice.address);
      await ctx.staking.connect(ctx.alice).claim();
      const minted = (await ctx.soul.balanceOf(ctx.alice.address)) - before;
      // the claim tx advances the clock by one second relative to the view
      expect(minted - pending).to.equal(2n * RATE);
    });

    it("settles before a stake so the new tokens do not earn retroactively", async function () {
      const ctx = await loadFixture(deployFixture);
      const { t0 } = await stakeAll(ctx, ctx.alice, 1);
      await time.increase(1000);

      const more = await mintTo(ctx, ctx.alice, 3);
      const tx = await ctx.staking.connect(ctx.alice).stake(more);
      const t1 = await ts(tx);

      await time.increase(500);
      const tx2 = await ctx.staking.connect(ctx.alice).claim();
      const t2 = await ts(tx2);

      const expected = 1n * RATE * (t1 - t0) + 4n * RATE * (t2 - t1);
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(expected);
    });

    it("settles and claims on unstake, then stops accruing", async function () {
      const ctx = await loadFixture(deployFixture);
      const { ids, t0 } = await stakeAll(ctx, ctx.alice, 2);
      await time.increase(2000);
      const tx = await ctx.staking.connect(ctx.alice).unstake(ids);
      const t1 = await ts(tx);
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(2n * RATE * (t1 - t0));

      await time.increase(10000);
      expect(await ctx.staking.pendingRewards(ctx.alice.address)).to.equal(0n);
      await ctx.staking.connect(ctx.alice).claim();
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(2n * RATE * (t1 - t0));
    });

    it("partial unstake keeps the remainder earning", async function () {
      const ctx = await loadFixture(deployFixture);
      const { ids, t0 } = await stakeAll(ctx, ctx.alice, 4);
      await time.increase(1000);
      const tx = await ctx.staking.connect(ctx.alice).unstake([ids[0], ids[1]]);
      const t1 = await ts(tx);
      await time.increase(1000);
      const tx2 = await ctx.staking.connect(ctx.alice).claim();
      const t2 = await ts(tx2);
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(4n * RATE * (t1 - t0) + 2n * RATE * (t2 - t1));
    });

    it("claiming twice in a row mints nothing the second time", async function () {
      const ctx = await loadFixture(deployFixture);
      await stakeAll(ctx, ctx.alice, 1);
      await time.increase(100);
      await ctx.staking.connect(ctx.alice).claim();
      const bal = await ctx.soul.balanceOf(ctx.alice.address);
      const tx = await ctx.staking.connect(ctx.alice).claim();
      await tx.wait();
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(bal + RATE); // exactly one second passed
    });

    it("wallets accrue independently", async function () {
      const ctx = await loadFixture(deployFixture);
      const a = await stakeAll(ctx, ctx.alice, 1);
      const b = await stakeAll(ctx, ctx.bob, 5);
      await time.increase(3600);
      const ta = await ts(await ctx.staking.connect(ctx.alice).claim());
      const tb = await ts(await ctx.staking.connect(ctx.bob).claim());
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(1n * RATE * (ta - a.t0));
      expect(await ctx.soul.balanceOf(ctx.bob.address)).to.equal(5n * RATE * (tb - b.t0));
    });
  });

  describe("blocks", function () {
    it("forfeits (does not delay) emission for the blocked window", async function () {
      const ctx = await loadFixture(deployFixture);
      const { t0 } = await stakeAll(ctx, ctx.alice, 1);
      await time.increase(100);

      const g = await asGame(ctx);
      const bt = await ts(await ctx.staking.connect(g).applyBlock(ctx.alice.address, HOUR));
      expect(await ctx.staking.blockedUntil(ctx.alice.address)).to.equal(bt + BigInt(HOUR));
      // settled up to the block moment
      expect(await ctx.staking.accrued(ctx.alice.address)).to.equal(RATE * (bt - t0));

      // mid-window: nothing new
      await time.increaseTo(bt + 1800n);
      expect(await ctx.staking.pendingRewards(ctx.alice.address)).to.equal(RATE * (bt - t0));

      // after the window: only post-window time counts
      await time.increaseTo(bt + BigInt(HOUR) + 500n);
      const t2 = await ts(await ctx.staking.connect(ctx.alice).claim());
      const expected = RATE * (bt - t0) + RATE * (t2 - (bt + BigInt(HOUR)));
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(expected);
      // the blocked hour really was lost
      expect(expected).to.be.lessThan(RATE * (t2 - t0));
    });

    it("blocks stack", async function () {
      const ctx = await loadFixture(deployFixture);
      const { t0 } = await stakeAll(ctx, ctx.alice, 2);
      const g = await asGame(ctx);
      await time.increase(50);
      const b1 = await ts(await ctx.staking.connect(g).applyBlock(ctx.alice.address, HOUR));
      await time.increase(10);
      const b2 = await ts(await ctx.staking.connect(g).applyBlock(ctx.alice.address, HOUR));

      const until = b1 + BigInt(HOUR) + BigInt(HOUR);
      expect(await ctx.staking.blockedUntil(ctx.alice.address)).to.equal(until);
      // the second block settled nothing extra (already blocked)
      expect(await ctx.staking.accrued(ctx.alice.address)).to.equal(2n * RATE * (b1 - t0));

      await time.increaseTo(until + 100n);
      const t2 = await ts(await ctx.staking.connect(ctx.alice).claim());
      expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(
        2n * RATE * (b1 - t0) + 2n * RATE * (t2 - until)
      );
      expect(b2).to.be.greaterThan(b1);
    });

    it("a block applied after expiry starts from now", async function () {
      const ctx = await loadFixture(deployFixture);
      await stakeAll(ctx, ctx.alice, 1);
      const g = await asGame(ctx);
      const b1 = await ts(await ctx.staking.connect(g).applyBlock(ctx.alice.address, HOUR));
      await time.increaseTo(b1 + BigInt(DAY));
      const b2 = await ts(await ctx.staking.connect(g).applyBlock(ctx.alice.address, HOUR));
      expect(await ctx.staking.blockedUntil(ctx.alice.address)).to.equal(b2 + BigInt(HOUR));
    });

    it("only the Game can apply a block", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.staking.connect(ctx.alice).applyBlock(ctx.alice.address, HOUR)).to.be.revertedWithCustomError(
        ctx.staking,
        "NotGame"
      );
      await expect(ctx.staking.applyBlock(ctx.alice.address, HOUR)).to.be.revertedWithCustomError(
        ctx.staking,
        "NotGame"
      );
    });

    it("blocking a wallet with nothing staked is harmless", async function () {
      const ctx = await loadFixture(deployFixture);
      const g = await asGame(ctx);
      await ctx.staking.connect(g).applyBlock(ctx.carol.address, HOUR);
      expect(await ctx.staking.pendingRewards(ctx.carol.address)).to.equal(0n);
      expect(await ctx.staking.isBlocked(ctx.carol.address)).to.equal(true);
    });
  });

  describe("wiring", function () {
    it("setGame is one-time and owner-only", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.staking.setGame(ctx.bob.address)).to.be.revertedWithCustomError(ctx.staking, "GameAlreadySet");
      const S = await ethers.getContractFactory("Staking");
      const fresh = await S.deploy(await ctx.mortals.getAddress(), await ctx.soul.getAddress());
      await expect(fresh.connect(ctx.alice).setGame(ctx.bob.address)).to.be.revertedWithCustomError(
        fresh,
        "OwnableUnauthorizedAccount"
      );
      await expect(fresh.setGame(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "ZeroAddress");
      await expect(S.deploy(ethers.ZeroAddress, await ctx.soul.getAddress())).to.be.revertedWithCustomError(
        fresh,
        "ZeroAddress"
      );
    });

    it("accepts safeTransferFrom (IERC721Receiver)", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(
        await ctx.staking.onERC721Received(ctx.alice.address, ctx.alice.address, 1, "0x")
      ).to.equal("0x150b7a02");
    });
  });
});
