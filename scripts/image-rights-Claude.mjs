// Phase 2.5: image-rights gate (blocking).
// Every Commons image candidate has its license resolved via the Commons
// imageinfo + extmetadata API. PASS only PD, CC0, CC BY, CC BY-SA (share-alike
// flagged). Anything else fails and the page ships text-forward with
// photo: null. No Places photos in this run (no API key). No genealogy-site
// photos, ever. No generated or substitute imagery.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cachedJson, writeJson, ROOT } from './lib/api-Claude.mjs';

const records = JSON.parse(await readFile(path.join(ROOT, 'data', 'enriched-Claude.json'), 'utf8'));
const candidates = records.filter((r) => r.commons_image);
console.log(`[rights] ${candidates.length} Commons image candidates`);

function classify(meta) {
  const short = (meta.LicenseShortName?.value ?? '').trim();
  const s = short.toLowerCase();
  if (s.startsWith('cc0')) return { verdict: 'PASS', license: 'CC0', share_alike: false };
  if (/^(public domain|pd)/.test(s)) return { verdict: 'PASS', license: 'PD', share_alike: false };
  if (/^cc by-sa\b/.test(s)) return { verdict: 'PASS', license: 'CC BY-SA', share_alike: true };
  if (/^cc by\b/.test(s)) return { verdict: 'PASS', license: 'CC BY', share_alike: false };
  return { verdict: 'FAIL', license: short || 'unresolved', share_alike: false };
}

const stripTags = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const results = new Map();
const BATCH = 50;
for (let i = 0; i < candidates.length; i += BATCH) {
  const batch = candidates.slice(i, i + BATCH);
  const titles = batch.map((r) => 'File:' + r.commons_image).join('|');
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      titles,
      prop: 'imageinfo',
      iiprop: 'extmetadata|url',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
      format: 'json',
      formatversion: '2',
    });
  const res = await cachedJson('commons', url, { delayMs: 150 });
  for (const page of res.query?.pages ?? []) {
    const fileName = page.title.replace(/^File:/, '');
    const info = page.imageinfo?.[0];
    if (!info) {
      results.set(fileName, { verdict: 'FAIL', license: 'no imageinfo (missing file)', share_alike: false });
      continue;
    }
    const meta = info.extmetadata ?? {};
    const cls = classify(meta);
    results.set(fileName, {
      ...cls,
      license_url: meta.LicenseUrl?.value ?? null,
      credit: stripTags(meta.Artist?.value) || stripTags(meta.Credit?.value) || 'Wikimedia Commons contributor',
      source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(fileName.replace(/ /g, '_'))}`,
      // Thumb served from Commons at request time via Special:FilePath.
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName.replace(/ /g, '_'))}?width=960`,
    });
  }
  console.log(`[rights] ${Math.min(i + BATCH, candidates.length)}/${candidates.length} resolved`);
}

// Some Wikidata P18 names differ from resolved Commons titles by
// normalization; look up by both exact and underscore-normalized name.
const verdictFor = (name) =>
  results.get(name) ?? results.get(name.replace(/_/g, ' ')) ?? { verdict: 'FAIL', license: 'not resolved by API', share_alike: false };

const byLicense = {};
let pass = 0, fail = 0;
const perEntity = {};
for (const r of candidates) {
  const v = verdictFor(r.commons_image);
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
