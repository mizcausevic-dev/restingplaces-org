// Phase 2.6: capped multi-image gallery (non-blocking, additive to the
// existing single-hero photo from image-rights-Claude.mjs).
//
// Source: Wikidata P373 (Commons category) -> Commons categorymembers API
// for candidate files -> the SAME license-verification gate used for the
// hero photo (lib/license-gate-Claude.mjs: imageinfo + extmetadata, PASS
// only PD/CC0/CC BY/CC BY-SA). First 3 PASSing candidates per cemetery ship.
//
// Expectations are modest by design: a flat categorymembers query only sees
// files filed directly in the category, not subcategories, so flagship
// cemeteries whose real photos live in subcats (Père Lachaise, Arlington)
// often yield few or zero direct files. That's an honest gap, not a bug,
// same posture as the single-photo gate's photo: null.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cachedJson, writeJson, ROOT } from './lib/api-Claude.mjs';
import { resolveImageInfo, verdictFor } from './lib/license-gate-Claude.mjs';

const MAX_PER_CEMETERY = 3;
const CANDIDATES_PER_CATEGORY = 10; // cmlimit

const records = JSON.parse(await readFile(path.join(ROOT, 'data', 'enriched-Claude.json'), 'utf8'));
const withCategory = records.filter((r) => r.commons_category);
console.log(`[gallery] ${withCategory.length}/${records.length} cemeteries carry a Wikidata P373 Commons category`);

// ---------- fetch category members (real Commons API calls, one per category) ----------
async function categoryFiles(categoryName) {
  const title = 'Category:' + categoryName;
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: title,
      cmtype: 'file',
      cmlimit: String(CANDIDATES_PER_CATEGORY),
      format: 'json',
      formatversion: '2',
    });
  const res = await cachedJson('commons_categorymembers', url, { delayMs: 150 });
  return (res.query?.categorymembers ?? []).map((m) => m.title.replace(/^File:/, ''));
}

const candidatesByQid = new Map(); // qid -> [fileName, ...] (hero image excluded)
let categoriesQueried = 0;
let categoriesEmpty = 0;
for (const r of withCategory) {
  let files;
  try {
    files = await categoryFiles(r.commons_category);
  } catch (err) {
    console.log(`[gallery] ${r.qid} (${r.commons_category}) category query failed: ${err.message}`);
    files = [];
  }
  categoriesQueried++;
  // Exclude the hero photo (already shown separately) to avoid duplicating it.
  const filtered = r.commons_image ? files.filter((f) => f !== r.commons_image) : files;
  if (filtered.length === 0) categoriesEmpty++;
  if (filtered.length > 0) candidatesByQid.set(r.qid, filtered);
  if (categoriesQueried % 100 === 0) console.log(`[gallery] ${categoriesQueried}/${withCategory.length} categories queried`);
}
console.log(`[gallery] ${categoriesQueried} categories queried, ${categoriesEmpty} returned zero direct files`);

// ---------- resolve licenses for every distinct candidate file (batched) ----------
const allFiles = [...new Set([...candidatesByQid.values()].flat())];
console.log(`[gallery] ${allFiles.length} distinct candidate files to check against the license gate`);
const results = await resolveImageInfo(allFiles, { bucket: 'commons' });

// ---------- take first 3 PASSing candidates per cemetery, in category order ----------
const gallery = {};
let cemeteriesWithAnyPass = 0;
const perCountDist = { 0: 0, 1: 0, 2: 0, 3: 0 };
for (const r of withCategory) {
  const files = candidatesByQid.get(r.qid) ?? [];
  const passing = [];
  for (const f of files) {
    if (passing.length >= MAX_PER_CEMETERY) break;
    const v = verdictFor(results, f);
    if (v.verdict !== 'PASS') continue;
    passing.push({
      url: v.url,
      license: v.license,
      license_url: v.license_url ?? null,
      credit: v.credit,
      source: v.source,
      share_alike: v.share_alike,
    });
  }
  const n = passing.length;
  perCountDist[n] = (perCountDist[n] ?? 0) + 1;
  if (n > 0) {
    gallery[r.qid] = passing;
    cemeteriesWithAnyPass++;
  }
}

await writeJson('data/gallery-Claude.json', gallery);

const report = {
  cemeteries_total: records.length,
  cemeteries_with_commons_category: withCategory.length,
  categories_with_zero_direct_files: categoriesEmpty,
  distinct_candidate_files_checked: allFiles.length,
  cemeteries_with_at_least_one_passing_image: cemeteriesWithAnyPass,
  image_count_distribution: perCountDist, // how many cemeteries got 0/1/2/3 gallery images
  max_per_cemetery: MAX_PER_CEMETERY,
  candidates_per_category_requested: CANDIDATES_PER_CATEGORY,
  note: 'flat categorymembers query only sees files filed directly in the category, not subcategories; expect modest or zero yields for flagship cemeteries whose real photo pools live in subcats',
};
await writeJson('data/gallery-report-Claude.json', report);
console.log('\n[gallery]', JSON.stringify(report, null, 2));
