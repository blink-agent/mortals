import { json, preflight } from '@/lib/http';
import { getMessages } from '@/lib/chatlog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return preflight();
}

export async function GET(req) {
  const url = new URL(req.url);
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw !== null && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;

  const messages = await getMessages({ before, limit: 100 });
  return json({ messages, count: messages.length });
}
