// sigil.mjs — MORTALS "soul sigil" generator
// Zero-dependency ES module. Deterministic pixel-art generator for the
// MORTALS NFT collection. Same (tokenId, salt) always produces the same
// SVG + traits — no crypto, no external RNG, just a small string hash
// feeding a tiny seeded PRNG (cyrb128 + sfc32, both public-domain-style
// one-liners commonly used for deterministic seeding in JS).

// ---------------------------------------------------------------------
// PRNG: cyrb128 (string -> 4x32bit seed) + sfc32 (fast, tiny, seeded)
// ---------------------------------------------------------------------
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

function sfc32(a, b, c, d) {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function makeRng(seedStr) {
  const seed = cyrb128(seedStr);
  const rand = sfc32(seed[0], seed[1], seed[2], seed[3]);
  // burn a few values — cyrb128 seeds can be weakly mixed on first draws
  rand(); rand(); rand();
  return rand;
}

// ---------------------------------------------------------------------
// Curated palettes — 2 colors each (primary = growth, accent = core/glow)
// ---------------------------------------------------------------------
const PALETTES = [
  { name: "EMBER", primary: "#ff7a45", accent: "#ffd9b0" }, // ember orange / ash cream
  { name: "ICHOR", primary: "#c81d4a", accent: "#ff8fa3" }, // blood red / rose
  { name: "BONE", primary: "#d8d3c4", accent: "#9a9488" }, // bone white / grey
  { name: "LILITH", primary: "#8a6bc1", accent: "#d9c9f5" }, // violet / lavender
  { name: "TIDE", primary: "#22c1c3", accent: "#a6f1f2" }, // cyan / teal
  { name: "VENOM", primary: "#9fef00", accent: "#4f7a00" }, // acid green
  { name: "GILT", primary: "#d4af37", accent: "#f6dd8c" }, // gold / amber
  { name: "RIME", primary: "#8ecae6", accent: "#e3f6ff" }, // ice blue
  { name: "WRAITH", primary: "#aab8c2", accent: "#5c6b78" }, // ghost grey-blue
  { name: "CINDER", primary: "#8f2d3a", accent: "#e0847a" }, // dark red / charcoal ember
  { name: "OMEN", primary: "#8b2fc9", accent: "#ff6ad5" }, // deep purple / magenta
  { name: "MOSS", primary: "#5c8a4a", accent: "#c7e0a8" }, // sage / dark green
];

const AURAS = ["FAINT", "SOFT", "STRONG", "RADIANT"];
const AURA_PARAMS = {
  FAINT: { blur: 0.35, opacity: 0.28 },
  SOFT: { blur: 0.55, opacity: 0.4 },
  STRONG: { blur: 0.8, opacity: 0.5 },
  RADIANT: { blur: 1.1, opacity: 0.62 },
};

const DENSITIES = ["Sparse", "Balanced", "Dense"];
// Growth is a bounded, deterministic-per-seed cellular automaton: a cell
// turns on only if its live-neighbor count falls in [minN, maxN] (keeps
// shapes airy instead of filling solid), and only within maxRadius
// (chebyshev distance from center) so silhouettes stay compact, centered,
// and — for Radial symmetry — stay close enough to the axis that the
// mirrored halves read as one connected creature, not two islands.
const DENSITY_PARAMS = {
  Sparse: { extraSeeds: 1, iterations: 1, minN: 2, maxN: 2, maxRadius: 2, growProb: 0.85 },
  Balanced: { extraSeeds: 2, iterations: 1, minN: 2, maxN: 3, maxRadius: 3, growProb: 0.75 },
  Dense: { extraSeeds: 3, iterations: 2, minN: 2, maxN: 3, maxRadius: 4, growProb: 0.7 },
};

// Core glyph shapes, defined as offsets (dx <= 0, dy relative to center)
// from the grid center. Since the grid is built from its left half and
// mirrored, only the left half + center column needs to be listed —
// mirroring completes the shape symmetrically.
const CORES = {
  heart: [
    [-1, -1], [-2, 0], [-1, 0], [0, 0], [-1, 1], [0, 1], [0, 2],
  ],
  eye: [
    [-1, -1], [0, -1], [-2, 0], [-1, 0], [0, 0], [-1, 1], [0, 1],
  ],
  cross: [
    [0, -2], [0, -1], [-2, 0], [-1, 0], [0, 0], [0, 1], [0, 2],
  ],
  spark: [
    [-1, -1], [0, 0], [-1, 1],
  ],
  hollow: [
    [-1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
  ],
};
const CORE_NAMES = Object.keys(CORES);

const GRID = 11;
const CENTER = 5; // 0-indexed center row/col
const CELL = 480 / GRID; // px per logical cell at 480x480 render
const BG = "#0a0a0f";

// ---------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------
function makeEmptyLeftGrid() {
  // rows 0..10, cols 0..5 (left half incl. center column)
  const g = [];
  for (let r = 0; r < GRID; r++) g.push(new Array(CENTER + 1).fill(0));
  return g;
}

function inLeftBounds(r, c) {
  return r >= 0 && r < GRID && c >= 0 && c <= CENTER;
}

function countNeighbors(g, r, c) {
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr, cc = c + dc;
      if (inLeftBounds(rr, cc) && g[rr][cc]) n++;
    }
  }
  return n;
}

function chebyshev(r, c) {
  return Math.max(Math.abs(r - CENTER), Math.abs(c - CENTER));
}

function growCA(rand, density) {
  const params = DENSITY_PARAMS[density];
  const g = makeEmptyLeftGrid();

  // always seed the exact center
  g[CENTER][CENTER] = 1;

  // additional seeds, biased near the center for a compact, connected look
  for (let i = 0; i < params.extraSeeds; i++) {
    const dr = Math.floor(rand() * 5) - 2; // -2..2
    const dc = -Math.floor(rand() * 3); // -2..0 (stay in left half)
    const r = CENTER + dr;
    const c = CENTER + dc;
    if (inLeftBounds(r, c) && chebyshev(r, c) <= params.maxRadius) g[r][c] = 1;
  }

  for (let it = 0; it < params.iterations; it++) {
    const next = g.map((row) => row.slice());
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c <= CENTER; c++) {
        if (g[r][c]) continue;
        if (chebyshev(r, c) > params.maxRadius) continue;
        const n = countNeighbors(g, r, c);
        if (n >= params.minN && n <= params.maxN && rand() < params.growProb) {
          next[r][c] = 1;
        }
      }
    }
    for (let r = 0; r < GRID; r++) g[r] = next[r];
  }

  return g;
}

function stampCore(g, coreName) {
  const core = new Set();
  for (const [dx, dy] of CORES[coreName]) {
    const r = CENTER + dy;
    const c = CENTER + dx;
    if (inLeftBounds(r, c)) {
      g[r][c] = 1;
      core.add(`${r},${c}`);
    }
  }
  return core;
}

function buildFullGrid(leftGrid, symmetry) {
  // returns full[r][c] = 0/1 for the 11x11 grid, vertical-mirrored always,
  // plus horizontal mirror too when symmetry === "Radial"
  const full = [];
  for (let r = 0; r < GRID; r++) full.push(new Array(GRID).fill(0));

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c <= CENTER; c++) {
      const v = leftGrid[r][c];
      if (v) {
        full[r][c] = 1;
        full[r][GRID - 1 - c] = 1;
      }
    }
  }

  if (symmetry === "Radial") {
    const mirrored = full.map((row) => row.slice());
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (mirrored[r][c]) full[GRID - 1 - r][c] = 1;
      }
    }
  }

  return full;
}

// ---------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[ch]));
}

function renderSigilSvg({ full, coreCells, palette, aura, tokenId }) {
  const { blur, opacity } = AURA_PARAMS[aura];
  const cells = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (!full[r][c]) continue;
      const isCore = coreCells.has(`${r},${c}`) || coreCells.has(`${r},${GRID - 1 - c}`);
      cells.push({ r, c, isCore });
    }
  }

  const glowRects = cells
    .map(({ r, c, isCore }) => {
      const x = c * CELL - CELL * 0.15;
      const y = r * CELL - CELL * 0.15;
      const w = CELL * 1.3;
      const fill = isCore ? palette.accent : palette.primary;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${w.toFixed(2)}" fill="${fill}"/>`;
    })
    .join("");

  const crispRects = cells
    .map(({ r, c, isCore }) => {
      const x = c * CELL;
      const y = r * CELL;
      const fill = isCore ? palette.accent : palette.primary;
      return `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${CELL.toFixed(3)}" height="${CELL.toFixed(3)}" fill="${fill}"/>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" width="480" height="480">
  <title>MORTAL #${tokenId} soul sigil</title>
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="${(blur * CELL).toFixed(2)}" result="blur"/>
    </filter>
  </defs>
  <rect x="0" y="0" width="480" height="480" fill="${BG}"/>
  <g filter="url(#glow)" opacity="${opacity}">${glowRects}</g>
  <g shape-rendering="crispEdges">${crispRects}</g>
</svg>`;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Generate a deterministic soul sigil for a given tokenId + salt.
 * @param {number|string} tokenId
 * @param {string} salt
 * @returns {{svg: string, traits: Array<{trait_type: string, value: string}>}}
 */
export function generateSigil(tokenId, salt) {
  const rand = makeRng(`${salt}:${tokenId}`);

  const palette = PALETTES[Math.floor(rand() * PALETTES.length)];
  const densityRoll = rand();
  const density = densityRoll < 1 / 3 ? "Sparse" : densityRoll < 2 / 3 ? "Balanced" : "Dense";
  const symmetry = rand() < 0.5 ? "Mirror" : "Radial";
  const coreName = CORE_NAMES[Math.floor(rand() * CORE_NAMES.length)];
  const aura = AURAS[Math.floor(rand() * AURAS.length)];

  const leftGrid = growCA(rand, density);
  const coreCells = stampCore(leftGrid, coreName);
  const full = buildFullGrid(leftGrid, symmetry);

  const svg = renderSigilSvg({ full, coreCells, palette, aura, tokenId });

  const traits = [
    { trait_type: "Status", value: "ALIVE" },
    { trait_type: "Palette", value: palette.name },
    { trait_type: "Density", value: density },
    { trait_type: "Symmetry", value: symmetry },
    { trait_type: "Core", value: coreName.charAt(0).toUpperCase() + coreName.slice(1) },
    { trait_type: "Aura", value: aura },
  ];

  return { svg, traits };
}

/**
 * Stark black-background "you've been killed" SVG for dead tokens.
 * @param {number|string} tokenId
 * @returns {string}
 */
export function deadSvg(tokenId) {
  const idStr = escapeXml(`MORTAL #${tokenId}`);
  // Pixel-style monospace, letter-spaced, all caps — legible at a glance.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" width="480" height="480">
  <title>MORTAL #${tokenId} — DEAD</title>
  <rect x="0" y="0" width="480" height="480" fill="#000000"/>
  <g font-family="'Courier New', ui-monospace, monospace" text-anchor="middle" fill="#ffffff">
    <text x="240" y="220" font-size="34" font-weight="700" letter-spacing="2">YOU'VE</text>
    <text x="240" y="262" font-size="34" font-weight="700" letter-spacing="2">BEEN KILLED</text>
    <text x="240" y="320" font-size="16" fill="#8a1414" letter-spacing="3">${idStr}</text>
  </g>
  <rect x="0" y="0" width="480" height="480" fill="none" stroke="#1a0000" stroke-width="6"/>
</svg>`;
}

/**
 * Traits for a dead token — single-trait black metadata per spec.
 * @returns {Array<{trait_type: string, value: string}>}
 */
export function deadTraits() {
  return [{ trait_type: "Status", value: "DEAD" }];
}

export const __internal = {
  PALETTES, AURAS, DENSITIES, CORE_NAMES, cyrb128, sfc32,
};
