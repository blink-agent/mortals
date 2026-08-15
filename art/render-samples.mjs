#!/usr/bin/env node
// render-samples.mjs — writes sample-1..12.svg + dead-sample.svg into
// art/samples/, and tries to also convert a handful to PNG for quick
// human eyeballing (via the optional `sharp` dependency, if installed).
// Zero required deps: if sharp isn't available, SVGs alone are produced.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSigil, deadSvg } from "./sigil.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "samples");
mkdirSync(OUT_DIR, { recursive: true });

const SALT = "preview";
const SAMPLE_COUNT = 12;
const PNG_IDS = [1, 2, 3, 4]; // subset to convert to PNG if possible

const written = [];

for (let id = 1; id <= SAMPLE_COUNT; id++) {
  const { svg, traits } = generateSigil(id, SALT);
  const path = join(OUT_DIR, `sample-${id}.svg`);
  writeFileSync(path, svg);
  written.push(path);
  console.log(`wrote ${path} — ${traits.map((t) => `${t.trait_type}:${t.value}`).join(", ")}`);
}

const deadPath = join(OUT_DIR, "dead-sample.svg");
writeFileSync(deadPath, deadSvg(9999));
written.push(deadPath);
console.log(`wrote ${deadPath}`);

// Best-effort PNG conversion for a subset, so humans can eyeball results
// without an SVG-capable viewer. Never fails the script if unavailable.
async function tryPngConversion() {
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    console.log("\n(sharp not installed — skipping PNG conversion; SVGs above are the deliverable)");
    return;
  }

  for (const id of PNG_IDS) {
    const { svg } = generateSigil(id, SALT);
    const pngPath = join(OUT_DIR, `sample-${id}.png`);
    try {
      await sharp(Buffer.from(svg)).png().toFile(pngPath);
      console.log(`wrote ${pngPath}`);
    } catch (err) {
      console.log(`PNG conversion failed for sample-${id}: ${err.message}`);
    }
  }

  try {
    const deadSvgStr = deadSvg(9999);
    const deadPngPath = join(OUT_DIR, "dead-sample.png");
    await sharp(Buffer.from(deadSvgStr)).png().toFile(deadPngPath);
    console.log(`wrote ${deadPngPath}`);
  } catch (err) {
    console.log(`PNG conversion failed for dead-sample: ${err.message}`);
  }
}

await tryPngConversion();
console.log("\ndone.");
