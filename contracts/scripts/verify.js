/* eslint-disable no-console */
/**
 * Blockscout verification for every contract in deployments.json.
 *
 *   npx hardhat run scripts/verify.js --network robinhood
 *
 * If the plugin path fails, use the printed manual commands instead.
 */
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "deployments.json");
  if (!fs.existsSync(file)) throw new Error("deployments.json not found — run scripts/deploy.js first");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));

  const targets = [
    ["Soul", d.contracts.Soul, d.constructorArgs.Soul],
    ["Mortals", d.contracts.Mortals, d.constructorArgs.Mortals],
    ["Staking", d.contracts.Staking, d.constructorArgs.Staking],
    ["Game", d.contracts.Game, d.constructorArgs.Game],
    ["Chat", d.contracts.Chat, d.constructorArgs.Chat],
  ];

  console.log("Manual equivalents:\n");
  for (const [name, addr, args] of targets) {
    const quoted = args.map((a) => `"${a}"`).join(" ");
    console.log(`npx hardhat verify --network ${hre.network.name} ${addr} ${quoted}`.trim());
  }
  console.log("");

  for (const [name, addr, args] of targets) {
    try {
      console.log(`verifying ${name} @ ${addr} ...`);
      await hre.run("verify:verify", { address: addr, constructorArguments: args });
      console.log(`  ok`);
    } catch (e) {
      console.log(`  ${name}: ${e.message.split("\n")[0]}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
