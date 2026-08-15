#!/usr/bin/env node
// trait-distribution.mjs — sanity-checks trait distribution over a range
// of tokenIds (no rendering, traits only — fast). Flags any trait value
// that falls outside a healthy [2%, 40%] band.

import { generateSigil } from "./sigil.mjs";

const SALT = process.argv[2] || "mortals-mainnet";
const N = Number(process.argv[3] || 2000);

const counts = {}; // trait_type -> { value -> count }

for (let id = 1; id <= N; id++) {
  const { traits } = generateSigil(id, SALT);
  for (const { trait_type, value } of traits) {
    counts[trait_type] ??= {};
    counts[trait_type][value] = (counts[trait_type][value] || 0) + 1;
  }
}

console.log(`Trait distribution over tokenId 1..${N} (salt="${SALT}")\n`);

let anyFlag = false;
for (const [traitType, values] of Object.entries(counts)) {
  console.log(`## ${traitType}`);
  const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);
  for (const [value, count] of rows) {
    const pct = (count / N) * 100;
    const flag = pct > 40 || pct < 2 ? "  <-- FLAG (outside 2-40%)" : "";
    if (flag) anyFlag = true;
    console.log(`  ${value.padEnd(10)} ${count.toString().padStart(5)}  ${pct.toFixed(2)}%${flag}`);
  }
  console.log("");
}

console.log(anyFlag ? "RESULT: one or more trait values fell outside the 2-40% band." : "RESULT: all trait values within the 2-40% band.");
