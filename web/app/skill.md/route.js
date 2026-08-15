import { readSkillFile } from '@/lib/skills';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return readSkillFile('skill.md');
}
