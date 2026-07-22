// Shared Commons license-verification gate. Used by both the single-hero
// image pipeline (image-rights-Claude.mjs) and the capped gallery pipeline
// (gallery-Claude.mjs) so the PASS/FAIL rule lives in exactly one place.
// PASS only PD, CC0, CC BY, CC BY-SA (share-alike flagged). Anything else
// fails: no genealogy-site photos, no generated or substitute imagery, ever.

import { cachedJson } from './api-Claude.mjs';

export function classify(meta) {
  const short = (meta.LicenseShortName?.value ?? '').trim();
  const s = short.toLowerCase();
  if (s.startsWith('cc0')) return { verdict: 'PASS', license: 'CC0', share_alike: false };
  if (/^(public domain|pd)/.test(s)) return { verdict: 'PASS', license: 'PD', share_alike: false };
  if (/^cc by-sa\b/.test(s)) return { verdict: 'PASS', license: 'CC BY-SA', share_alike: true };
  if (/^cc by\b/.test(s)) return { verdict: 'PASS', license: 'CC BY', share_alike: false };
  return { verdict: 'FAIL', license: short || 'unresolved', share_alike: false };
}

export const stripTags = (html) => (html ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

// Resolves imageinfo + extmetadata for a list of raw Commons file names
// (no "File:" prefix) and returns a Map keyed by that same raw file name.
// Batches at 50 titles/request (the MediaWiki API cap for most props) and
// goes through cachedJson, so re-running after a partial run is cheap.
//
// POST, not GET: batching purely by title *count* is not safe when titles
// contain long non-ASCII names (real-world Commons categories carry plenty
// of Cyrillic/CJK filenames) - the encoded query string can exceed typical
// server URL-length limits (HTTP 414), which a 50-title-per-GET-request
// batch actually hit against a real 11k-file candidate set. POST puts the
// title list in the body instead, same pattern as sparql() in api-Claude.mjs.
export async function resolveImageInfo(fileNames, { bucket = 'commons' } = {}) {
  const results = new Map();
  const BATCH = 50;
  const endpoint = 'https://commons.wikimedia.org/w/api.php';
  for (let i = 0; i < fileNames.length; i += BATCH) {
    const batch = fileNames.slice(i, i + BATCH);
    const titles = batch.map((f) => 'File:' + f).join('|');
    const body = new URLSearchParams({
      action: 'query',
      titles,
      prop: 'imageinfo',
      iiprop: 'extmetadata|url',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
      format: 'json',
      formatversion: '2',
    }).toString();
    const res = await cachedJson(bucket, endpoint, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      delayMs: 150,
    });
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
  }
  return results;
}

// Some Wikidata file names differ from resolved Commons titles by
// normalization (spaces vs underscores); look up by both forms.
export function verdictFor(results, name) {
  return (
    results.get(name) ??
    results.get(name.replace(/_/g, ' ')) ?? { verdict: 'FAIL', license: 'not resolved by API', share_alike: false }
  );
}
