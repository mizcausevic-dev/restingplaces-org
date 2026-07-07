// Generates the operator data-coverage dashboard as a single self-contained
// HTML file with all report data inlined (openable from disk, no fetches,
// no external deps). Public site stays clean; this is an operator tool.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/api-Claude.mjs';

const load = async (f) => JSON.parse(await readFile(path.join(ROOT, 'data', f), 'utf8'));
const coverage = await load('coverage-report-Claude.json');
const classification = await load('classification-report-Claude.json');
const rights = await load('image-rights-report-Claude.json');
const qa = await load('qa-report-Claude.json');
const graph = await load('interment-graph-Claude.json');
const seed = await load('seed-report-Claude.json');

const data = {
  generated: new Date().toISOString().slice(0, 10),
  seed: { sublists: seed.sublist_count, raw: seed.raw_link_rows, unique: seed.unique_qids, confirmed: seed.confirmed_cemeteries },
  coverage,
  classification,
  rights: { checked: rights.checked, pass: rights.pass, fail: rights.fail, by_license: rights.by_license },
  graph: { cemeteries: graph.cemeteries_with_interments, edges: graph.total_edges, persons: graph.unique_persons },
  qa: {
    html_files: qa.html_files,
    links_checked: qa.internal_links_checked,
    broken: qa.broken_internal_links,
    orphans: qa.orphan_pages,
    image_violations: qa.images.violations,
    hours_pages: qa.freshness.pages_showing_hours,
    endpoints: qa.endpoints,
  },
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Resting Places: operator coverage dashboard</title>
<style>
  :root, [data-theme="parchment"] {
    --bg:#faf7f1; --card:#f2ecdf; --ink:#27221a; --muted:#6d6355; --accent:#47604c; --rule:#e2d9c8; --warn:#8a4b3b;
  }
  [data-theme="nocturne"] { --bg:#191611; --card:#221e17; --ink:#e9e2d4; --muted:#a89c88; --accent:#93ac95; --rule:#37312a; --warn:#c98874; }
  [data-theme="moss"] { --bg:#eef1ea; --card:#e2e8dc; --ink:#1f2a1f; --muted:#5c6b5c; --accent:#3d5c40; --rule:#cdd8c9; --warn:#8a4b3b; }
  [data-theme="slate"] { --bg:#1c2026; --card:#252a32; --ink:#dde3ea; --muted:#93a0af; --accent:#7da3c0; --rule:#333b46; --warn:#d09a6a; }
  [data-theme="sepia"] { --bg:#f5ead8; --card:#ecdcc2; --ink:#3a2c1c; --muted:#7d6a52; --accent:#7a5c33; --rule:#dcc9a8; --warn:#984a3a; }
  [data-theme="oxblood"] { --bg:#201416; --card:#2a1b1e; --ink:#ecdcd8; --muted:#a98f8a; --accent:#c07a6d; --rule:#42292c; --warn:#e0a570; }
  [data-theme="contrast"] { --bg:#ffffff; --card:#f2f2f2; --ink:#000000; --muted:#333333; --accent:#00509e; --rule:#bbbbbb; --warn:#a30000; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 system-ui,sans-serif; padding:1.5rem 1rem 4rem; transition:background .2s; }
  main { max-width:72rem; margin:0 auto; }
  h1 { font-family:Georgia,serif; font-size:1.5rem; }
  h2 { font-family:Georgia,serif; font-size:1.1rem; margin:1.6rem 0 .5rem; }
  .themes { display:flex; gap:.4rem; flex-wrap:wrap; margin:.8rem 0; }
  .themes button { border:1px solid var(--rule); background:var(--card); color:var(--ink); border-radius:999px; padding:.2rem .8rem; cursor:pointer; font-size:.82rem; }
  .themes button.active { border-color:var(--accent); outline:2px solid var(--accent); }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(13rem,1fr)); gap:.7rem; }
  .kpi { background:var(--card); border:1px solid var(--rule); border-radius:6px; padding:.8rem 1rem; }
  .kpi .n { font-size:1.6rem; font-family:Georgia,serif; color:var(--accent); }
  .kpi .warn { color:var(--warn); }
  .kpi .l { color:var(--muted); font-size:.85rem; }
  .bar { display:grid; grid-template-columns:14rem 1fr 4.5rem; align-items:center; gap:.6rem; margin:.25rem 0; font-size:.88rem; }
  .bar .track { background:var(--card); border:1px solid var(--rule); border-radius:4px; height:.9rem; overflow:hidden; }
  .bar .fill { background:var(--accent); height:100%; }
  .bar .v { color:var(--muted); text-align:right; }
  table { border-collapse:collapse; font-size:.88rem; }
  td, th { padding:.3rem .8rem .3rem 0; text-align:left; border-bottom:1px solid var(--rule); }
  .ok { color:var(--accent); } .bad { color:var(--warn); }
  .note { color:var(--muted); font-size:.83rem; }
</style>
</head>
<body>
<main>
  <h1>Resting Places: operator coverage dashboard</h1>
  <div class="note">Generated __DATE__ from pipeline reports. Operator tool, not shipped with the public site.</div>
  <div class="themes" id="themes"></div>
  <div id="app"></div>
</main>
<script>
const DATA = __DATA__;
const THEMES = ['parchment','nocturne','moss','slate','sepia','oxblood','contrast'];
const saved = localStorage.getItem('rp-theme') || 'parchment';
document.documentElement.dataset.theme = saved;
const tdiv = document.getElementById('themes');
for (const t of THEMES) {
  const b = document.createElement('button');
  b.textContent = t; b.className = t === saved ? 'active' : '';
  b.onclick = () => { document.documentElement.dataset.theme = t; localStorage.setItem('rp-theme', t);
    tdiv.querySelectorAll('button').forEach(x => x.className = x.textContent === t ? 'active' : ''); };
  tdiv.appendChild(b);
}
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const bar = (label, val, total) =>
  '<div class="bar"><div>' + label + '</div><div class="track"><div class="fill" style="width:' + pct(val, total) + '%"></div></div><div class="v">' + val.toLocaleString() + ' (' + pct(val, total) + '%)</div></div>';
const kpi = (n, l, warn) => '<div class="kpi"><div class="n' + (warn ? ' warn' : '') + '">' + n.toLocaleString() + '</div><div class="l">' + l + '</div></div>';
const c = DATA.coverage, k = DATA.classification, q = DATA.qa, g = DATA.graph, r = DATA.rights, s = DATA.seed;
document.getElementById('app').innerHTML =
  '<h2>Pipeline</h2><div class="grid">'
  + kpi(s.sublists, 'sub-lists crawled') + kpi(s.raw, 'raw entity links') + kpi(s.confirmed, 'confirmed cemeteries')
  + kpi(g.edges, 'interment edges') + kpi(g.persons, 'notable persons') + kpi(k.buried_pages, '/buried/ pages') + '</div>'
  + '<h2>Field coverage (' + c.total_entities.toLocaleString() + ' entities)</h2>'
  + bar('coordinates', c.coordinates, c.total_entities)
  + bar('country', c.country, c.total_entities)
  + bar('admin region', c.admin_region, c.total_entities)
  + bar('established year', c.established_year, c.total_entities)
  + bar('heritage id', c.heritage_id, c.total_entities)
  + bar('cleared photo', DATA.classification.photos_cleared, c.total_entities)
  + bar('official website', c.official_website, c.total_entities)
  + bar('area', c.area, c.total_entities)
  + bar('notable interments', c.with_notable_interments, c.total_entities)
  + bar('findagrave link-out', c.findagrave_linkout, c.total_entities)
  + '<p class="note">Google Places: ' + c.google_places_note + '</p>'
  + '<h2>Image rights</h2><div class="grid">'
  + kpi(r.pass, 'PASS') + kpi(r.fail, 'FAIL (ship text-forward)', r.fail > 0) + '</div>'
  + Object.entries(r.by_license).map(([l, n]) => bar(l, n, r.checked)).join('')
  + '<h2>Type distribution</h2>'
  + Object.entries(k.type_distribution).map(([t, n]) => bar(t, n, k.total)).join('')
  + '<h2>Era distribution</h2>'
  + Object.entries(k.era_distribution).map(([t, n]) => bar(t, n, k.total)).join('')
  + '<h2>QA</h2><div class="grid">'
  + kpi(q.html_files, 'HTML pages') + kpi(q.links_checked, 'internal links checked')
  + kpi(q.broken, 'broken links', q.broken > 0) + kpi(q.orphans, 'orphan pages', q.orphans > 0)
  + kpi(q.image_violations, 'image violations', q.image_violations > 0) + kpi(q.hours_pages, 'pages showing hours', q.hours_pages > 0) + '</div>'
  + '<h2>Endpoints</h2><table>'
  + Object.entries(q.endpoints).map(([e, st]) => '<tr><td>' + e + '</td><td class="' + (st === 'MISSING' ? 'bad' : 'ok') + '">' + st + '</td></tr>').join('')
  + '</table>';
</script>
</body>
</html>`;

await mkdir(path.join(ROOT, 'docs'), { recursive: true });
await writeFile(
  path.join(ROOT, 'docs', 'coverage-dashboard-Claude.html'),
  html.replace('__DATA__', JSON.stringify(data)).replace('__DATE__', data.generated),
  'utf8'
);
console.log('[dashboard] docs/coverage-dashboard-Claude.html written');
