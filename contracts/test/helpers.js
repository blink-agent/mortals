const { ethers } = require("hardhat");
const { time, impersonateAccount, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

const BASE_URI = "https://mortals.xyz/api/metadata/";
const CONTRACT_URI = "https://mortals.xyz/api/contract";

let _nonce = 0;
function nextNonce() {
  _nonce += 1;
  return ethers.zeroPadValue(ethers.toBeHex(_nonce), 32);
}

async function signVoucher(signer, mortals, minter, quantity, nonce, overrides = {}) {
  const chainId = overrides.chainId ?? (await ethers.provider.getNetwork()).chainId;
  const contract = overrides.contract ?? (await mortals.getAddress());
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "bytes32", "uint256", "address"],
    [minter, quantity, nonce, chainId, contract]
  );
  const digest = ethers.keccak256(encoded);
  return signer.signMessage(ethers.getBytes(digest));
}

async function deployFixture(useHarness = false) {
  const wallets = await ethers.getSigners();
  const [deployer, signer, payout, alice, bob, carol, dave, eve] = wallets;

  const Soul = await ethers.getContractFactory("Soul");
  const soul = await Soul.deploy();
  await soul.waitForDeployment();

  const Mortals = await ethers.getContractFactory(useHarness ? "MortalsHarness" : "Mortals");
  const mortals = await Mortals.deploy(signer.address, payout.address, BASE_URI, CONTRACT_URI);
  await mortals.waitForDeployment();

  const Staking = await ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(await mortals.getAddress(), await soul.getAddress());
  await staking.waitForDeployment();

  const Game = await ethers.getContractFactory("Game");
  const game = await Game.deploy(
    await mortals.getAddress(),
    await soul.getAddress(),
    await staking.getAddress(),
    payout.address
  );
  await game.waitForDeployment();

  const Chat = await ethers.getContractFactory("Chat");
  const chat = await Chat.deploy(await mortals.getAddress(), await staking.getAddress(), deployer.address);
  await chat.waitForDeployment();

  await (await soul.setMinter(await staking.getAddress())).wait();
  await (await soul.setGame(await game.getAddress())).wait();
  await (await staking.setGame(await game.getAddress())).wait();
  await (await mortals.setGame(await game.getAddress())).wait();
  await (await mortals.setDefaultRoyalty(await game.getAddress(), 500)).wait();
  await (await mortals.setMintActive(true)).wait();

  return {
    deployer,
    signer,
    payout,
    alice,
    bob,
    carol,
    dave,
    eve,
    wallets,
    soul,
    mortals,
    staking,
    game,
    chat,
  };
}

function harnessFixture() {
  return deployFixture(true);
}

/** ETH-mint `qty` tokens to `wallet` with a valid voucher. Returns the token ids. */
async function mintTo(ctx, wallet, qty, opts = {}) {
  const nonce = opts.nonce ?? nextNonce();
  const sig = await signVoucher(opts.signer ?? ctx.signer, ctx.mortals, wallet.address, qty, nonce);
  const cost = await ctx.mortals.priceForQuantity(qty);
  const start = await ctx.mortals.nextTokenId();
  await ctx.mortals.connect(wallet).mint(qty, nonce, sig, { value: opts.value ?? cost });
  return Array.from({ length: Number(qty) }, (_, i) => start + BigInt(i));
}

/**
 * Mint 32 tokens to `wallet`, stake them, fast-forward until at least `amount` SOUL has
 * accrued, then unstake (which settles + claims). Wallet ends with 32 alive tokens and
 * a SOUL balance >= amount.
 */
async function fundSoul(ctx, wallet, amount) {
  const ids = await mintTo(ctx, wallet, 32);
  await (await ctx.mortals.connect(wallet).setApprovalForAll(await ctx.staking.getAddress(), true)).wait();
  await (await ctx.staking.connect(wallet).stake(ids)).wait();

  const rate = await ctx.staking.RATE();
  const perSec = rate * 32n;
  const have = (await ctx.soul.balanceOf(wallet.address)) + (await ctx.staking.pendingRewards(wallet.address));
  let need = BigInt(amount) - have;
  if (need < 0n) need = 0n;
  await time.increase(need / perSec + 2n);

  await (await ctx.staking.connect(wallet).unstake(ids)).wait();
  return ids;
}

/** Returns a signer that impersonates the Game contract (funded), for direct-call tests. */
async function asGame(ctx) {
  const addr = await ctx.game.getAddress();
  await impersonateAccount(addr);
  await setBalance(addr, ethers.parseEther("100"));
  return ethers.getSigner(addr);
}

async function asAddress(addr) {
  await impersonateAccount(addr);
  await setBalance(addr, ethers.parseEther("100"));
  return ethers.getSigner(addr);
}

const DAY = 86400;
const HOUR = 3600;

module.exports = {
  BASE_URI,
  CONTRACT_URI,
  DAY,
  HOUR,
  nextNonce,
  signVoucher,
  deployFixture,
  harnessFixture,
  mintTo,
  fundSoul,
  asGame,
  asAddress,
};
