/* eslint-disable no-console */
/**
 * MORTALS full deployment + wiring.
 *
 *   SIGNER_ADDRESS=0x...  \
 *   PAYOUT=0x...          \
 *   BASE_URI=https://.../api/metadata/     \
 *   CONTRACT_URI=https://.../api/contract  \
 *   DEPLOYER_PK=0x...     \
 *   npx hardhat run scripts/deploy.js --network robinhood
 *
 * Writes deployments.json and prints every address as JSON.
 */
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PK.");

  const SIGNER_ADDRESS = process.env.SIGNER_ADDRESS;
  if (!SIGNER_ADDRESS || !ethers.isAddress(SIGNER_ADDRESS)) {
    throw new Error("SIGNER_ADDRESS env var required (the voucher signer, NOT the deployer key)");
  }
  const PAYOUT = process.env.PAYOUT && ethers.isAddress(process.env.PAYOUT) ? process.env.PAYOUT : deployer.address;
  const BASE_URI = process.env.BASE_URI || "";
  const CONTRACT_URI = process.env.CONTRACT_URI || "";
  const OPERATOR = process.env.OPERATOR && ethers.isAddress(process.env.OPERATOR) ? process.env.OPERATOR : deployer.address;

  console.log("network        :", network.name);
  console.log("deployer       :", deployer.address);
  console.log("balance        :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");
  console.log("signer         :", SIGNER_ADDRESS);
  console.log("payout         :", PAYOUT);
  console.log("operator       :", OPERATOR);
  console.log("baseURI        :", BASE_URI);
  console.log("contractURI    :", CONTRACT_URI);
  console.log("");

  // ── 1. Soul (no constructor args) ─────────────────────────────────────
  const Soul = await ethers.getContractFactory("Soul");
  const soul = await Soul.deploy();
  await soul.waitForDeployment();
  console.log("1/5 Soul       :", await soul.getAddress());

  // ── 2. Mortals ────────────────────────────────────────────────────────
  const Mortals = await ethers.getContractFactory("Mortals");
  const mortals = await Mortals.deploy(SIGNER_ADDRESS, PAYOUT, BASE_URI, CONTRACT_URI);
  await mortals.waitForDeployment();
  console.log("2/5 Mortals    :", await mortals.getAddress());

  // ── 3. Staking (needs Mortals + Soul) ─────────────────────────────────
  const Staking = await ethers.getContractFactory("Staking");
  const staking = await Staking.deploy(await mortals.getAddress(), await soul.getAddress());
  await staking.waitForDeployment();
  console.log("3/5 Staking    :", await staking.getAddress());

  // ── 4. Game (needs Mortals + Soul + Staking + payout) ──────────────────
  const Game = await ethers.getContractFactory("Game");
  const game = await Game.deploy(
    await mortals.getAddress(),
    await soul.getAddress(),
    await staking.getAddress(),
    PAYOUT
  );
  await game.waitForDeployment();
  console.log("4/5 Game       :", await game.getAddress());

  // ── 5. Chat (needs Mortals + Staking + operator) ───────────────────────
  const Chat = await ethers.getContractFactory("Chat");
  const chat = await Chat.deploy(await mortals.getAddress(), await staking.getAddress(), OPERATOR);
  await chat.waitForDeployment();
  console.log("5/5 Chat       :", await chat.getAddress());
  console.log("");

  // ── Wiring (all one-time setters) ─────────────────────────────────────
  console.log("wiring...");
  let tx;
  tx = await soul.setMinter(await staking.getAddress());
  await tx.wait();
  console.log("  soul.setMinter(Staking)          ", tx.hash);

  tx = await soul.setGame(await game.getAddress());
  await tx.wait();
  console.log("  soul.setGame(Game)               ", tx.hash);

  tx = await staking.setGame(await game.getAddress());
  await tx.wait();
  console.log("  staking.setGame(Game)            ", tx.hash);

  tx = await mortals.setGame(await game.getAddress());
  await tx.wait();
  console.log("  mortals.setGame(Game)            ", tx.hash);

  tx = await mortals.setDefaultRoyalty(await game.getAddress(), 500);
  await tx.wait();
  console.log("  mortals.setDefaultRoyalty(Game,5%)", tx.hash);

  tx = await mortals.setMintActive(true);
  await tx.wait();
  console.log("  mortals.setMintActive(true)      ", tx.hash);
  console.log("");

  // ── Sanity checks ─────────────────────────────────────────────────────
  const checks = {
    soulMinter: await soul.minter(),
    soulGame: await soul.game(),
    stakingGame: await staking.game(),
    mortalsGame: await mortals.game(),
    mintActive: await mortals.mintActive(),
    royalty: (await mortals.royaltyInfo(1, 10000n)).toString(),
    chatOperator: await chat.operator(),
  };
  console.log("checks:", JSON.stringify(checks, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log("");

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    signer: SIGNER_ADDRESS,
    payout: PAYOUT,
    operator: OPERATOR,
    baseURI: BASE_URI,
    contractURI: CONTRACT_URI,
    timestamp: new Date().toISOString(),
    contracts: {
      Soul: await soul.getAddress(),
      Mortals: await mortals.getAddress(),
      Staking: await staking.getAddress(),
      Game: await game.getAddress(),
      Chat: await chat.getAddress(),
    },
    constructorArgs: {
      Soul: [],
      Mortals: [SIGNER_ADDRESS, PAYOUT, BASE_URI, CONTRACT_URI],
      Staking: [await mortals.getAddress(), await soul.getAddress()],
      Game: [await mortals.getAddress(), await soul.getAddress(), await staking.getAddress(), PAYOUT],
      Chat: [await mortals.getAddress(), await staking.getAddress(), OPERATOR],
    },
  };

  const file = path.join(__dirname, "..", "deployments.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out.contracts, null, 2));
  console.log("\nsaved ->", file);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
