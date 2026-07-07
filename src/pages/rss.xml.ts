import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { GUIDES } from '../lib/guides-Claude';

// Feed of editorial additions. Dates are the real dates content went live,
// never refreshed artificially.
const LAUNCH = new Date('2026-07-07');

export const GET: APIRoute = (context) =>
  rss({
    title: 'Resting Places',
    description: 'New guides and editorial additions to the cemetery directory.',
    site: context.site!,
    items: Object.entries(GUIDES).map(([slug, g]) => ({
      title: g.title,
      link: `/guides/${slug}/`,
      description: g.intro,
      pubDate: LAUNCH,
    })),
  });
