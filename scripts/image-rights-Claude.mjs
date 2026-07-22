// Phase 2.5: image-rights gate (blocking).
// Every Commons image candidate has its license resolved via the Commons
// imageinfo + extmetadata API. PASS only PD, CC0, CC BY, CC BY-SA (share-alike
// flagged). Anything else fails and the page ships text-forward with
// photo: null. No Places photos in this run (no API key). No genealogy-site
// photos, ever. No generated or substitute imagery.
//
// Classification + imageinfo resolution live in lib/license-gate-Claude.mjs,
// shared with gallery-Claude.mjs (the capped multi-image gallery) so the
// PASS/FAIL rule is defined exactly once.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJson, ROOT } from './lib/api-Claude.mjs';
import { resolveImageInfo, verdictFor } from './lib/license-gate-Claude.mjs';

const records = JSON.parse(await readFile(path.join(ROOT, 'data', 'enriched-Claude.json'), 'utf8'));
const candidates = records.filter((r) => r.commons_image);
console.log(`[rights] ${candidates.length} Commons image candidates`);

const results = await resolveImageInfo(candidates.map((r) => r.commons_image));
console.log(`[rights] ${results.size} resolved`);

const byLicense = {};
let pass = 0, fail = 0;
const perEntity = {};
for (const r of candidates) {
  const v = verdictFor(results, r.commons_image);
  perEntity[r.qid] = { file: r.commons_image, ...v };
  byLicense[v.license] = (byLicense[v.license] ?? 0) + 1;
  v.verdict === 'PASS' ? pass++ : fail++;
}

await writeJson('data/image-rights-report-Claude.json', {
  checked: candidates.length,
  pass,
  fail,
  no_image_entities: records.length - candidates.length,
  by_license: byLicense,
  places_photos: 'none: no GOOGLE_PLACES_KEY configured; Places is a separate terms-bound path, unused in this build',
  genealogy_site_photos: 'never (prohibited by policy)',
  verdicts: perEntity,
});

console.log(`\n[rights] PASS ${pass} / FAIL ${fail} of ${candidates.length}`);
console.log('[rights] by license:', JSON.stringify(byLicense, null, 2));
