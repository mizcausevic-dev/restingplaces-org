// Phase 1: meta-list fan-out ingest.
// Seed: https://en.wikipedia.org/wiki/Lists_of_cemeteries
// The seed is an index of lists and list pages link deeper list pages
// (country -> state -> city), so ingestion is a BFS crawl over list pages
// to closure, depth-capped. Entities are confirmed as cemeteries against
// Wikidata (P31/P279* cemetery), never guessed from link titles.
// No Find a Grave, no BillionGraves.

import { mwQuery, sparql, writeJson, ROOT } from './lib/api-Claude.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const SEED = 'Lists of cemeteries';
const SUBLIST_RE = /^Lists? of .*\b(cemeter|graveyard|churchyard|burial|necropol|catacomb|columbari|mausole|war grave)/i;
const MAX_DEPTH = 3;
const CEMETERY_ROOT = 'Q39614'; // cemetery

// All mainspace links on a list page, with Wikidata QIDs where present.
async function pageLinks(title) {
  const rows = [];
  let cont = {};
  let noQid = 0;
  do {
    const res = await mwQuery({
      action: 'query',
      generator: 'links',
      titles: title,
      gplnamespace: '0',
      gpllimit: 'max',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      redirects: '1',
      ...cont,
    });
    for (const page of res.query?.pages || []) {
      if (page.missing) continue;
      const qid = page.pageprops?.wikibase_item;
      if (qid) rows.push({ title: page.title, qid });
      else noQid++;
    }
    cont = res.continue || null;
  } while (cont);
  return { rows, noQid };
}

// Country vs region hint from the sub-list title.
function placeHint(sublist) {
  const m = sublist.match(/\b(?:in|of) (?:the )?([A-Z][^,]*?)(?: \(.*\))?$/);
  return m ? m[1].trim() : null;
}

async function confirmCemeteries(qids) {
  const confirmed = new Set();
  const BATCH = 250;
  for (let i = 0; i < qids.length; i += BATCH) {
    const batch = qids.slice(i, i + BATCH);
    const values = batch.map((q) => `wd:${q}`).join(' ');
    const query = `SELECT ?item WHERE { VALUES ?item { ${values} } ?item wdt:P31/wdt:P279* wd:${CEMETERY_ROOT} . }`;
    const res = await sparql(query);
    for (const b of res.results.bindings) {
      confirmed.add(b.item.value.replace('http://www.wikidata.org/entity/', ''));
    }
    console.log(`[p31] ${Math.min(i + BATCH, qids.length)}/${qids.length} checked, ${confirmed.size} confirmed`);
  }
  return confirmed;
}

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// BFS over list pages to closure.
const seenLists = new Set();
const queue = [{ title: SEED, depth: 0 }];
const bySublist = {};
const listInventory = [];
let rawCount = 0;
let noQidTotal = 0;

while (queue.length) {
  const { title, depth } = queue.shift();
  if (seenLists.has(title)) continue;
  seenLists.add(title);
  let links;
  try {
    links = await pageLinks(title);
  } catch (err) {
    console.log(`[skip] ${title}: ${err.message}`);
    continue;
  }
  const entityRows = [];
  let childLists = 0;
  for (const row of links.rows) {
    if (SUBLIST_RE.test(row.title)) {
      childLists++;
      if (depth < MAX_DEPTH) queue.push({ title: row.title, depth: depth + 1 });
    } else {
      entityRows.push(row);
    }
  }
  noQidTotal += links.noQid;
  if (title !== SEED) {
    bySublist[title] = entityRows;
    listInventory.push({ title, depth, entity_links: entityRows.length, child_lists: childLists });
    rawCount += entityRows.length;
  }
  console.log(`[list d${depth}] ${title}: ${entityRows.length} entity links, ${childLists} child lists`);
}

console.log(`\n[inventory] ${listInventory.length} sub-lists crawled to closure (depth cap ${MAX_DEPTH})`);

// Dedupe across sub-lists by QID, merging provenance.
const byQid = new Map();
for (const [sub, rows] of Object.entries(bySublist)) {
  const hint = placeHint(sub);
  for (const { title, qid } of rows) {
    if (!byQid.has(qid)) {
      byQid.set(qid, { qid, name: title, sublists: new Set(), hints: new Set() });
    }
    const e = byQid.get(qid);
    e.sublists.add(sub);
    if (hint) e.hints.add(hint);
  }
}

const uniqueQids = [...byQid.keys()];
console.log(`[dedupe] raw ${rawCount} -> unique ${uniqueQids.length} (plus ${noQidTotal} links without a Wikidata item, dropped)`);

const confirmed = await confirmCemeteries(uniqueQids);
const entities = [];
const rejected = [];
for (const e of byQid.values()) {
  (confirmed.has(e.qid) ? entities : rejected).push(e);
}
console.log(`[p31] confirmed cemeteries: ${entities.length}, rejected non-cemetery links: ${rejected.length}`);

const header = 'qid,name,place_hint,wikipedia_url,sublists\n';
const lines = entities.map((e) =>
  [
    e.qid,
    csvField(e.name),
    csvField([...e.hints].join('|')),
    `https://en.wikipedia.org/wiki/${encodeURIComponent(e.name.replace(/ /g, '_'))}`,
    csvField([...e.sublists].join('|')),
  ].join(',')
);
await writeFile(path.join(ROOT, 'data', 'seed-Claude.csv'), header + lines.join('\n') + '\n', 'utf8');

await writeJson('data/seed-report-Claude.json', {
  generated_from: 'https://en.wikipedia.org/wiki/Lists_of_cemeteries',
  method: 'MediaWiki Action API BFS over list pages (generator=links + pageprops), Wikidata SPARQL P31/P279* Q39614 confirmation',
  sublist_count: listInventory.length,
  sublists: listInventory,
  raw_link_rows: rawCount,
  links_without_wikidata_item: noQidTotal,
  unique_qids: uniqueQids.length,
  confirmed_cemeteries: entities.length,
  rejected_non_cemeteries: rejected.length,
  rejected_sample: rejected.slice(0, 25).map((r) => ({ qid: r.qid, name: r.name })),
});

console.log(`\n[done] data/seed-Claude.csv written with ${entities.length} entities`);
