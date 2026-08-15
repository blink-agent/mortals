const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  deployFixture,
  harnessFixture,
  signVoucher,
  nextNonce,
  mintTo,
  asGame,
  BASE_URI,
  CONTRACT_URI,
} = require("./helpers");

const E13 = 10n ** 13n; // 0.00001 ether
const TIER = 1234n;
const TIER_PRICES = [0n, E13, 2n * E13, 4n * E13, 8n * E13, 16n * E13, 32n * E13, 64n * E13];

describe("Mortals", function () {
  describe("deployment", function () {
    it("has the right name, symbol and first token id", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mortals.name()).to.equal("MORTALS");
      expect(await ctx.mortals.symbol()).to.equal("MORTAL");
      expect(await ctx.mortals.nextTokenId()).to.equal(1n);
      const ids = await mintTo(ctx, ctx.alice, 1);
      expect(ids[0]).to.equal(1n);
      expect(await ctx.mortals.ownerOf(1)).to.equal(ctx.alice.address);
    });

    it("exposes the spec constants", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mortals.MAX_ETH_SUPPLY()).to.equal(9872n);
      expect(await ctx.mortals.MAX_PER_TX()).to.equal(32n);
      expect(await ctx.mortals.TIER_SIZE()).to.equal(1234n);
      expect(await ctx.mortals.BASE_PRICE()).to.equal(E13);
    });

    it("owner is the deployer", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mortals.owner()).to.equal(ctx.deployer.address);
    });
  });

  describe("price ladder", function () {
    it("prices every tier boundary correctly", async function () {
      const ctx = await loadFixture(deployFixture);
      for (let t = 0; t < 8; t++) {
        const first = TIER * BigInt(t);
        const last = TIER * BigInt(t + 1) - 1n;
        expect(await ctx.mortals.priceAtIndex(first), `tier ${t} first`).to.equal(TIER_PRICES[t]);
        expect(await ctx.mortals.priceAtIndex(last), `tier ${t} last`).to.equal(TIER_PRICES[t]);
      }
      // explicit spec numbers
      expect(await ctx.mortals.priceAtIndex(0)).to.equal(0n);
      expect(await ctx.mortals.priceAtIndex(1233)).to.equal(0n);
      expect(await ctx.mortals.priceAtIndex(1234)).to.equal(ethers.parseEther("0.00001"));
      expect(await ctx.mortals.priceAtIndex(2468)).to.equal(ethers.parseEther("0.00002"));
      expect(await ctx.mortals.priceAtIndex(3702)).to.equal(ethers.parseEther("0.00004"));
      expect(await ctx.mortals.priceAtIndex(4936)).to.equal(ethers.parseEther("0.00008"));
      expect(await ctx.mortals.priceAtIndex(6170)).to.equal(ethers.parseEther("0.00016"));
      expect(await ctx.mortals.priceAtIndex(7404)).to.equal(ethers.parseEther("0.00032"));
      expect(await ctx.mortals.priceAtIndex(8638)).to.equal(ethers.parseEther("0.00064"));
      expect(await ctx.mortals.priceAtIndex(9871)).to.equal(ethers.parseEther("0.00064"));
    });

    it("the first 1234 are free", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mortals.priceForQuantity(1)).to.equal(0n);
      expect(await ctx.mortals.priceForQuantity(32)).to.equal(0n);
      expect(await ctx.mortals.priceForQuantity(1234)).to.equal(0n);
    });

    it("sums per-token prices across a tier boundary", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(1230);
      // indices 1230..1239 => 4 free + 6 @ 0.00001
      expect(await ctx.mortals.priceForQuantity(10)).to.equal(6n * E13);

      await ctx.mortals.setEthMinted(2460);
      // 2460..2491 (32) => 8 @1e13 (2460..2467) + 24 @2e13 (2468..2491)
      expect(await ctx.mortals.priceForQuantity(32)).to.equal(8n * E13 + 24n * 2n * E13);

      await ctx.mortals.setEthMinted(8637);
      // 8637 @32e13 + 31 @64e13
      expect(await ctx.mortals.priceForQuantity(32)).to.equal(32n * E13 + 31n * 64n * E13);
    });

    it("sums correctly across several tiers at once", async function () {
      const ctx = await loadFixture(harnessFixture);
      // 0..4999 => 1234 free, 1234@1, 1234@2, 1234@4, 64@8 (x 1e13)
      const expected = (1234n * 1n + 1234n * 2n + 1234n * 4n + 64n * 8n) * E13;
      expect(await ctx.mortals.priceForQuantity(5000)).to.equal(expected);
      expect(expected).to.equal(9150n * E13);
    });

    it("prices the full 9872 supply at 1.56718 ETH", async function () {
      const ctx = await loadFixture(harnessFixture);
      const total = await ctx.mortals.priceForQuantity(9872);
      expect(total).to.equal(1234n * (1n + 2n + 4n + 8n + 16n + 32n + 64n) * E13);
      expect(total).to.equal(ethers.parseEther("1.56718"));
    });

    it("advances the ladder as ETH mints happen", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(1234);
      expect(await ctx.mortals.priceForQuantity(1)).to.equal(E13);
      expect(await ctx.mortals.currentTier()).to.equal(1n);
    });

    it("reverts when quoting past the cap", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(9870);
      expect(await ctx.mortals.priceForQuantity(2)).to.equal(2n * 64n * E13);
      await expect(ctx.mortals.priceForQuantity(3)).to.be.revertedWithCustomError(ctx.mortals, "MaxSupplyReached");
    });
  });

  describe("voucher mint", function () {
    it("mints with a valid voucher", async function () {
      const ctx = await loadFixture(deployFixture);
      const ids = await mintTo(ctx, ctx.alice, 5);
      expect(ids).to.deep.equal([1n, 2n, 3n, 4n, 5n]);
      expect(await ctx.mortals.balanceOf(ctx.alice.address)).to.equal(5n);
      expect(await ctx.mortals.ethMinted()).to.equal(5n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(5n);
    });

    it("rejects a signature from the wrong signer", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.bob, ctx.mortals, ctx.alice.address, 1, nonce);
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidSignature"
      );
    });

    it("rejects a voucher issued for another wallet", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.bob.address, 1, nonce);
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidSignature"
      );
    });

    it("rejects a voucher for a different quantity", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 3, nonce);
      await expect(ctx.mortals.connect(ctx.alice).mint(4, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidSignature"
      );
    });

    it("rejects a voucher signed for another chain id", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 1, nonce, { chainId: 4663n });
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidSignature"
      );
    });

    it("rejects a voucher signed for another contract", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 1, nonce, {
        contract: ctx.bob.address,
      });
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidSignature"
      );
    });

    it("rejects a reused nonce", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 1, nonce);
      await ctx.mortals.connect(ctx.alice).mint(1, nonce, sig);
      expect(await ctx.mortals.usedNonces(nonce)).to.equal(true);
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "NonceAlreadyUsed"
      );
    });

    it("enforces the 32-per-tx cap and rejects zero", async function () {
      const ctx = await loadFixture(deployFixture);
      const n1 = nextNonce();
      const s1 = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 33, n1);
      await expect(ctx.mortals.connect(ctx.alice).mint(33, n1, s1)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidQuantity"
      );
      const n2 = nextNonce();
      const s2 = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 0, n2);
      await expect(ctx.mortals.connect(ctx.alice).mint(0, n2, s2)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidQuantity"
      );
      // 32 is fine
      const ids = await mintTo(ctx, ctx.alice, 32);
      expect(ids.length).to.equal(32);
    });

    it("has no per-wallet cap", async function () {
      const ctx = await loadFixture(deployFixture);
      for (let i = 0; i < 4; i++) await mintTo(ctx, ctx.alice, 32);
      expect(await ctx.mortals.balanceOf(ctx.alice.address)).to.equal(128n);
    });

    it("respects mintActive", async function () {
      const ctx = await loadFixture(deployFixture);
      await ctx.mortals.setMintActive(false);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 1, nonce);
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "MintNotActive"
      );
    });

    it("enforces the 9872 ETH cap", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(9870);
      const n1 = nextNonce();
      const s1 = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 3, n1);
      await expect(
        ctx.mortals.connect(ctx.alice).mint(3, n1, s1, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(ctx.mortals, "MaxSupplyReached");

      await mintTo(ctx, ctx.alice, 2);
      expect(await ctx.mortals.ethMinted()).to.equal(9872n);

      const n2 = nextNonce();
      const s2 = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 1, n2);
      await expect(
        ctx.mortals.connect(ctx.alice).mint(1, n2, s2, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(ctx.mortals, "MaxSupplyReached");
    });

    it("reverts on underpayment", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(1234);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 4, nonce);
      const cost = await ctx.mortals.priceForQuantity(4);
      await expect(
        ctx.mortals.connect(ctx.alice).mint(4, nonce, sig, { value: cost - 1n })
      ).to.be.revertedWithCustomError(ctx.mortals, "InsufficientPayment");
    });
  });

  describe("payment split", function () {
    it("splits paid mints exactly 90/10 between payout and the pot", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(2000); // tier 1: 0.00001 each
      const qty = 10;
      const cost = await ctx.mortals.priceForQuantity(qty);
      expect(cost).to.equal(10n * E13);

      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, qty, nonce);
      const tx = ctx.mortals.connect(ctx.alice).mint(qty, nonce, sig, { value: cost });

      await expect(tx).to.changeEtherBalances(
        [ctx.alice, ctx.payout, ctx.game],
        [-cost, (cost * 9n) / 10n, cost / 10n]
      );
      expect(await ctx.game.potEth()).to.equal(cost / 10n);
    });

    it("splits exactly across a tier boundary too", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(2460);
      const cost = await ctx.mortals.priceForQuantity(32);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 32, nonce);
      await expect(
        ctx.mortals.connect(ctx.alice).mint(32, nonce, sig, { value: cost })
      ).to.changeEtherBalances([ctx.alice, ctx.payout, ctx.game], [-cost, cost - cost / 10n, cost / 10n]);
    });

    it("refunds overpayment", async function () {
      const ctx = await loadFixture(harnessFixture);
      await ctx.mortals.setEthMinted(2000);
      const cost = await ctx.mortals.priceForQuantity(3);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 3, nonce);
      await expect(
        ctx.mortals.connect(ctx.alice).mint(3, nonce, sig, { value: ethers.parseEther("1") })
      ).to.changeEtherBalances([ctx.alice, ctx.payout, ctx.game], [-cost, cost - cost / 10n, cost / 10n]);
    });

    it("moves no ETH on free-tier mints and refunds everything sent", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 4, nonce);
      await expect(
        ctx.mortals.connect(ctx.alice).mint(4, nonce, sig, { value: ethers.parseEther("0.5") })
      ).to.changeEtherBalances([ctx.alice, ctx.payout, ctx.game], [0n, 0n, 0n]);
      expect(await ctx.game.potEth()).to.equal(0n);
    });
  });

  describe("gameMint", function () {
    it("only the Game can call it and it bypasses the ladder and cap", async function () {
      const ctx = await loadFixture(harnessFixture);
      await expect(ctx.mortals.connect(ctx.alice).gameMint(ctx.alice.address, 1)).to.be.revertedWithCustomError(
        ctx.mortals,
        "NotGame"
      );

      await ctx.mortals.setEthMinted(9872); // ETH supply exhausted
      const g = await asGame(ctx);
      await ctx.mortals.connect(g).gameMint(ctx.bob.address, 3);

      expect(await ctx.mortals.balanceOf(ctx.bob.address)).to.equal(3n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.bob.address)).to.equal(3n);
      expect(await ctx.mortals.ethMinted()).to.equal(9872n); // untouched
      expect(await ctx.mortals.gameMinted()).to.equal(3n);
    });

    it("rejects zero quantity", async function () {
      const ctx = await loadFixture(deployFixture);
      const g = await asGame(ctx);
      await expect(ctx.mortals.connect(g).gameMint(ctx.bob.address, 0)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidQuantity"
      );
    });
  });

  describe("dead state", function () {
    it("only the Game may flip it and it must actually change", async function () {
      const ctx = await loadFixture(deployFixture);
      await mintTo(ctx, ctx.alice, 1);
      await expect(ctx.mortals.connect(ctx.alice).setDead(1, true)).to.be.revertedWithCustomError(
        ctx.mortals,
        "NotGame"
      );
      const g = await asGame(ctx);
      await expect(ctx.mortals.connect(g).setDead(999, true)).to.be.revertedWithCustomError(
        ctx.mortals,
        "TokenDoesNotExist"
      );
      await ctx.mortals.connect(g).setDead(1, true);
      await expect(ctx.mortals.connect(g).setDead(1, true)).to.be.revertedWithCustomError(
        ctx.mortals,
        "DeadStateUnchanged"
      );
    });

    it("dead tokens cannot be transferred", async function () {
      const ctx = await loadFixture(deployFixture);
      await mintTo(ctx, ctx.alice, 2);
      const g = await asGame(ctx);
      await ctx.mortals.connect(g).setDead(1, true);

      await expect(
        ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 1)
      ).to.be.revertedWithCustomError(ctx.mortals, "DeadTokensCannotMove");

      // the alive sibling still moves
      await ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 2);
      expect(await ctx.mortals.ownerOf(2)).to.equal(ctx.bob.address);

      // and moves again after revival
      await ctx.mortals.connect(g).setDead(1, false);
      await ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 1);
      expect(await ctx.mortals.ownerOf(1)).to.equal(ctx.bob.address);
    });

    it("dead tokens can still be minted around (mint hook is never blocked)", async function () {
      const ctx = await loadFixture(deployFixture);
      await mintTo(ctx, ctx.alice, 1);
      const g = await asGame(ctx);
      await ctx.mortals.connect(g).setDead(1, true);
      // minting a fresh batch right after a dead token still works
      const ids = await mintTo(ctx, ctx.alice, 3);
      expect(ids).to.deep.equal([2n, 3n, 4n]);
    });
  });

  describe("aliveBalanceOf", function () {
    it("tracks mint, batch transfer, kill and revive", async function () {
      const ctx = await loadFixture(deployFixture);
      await mintTo(ctx, ctx.alice, 6);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(6n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.bob.address)).to.equal(0n);

      await ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 3);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(5n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.bob.address)).to.equal(1n);

      const g = await asGame(ctx);
      await ctx.mortals.connect(g).setDead(1, true);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(4n);
      expect(await ctx.mortals.balanceOf(ctx.alice.address)).to.equal(5n);

      await ctx.mortals.connect(g).setDead(3, true); // bob's token
      expect(await ctx.mortals.aliveBalanceOf(ctx.bob.address)).to.equal(0n);

      await ctx.mortals.connect(g).setDead(1, false);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(5n);

      await ctx.mortals.connect(g).setDead(3, false);
      expect(await ctx.mortals.aliveBalanceOf(ctx.bob.address)).to.equal(1n);
    });

    it("stays correct when a killed token is revived after changing hands", async function () {
      const ctx = await loadFixture(deployFixture);
      await mintTo(ctx, ctx.alice, 2);
      const g = await asGame(ctx);
      await ctx.mortals.connect(g).setDead(1, true);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(1n);
      await ctx.mortals.connect(g).setDead(1, false);
      await ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 1);
      await ctx.mortals.connect(g).setDead(1, true);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(1n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.bob.address)).to.equal(0n);
    });

    it("survives large ERC721A batches split across transfers", async function () {
      const ctx = await loadFixture(deployFixture);
      const ids = await mintTo(ctx, ctx.alice, 32);
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(32n);
      for (const id of [ids[0], ids[15], ids[31]]) {
        await ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.carol.address, id);
      }
      expect(await ctx.mortals.aliveBalanceOf(ctx.alice.address)).to.equal(29n);
      expect(await ctx.mortals.aliveBalanceOf(ctx.carol.address)).to.equal(3n);
    });
  });

  describe("metadata", function () {
    it("tokenURI is baseURI + id and contractURI is settable", async function () {
      const ctx = await loadFixture(deployFixture);
      await mintTo(ctx, ctx.alice, 2);
      expect(await ctx.mortals.tokenURI(2)).to.equal(BASE_URI + "2");
      expect(await ctx.mortals.contractURI()).to.equal(CONTRACT_URI);

      await ctx.mortals.setBaseURI("ipfs://x/");
      expect(await ctx.mortals.tokenURI(1)).to.equal("ipfs://x/1");
      await ctx.mortals.setContractURI("ipfs://c");
      expect(await ctx.mortals.contractURI()).to.equal("ipfs://c");

      await expect(ctx.mortals.connect(ctx.alice).setBaseURI("x")).to.be.revertedWithCustomError(
        ctx.mortals,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("royalties (ERC2981)", function () {
    it("reports 5% to the Game contract", async function () {
      const ctx = await loadFixture(deployFixture);
      const [receiver, amount] = await ctx.mortals.royaltyInfo(1, ethers.parseEther("1"));
      expect(receiver).to.equal(await ctx.game.getAddress());
      expect(amount).to.equal(ethers.parseEther("0.05"));

      const [, amt2] = await ctx.mortals.royaltyInfo(42, 10000n);
      expect(amt2).to.equal(500n);
    });

    it("advertises the right interfaces", async function () {
      const ctx = await loadFixture(deployFixture);
      expect(await ctx.mortals.supportsInterface("0x80ac58cd")).to.equal(true); // ERC721
      expect(await ctx.mortals.supportsInterface("0x5b5e139f")).to.equal(true); // ERC721Metadata
      expect(await ctx.mortals.supportsInterface("0x2a55205a")).to.equal(true); // ERC2981
      expect(await ctx.mortals.supportsInterface("0xad0d7f6c")).to.equal(true); // ICreatorToken
      expect(await ctx.mortals.supportsInterface("0xe8a3d485")).to.equal(true); // contractURI
      expect(await ctx.mortals.supportsInterface("0xdeadbeef")).to.equal(false);
    });
  });

  describe("transfer validator (ICreatorToken)", function () {
    it("is owner-settable and reported", async function () {
      const ctx = await loadFixture(deployFixture);
      const V = await ethers.getContractFactory("MockTransferValidator");
      const v = await V.deploy();
      expect(await ctx.mortals.getTransferValidator()).to.equal(ethers.ZeroAddress);
      await expect(ctx.mortals.setTransferValidator(await v.getAddress()))
        .to.emit(ctx.mortals, "TransferValidatorUpdated")
        .withArgs(ethers.ZeroAddress, await v.getAddress());
      expect(await ctx.mortals.getTransferValidator()).to.equal(await v.getAddress());

      const [sel, isView] = await ctx.mortals.getTransferValidationFunction();
      expect(sel).to.equal("0xcaee23ea");
      expect(isView).to.equal(false);

      await expect(
        ctx.mortals.connect(ctx.alice).setTransferValidator(await v.getAddress())
      ).to.be.revertedWithCustomError(ctx.mortals, "OwnableUnauthorizedAccount");
    });

    it("is called on transfers, skipped on mint, and can block a transfer", async function () {
      const ctx = await loadFixture(deployFixture);
      const V = await ethers.getContractFactory("MockTransferValidator");
      const v = await V.deploy();
      await ctx.mortals.setTransferValidator(await v.getAddress());

      // mint is never gated
      await v.setShouldRevert(true);
      await mintTo(ctx, ctx.alice, 2);
      expect(await v.calls()).to.equal(0n);

      await expect(
        ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 1)
      ).to.be.revertedWithCustomError(v, "TransferNotAllowed");

      await v.setShouldRevert(false);
      await ctx.mortals.connect(ctx.alice).transferFrom(ctx.alice.address, ctx.bob.address, 1);
      expect(await v.calls()).to.equal(1n);
      expect(await v.lastFrom()).to.equal(ctx.alice.address);
      expect(await v.lastTo()).to.equal(ctx.bob.address);
      expect(await v.lastTokenId()).to.equal(1n);
    });
  });

  describe("admin", function () {
    it("setGame is one-time", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.mortals.setGame(ctx.bob.address)).to.be.revertedWithCustomError(ctx.mortals, "GameAlreadySet");
    });

    it("owner-only setters are guarded", async function () {
      const ctx = await loadFixture(deployFixture);
      for (const call of [
        ctx.mortals.connect(ctx.alice).setSigner(ctx.alice.address),
        ctx.mortals.connect(ctx.alice).setPayout(ctx.alice.address),
        ctx.mortals.connect(ctx.alice).setMintActive(false),
        ctx.mortals.connect(ctx.alice).setDefaultRoyalty(ctx.alice.address, 100),
        ctx.mortals.connect(ctx.alice).setContractURI("x"),
      ]) {
        await expect(call).to.be.revertedWithCustomError(ctx.mortals, "OwnableUnauthorizedAccount");
      }
    });

    it("rotating the signer invalidates old vouchers", async function () {
      const ctx = await loadFixture(deployFixture);
      const nonce = nextNonce();
      const sig = await signVoucher(ctx.signer, ctx.mortals, ctx.alice.address, 1, nonce);
      await ctx.mortals.setSigner(ctx.carol.address);
      await expect(ctx.mortals.connect(ctx.alice).mint(1, nonce, sig)).to.be.revertedWithCustomError(
        ctx.mortals,
        "InvalidSignature"
      );
      const sig2 = await signVoucher(ctx.carol, ctx.mortals, ctx.alice.address, 1, nonce);
      await ctx.mortals.connect(ctx.alice).mint(1, nonce, sig2);
      expect(await ctx.mortals.balanceOf(ctx.alice.address)).to.equal(1n);
    });

    it("rejects zero addresses in setters and constructor", async function () {
      const ctx = await loadFixture(deployFixture);
      await expect(ctx.mortals.setSigner(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.mortals, "ZeroAddress");
      await expect(ctx.mortals.setPayout(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.mortals, "ZeroAddress");
      const M = await ethers.getContractFactory("Mortals");
      await expect(M.deploy(ethers.ZeroAddress, ctx.payout.address, "", "")).to.be.revertedWithCustomError(
        ctx.mortals,
        "ZeroAddress"
      );
    });
  });
});
