// Phase 2: enrichment from licensed sources only.
// Order per entity: Wikidata (CC0) -> interment graph (CC0) -> Nominatim
// fallback geocoding. Google Places is skipped in this run: no API key is
// configured, so google_place_id and hours stay null and hours are omitted
// sitewide by the freshness gate. Nothing is synthesized: a field that does
// not resolve is null with provenance recorded.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sparql, cachedJson, writeJson, ROOT } from './lib/api-Claude.mjs';

const WD = 'http://www.wikidata.org/entity/';
const qid = (uri) => uri.replace(WD, '');

// ---------- load seed ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csv = await readFile(path.join(ROOT, 'data', 'seed-Claude.csv'), 'utf8');
const [head, ...rows] = parseCsv(csv);
const seed = rows
  .filter((r) => r.length >= 5)
  .map((r) => ({ qid: r[0], name: r[1], place_hint: r[2], wikipedia_url: r[3], sublists: r[4].split('|') }));
console.log(`[seed] ${seed.length} entities loaded`);

// ---------- Wikidata entity enrichment ----------
async function enrichBatch(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const query = `
SELECT ?item ?itemLabel ?coord ?inception ?areaM2 ?countryLabel
       (SAMPLE(?adminL) AS ?adminLabel) (SAMPLE(?adminIsCity) AS ?adminCity)
       (SAMPLE(?adminUpL) AS ?adminUpLabel)
       (SAMPLE(?image) AS ?img) (SAMPLE(?website) AS ?site)
       (SAMPLE(?nrhp) AS ?nrhpId) (SAMPLE(?heritageL) AS ?heritageLabel)
       (SAMPLE(?osm) AS ?osmRel) (SAMPLE(?fag) AS ?fagId)
       (GROUP_CONCAT(DISTINCT ?typeL; separator="|") AS ?types)
       (GROUP_CONCAT(DISTINCT ?altLabel; separator="|") AS ?aliases)
WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item p:P2046/psn:P2046/wikibase:quantityAmount ?areaM2 }
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL {
    ?item wdt:P131 ?admin .
    ?admin rdfs:label ?adminL FILTER(LANG(?adminL) = "en")
    BIND(EXISTS { ?admin wdt:P31/wdt:P279* wd:Q486972 } AS ?adminIsCity)
    OPTIONAL { ?admin wdt:P131 ?adminUp . ?adminUp rdfs:label ?adminUpL FILTER(LANG(?adminUpL) = "en") }
  }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P649 ?nrhp }
  OPTIONAL { ?item wdt:P1435 ?heritage . ?heritage rdfs:label ?heritageL FILTER(LANG(?heritageL) = "en") }
  OPTIONAL { ?item wdt:P402 ?osm }
  OPTIONAL { ?item wdt:P2025 ?fag }
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeL FILTER(LANG(?typeL) = "en") }
  OPTIONAL { ?item skos:altLabel ?altLabel FILTER(LANG(?altLabel) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?item ?itemLabel ?coord ?inception ?areaM2 ?countryLabel`;
  const res = await sparql(query);
  return res.results.bindings;
}

const enriched = new Map();
{
  const BATCH = 150;
  for (let i = 0; i < seed.length; i += BATCH) {
    const batch = seed.slice(i, i + BATCH).map((s) => s.qid);
    let bindings;
    try {
      bindings = await enrichBatch(batch);
    } catch (err) {
      console.log(`[wd] batch ${i} failed (${err.message}), splitting`);
      bindings = [];
      for (const half of [batch.slice(0, batch.length / 2), batch.slice(batch.length / 2)]) {
        bindings.push(...(await enrichBatch(half)));
      }
    }
    for (const b of bindings) {
      const id = qid(b.item.value);
      const coordM = b.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      const year = b.inception ? Number(b.inception.value.slice(0, b.inception.value.startsWith('-') ? 5 : 4)) : null;
      enriched.set(id, {
        qid: id,
        label: b.itemLabel?.value ?? null,
        coordinates: coordM ? { lat: Number(coordM[2]), lng: Number(coordM[1]) } : null,
        coordinates_source: coordM ? 'wikidata' : null,
        established_year: Number.isFinite(year) ? year : null,
        area_hectares: b.areaM2 ? Math.round((Number(b.areaM2.value) / 10000) * 100) / 100 : null,
        country: b.countryLabel?.value ?? null,
        admin: b.adminLabel?.value ?? null,
        admin_is_city: b.adminCity?.value === 'true',
        admin_up: b.adminUpLabel?.value ?? null,
        commons_image: b.img ? decodeURIComponent(b.img.value.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ') || null : null,
        official_website: b.site?.value ?? null,
        heritage_id: b.nrhpId?.value ? `NRHP ${b.nrhpId.value}` : b.heritageLabel?.value ?? null,
        osm_id: b.osmRel ? `relation/${b.osmRel.value}` : null,
        findagrave_url: b.fagId?.value ? `https://www.findagrave.com/cemetery/${b.fagId.value}` : null,
        wd_types: b.types?.value ? b.types.value.split('|').filter(Boolean) : [],
        name_variants: b.aliases?.value ? b.aliases.value.split('|').filter(Boolean).slice(0, 6) : [],
      });
    }
    console.log(`[wd] ${Math.min(i + BATCH, seed.length)}/${seed.length} enriched`);
  }
}

// ---------- interment graph (the core asset) ----------
// Notability threshold enforced in the query: enwiki article + death date.
async function intermentBatch(qids) {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const query = `
SELECT ?cem ?person ?personLabel ?birth ?death ?sitelinks ?article
       (GROUP_CONCAT(DISTINCT ?occL; separator=", ") AS ?occs)
WHERE {
  VALUES ?cem { ${values} }
  ?person wdt:P119 ?cem ; wdt:P570 ?death .
  ?article schema:about ?person ; schema:isPartOf <https://en.wikipedia.org/> .
  ?person wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?person wdt:P569 ?birth }
  OPTIONAL { ?person wdt:P106 ?occ . ?occ rdfs:label ?occL FILTER(LANG(?occL) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?cem ?person ?personLabel ?birth ?death ?sitelinks ?article`;
  const res = await sparql(query);
  return res.results.bindings;
}

async function intermentsFor(qids) {
  try {
    return await intermentBatch(qids);
  } catch (err) {
    if (qids.length === 1) {
      console.log(`[graph] ${qids[0]} failed even alone (${err.message}), skipping`);
      return [];
    }
    console.log(`[graph] batch of ${qids.length} failed (${err.message}), splitting`);
    const mid = Math.ceil(qids.length / 2);
    return [...(await intermentsFor(qids.slice(0, mid))), ...(await intermentsFor(qids.slice(mid)))];
  }
}

const yearOf = (v) => {
  if (!v) return null;
  const y = Number(v.value.slice(0, v.value.startsWith('-') ? 5 : 4));
  return Number.isFinite(y) ? y : null;
};

const graph = new Map(); // cemetery qid -> [person records]
const persons = new Map(); // person qid -> record
{
  const BATCH = 60;
  const allQids = seed.map((s) => s.qid);
  for (let i = 0; i < allQids.length; i += BATCH) {
    const bindings = await intermentsFor(allQids.slice(i, i + BATCH));
    for (const b of bindings) {
      const cem = qid(b.cem.value);
      const pid = qid(b.person.value);
      const rec = {
        person_qid: pid,
        person_name: b.personLabel?.value ?? pid,
        birth_year: yearOf(b.birth),
        death_year: yearOf(b.death),
        known_for: b.occs?.value ? b.occs.value.split(', ').slice(0, 3).join(', ') : null,
        sitelinks: Number(b.sitelinks?.value ?? 0),
        wikipedia_url: b.article?.value ?? null,
      };
      if (!graph.has(cem)) graph.set(cem, []);
      graph.get(cem).push(rec);
      if (!persons.has(pid)) persons.set(pid, { ...rec, buried_in: cem });
    }
    console.log(`[graph] ${Math.min(i + BATCH, allQids.length)}/${allQids.length} cemeteries queried, ${persons.size} persons, ${[...graph.values()].reduce((a, v) => a + v.length, 0)} edges`);
  }
}

// ---------- Nominatim fallback geocoding ----------
const missingCoords = seed.filter((s) => enriched.get(s.qid) && !enriched.get(s.qid).coordinates);
console.log(`[nominatim] ${missingCoords.length} entities lack Wikidata coordinates, trying fallback`);
let geocoded = 0;
for (const s of missingCoords) {
  const e = enriched.get(s.qid);
  const q = encodeURIComponent(`${s.name}${s.place_hint ? ', ' + s.place_hint.split('|')[0] : ''}`);
  try {
    const res = await cachedJson(
      'nominatim',
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${q}`,
      { delayMs: 1100 }
    );
    const hit = res?.[0];
    // Accept only results OSM itself classes as a burial ground. Never guess.
    if (hit && (hit.type === 'cemetery' || hit.type === 'grave_yard')) {
      e.coordinates = { lat: Number(hit.lat), lng: Number(hit.lon) };
      e.coordinates_source = 'nominatim';
      if (!e.osm_id && hit.osm_type && hit.osm_id) e.osm_id = `${hit.osm_type}/${hit.osm_id}`;
      geocoded++;
    }
  } catch (err) {
    console.log(`[nominatim] ${s.name}: ${err.message}`);
  }
}
console.log(`[nominatim] recovered coordinates for ${geocoded}/${missingCoords.length}`);

// ---------- merge + reports ----------
const records = seed
  .map((s) => {
    const e = enriched.get(s.qid);
    if (!e) return null;
    const interments = (graph.get(s.qid) ?? []).sort((a, b) => b.sitelinks - a.sitelinks);
    return { ...s, ...e, notable_interments: interments };
  })
  .filter(Boolean);

await writeJson('data/enriched-Claude.json', records);

const graphObj = {};
for (const [cem, list] of graph) graphObj[cem] = list.map((p) => p.person_qid);
await writeJson('data/interment-graph-Claude.json', {
  license: 'CC0 (Wikidata)',
  threshold: 'person has enwiki article + death date (P570) + place of burial (P119)',
  cemeteries_with_interments: graph.size,
  total_edges: [...graph.values()].reduce((a, v) => a + v.length, 0),
  unique_persons: persons.size,
  edges: graphObj,
});
await writeJson('data/persons-Claude.json', Object.fromEntries(persons));

const cov = (f) => records.filter(f).length;
const coverage = {
  total_entities: records.length,
  coordinates: cov((r) => r.coordinates),
  coordinates_wikidata: cov((r) => r.coordinates_source === 'wikidata'),
  coordinates_nominatim: cov((r) => r.coordinates_source === 'nominatim'),
  established_year: cov((r) => r.established_year !== null),
  country: cov((r) => r.country),
  admin_region: cov((r) => r.admin),
  area: cov((r) => r.area_hectares !== null),
  commons_image_candidate: cov((r) => r.commons_image),
  official_website: cov((r) => r.official_website),
  heritage_id: cov((r) => r.heritage_id),
  osm_id: cov((r) => r.osm_id),
  findagrave_linkout: cov((r) => r.findagrave_url),
  with_notable_interments: cov((r) => r.notable_interments.length > 0),
  google_places: 0,
  google_places_note: 'skipped: no GOOGLE_PLACES_KEY configured; hours omitted sitewide per freshness gate',
};
await writeJson('data/coverage-report-Claude.json', coverage);
console.log('\n[coverage]', JSON.stringify(coverage, null, 2));
