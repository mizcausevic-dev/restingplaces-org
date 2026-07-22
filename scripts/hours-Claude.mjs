// PRODUCTION pass: real opening-hours resolution across ALL cataloged
// cemeteries in data/cemeteries-Claude.json. Generalizes
// hours-test-Claude.mjs (which stays in place, untouched, as the original
// 15-cemetery validation run — see that file for the tier design writeup)
// into a real pipeline stage that writes a mergeable output file.
//
// Tiers, same as the test, hardened:
//   1. OSM Overpass (free) — opening_hours tag via direct osm_id or nearby
//      search. HARDENED vs. the test script: a query that errors out
//      (the test hit a real HTTP 504) now retries with backoff via the
//      shared cachedJson() retry loop, AND on error falls through to the
//      OTHER tier/radius instead of aborting straight to Google on the
//      first failure. The test's early-`return`-on-catch bug is fixed here.
//   2. Google Places API (New): Text Search (id-only field mask, free) then
//      ONE Place Details call (field mask: id,displayName,regularOpeningHours,
//      currentOpeningHours,businessStatus — same minimal Enterprise-tier
//      mask as the test, not broadened). Real money: $20.00/1000 calls.
//      Only tried when Overpass missed. At most one Details call is ever
//      attempted per cemetery per script invocation, and the on-disk cache
//      (data/cache/google-places-details/, same bucket + same cache-key
//      derivation as the test script) makes a re-run after an interruption
//      resume for free instead of re-billing already-fetched places.
//
// Output:
//   - data/hours-Claude.json          slug -> hours record, consumed by
//                                      build-data-Claude.mjs
//   - data/hours-report-Claude.json   summary counts + real cost + timing
//   - data/hours-log-Claude.txt       full per-record audit trail, appended
//                                      to (not truncated) so a resumed run
//                                      keeps prior history
//
// Run: node --env-file=.env scripts/hours-Claude.mjs
// Safe to interrupt (Ctrl-C) and re-run: already-billed Google Details
// calls are served from cache, never re-billed. A hard cost ceiling below
// aborts the run outright if the real running cost ever implies duplicate
// billing.

import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { cachedJson, writeJson, ROOT } from './lib/api-Claude.mjs';

const RUN_STARTED_AT = new Date();
const TODAY_ISO = RUN_STARTED_AT.toISOString().slice(0, 10); // real date this run happened, stamped once, reused for every record resolved this run
const START_MS = Date.now();

// ---------- logging ----------
const LOG_FILE = path.join(ROOT, 'data', 'hours-log-Claude.txt');
async function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  await appendFile(LOG_FILE, stamped + '\n', 'utf8').catch(() => {});
}
await appendFile(
  LOG_FILE,
  `\n${'='.repeat(70)}\n[${RUN_STARTED_AT.toISOString()}] hours-Claude.mjs run started\n${'='.repeat(70)}\n`,
  'utf8'
).catch(async () => {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, `[${RUN_STARTED_AT.toISOString()}] hours-Claude.mjs run started\n`, 'utf8');
});

// ---------- load records ----------
const allRecords = JSON.parse(
  await readFile(path.join(ROOT, 'data', 'cemeteries-Claude.json'), 'utf8')
);
// Optional bounded smoke-test slice (HOURS_LIMIT=N), or an explicit slug
// allowlist (HOURS_SLUGS=slug-a,slug-b,...) to target specific records —
// e.g. replaying hours-test-Claude.mjs's original 15-cemetery set to pull
// its already-cached, already-billed real results into the real pipeline
// without any new network calls or cost. Both unset in the real production
// invocation, where allCemeteries === allRecords (every record).
const LIMIT = process.env.HOURS_LIMIT ? Number(process.env.HOURS_LIMIT) : null;
const SLUGS = process.env.HOURS_SLUGS ? process.env.HOURS_SLUGS.split(',').map((s) => s.trim()).filter(Boolean) : null;
let allCemeteries = allRecords;
if (SLUGS) {
  const slugSet = new Set(SLUGS);
  allCemeteries = allRecords.filter((c) => slugSet.has(c.slug));
} else if (LIMIT) {
  allCemeteries = allRecords.slice(0, LIMIT);
}
await log(
  `[setup] ${allRecords.length} cemeteries total in data/cemeteries-Claude.json` +
    (SLUGS
      ? `; HOURS_SLUGS set, processing exactly ${allCemeteries.length} of ${SLUGS.length} requested slugs this run`
      : LIMIT
        ? `; HOURS_LIMIT=${LIMIT} set, processing only the first ${allCemeteries.length} this run`
        : `; processing all ${allCemeteries.length}`)
);

// ---------- OSM Overpass (free, no key) ----------
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function overpassQueryForOsmId(osmId) {
  const [type, id] = osmId.split('/');
  return `[out:json][timeout:25];\n${type}(${id});\nout tags;`;
}

function overpassQueryAround(lat, lng, radiusM) {
  return `[out:json][timeout:25];\n(\n  way["leisure"="cemetery"](around:${radiusM},${lat},${lng});\n  relation["leisure"="cemetery"](around:${radiusM},${lat},${lng});\n  way["amenity"="grave_yard"](around:${radiusM},${lat},${lng});\n  node["amenity"="grave_yard"](around:${radiusM},${lat},${lng});\n  way["landuse"="cemetery"](around:${radiusM},${lat},${lng});\n  relation["landuse"="cemetery"](around:${radiusM},${lat},${lng});\n);\nout tags center;`;
}

// Hardened vs. the test: retries:3 + delayMs:1200 gives real backoff before
// giving up on any single query (etiquette pause before every attempt, plus
// cachedJson's own escalating sleep between retries). This is what actually
// would have absorbed the real HTTP 504 the test batch hit.
async function runOverpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  return cachedJson('overpass', OVERPASS_URL + '#' + createHash('sha1').update(body).digest('hex'), {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    delayMs: 1200,
    retries: 3,
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

  let directIdReason = null;
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
        // Definitive: this exact matched feature has no hours tag. Don't
        // fall through to a nearby-search guess under the same name — that
        // would risk attaching a different real feature's hours to this
        // record, a provenance error, not a resolution.
        return {
          found: false,
          reason: `resolved osm_id ${cemetery.osm_id} (${el.tags?.name || 'unnamed'}), no opening_hours tag present`,
        };
      }
      directIdReason = `osm_id ${cemetery.osm_id} did not resolve to an element`;
    } catch (err) {
      // HARDENED: the test script returned immediately here on any error
      // (that's the bug — a transient/504 error on the direct-id query
      // aborted the whole Overpass attempt for that record). Now: fall
      // through to the nearby-search tier instead of giving up.
      directIdReason = `overpass direct-id error after retries: ${err.message}`;
    }
  }

  for (const radius of [300, 1500]) {
    try {
      const res = await runOverpass(overpassQueryAround(lat, lng, radius));
      const elements = res.elements || [];
      if (!elements.length) continue;

      const nameNorm = normalize(cemetery.name);
      const withHours = elements.filter((e) => e.tags && e.tags.opening_hours);
      if (!withHours.length) {
        if (radius === 1500) {
          return {
            found: false,
            reason: [directIdReason, `${elements.length} nearby OSM cemetery feature(s) within ${radius}m, none carry opening_hours`]
              .filter(Boolean)
              .join('; '),
          };
        }
        continue;
      }
      const nameMatch = withHours.find(
        (e) => normalize(e.tags.name).includes(nameNorm) || nameNorm.includes(normalize(e.tags.name))
      );
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
      // HARDENED: try the other radius instead of aborting the whole tier
      // on the first error.
      if (radius === 1500) {
        return {
          found: false,
          reason: [directIdReason, `overpass nearby-search error after retries at both radii: ${err.message}`]
            .filter(Boolean)
            .join('; '),
        };
      }
      continue;
    }
  }
  return {
    found: false,
    reason: [directIdReason, 'no OSM cemetery feature found nearby with an opening_hours tag'].filter(Boolean).join('; '),
  };
}

// ---------- Google Places API (New) — real, billable ----------
// Identical call shape + identical cache bucket names/keys to
// hours-test-Claude.mjs on purpose: the 14 already-billed test records hit
// their existing cache files here and cost nothing again.
function resolveGoogleKey() {
  if (process.env.PUBLIC_GOOGLE_MAPS_KEY) return process.env.PUBLIC_GOOGLE_MAPS_KEY;
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

// Same hang-robustness reasoning as lib/api-Claude.mjs's cachedJson: plain
// fetch() has no default timeout. Google's API is far more reliable than
// the shared public Overpass instance, but this is a multi-hour real-money
// run — a single stalled connection should time out and fail cleanly, not
// hang the whole process.
async function fetchWithTimeout(url, opts, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': key,
        'x-goog-fieldmask': 'places.id',
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

// Deliberately NO retry loop here (unlike Overpass) — a single real fetch
// attempt. This is the load-bearing choice that keeps the cost ceiling a
// hard guarantee: one attempt per cemetery per run, full stop. If it fails,
// it fails for this record this run; a later re-run will try again (and
// only bills again if the earlier attempt truly never reached cache, i.e.
// truly never billed).
async function googlePlaceDetailsMinimal(key, placeId) {
  const url = `https://places.googleapis.com/v1/places/${placeId}`;
  const { json, cacheHit } = await cachedFetchWithHitInfo('google-places-details', url, async () => {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        'x-goog-api-key': key,
        'x-goog-fieldmask': 'id,displayName,regularOpeningHours,currentOpeningHours,businessStatus',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Place Details HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  });
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
    detailsBillableCall: detailsResult.billable,
  };
}

// ---------- run ----------
let googleKey = resolveGoogleKey();
if (!googleKey) googleKey = await loadDotEnvKey();
let googleAvailable = !!googleKey;
await log(
  googleAvailable
    ? '[setup] PUBLIC_GOOGLE_MAPS_KEY resolved — Google Places tier will run for real'
    : '[setup] No PUBLIC_GOOGLE_MAPS_KEY found — Google Places tier SKIPPED entirely for the whole run, not fabricated'
);

// Circuit breaker: a per-cemetery *data* miss (no place, no hours) is
// expected and fine. A *permission* failure (403 — e.g. the key gained an
// HTTP-referrer restriction after this script was validated, which blocks
// all server-side calls since Node sends no Referer header) is not a
// per-record problem, it is a whole-run problem, and every remaining
// attempt would fail identically. Hammering that for 2,000+ more records
// wastes real time for zero yield and misrepresents "tried Google, no
// match" in the log for records where Google was never really reachable.
// Three consecutive 403s (not just one, to tolerate a single flaky
// response) disables the Google tier for the rest of THIS run only —
// data/hours-Claude.json still records exactly what happened, and a future
// run with a working key resumes cleanly for every cemetery this run
// couldn't reach.
let consecutive403 = 0;
const GOOGLE_403_CIRCUIT_BREAKER = 3;
function isPermissionDenied(reason) {
  return typeof reason === 'string' && /HTTP 403/.test(reason);
}

const withCoords = allCemeteries.filter((c) => c.coordinates).length;
const maxPossibleBillable = withCoords; // structural ceiling: at most 1 Details call per coordinate-bearing cemetery
const maxPossibleCost = maxPossibleBillable * 0.02;
await log(
  `[setup] ${withCoords} of ${allCemeteries.length} cemeteries carry coordinates and are eligible for lookup. ` +
    `Theoretical max spend if EVERY one required a billed Details call: $${maxPossibleCost.toFixed(2)} (approved ceiling: $50.00)`
);

const HARD_STOP_COST = 49.0; // just above the real structural ceiling (~$48.60-$48.86); breaching this can only mean a duplicate-billing bug
const billedSlugs = new Set();

let osmHits = 0;
let googleHits = 0;
let neither = 0;
let noCoords = 0;
let billableCalls = 0;
// Load any existing real results (from a prior run — full, HOURS_LIMIT-
// bounded, or HOURS_SLUGS-targeted) and accumulate into them rather than
// starting from {} and overwriting. Without this, a second invocation
// (e.g. a targeted HOURS_SLUGS replay after an earlier partial full run)
// would silently discard the first run's real, already-resolved records —
// a real bug hit and fixed this session, not theoretical.
let results = {};
try {
  results = JSON.parse(await readFile(path.join(ROOT, 'data', 'hours-Claude.json'), 'utf8'));
  await log(`[setup] loaded ${Object.keys(results).length} existing real hours record(s) from a prior run — this run adds to them, does not replace them`);
} catch {
  // no prior output file; starting fresh is correct
}

async function writeOutputs(final) {
  await writeJson('data/hours-Claude.json', results);
  const elapsedMin = (Date.now() - START_MS) / 60000;
  const report = {
    run_started_at: RUN_STARTED_AT.toISOString(),
    run_status: final ? 'complete' : 'in-progress checkpoint',
    total_cemeteries: allCemeteries.length,
    cemeteries_with_coordinates: withCoords,
    processed_this_run: osmHits + googleHits + neither + noCoords,
    no_coordinates_skipped: noCoords,
    osm_hits: osmHits,
    google_hits: googleHits,
    resolved_total: osmHits + googleHits,
    neither_source_resolved: neither,
    google_key_present: !!googleKey,
    google_tier_available_now: googleAvailable,
    google_circuit_breaker_tripped: !!googleKey && !googleAvailable,
    billable_place_details_calls_this_run: billableCalls,
    real_cost_this_run_usd: Number((billableCalls * 0.02).toFixed(2)),
    elapsed_minutes_this_run: Number(elapsedMin.toFixed(1)),
  };
  await writeJson('data/hours-report-Claude.json', report);
  return report;
}

for (let i = 0; i < allCemeteries.length; i++) {
  const cemetery = allCemeteries[i];
  const idx = i + 1;

  if (!cemetery.coordinates) {
    noCoords++;
    continue; // no per-record log line for the routine no-coordinates skip; keeps the log readable. Counted in the periodic progress line below.
  }

  const osm = await tryOverpass(cemetery);

  if (osm.found) {
    osmHits++;
    results[cemetery.slug] = {
      source: 'osm-overpass',
      // OSM opening_hours is a compact DSL (e.g. "Mo-Fr 08:00-17:00"), not a
      // day-by-day list like Google's weekdayDescriptions. No OSM
      // opening_hours parser is in this repo's dependency set, and writing
      // one to split this into 7 lines risks a real mis-parse presented as
      // fact — the same fabrication class this site's schema exists to
      // prevent. The raw, real, verbatim OSM string is kept as a single
      // array element instead: honest, exactly what the source said.
      weekday_text: [osm.opening_hours],
      last_checked: TODAY_ISO,
      google_place_id: null,
    };
    await log(`[${idx}/${allCemeteries.length}] ${cemetery.slug} — OSM HIT: "${osm.opening_hours}" (${osm.method})`);
  } else if (googleAvailable) {
    const google = await tryGooglePlaces(cemetery, googleKey);

    if (google.detailsBillableCall) {
      if (billedSlugs.has(cemetery.slug)) {
        await log(`[FATAL] duplicate billed Details call attempted for ${cemetery.slug} — halting to prevent double billing`);
        await writeOutputs(false);
        process.exit(1);
      }
      billedSlugs.add(cemetery.slug);
      billableCalls++;
    }

    const runningCost = billableCalls * 0.02;
    if (runningCost > HARD_STOP_COST) {
      await log(
        `[SAFETY STOP] running cost $${runningCost.toFixed(2)} exceeds hard ceiling $${HARD_STOP_COST.toFixed(2)} ` +
          `after ${idx} cemeteries processed (${billableCalls} billed Details calls, structural max was ${maxPossibleBillable}). ` +
          `Halting immediately. This should be structurally impossible under the one-attempt-per-cemetery design and indicates a real bug.`
      );
      await writeOutputs(false);
      process.exit(1);
    }

    if (google.found) {
      consecutive403 = 0;
      googleHits++;
      results[cemetery.slug] = {
        source: 'google-places',
        weekday_text: google.weekday_text,
        last_checked: TODAY_ISO,
        google_place_id: google.place_id ?? null,
      };
      await log(
        `[${idx}/${allCemeteries.length}] ${cemetery.slug} — GOOGLE HIT: ${JSON.stringify(google.weekday_text)} ` +
          `(place_id ${google.place_id}${google.detailsBillableCall ? ', real billed call' : ', served from cache'})`
      );
    } else {
      neither++;
      if (isPermissionDenied(google.reason)) {
        consecutive403++;
      } else {
        consecutive403 = 0;
      }
      await log(`[${idx}/${allCemeteries.length}] ${cemetery.slug} — neither source: OSM: ${osm.reason} | Google: ${google.reason}`);

      if (consecutive403 >= GOOGLE_403_CIRCUIT_BREAKER) {
        googleAvailable = false;
        await log(
          `\n[CIRCUIT BREAKER] ${consecutive403} consecutive HTTP 403 (permission-denied) responses from the Google Places API — ` +
            `this is a whole-run access problem (e.g. the key gained an HTTP-referrer restriction after validation; server-side ` +
            `requests carry no Referer header, so a referrer-restricted key fails 100% of the time here), not a per-record data ` +
            `miss. Disabling the Google Places tier for the REST of this run to avoid burning time on guaranteed failures. ` +
            `OSM Overpass continues for every remaining record. Real billed Details calls so far this run: ${billableCalls} ` +
            `($${(billableCalls * 0.02).toFixed(2)}). No further Google attempts will be made this run.\n`
        );
      }
    }
  } else {
    neither++;
    await log(`[${idx}/${allCemeteries.length}] ${cemetery.slug} — OSM miss (${osm.reason}), Google tier ${googleKey ? 'disabled (circuit breaker tripped this run)' : 'skipped (no key)'}`);
  }

  if (idx % 100 === 0 || idx === allCemeteries.length) {
    const elapsedMin = ((Date.now() - START_MS) / 60000).toFixed(1);
    const cost = (billableCalls * 0.02).toFixed(2);
    await log(
      `\n===== PROGRESS ${idx}/${allCemeteries.length} — elapsed ${elapsedMin} min — ` +
        `OSM hits ${osmHits} — Google hits ${googleHits} — neither ${neither} — no-coords so far ${noCoords} — ` +
        `billed Details calls ${billableCalls} — real running cost $${cost} =====\n`
    );
    await writeOutputs(false);
  }
}

const finalReport = await writeOutputs(true);
await log(`\n${'='.repeat(70)}\nFINAL — real run, not predicted\n${'='.repeat(70)}`);
await log(JSON.stringify(finalReport, null, 2));
console.log('\n' + JSON.stringify(finalReport, null, 2));
