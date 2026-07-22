// Country metadata for flags + continent browsing.
// Sourced live from Wikidata (P297 ISO 3166-1 alpha-2, P30 continent) for the
// exact 80 country labels present in the dataset. No hand-typed ISO codes or
// continent assignments: a country with no P297/P30 on Wikidata ships null,
// never guessed.
//
// Two passes, deliberately kept separate:
//  1. Resolve which Wikidata item each label actually means. A bare English
//     rdfs:label match is ambiguous ("Albania" matches 23 distinct items).
//     Tiebreak: prefer the candidate that carries a real ISO2 code (near-
//     definitive proof it's the country itself, not a village/disambiguation
//     entity sharing the label).
//  2. Fetch every P30 (continent) value for the WINNING item only. Some
//     countries are transcontinental (Russian Empire held Europe, Asia, and
//     briefly North American territory) — collecting one arbitrary P30 first
//     picked "North America" for the Russian Empire, which is wrong. Storing
//     all continents avoids ever having to guess a "primary" one.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sparql, writeJson, ROOT } from './lib/api-Claude.mjs';

const all = JSON.parse(await readFile(path.join(ROOT, 'data', 'cemeteries-Claude.json'), 'utf8'));
const countries = [...new Set(all.map((c) => c.country).filter(Boolean))].sort();
console.log(`[geo] ${countries.length} distinct countries in dataset`);

// ---------- pass 1: resolve label -> item ----------
const values = countries.map((c) => `"${c.replace(/"/g, '\\"')}"@en`).join(' ');
const resolveQuery = `
SELECT ?label ?item ?iso2
WHERE {
  VALUES ?label { ${values} }
  ?item rdfs:label ?label .
  OPTIONAL { ?item wdt:P297 ?iso2 }
}
ORDER BY ?label DESC(BOUND(?iso2))`;

const resolveRes = await sparql(resolveQuery, 'geo-wdqs-resolve');
const winnerByLabel = new Map();
const candidateCounts = new Map();
for (const b of resolveRes.results.bindings) {
  const label = b.label.value;
  candidateCounts.set(label, (candidateCounts.get(label) ?? 0) + 1);
  if (winnerByLabel.has(label)) continue;
  winnerByLabel.set(label, { item: b.item.value.replace('http://www.wikidata.org/entity/', ''), iso2: b.iso2?.value ?? null });
}

// ---------- pass 2: all continents for the winning items ----------
const winningQids = [...new Set([...winnerByLabel.values()].map((w) => w.item))];
const contValues = winningQids.map((q) => `wd:${q}`).join(' ');
const continentQuery = `
SELECT ?item ?continent ?continentLabel
WHERE {
  VALUES ?item { ${contValues} }
  ?item wdt:P30 ?continent .
  ?continent rdfs:label ?continentLabel FILTER(LANG(?continentLabel) = "en")
}`;
const continentRes = await sparql(continentQuery, 'geo-wdqs-continents');
const continentsByQid = new Map();
for (const b of continentRes.results.bindings) {
  const qid = b.item.value.replace('http://www.wikidata.org/entity/', '');
  if (!continentsByQid.has(qid)) continentsByQid.set(qid, []);
  continentsByQid.get(qid).push({
    label: b.continentLabel.value,
    qid: b.continent.value.replace('http://www.wikidata.org/entity/', ''),
  });
}

// ---------- assemble ----------
const metadata = {};
let withIso2 = 0, withContinent = 0;
for (const name of countries) {
  const w = winnerByLabel.get(name);
  const continents = w ? (continentsByQid.get(w.item) ?? []) : [];
  metadata[name] = {
    wikidata_item: w?.item ?? null,
    iso2: w?.iso2 ?? null,
    continents, // array: [{label, qid}], never a single guessed "primary"
    candidate_count: candidateCounts.get(name) ?? 0,
  };
  if (metadata[name].iso2) withIso2++;
  if (continents.length) withContinent++;
}

await writeJson('data/country-metadata-Claude.json', metadata);

console.log(`[geo] iso2 resolved: ${withIso2}/${countries.length}`);
console.log(`[geo] continent resolved: ${withContinent}/${countries.length}`);
console.log(`\n[geo] transcontinental (>1 continent) — verify these look right:`);
for (const c of countries) if (metadata[c].continents.length > 1) console.log(`  ${c} -> ${metadata[c].continents.map((x) => x.label).join(', ')}`);
console.log(`\n[geo] no ISO2 (expect historical/colonial entities here):`);
for (const c of countries) if (!metadata[c].iso2) console.log(`  ${c} -> item ${metadata[c].wikidata_item ?? 'NONE'}, continents=${metadata[c].continents.map((x) => x.label).join('/')  || 'NONE'}`);
console.log(`\n[geo] no continent at all (should be rare/zero):`);
for (const c of countries) if (!metadata[c].continents.length) console.log(`  ${c} -> item ${metadata[c].wikidata_item ?? 'NONE'}`);
console.log(`\n[geo] spot sample:`);
for (const c of ['France', 'United States', 'Russia', 'Russian Empire', 'Turkey', 'Egypt', 'Kazakhstan'].filter((c) => metadata[c])) {
  console.log(`  ${c} -> ${JSON.stringify(metadata[c])}`);
}
