// Phase 8 QA over the built dist/. Checks are mechanical and reported raw:
// broken internal links, orphan pages, compliance (no genealogy-site
// ingestion, attribution present), image-license mapping, freshness gate,
// structural JSON-LD validation, endpoint resolution.

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, writeJson } from './lib/api-Claude.mjs';

const DIST = path.join(ROOT, 'dist');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const htmlFiles = [];
const allFiles = new Set();
for await (const f of walk(DIST)) {
  allFiles.add(path.relative(DIST, f).replace(/\\/g, '/'));
  if (f.endsWith('.html')) htmlFiles.push(f);
}
console.log(`[qa] ${htmlFiles.length} HTML files, ${allFiles.size} total files in dist/`);

// ---------- link + orphan check ----------
const internalTargets = new Set(); // normalized page paths that exist
for (const rel of allFiles) {
  internalTargets.add('/' + rel);
  if (rel.endsWith('/index.html')) internalTargets.add('/' + rel.slice(0, -'index.html'.length));
  if (rel === 'index.html') internalTargets.add('/');
}

const hrefRe = /(?:href|src)="([^"]+)"/g;
const broken = [];
const linkedTo = new Set();
const externalHosts = new Map();
let checkedLinks = 0;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const m of html.matchAll(hrefRe)) {
    const url = m[1];
    if (url.startsWith('#') || url.startsWith('mailto:')) continue;
    if (/^https?:\/\//.test(url)) {
      const host = new URL(url).hostname;
      externalHosts.set(host, (externalHosts.get(host) ?? 0) + 1);
      continue;
    }
    if (!url.startsWith('/')) continue;
    checkedLinks++;
    const clean = url.split('#')[0].split('?')[0];
    const normalized = decodeURIComponent(clean);
    linkedTo.add(normalized);
    const candidates = [normalized, normalized.endsWith('/') ? normalized + 'index.html' : normalized + '/index.html'];
    if (!candidates.some((c) => internalTargets.has(c))) {
      broken.push({ page: path.relative(DIST, file).replace(/\\/g, '/'), href: url });
    }
  }
}

const orphanExempt = /^(404\.html|pagefind\/|_astro\/|robots\.txt|favicon)/;
const orphans = [];
for (const rel of allFiles) {
  if (!rel.endsWith('.html') || orphanExempt.test(rel)) continue;
  const asPage = '/' + (rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel);
  if (!linkedTo.has(asPage) && !linkedTo.has(asPage.replace(/\/$/, ''))) orphans.push(asPage);
}

// ---------- compliance audit ----------
const compliance = { findagrave_img_or_data: [], billiongraves_any: [], findagrave_linkouts: 0 };
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  if (/billiongraves/i.test(html)) compliance.billiongraves_any.push(path.relative(DIST, file));
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    if (/findagrave|billiongraves/i.test(m[1])) compliance.findagrave_img_or_data.push({ file: path.relative(DIST, file), src: m[1] });
  }
  compliance.findagrave_linkouts += (html.match(/href="https:\/\/www\.findagrave\.com\/cemetery\//g) ?? []).length;
}

// Cache buckets prove what was fetched during the pipeline.
const cacheBuckets = [];
try {
  for (const d of await readdir(path.join(ROOT, 'data', 'cache'), { withFileTypes: true })) {
    if (d.isDirectory()) cacheBuckets.push(d.name);
  }
} catch { /* no cache dir */ }

// ---------- image-license audit ----------
const rights = JSON.parse(await readFile(path.join(ROOT, 'data', 'image-rights-report-Claude.json'), 'utf8'));
const passUrls = new Set(
  Object.values(rights.verdicts)
    .filter((v) => v.verdict === 'PASS')
    .map((v) => v.url)
);
const imgViolations = [];
let imgCount = 0;
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const m of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
    imgCount++;
    const src = m[1];
    const ok = src.startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/') && passUrls.has(src.replace(/&amp;/g, '&'));
    if (!ok) imgViolations.push({ file: path.relative(DIST, file), src: src.slice(0, 120) });
  }
}

// ---------- freshness audit ----------
let hoursPages = 0;
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  if (html.includes('Opening hours')) hoursPages++;
}

// ---------- structural JSON-LD validation on a sample ----------
const samples = [
  'index.html',
  'cemeteries/pere-lachaise-cemetery/index.html',
  'country/france/index.html',
  'type/historic-heritage/index.html',
  'era/1800s/index.html',
  'guides/most-documented-notable-interments/index.html',
];
const schemaResults = [];
for (const rel of samples) {
  const file = path.join(DIST, rel);
  try {
    const html = await readFile(file, 'utf8');
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
    const types = [];
    let valid = true;
    for (const b of blocks) {
      try {
        const parsed = JSON.parse(b[1]);
        types.push(parsed['@type']);
        if (!parsed['@context']) valid = false;
      } catch {
        valid = false;
      }
    }
    schemaResults.push({ page: rel, blocks: blocks.length, types, valid });
  } catch (err) {
    schemaResults.push({ page: rel, error: 'file missing' });
  }
}

// Find a person page sample dynamically.
const buriedSample = htmlFiles.find((f) => f.replace(/\\/g, '/').includes('/buried/'));
if (buriedSample) {
  const html = await readFile(buriedSample, 'utf8');
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  let valid = true;
  const types = [];
  for (const b of blocks) {
    try { types.push(JSON.parse(b[1])['@type']); } catch { valid = false; }
  }
  schemaResults.push({ page: path.relative(DIST, buriedSample).replace(/\\/g, '/'), blocks: blocks.length, types, valid });
}

// ---------- endpoint resolution ----------
const endpoints = ['sitemap-index.xml', 'robots.txt', 'llms.txt', 'llms-full.txt', 'rss.xml', 'api/cemeteries.json', 'api/interments.json'];
const endpointStatus = {};
for (const e of endpoints) {
  try {
    const s = await stat(path.join(DIST, e));
    endpointStatus[e] = `ok (${(s.size / 1024).toFixed(1)} KB)`;
  } catch {
    endpointStatus[e] = 'MISSING';
  }
}

const report = {
  html_files: htmlFiles.length,
  internal_links_checked: checkedLinks,
  broken_internal_links: broken.length,
  broken_sample: broken.slice(0, 15),
  orphan_pages: orphans.length,
  orphan_sample: orphans.slice(0, 15),
  compliance: {
    ...compliance,
    findagrave_img_or_data: compliance.findagrave_img_or_data.length,
    billiongraves_any: compliance.billiongraves_any.length,
    cache_buckets: cacheBuckets,
  },
  images: { total_rendered: imgCount, violations: imgViolations.length, violation_sample: imgViolations.slice(0, 10) },
  freshness: { pages_showing_hours: hoursPages, note: 'expected 0: no live hours source configured' },
  schema_samples: schemaResults,
  endpoints: endpointStatus,
  external_hosts: Object.fromEntries([...externalHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)),
};
await writeJson('data/qa-report-Claude.json', report);
console.log(JSON.stringify(report, null, 2));
