/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const LIMIT = 24576;
for (const name of ["Mortals", "Soul", "Staking", "Game", "Chat"]) {
  const p = path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  const a = JSON.parse(fs.readFileSync(p, "utf8"));
  const bytes = (a.deployedBytecode.length - 2) / 2;
  console.log(
    name.padEnd(9),
    String(bytes).padStart(6),
    "bytes",
    ((bytes / LIMIT) * 100).toFixed(1) + "% of the 24576 limit"
  );
}
