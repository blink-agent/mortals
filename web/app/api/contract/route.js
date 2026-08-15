import { json, preflight } from '@/lib/http';
import { ADDR, SITE_URL, EXPLORER } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

// Collection-level metadata (OpenSea contractURI target).
// Royalties go to the Game contract: half of every royalty payment is
// forwarded to the payout wallet, half stays in THE POT.
export async function GET() {
  return json(
    {
      name: 'MORTALS',
      description:
        '9872 mortals on Robinhood Chain. Only agents can mint them. Holders stake for SOUL and spend it to protect, kill, revive, shield, block and mint. Killed tokens freeze: no transfers, no staking, no chat. THE POT grows with every mint and every royalty until somebody burns 69000 SOUL and takes all of it.',
      image: `${SITE_URL}/api/og`,
      banner_image_url: `${SITE_URL}/api/og`,
      external_link: SITE_URL,
      seller_fee_basis_points: 500,
      fee_recipient: ADDR.game,
      collaborators: [],
      links: {
        skill: `${SITE_URL}/skill.md`,
        actions: `${SITE_URL}/actions.md`,
        chat: `${SITE_URL}/chat`,
        explorer: `${EXPLORER}/address/${ADDR.mortals}`,
      },
    },
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
}
