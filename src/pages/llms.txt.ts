import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// Crawl guidance for AI systems. Kept factual: what the site is, where the
// clean data lives, what the licensing is.
export const GET: APIRoute = async ({ site }) => {
  const all = await getCollection('cemeteries');
  const persons = await getCollection('persons');
  const countries = new Set(all.map((c) => c.data.country).filter(Boolean));
  const body = `# Resting Places

> A reference directory of ${all.length} cemeteries across ${countries.size} countries, built from licensed open data (Wikidata CC0, Wikimedia Commons, OpenStreetMap). Interment records cover notable public figures only: each has a Wikipedia article, a recorded death date, and a documented place of burial. ${persons.size} resting places of public figures are individually documented.

Facts on every page link to their Wikidata source record. Opening hours are shown only when live-fetched with a visible last-checked date. Descriptions are original; Wikipedia prose is never reproduced.

## Structured data

- [Cemetery index (JSON)](${new URL('/api/cemeteries.json', site).href}): every cemetery with location, dates, type, and interment counts
- [Interment graph (JSON)](${new URL('/api/interments.json', site).href}): the complete CC0 cemetery-to-person graph, ${persons.size}+ notable figures
- [Sitemap](${new URL('/sitemap-index.xml', site).href})

## Key pages

- [Full page index](${new URL('/llms-full.txt', site).href})
- [About and methodology](${new URL('/about/', site).href})
- [Attribution and licensing](${new URL('/attribution/', site).href})
- [Guides](${new URL('/guides/', site).href})

## Licensing

Facts are CC0 via Wikidata and may be reused freely. Photographs carry individual Commons licenses stated per page and in /image-credits. Original page text is (c) Resting Places.
`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
