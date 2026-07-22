// Phase 3 + 4: classification over sourced facts, then the typed content
// collection data. Labels come from fixed vocabularies applied to Wikidata
// P31 type labels, heritage status, and the interment graph. Nothing is
// inferred beyond what a sourced field states; unmatched stays untagged and
// is counted, not papered over.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJson, ROOT } from './lib/api-Claude.mjs';

const records = JSON.parse(await readFile(path.join(ROOT, 'data', 'enriched-Claude.json'), 'utf8'));
const rights = JSON.parse(await readFile(path.join(ROOT, 'data', 'image-rights-report-Claude.json'), 'utf8'));
const geoMetadata = JSON.parse(await readFile(path.join(ROOT, 'data', 'country-metadata-Claude.json'), 'utf8'));
// Capped multi-image gallery (up to 3 per cemetery), see gallery-Claude.mjs.
// Optional file: an empty {} is a valid "gallery pipeline not yet run" state.
let galleryByQid = {};
try {
  galleryByQid = JSON.parse(await readFile(path.join(ROOT, 'data', 'gallery-Claude.json'), 'utf8'));
} catch {
  // not run yet; every record gets gallery: []
}
const PERSON_PAGE_SITELINKS = 15; // /buried/ page threshold, see phase 2 gate note

// ---------- helpers ----------
function slugify(s) {
  const out = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || null;
}

function uniqueSlug(base, taken, fallback) {
  let s = base ?? fallback;
  if (!taken.has(s)) { taken.add(s); return s; }
  const withFallback = `${s}-${fallback}`;
  taken.add(withFallback);
  return withFallback;
}

// ---------- classification (fixed vocabulary, sourced facts only) ----------
const TYPE_RULES = [
  ['national-military', /\b(national cemetery|military cemetery|war cemetery|war grave|military memorial|garrison cemetery)/],
  ['religious-churchyard', /\b(churchyard|jewish|islamic|muslim|catholic|protestant|orthodox|monaster|convent|abbey|buddhis|shinto|hindu|mennonite|quaker|moravian|lutheran|anglican)/],
  ['historic-heritage', /\b(necropolis|archaeological|catacomb|tumulus|barrow|dolmen|hypogeum|rock-cut)/],
  ['garden-rural', /\b(rural cemetery|garden cemetery|lawn cemetery)/],
  ['natural-green-burial', /\b(natural burial|green burial|woodland burial|conservation burial)/],
  ['municipal-public', /\b(municipal|communal cemetery|public cemetery|city cemetery|town cemetery|village cemetery)/],
  ['private', /\b(private cemetery|family cemetery|family (burial|plot)|pet cemetery)/],
];

function classifyTypes(r) {
  const hay = r.wd_types.join(' | ').toLowerCase();
  const types = TYPE_RULES.filter(([, re]) => re.test(hay)).map(([t]) => t);
  if (r.heritage_id && !types.includes('historic-heritage')) types.push('historic-heritage');
  return types;
}

// A handful of countries carry "Eurasia" as a P30 value instead of (or
// alongside) "Europe"/"Asia" (e.g. Russia lists all three; the Russian
// Empire, a purely historical entity, lists only "Eurasia" plus a real but
// unhelpful-for-browsing "North America" from its brief hold on Alaska).
// For continent HUB browsing specifically (not for the underlying data,
// which stays exactly as sourced), fold a bare "Eurasia" into both Europe
// and Asia so it doesn't create a thin third hub. This is a presentation
// choice, not an assertion about the country's real Wikidata continents.
function continentsForBrowsing(continents) {
  const labels = new Set(continents.map((c) => c.label));
  if (labels.has('Eurasia') && !labels.has('Europe') && !labels.has('Asia')) {
    const rest = continents.filter((c) => c.label !== 'Eurasia');
    return [...rest, { label: 'Europe', qid: 'Q46' }, { label: 'Asia', qid: 'Q48' }];
  }
  return continents;
}

function classifyEra(year) {
  if (year === null) return null;
  if (year < 1800) return 'pre-1800';
  if (year < 1900) return '1800s';
  if (year < 1945) return 'early-1900s';
  if (year < 1980) return 'mid-1900s';
  return 'contemporary';
}

// ---------- slugs ----------
const cemSlugs = new Set();
for (const r of records) {
  r.slug = uniqueSlug(slugify(r.name), cemSlugs, r.qid.toLowerCase());
}
const cemBySlug = new Map(records.map((r) => [r.slug, r]));

// Geo slugs: region and city slugs are made unique across countries by
// suffixing the country slug on collision (Georgia the state vs the country).
function geoSlugs(records, key) {
  const seen = new Map(); // slug -> Set of countries
  for (const r of records) {
    const name = r[key];
    if (!name) continue;
    const s = slugify(name);
    if (!s) continue;
    if (!seen.has(s)) seen.set(s, new Set());
    seen.get(s).add(r.country ?? '');
  }
  return (r) => {
    const name = r[key];
    if (!name) return null;
    const s = slugify(name);
    if (!s) return null;
    return seen.get(s).size > 1 && r.country ? `${s}-${slugify(r.country)}` : s;
  };
}

// ---------- assemble ----------
for (const r of records) {
  r.type = classifyTypes(r);
  r.era = classifyEra(r.established_year);
  r.city = r.admin_is_city ? r.admin : null;
  r.region = r.admin_is_city ? r.admin_up : r.admin;
}
const regionSlugOf = geoSlugs(records, 'region');
const citySlugOf = geoSlugs(records, 'city');

const TYPE_LABEL = {
  'national-military': 'national or military cemetery',
  'religious-churchyard': 'religious burial ground',
  'historic-heritage': 'historic cemetery',
  'garden-rural': 'garden cemetery',
  'natural-green-burial': 'natural burial ground',
  'municipal-public': 'municipal cemetery',
  private: 'private cemetery',
};

function shortDesc(r, interments) {
  const kind = r.type.length ? TYPE_LABEL[r.type[0]] : 'cemetery';
  const where = [r.city ?? r.region, r.country].filter(Boolean).join(', ');
  const parts = [`${r.name} is a ${kind}${where ? ` in ${where}` : ''}.`];
  const facts = [];
  if (r.established_year !== null) facts.push(`established in ${r.established_year}`);
  if (r.area_hectares !== null) facts.push(`covering ${r.area_hectares} hectares`);
  if (facts.length) parts.push(`It was ${facts.join(', ')}.`);
  if (r.heritage_id?.startsWith('NRHP')) parts.push('It is listed on the National Register of Historic Places.');
  else if (r.heritage_id) parts.push(`It holds ${r.heritage_id} status.`);
  if (interments.length > 0) {
    const top = interments.slice(0, 3).map((p) => p.person_name);
    const n = interments.length;
    parts.push(
      n === 1
        ? `Wikidata records ${top[0]} as a notable interment here.`
        : `Wikidata records ${n} notable interments here, including ${top.join(', ')}.`
    );
  }
  return parts.join(' ');
}

// ---------- person pages (/buried/) ----------
const personSlugs = new Set();
const buried = [];
const personSlugByQid = new Map();

for (const r of records) {
  for (const p of r.notable_interments) {
    if (p.sitelinks < PERSON_PAGE_SITELINKS) continue;
    if (personSlugByQid.has(p.person_qid)) continue;
    const slug = uniqueSlug(slugify(p.person_name), personSlugs, p.person_qid.toLowerCase());
    personSlugByQid.set(p.person_qid, slug);
    buried.push({
      id: p.person_qid,
      slug,
      name: p.person_name,
      qid: p.person_qid,
      birth_year: p.birth_year,
      death_year: p.death_year,
      known_for: p.known_for,
      sitelinks: p.sitelinks,
      wikipedia_url: p.wikipedia_url,
      cemetery_slug: r.slug,
      cemetery_name: r.name,
      cemetery_city: r.city,
      cemetery_region: r.region,
      cemetery_country: r.country,
      cemetery_coordinates: r.coordinates,
    });
  }
}

// ---------- related cemeteries ----------
const byCountry = new Map();
for (const r of records) {
  const c = r.country ?? '??';
  if (!byCountry.has(c)) byCountry.set(c, []);
  byCountry.get(c).push(r);
}
function related(r) {
  const pool = byCountry.get(r.country ?? '??') ?? [];
  return pool
    .filter((o) => o !== r)
    .map((o) => {
      let score = 0;
      if (o.region && o.region === r.region) score += 3;
      if (o.type.some((t) => r.type.includes(t))) score += 2;
      if (o.era && o.era === r.era) score += 1;
      if (o.notable_interments.length > 0) score += 1;
      return { o, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.o.slug);
}

// ---------- nearby cemeteries (real haversine distance) ----------
// Supplements related_slugs (category-similarity scoring) with genuinely
// geographic nearest-neighbors. Only records with coordinates participate;
// a cemetery with no coordinates gets nearby_slugs: null (can't claim a
// real distance to or from an unlocated place). O(n^2) over ~2,430 coord
// records (~2.95M pairs) computed once here at build time, each record
// keeping a running top-5-nearest list rather than sorting all pairs.
const RAD = Math.PI / 180;
const coordRecords = records
  .filter((r) => r.coordinates)
  .map((r) => ({
    slug: r.slug,
    lat: r.coordinates.lat,
    lng: r.coordinates.lng,
    latRad: r.coordinates.lat * RAD,
    lngRad: r.coordinates.lng * RAD,
  }));
coordRecords.forEach((r) => {
  r.cosLat = Math.cos(r.latRad);
  r.sinLat = Math.sin(r.latRad);
});

const EARTH_RADIUS_KM = 6371;
function haversineKm(a, b) {
  const dLat = b.latRad - a.latRad;
  const dLng = b.lngRad - a.lngRad;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + a.cosLat * b.cosLat * sinDLng * sinDLng;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const NEARBY_COUNT = 5;
const nearestBySlug = new Map(coordRecords.map((r) => [r.slug, []])); // bounded top-5, ascending distance

function considerNeighbor(list, slug, distance) {
  if (list.length < NEARBY_COUNT) {
    list.push({ slug, distance });
    list.sort((a, b) => a.distance - b.distance);
  } else if (distance < list[NEARBY_COUNT - 1].distance) {
    list[NEARBY_COUNT - 1] = { slug, distance };
    list.sort((a, b) => a.distance - b.distance);
  }
}

for (let i = 0; i < coordRecords.length; i++) {
  const a = coordRecords[i];
  const aList = nearestBySlug.get(a.slug);
  for (let j = i + 1; j < coordRecords.length; j++) {
    const b = coordRecords[j];
    const d = haversineKm(a, b);
    considerNeighbor(aList, b.slug, d);
    considerNeighbor(nearestBySlug.get(b.slug), a.slug, d);
  }
}

function nearbySlugsFor(r) {
  if (!r.coordinates) return null;
  return nearestBySlug.get(r.slug).map((x) => ({ slug: x.slug, distance_km: Math.round(x.distance * 10) / 10 }));
}

// ---------- occupation breakdown ----------
// known_for is free text straight from Wikidata P106, usually 1-3
// comma-separated occupation labels (e.g. "writer, poet, playwright").
// Aggregated over the FULL notable_interments list for the cemetery, not
// just the top INTERMENTS_SHOWN slice below, so the percentages reflect the
// whole documented population, not just the most-covered subset of it.
function occupationBreakdown(interments) {
  const total = interments.length;
  if (total === 0) return [];
  const counts = new Map();
  for (const p of interments) {
    if (!p.known_for) continue;
    // A person's own known_for can repeat a label (rare Wikidata duplication);
    // de-dupe per-person first so one person can't inflate a single label's count.
    const labels = new Set(
      p.known_for
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    for (const label of labels) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2) // exclude one-off unique labels; not a real breakdown
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }));
}

// ---------- final collection ----------
const INTERMENTS_SHOWN = 25;
const collection = records.map((r) => {
  const verdict = rights.verdicts[r.qid];
  const photo =
    verdict && verdict.verdict === 'PASS'
      ? {
          url: verdict.url,
          license: verdict.license,
          license_url: verdict.license_url ?? null,
          credit: verdict.credit,
          source: verdict.source,
          share_alike: verdict.share_alike,
        }
      : null;
  const interments = r.notable_interments; // already sorted by sitelinks desc
  return {
    id: r.slug,
    slug: r.slug,
    name: r.name,
    name_variants: r.name_variants,
    country: r.country,
    country_slug: r.country ? slugify(r.country) : null,
    country_iso2: r.country ? (geoMetadata[r.country]?.iso2 ?? null) : null,
    continents: r.country
      ? continentsForBrowsing(geoMetadata[r.country]?.continents ?? []).map((c) => ({ label: c.label, slug: slugify(c.label) }))
      : [],
    region: r.region,
    region_slug: regionSlugOf(r),
    city: r.city,
    city_slug: citySlugOf(r),
    coordinates: r.coordinates,
    coordinates_source: r.coordinates_source,
    established_year: r.established_year,
    type: r.type,
    era: r.era,
    area_hectares: r.area_hectares,
    wikidata_qid: r.qid,
    wikipedia_url: r.wikipedia_url ?? null,
    osm_id: r.osm_id,
    heritage_id: r.heritage_id,
    official_website: r.official_website,
    findagrave_url: r.findagrave_url,
    notable_interments: interments.slice(0, INTERMENTS_SHOWN).map((p) => ({
      person_name: p.person_name,
      person_qid: p.person_qid,
      person_slug: personSlugByQid.get(p.person_qid) ?? null,
      known_for: p.known_for,
      nationality: p.nationality ?? null,
      birth_year: p.birth_year,
      death_year: p.death_year,
    })),
    notable_interments_total: interments.length,
    has_notable_interments: interments.length > 0,
    occupation_breakdown: occupationBreakdown(interments),
    photo,
    gallery: galleryByQid[r.qid] ?? [],
    google_place_id: null,
    hours: null,
    short_desc: shortDesc(r, interments),
    history: null,
    related_slugs: related(r),
    nearby_slugs: nearbySlugsFor(r),
    seed_sublists: r.sublists,
    classification_source: 'generated',
    classification_reviewed: false,
  };
});

await writeJson('data/cemeteries-Claude.json', collection);
await writeJson('data/buried-Claude.json', buried);

// ---------- distributions (the gate) ----------
const dist = (arr) => {
  const d = {};
  for (const v of arr) d[v] = (d[v] ?? 0) + 1;
  return Object.fromEntries(Object.entries(d).sort((a, b) => b[1] - a[1]));
};
const report = {
  total: collection.length,
  type_distribution: dist(collection.flatMap((r) => (r.type.length ? r.type : ['(untyped)']))),
  era_distribution: dist(collection.map((r) => r.era ?? '(no established date)')),
  notable_interments: {
    with: collection.filter((r) => r.has_notable_interments).length,
    without: collection.filter((r) => !r.has_notable_interments).length,
  },
  photos_cleared: collection.filter((r) => r.photo).length,
  gallery_images_cleared: collection.reduce((a, r) => a + r.gallery.length, 0),
  cemeteries_with_gallery: collection.filter((r) => r.gallery.length > 0).length,
  buried_pages: buried.length,
  buried_page_threshold: `sitelinks >= ${PERSON_PAGE_SITELINKS} (of 70270 qualifying persons, page tier only; full graph ships in /api/interments.json)`,
  classification: 'generated, unreviewed (classification_reviewed=false on every record)',
  nearby_slugs: {
    cemeteries_with_coordinates: coordRecords.length,
    cemeteries_without_coordinates: collection.length - coordRecords.length,
    method: 'haversine distance in km over real coordinates, top 5 nearest per record',
  },
};
await writeJson('data/classification-report-Claude.json', report);
console.log(JSON.stringify(report, null, 2));
