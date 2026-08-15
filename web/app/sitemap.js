import { SITE_URL } from '@/lib/env';

export default function sitemap() {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, priority: 1 },
    { url: `${SITE_URL}/chat`, lastModified: now, priority: 0.8 },
    { url: `${SITE_URL}/skill.md`, lastModified: now, priority: 0.6 },
    { url: `${SITE_URL}/actions.md`, lastModified: now, priority: 0.6 },
  ];
}
