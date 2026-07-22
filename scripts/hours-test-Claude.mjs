// SCAFFOLDING / TEST SCRIPT — not wired into the pipeline.
//
// Tests opening-hours resolution for a small (15-cemetery) sample, in two
// tiers:
//   1. OpenStreetMap Overpass API (https://overpass-api.de/api/interpreter)
//      for an `opening_hours` tag — free, no key, tried first for everyone.
//   2. Google Places API (New) — Text Search (id-only field mask, free) then
//      Place Details (minimal field mask: id,displayName,regularOpeningHours,
//      currentOpeningHours,businessStatus) — billed at the Enterprise SKU,
//      $20.00/1000 calls, 1000 free/month. Only tried for cemeteries where
//      step 1 found nothing, and only if PUBLIC_GOOGLE_MAPS_KEY resolves to
//      a real key.
//
// This does NOT write to data/cemeteries-Claude.json, does NOT touch
// src/content.config.ts's hours schema, and does NOT run against anything
// beyond the fixed 15-cemetery test set below. Full-scale (2,443-cemetery)
// runs are an explicit separate go/no-ahead after reviewing these results.
//
// Run: node scripts/hours-test-Claude.mjs
// (or: node --env-file=.env scripts/hours-test-Claude.mjs)

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { cachedJson, ROOT, USER_AGENT } from './lib/api-Claude.mjs';

// ---------- test set ----------
// 3 well-known (Pere Lachaise, Arlington, Highgate) + 12 obscure cemeteries
// picked with a seeded pseudo-random draw stratified across continents
// (3 North America / 3 Europe / 2 Asia / 2 Oceania / 1 Africa / 1 South
// America) from the pool of 2,443 minus the 3 well-known ones, so this is a
// realistic mixed sample, not a cherry-picked easy one. Selection script is
// not preserved as a separate file since it's a one-time deterministic pick;
// slugs are pinned below so re-runs test the same 15 records.
const TEST_SLUGS = [
  // well-known
  'pere-lachaise-cemetery',
  'arlington-national-cemetery',
  'highgate-cemetery',
  // obscure / stratified by continent
  'sparkman-hillcrest-memorial-park-cemetery', // North America
  'colfax-district-cemetery', // North America
  'mount-feake-cemetery', // North America
  'weaste-cemetery', // Europe
  'becklingen-war-cemetery', // Europe
  'brandhoek-new-military-commonwealth-war-graves-commission-cemetery', // Europe
  'giri-tunggal-heroes-cemetery', // Asia
  'manila-chinese-cemetery', // Asia
  'kadina-cemetery', // Oceania
  'croydon-cemetery-queensland', // Oceania
  'national-heroes-acre-zimbabwe', // Africa
  'recoleta-cemetery-asuncion', // South America
];

// ---------- load records ----------
const allCemeteries = JSON.parse(
  await readFile(path.join(ROOT, 'data', 'cemeteries-Claude.json'), 'utf8')
);
const bySlug = new Map(allCemeteries.map((c) => [c.slug, c]));

const testSet = [];
for (const slug of TEST_SLUGS) {
  const rec = bySlug.get(slug);
  if (!rec) {
    console.error(`[fatal] test slug not found in data/cemeteries-Claude.json: ${slug}`);
    process.exit(1);
  }
  testSet.push(rec);
}
console.log(`[setup] ${testSet.length} test cemeteries loaded`);

// ---------- Overpass (free, no key) ----------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function overpassQueryForOsmId(osmId) {
  const [type, id] = osmId.split('/');
  return `[out:json][timeout:25];\n${type}(${id});\nout tags;`;
}

function overpassQueryAround(lat, lng, radiusM) {
  return `[out:json][timeout:25];\n(\n  way["leisure"="cemetery"](around:${radiusM},${lat},${lng});\n  relation["leisure"="cemetery"](around:${radiusM},${lat},${lng});\n  way["amenity"="grave_yard"](around:${radiusM},${lat},${lng});\n  node["amenity"="grave_yard"](around:${radiusM},${lat},${lng});\n  way["landuse"="cemetery"](around:${radiusM},${lat},${lng});\n  relation["landuse"="cemetery"](around:${radiusM},${lat},${lng});\n);\nout tags center;`;
}

async function runOverpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  return cachedJson('overpass', OVERPASS_URL + '#' + createHash('sha1').update(body).digest('hex'), {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    delayMs: 1200, // be polite to the shared public instance
    retries: 4,
  });
}

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function tryOverpass(cemetery) {
  const { lat, lng } = cemetery.coordinates || {};
  if (lat == null || lng == null) {
    return { found: false, reason: 'no coordinates on record' };
  }

  // Tier A: direct OSM id, if the record already carries one.
  if (cemetery.osm_id) {
    try {
      const res = await runOverpass(overpassQueryForOsmId(cemetery.osm_id));
      const el = (res.elements || [])[0];
      if (el && el.tags && el.tags.opening_hours) {
        return {
          found: true,
          opening_hours: el.tags.opening_hours,
          matchedElement: { type: el.type, id: el.id, name: el.tags.name || null },
          method: `direct osm_id (${cemetery.osm_id})`,
        };
      }
      if (el) {
        return {
          found: false,
          reason: `resolved osm_id ${cemetery.osm_id} (${el.tags?.name || 'unnamed'}), no opening_hours tag present`,
        };
      }
    } catch (err) {
      return { found: false, reason: `overpass direct-id error: ${err.message}` };
    }
  }

  // Tier B: nearby search by tag, tightening/loosening radius.
  for (const radius of [300, 1500]) {
    try {
      const res = await runOverpass(overpassQueryAround(lat, lng, radius));
      const elements = res.elements || [];
      if (!elements.length) continue;

      const nameNorm = normalize(cemetery.name);
      const withHours = elements.filter((e) => e.tags && e.tags.opening_hours);
      if (!withHours.length) {
        // record how many candidate cemetery features Overpass found nearby,
        // even with no hours, useful diagnostic.
        if (radius === 1500) {
          return {
            found: false,
            reason: `${elements.length} nearby OSM cemetery feature(s) within ${radius}m, none carry opening_hours`,
          };
        }
        continue;
      }
      // Prefer a name match among the ones that do carry hours.
      const nameMatch = withHours.find((e) => normalize(e.tags.name).includes(nameNorm) || nameNorm.includes(normalize(e.tags.name)));
      const chosen = nameMatch || withHours[0];
      return {
        found: true,
        opening_hours: chosen.tags.opening_hours,
        matchedElement: { type: chosen.type, id: chosen.id, name: chosen.tags.name || null },
        method: nameMatch
          ? `nearby search, name-matched, ${radius}m radius`
          : `nearby search, first candidate (no name match), ${radius}m radius`,
      };
    } catch (err) {
      return { found: false, reason: `overpass nearby-search error: ${err.message}` };
    }
  }
  return { found: false, reason: 'no OSM cemetery feature found nearby with an opening_hours tag' };
}

// ---------- Google Places API (New) — real, small, billable ----------
function resolveGoogleKey() {
  if (process.env.PUBLIC_GOOGLE_MAPS_KEY) return process.env.PUBLIC_GOOGLE_MAPS_KEY;
  // fall back to parsing .env directly, in case this was run without
  // `node --env-file=.env`
  return null;
}

async function loadDotEnvKey() {
  try {
    const text = await readFile(path.join(ROOT, '.env'), 'utf8');
    const m = text.match(/^PUBLIC_GOOGLE_MAPS_KEY\s*=\s*(.+)\s*$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

const CACHE_DIR = path.join(ROOT, 'data', 'cache');
function cacheFile(bucket, key) {
  const hash = createHash('sha1').update(key).digest('hex');
  return path.join(CACHE_DIR, bucket, `${hash}.json`);
}

// Local cache wrapper (distinct from lib/api-Claude.mjs's cachedJson)
// because we need to know cache HIT vs MISS to report real billable call
// counts accurately — a cache hit on re-run costs nothing, a miss is a real
// network call against the Enterprise SKU.
async function cachedFetchWithHitInfo(bucket, key, doFetch) {
  const file = cacheFile(bucket, key);
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    return { json: cached, cacheHit: true };
  } catch {
    // not cached
  }
  const json = await doFetch();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(json), 'utf8');
  return { json, cacheHit: false };
}

async function googleTextSearchIdOnly(key, textQuery) {
  const url = 'https://places.googleapis.com/v1/places:searchText';
  const bodyObj = { textQuery };
  const body = JSON.stringify(bodyObj);
  const { json, cacheHit } = await cachedFetchWithHitInfo('google-places-search', url + body, async () => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-fieldmask': 'places.id',
        'user-agent': USER_AGENT,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Text Search HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  });
  return { json, cacheHit, billable: false }; // id-only field mask, free tier per current pricing
}

async function googlePlaceDetailsMinimal(key, placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const { json, cacheHit } = await cachedFetchWithHitInfo('google-places-details', url, async () => {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'x-goog-api-key': key,
        'x-goog-fieldmask': 'id,displayName,regularOpeningHours,currentOpeningHours,businessStatus',
        'user-agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Place Details HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  });
  // billable = true only when this was a REAL network call (cache miss),
  // since a cache hit on re-run does not hit Google again.
  return { json, cacheHit, billable: !cacheHit };
}

async function tryGooglePlaces(cemetery, key) {
  const locality = cemetery.city || cemetery.region || '';
  const textQuery = [cemetery.name, locality, cemetery.country].filter(Boolean).join(', ');
  let searchResult;
  try {
    searchResult = await googleTextSearchIdOnly(key, textQuery);
  } catch (err) {
    return { found: false, reason: `text search error: ${err.message}`, detailsBillableCall: false };
  }
  const places = searchResult.json.places || [];
  if (!places.length) {
    return { found: false, reason: `text search "${textQuery}" returned no place_id match`, detailsBillableCall: false };
  }
  const placeId = places[0].id;

  let detailsResult;
  try {
    detailsResult = await googlePlaceDetailsMinimal(key, placeId);
  } catch (err) {
    return { found: false, reason: `place details error: ${err.message}`, detailsBillableCall: false, place_id: placeId };
  }
  const d = detailsResult.json;
  const hours = d.regularOpeningHours || d.currentOpeningHours || null;
  return {
    found: !!hours,
    place_id: placeId,
    business_status: d.businessStatus || null,
    weekday_text: hours?.weekdayDescriptions || null,
    reason: hours ? null : 'Place Details resolved but carries no regularOpeningHours/currentOpeningHours (likely an open-access ground with no gated hours concept)',
    detailsBillableCall: detailsResult.billable, // true = real network call this run, false = served from cache
  };
}

// ---------- run ----------
let googleKey = resolveGoogleKey();
if (!googleKey) googleKey = await loadDotEnvKey();
const googleAvailable = !!googleKey;

console.log(
  googleAvailable
    ? '[setup] PUBLIC_GOOGLE_MAPS_KEY resolved (from process.env or .env) — Google Places tier will run for real'
    : '[setup] No PUBLIC_GOOGLE_MAPS_KEY found in process.env or .env — Google Places tier SKIPPED, not fabricated'
);

const results = [];
let googleDetailsBillableCalls = 0;

for (const cemetery of testSet) {
  process.stdout.write(`[test] ${cemetery.slug} ... `);
  const osm = await tryOverpass(cemetery);

  let google = null;
  if (!osm.found && googleAvailable) {
    google = await tryGooglePlaces(cemetery, googleKey);
    if (google.detailsBillableCall) googleDetailsBillableCalls++;
  }

  const row = { slug: cemetery.slug, name: cemetery.name, country: cemetery.country, osm, google };
  results.push(row);

  if (osm.found) {
    console.log(`OSM HIT — "${osm.opening_hours}" (${osm.method})`);
  } else if (google?.found) {
    console.log(`GOOGLE HIT — ${JSON.stringify(google.weekday_text)}`);
  } else if (google) {
    console.log(`neither — OSM: ${osm.reason} | Google: ${google.reason}`);
  } else {
    console.log(`OSM only, no hit — ${osm.reason}`);
  }
}

// ---------- report ----------
const osmHits = results.filter((r) => r.osm.found);
const googleHits = results.filter((r) => r.google?.found);
const neitherHits = results.filter((r) => !r.osm.found && !r.google?.found);

console.log('\n' + '='.repeat(70));
console.log('RESULTS — real run, not predicted');
console.log('='.repeat(70));
for (const r of results) {
  console.log(`\n${r.name} (${r.country}) — ${r.slug}`);
  console.log(`  OSM:    ${r.osm.found ? `HIT — "${r.osm.opening_hours}" via ${r.osm.method}` : `miss — ${r.osm.reason}`}`);
  if (r.google) {
    console.log(
      `  Google: ${r.google.found ? `HIT — ${JSON.stringify(r.google.weekday_text)}` : `miss — ${r.google.reason}`}` +
        (r.google.place_id ? ` (place_id ${r.google.place_id}${r.google.detailsBillableCall ? ', real billable call' : ', served from cache'})` : '')
    );
  } else if (!r.osm.found && !googleAvailable) {
    console.log('  Google: untested — no API key available');
  } else {
    console.log('  Google: not attempted (OSM already resolved it)');
  }
}

console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
console.log(`Test set size: ${results.length}`);
console.log(`OSM Overpass hits: ${osmHits.length}/${results.length}`);
console.log(`Google Places hits: ${googleHits.length}/${results.length} (only attempted where OSM missed: ${results.filter((r) => r.google).length} attempts)`);
console.log(`Neither source resolved: ${neitherHits.length}/${results.length}`);
console.log(`Google Places tier: ${googleAvailable ? 'RAN (real key present)' : 'SKIPPED (no key) — not fabricated'}`);
console.log(`Real Place Details calls made this run (cache misses, billable): ${googleDetailsBillableCalls}`);
console.log(
  `Estimated cost at documented $20.00/1000 Enterprise-SKU rate: $${(googleDetailsBillableCalls * 0.02).toFixed(2)}` +
    ' (computed from the real call count above against the stated public rate — this script has no access to the Google Cloud Billing console, so this is not a billing-confirmed charge, just call_count × rate)'
);
console.log('Note: Text Search calls (place_id resolution) are not counted above — id-only field mask is free per current Places API (New) pricing.');

if (neitherHits.length) {
  console.log('\nCemeteries with neither source: ' + neitherHits.map((r) => r.slug).join(', '));
}
