# MORTALS — soul sigil art module

Zero-dependency ES module. Import `generateSigil`/`deadSvg`/`deadTraits` from `sigil.mjs` directly in a Next.js API route (`app/api/image/[id]/route.ts` and `app/api/metadata/[id]/route.ts`) — no build step needed since it's plain JS with no deps.

```js
import { generateSigil, deadSvg, deadTraits } from "@/art/sigil.mjs"; // or relative path

// GET /api/image/[id]
const isDead = await checkOnChain(id); // read isDead from Mortals.sol
const svg = isDead ? deadSvg(id) : generateSigil(id, process.env.ART_SALT).svg;
return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });

// GET /api/metadata/[id]
const traits = isDead ? deadTraits() : generateSigil(id, process.env.ART_SALT).traits;
```

Keep `ART_SALT` fixed and secret-ish (an env var, not committed) so ids can't be pre-browsed for rare traits before mint, but reuse the same salt everywhere so `/api/image` and `/api/metadata` stay in sync for a given token. `preview.html` and `render-samples.mjs` use the public salt `"preview"` for demos only — do not use it in production.
