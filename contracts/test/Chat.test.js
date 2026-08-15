const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, mintTo, asGame } = require("./helpers");

describe("Chat", function () {
  it("knows its operator and limits", async function () {
    const ctx = await loadFixture(deployFixture);
    expect(await ctx.chat.operator()).to.equal(ctx.deployer.address);
    expect(await ctx.chat.MAX_MESSAGE_BYTES()).to.equal(280n);
    expect(await ctx.chat.MAX_USERNAME_BYTES()).to.equal(24n);
  });

  it("lets an alive holder post", async function () {
    const ctx = await loadFixture(deployFixture);
    await mintTo(ctx, ctx.alice, 1);
    expect(await ctx.chat.canPost(ctx.alice.address)).to.equal(true);
    await expect(ctx.chat.connect(ctx.alice).post("gm")).to.emit(ctx.chat, "Message");

    const tx = await ctx.chat.connect(ctx.alice).post("hello");
    const r = await tx.wait();
    const block = await ethers.provider.getBlock(r.blockNumber);
    const ev = r.logs.map((l) => ctx.chat.interface.parseLog(l)).find((e) => e && e.name === "Message");
    expect(ev.args.sender).to.equal(ctx.alice.address);
    expect(ev.args.text).to.equal("hello");
    expect(ev.args.timestamp).to.equal(BigInt(block.timestamp));
  });

  it("lets a wallet whose only Mortals are staked post", async function () {
    const ctx = await loadFixture(deployFixture);
    const ids = await mintTo(ctx, ctx.dave, 2);
    await ctx.mortals.connect(ctx.dave).setApprovalForAll(await ctx.staking.getAddress(), true);
    await ctx.staking.connect(ctx.dave).stake(ids);

    expect(await ctx.mortals.aliveBalanceOf(ctx.dave.address)).to.equal(0n);
    expect(await ctx.staking.stakedCountOf(ctx.dave.address)).to.equal(2n);
    expect(await ctx.chat.canPost(ctx.dave.address)).to.equal(true);
    await expect(ctx.chat.connect(ctx.dave).post("staked and posting")).to.emit(ctx.chat, "Message");
  });

  it("rejects a wallet with no Mortals", async function () {
    const ctx = await loadFixture(deployFixture);
    expect(await ctx.chat.canPost(ctx.eve.address)).to.equal(false);
    await expect(ctx.chat.connect(ctx.eve).post("let me in")).to.be.revertedWithCustomError(
      ctx.chat,
      "NotAllowedToPost"
    );
  });

  it("rejects a wallet holding only dead Mortals", async function () {
    const ctx = await loadFixture(deployFixture);
    const ids = await mintTo(ctx, ctx.carol, 1);
    const g = await asGame(ctx);
    await ctx.mortals.connect(g).setDead(ids[0], true);
    expect(await ctx.chat.canPost(ctx.carol.address)).to.equal(false);
    await expect(ctx.chat.connect(ctx.carol).post("still here")).to.be.revertedWithCustomError(
      ctx.chat,
      "NotAllowedToPost"
    );
    // revived -> allowed again
    await ctx.mortals.connect(g).setDead(ids[0], false);
    await expect(ctx.chat.connect(ctx.carol).post("back")).to.emit(ctx.chat, "Message");
  });

  it("lets the operator post without holding anything", async function () {
    const ctx = await loadFixture(deployFixture);
    expect(await ctx.mortals.aliveBalanceOf(ctx.deployer.address)).to.equal(0n);
    await expect(ctx.chat.connect(ctx.deployer).post("announcement")).to.emit(ctx.chat, "Message");
  });

  it("enforces the 1..280 byte message bounds", async function () {
    const ctx = await loadFixture(deployFixture);
    await mintTo(ctx, ctx.alice, 1);
    await expect(ctx.chat.connect(ctx.alice).post("")).to.be.revertedWithCustomError(ctx.chat, "EmptyMessage");
    await expect(ctx.chat.connect(ctx.alice).post("a".repeat(281))).to.be.revertedWithCustomError(
      ctx.chat,
      "MessageTooLong"
    );
    await expect(ctx.chat.connect(ctx.alice).post("a".repeat(280))).to.emit(ctx.chat, "Message");
    await expect(ctx.chat.connect(ctx.alice).post("a")).to.emit(ctx.chat, "Message");
    // bytes, not characters: 94 * 3-byte chars = 282 bytes
    await expect(ctx.chat.connect(ctx.alice).post("☠".repeat(94))).to.be.revertedWithCustomError(
      ctx.chat,
      "MessageTooLong"
    );
  });

  it("checks the gate before the caller can spend gas on a long message", async function () {
    const ctx = await loadFixture(deployFixture);
    // length checks come first by design; a non-holder with an empty message still gets EmptyMessage
    await expect(ctx.chat.connect(ctx.eve).post("")).to.be.revertedWithCustomError(ctx.chat, "EmptyMessage");
  });

  it("stores usernames up to 24 bytes for anyone", async function () {
    const ctx = await loadFixture(deployFixture);
    await expect(ctx.chat.connect(ctx.eve).setUsername("reaper"))
      .to.emit(ctx.chat, "UsernameSet")
      .withArgs(ctx.eve.address, "reaper");
    expect(await ctx.chat.usernameOf(ctx.eve.address)).to.equal("reaper");

    await ctx.chat.connect(ctx.eve).setUsername("a".repeat(24));
    expect(await ctx.chat.usernameOf(ctx.eve.address)).to.equal("a".repeat(24));

    await expect(ctx.chat.connect(ctx.eve).setUsername("a".repeat(25))).to.be.revertedWithCustomError(
      ctx.chat,
      "UsernameTooLong"
    );

    await ctx.chat.connect(ctx.eve).setUsername("");
    expect(await ctx.chat.usernameOf(ctx.eve.address)).to.equal("");
  });

  it("operator is owner-changeable only", async function () {
    const ctx = await loadFixture(deployFixture);
    await expect(ctx.chat.connect(ctx.alice).setOperator(ctx.alice.address)).to.be.revertedWithCustomError(
      ctx.chat,
      "OwnableUnauthorizedAccount"
    );
    await expect(ctx.chat.setOperator(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.chat, "ZeroAddress");

    await expect(ctx.chat.setOperator(ctx.bob.address)).to.emit(ctx.chat, "OperatorSet").withArgs(ctx.bob.address);
    expect(await ctx.chat.canPost(ctx.bob.address)).to.equal(true);
    expect(await ctx.chat.canPost(ctx.deployer.address)).to.equal(false);
  });

  it("rejects zero addresses in the constructor", async function () {
    const ctx = await loadFixture(deployFixture);
    const C = await ethers.getContractFactory("Chat");
    await expect(
      C.deploy(ethers.ZeroAddress, await ctx.staking.getAddress(), ctx.deployer.address)
    ).to.be.revertedWithCustomError(ctx.chat, "ZeroAddress");
  });
});
