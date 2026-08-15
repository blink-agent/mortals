const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, asGame, asAddress } = require("./helpers");

describe("Soul", function () {
  it("has the right name, symbol and decimals and starts empty", async function () {
    const ctx = await loadFixture(deployFixture);
    expect(await ctx.soul.name()).to.equal("SOUL");
    expect(await ctx.soul.symbol()).to.equal("SOUL");
    expect(await ctx.soul.decimals()).to.equal(18n);
    expect(await ctx.soul.totalSupply()).to.equal(0n);
  });

  it("is wired to Staking as minter and Game as game", async function () {
    const ctx = await loadFixture(deployFixture);
    expect(await ctx.soul.minter()).to.equal(await ctx.staking.getAddress());
    expect(await ctx.soul.game()).to.equal(await ctx.game.getAddress());
  });

  it("only the minter can mint", async function () {
    const ctx = await loadFixture(deployFixture);
    await expect(ctx.soul.connect(ctx.alice).mint(ctx.alice.address, 1n)).to.be.revertedWithCustomError(
      ctx.soul,
      "NotMinter"
    );
    await expect(ctx.soul.mint(ctx.alice.address, 1n)).to.be.revertedWithCustomError(ctx.soul, "NotMinter");

    const s = await asAddress(await ctx.staking.getAddress());
    await ctx.soul.connect(s).mint(ctx.alice.address, ethers.parseEther("5"));
    expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(ethers.parseEther("5"));
  });

  it("only the Game can gameBurn / gameTake, with no allowance needed", async function () {
    const ctx = await loadFixture(deployFixture);
    const s = await asAddress(await ctx.staking.getAddress());
    await ctx.soul.connect(s).mint(ctx.alice.address, ethers.parseEther("100"));

    await expect(ctx.soul.connect(ctx.alice).gameBurn(ctx.alice.address, 1n)).to.be.revertedWithCustomError(
      ctx.soul,
      "NotGame"
    );
    await expect(ctx.soul.connect(ctx.alice).gameTake(ctx.alice.address, 1n)).to.be.revertedWithCustomError(
      ctx.soul,
      "NotGame"
    );

    const g = await asGame(ctx);
    expect(await ctx.soul.allowance(ctx.alice.address, await ctx.game.getAddress())).to.equal(0n);

    await ctx.soul.connect(g).gameBurn(ctx.alice.address, ethers.parseEther("10"));
    expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(ethers.parseEther("90"));
    expect(await ctx.soul.totalSupply()).to.equal(ethers.parseEther("90"));

    await ctx.soul.connect(g).gameTake(ctx.alice.address, ethers.parseEther("40"));
    expect(await ctx.soul.balanceOf(ctx.alice.address)).to.equal(ethers.parseEther("50"));
    expect(await ctx.soul.balanceOf(await ctx.game.getAddress())).to.equal(ethers.parseEther("40"));
    expect(await ctx.soul.totalSupply()).to.equal(ethers.parseEther("90"));
  });

  it("gameBurn beyond balance reverts", async function () {
    const ctx = await loadFixture(deployFixture);
    const g = await asGame(ctx);
    await expect(ctx.soul.connect(g).gameBurn(ctx.alice.address, 1n)).to.be.revertedWithCustomError(
      ctx.soul,
      "ERC20InsufficientBalance"
    );
  });

  it("supports public burn and normal ERC20 transfer/approve", async function () {
    const ctx = await loadFixture(deployFixture);
    const s = await asAddress(await ctx.staking.getAddress());
    await ctx.soul.connect(s).mint(ctx.alice.address, ethers.parseEther("100"));

    await ctx.soul.connect(ctx.alice).burn(ethers.parseEther("10"));
    expect(await ctx.soul.totalSupply()).to.equal(ethers.parseEther("90"));

    await ctx.soul.connect(ctx.alice).transfer(ctx.bob.address, ethers.parseEther("30"));
    expect(await ctx.soul.balanceOf(ctx.bob.address)).to.equal(ethers.parseEther("30"));

    await ctx.soul.connect(ctx.alice).approve(ctx.carol.address, ethers.parseEther("20"));
    await ctx.soul.connect(ctx.carol).transferFrom(ctx.alice.address, ctx.carol.address, ethers.parseEther("20"));
    expect(await ctx.soul.balanceOf(ctx.carol.address)).to.equal(ethers.parseEther("20"));
  });

  it("wiring setters are one-time and owner-only", async function () {
    const ctx = await loadFixture(deployFixture);
    await expect(ctx.soul.setMinter(ctx.bob.address)).to.be.revertedWithCustomError(ctx.soul, "MinterAlreadySet");
    await expect(ctx.soul.setGame(ctx.bob.address)).to.be.revertedWithCustomError(ctx.soul, "GameAlreadySet");

    const S = await ethers.getContractFactory("Soul");
    const fresh = await S.deploy();
    await expect(fresh.connect(ctx.alice).setMinter(ctx.alice.address)).to.be.revertedWithCustomError(
      fresh,
      "OwnableUnauthorizedAccount"
    );
    await expect(fresh.setMinter(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "ZeroAddress");
    await expect(fresh.setGame(ethers.ZeroAddress)).to.be.revertedWithCustomError(fresh, "ZeroAddress");
  });
});
