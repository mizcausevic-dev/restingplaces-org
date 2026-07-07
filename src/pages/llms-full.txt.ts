import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { GUIDES } from '../lib/guides-Claude';

// Complete page index for AI systems: every cemetery page with its one-line
// factual description, every hub, every guide.
export const GET: APIRoute = async ({ site }) => {
  const all = (await getCollection('cemeteries')).map((c) => c.data);
  const lines: string[] = [
    '# Resting Places: full page index',
    '',
    'Facts CC0 via Wikidata. See /llms.txt for overview and /api/ for JSON.',
    '',
    '## Guides',
    ...Object.entries(GUIDES).map(([slug, g]) => `- [${g.title}](${new URL(`/guides/${slug}/`, site).href})`),
    '',
    '## Cemeteries',
  ];
  for (const c of [...all].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`- [${c.name}](${new URL(`/cemeteries/${c.slug}/`, site).href}): ${c.short_desc}`);
  }
  return new Response(lines.join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
