import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import graph from '../../../../data/interment-graph-Claude.json';
import personsData from '../../../../data/persons-Claude.json';

// Full per-cemetery record, including the complete notable-interment list
// (the HTML page shows the top 25; this endpoint has all of them).

export const getStaticPaths: GetStaticPaths = async () => {
  const all = await getCollection('cemeteries');
  return all.map((c) => ({ params: { slug: c.data.slug }, props: { cem: c.data } }));
};

export const GET: APIRoute = async ({ props, site }) => {
  const { cem } = props as { cem: any };
  const edgeQids: string[] = (graph as any).edges[cem.wikidata_qid] ?? [];
  const interments = edgeQids
    .map((qid) => (personsData as any)[qid])
    .filter(Boolean)
    .map((p: any) => ({
      person_qid: p.person_qid,
      person_name: p.person_name,
      birth_year: p.birth_year,
      death_year: p.death_year,
      known_for: p.known_for,
      wikipedia_url: p.wikipedia_url,
    }));
  const record = {
    ...cem,
    notable_interments: interments,
    url: new URL(`/cemeteries/${cem.slug}/`, site).href,
    license: 'Facts CC0 via Wikidata; photo licenses as stated per record; see /attribution',
  };
  return new Response(JSON.stringify(record), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
