import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// Machine index of every cemetery in the directory. Facts are CC0 (Wikidata).
export const GET: APIRoute = async ({ site }) => {
  const all = await getCollection('cemeteries');
  const index = all.map((c) => ({
    slug: c.data.slug,
    name: c.data.name,
    wikidata_qid: c.data.wikidata_qid,
    country: c.data.country,
    region: c.data.region,
    city: c.data.city,
    coordinates: c.data.coordinates,
    established_year: c.data.established_year,
    type: c.data.type,
    era: c.data.era,
    heritage_id: c.data.heritage_id,
    notable_interments_total: c.data.notable_interments_total,
    url: new URL(`/cemeteries/${c.data.slug}/`, site).href,
    api: new URL(`/api/cemeteries/${c.data.slug}.json`, site).href,
  }));
  return new Response(
    JSON.stringify({ license: 'Facts CC0 via Wikidata; see /attribution', count: index.length, cemeteries: index }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
