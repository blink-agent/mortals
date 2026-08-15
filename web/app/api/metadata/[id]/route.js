import { contracts, soft } from '@/lib/chain';
import { ART_SALT, SITE_URL } from '@/lib/env';
import { json, fail, preflight } from '@/lib/http';
import { generateSigil, deadTraits } from '@/lib/sigil.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function GET(_req, { params }) {
  const raw = String(params.id || '');
  if (!/^\d+$/.test(raw)) {
    return fail('not_found', 'Unknown token.', 404);
  }
  const id = raw.replace(/^0+(?=\d)/, '');

  const c = contracts();
  const exists = await soft(() => c.mortals.exists(id), null);
  if (exists === false) {
    return fail('not_found', `MORTAL #${id} does not exist.`, 404);
  }

  const dead = (await soft(() => c.mortals.isDead(id), false)) === true;
  const image = `${SITE_URL}/api/image/${id}`;

  // Status can flip on any block, but a 60s window is fine — and indexers
  // (Blockscout, OpenSea) deprioritize uncacheable metadata.
  const headers = { 'Cache-Control': 'public, max-age=60' };

  if (dead) {
    return json(
      {
        name: `MORTAL #${id}`,
        description: "You've been killed.",
        image,
        external_url: `${SITE_URL}`,
        attributes: deadTraits(),
      },
      200,
      headers,
    );
  }

  const { traits } = generateSigil(id, ART_SALT);
  return json(
    {
      name: `MORTAL #${id}`,
      description:
        'A soul sigil on Robinhood Chain. Alive until somebody burns 500 SOUL to end it.',
      image,
      external_url: `${SITE_URL}`,
      attributes: traits,
    },
    200,
    headers,
  );
}
