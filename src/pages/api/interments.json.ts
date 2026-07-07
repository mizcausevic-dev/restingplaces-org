import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import graph from '../../../data/interment-graph-Claude.json';
import personsData from '../../../data/persons-Claude.json';

// The complete cemetery-to-person interment graph, CC0, as a clean machine
// dataset. This is the differentiation surface of the site and it ships
// whole: every edge, not just the page-tier subset.
export const GET: APIRoute = async ({ site }) => {
  const all = await getCollection('cemeteries');
  const bySlugQid = new Map(all.map((c) => [c.data.wikidata_qid, c.data]));
  const cemeteries: Record<string, any> = {};
  for (const [cemQid, personQids] of Object.entries((graph as any).edges)) {
    const cem = bySlugQid.get(cemQid);
    if (!cem) continue;
    cemeteries[cemQid] = {
      name: cem.name,
      slug: cem.slug,
      country: cem.country,
      url: new URL(`/cemeteries/${cem.slug}/`, site).href,
      interments: (personQids as string[])
        .map((qid) => (personsData as any)[qid])
        .filter(Boolean)
        .map((p: any) => ({
          qid: p.person_qid,
          name: p.person_name,
          birth_year: p.birth_year,
          death_year: p.death_year,
          known_for: p.known_for,
        })),
    };
  }
  return new Response(
    JSON.stringify({
      license: 'CC0 (facts from Wikidata)',
      threshold: (graph as any).threshold,
      cemeteries_with_interments: (graph as any).cemeteries_with_interments,
      total_edges: (graph as any).total_edges,
      unique_persons: (graph as any).unique_persons,
      cemeteries,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
