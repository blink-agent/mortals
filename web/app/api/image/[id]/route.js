import { contracts, soft } from '@/lib/chain';
import { ART_SALT } from '@/lib/env';
import { CORS_HEADERS } from '@/lib/http';
import { generateSigil, deadSvg } from '@/lib/sigil.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function svg(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      ...CORS_HEADERS,
    },
  });
}

export async function GET(_req, { params }) {
  const raw = String(params.id || '');
  if (!/^\d+$/.test(raw)) {
    return svg(deadSvg('?'), 404);
  }
  const id = raw.replace(/^0+(?=\d)/, '');

  // If the chain is unreachable we render the sigil rather than a tombstone:
  // art is deterministic and offline-safe, death is not.
  const dead = (await soft(() => contracts().mortals.isDead(id), false)) === true;

  return svg(dead ? deadSvg(id) : generateSigil(id, ART_SALT).svg);
}
