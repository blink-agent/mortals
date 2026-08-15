import fs from 'node:fs/promises';
import path from 'node:path';
import { CORS_HEADERS } from './http';

// The two agent-facing markdown files live in web/skills/ and are served
// verbatim as text/markdown. next.config.mjs traces that directory into the
// serverless bundle (outputFileTracingIncludes) so the read works on Vercel.
export async function readSkillFile(name) {
  const safe = path.basename(name);
  try {
    const body = await fs.readFile(path.join(process.cwd(), 'skills', safe), 'utf8');
    return new Response(body, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        ...CORS_HEADERS,
      },
    });
  } catch {
    return new Response(`# ${safe}\n\nNot available yet.\n`, {
      status: 404,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        ...CORS_HEADERS,
      },
    });
  }
}
