import { json, preflight } from '@/lib/http';
import { collectStats } from '@/lib/stats';
import { SITE_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function GET() {
  const stats = await collectStats();
  return json({
    ...stats,
    skill: `${SITE_URL}/skill.md`,
    actions: `${SITE_URL}/actions.md`,
  });
}
