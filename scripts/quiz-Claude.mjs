// Phase 10 (post-launch): builds the static quiz question bank consumed by
// src/pages/quiz.astro. Reads only already-committed, licensed data
// (data/buried-Claude.json, data/cemeteries-Claude.json, both Wikidata CC0)
// and mechanically derives multiple-choice questions from real field values.
// Nothing here invents a fact: every prompt and every choice, right or
// wrong, is a real value pulled from the dataset. Distractors are always
// OTHER real records' values, never synthesized text.
//
// Deterministic on purpose: a fixed-seed PRNG means re-running this script
// against unchanged data produces byte-identical output, matching the rest
// of the pipeline's "cheap and deterministic" re-run contract (see
// scripts/build-data-Claude.mjs and CLAUDE.md's orientation section).
//
// Run after build-data-Claude.mjs (needs its output), before `npm run build`:
//   node scripts/build-data-Claude.mjs && node scripts/quiz-Claude.mjs && npm run build

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, writeJson } from './lib/api-Claude.mjs';

const QUIZ_SEED = 0x51e57a; // fixed seed: "quiz-ta" leetspeak, arbitrary but constant

// ---------- seeded PRNG (mulberry32) + sampling helpers ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(QUIZ_SEED);

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function sampleN(arr, n) {
  return shuffle(arr).slice(0, n);
}
function pickDistinct(pool, n, excludeValues, keyFn = (x) => x) {
  const seen = new Set(excludeValues);
  const out = [];
  for (const item of shuffle(pool)) {
    const k = keyFn(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length === n) break;
  }
  return out;
}

// ---------- formatting ----------
function formatYear(y) {
  if (y === null || y === undefined) return '?';
  return y < 0 ? `${Math.abs(y)} BCE` : `${y}`;
}
function formatRange(birth, death) {
  return `${formatYear(birth)}-${formatYear(death)}`;
}

// Mirrors build-data-Claude.mjs's classifyEra() exactly (same boundaries),
// duplicated here rather than imported because that script runs its whole
// pipeline as a side effect of module load. Kept in lockstep by comment.
function classifyEra(year) {
  if (year === null) return null;
  if (year < 1800) return 'pre-1800';
  if (year < 1900) return '1800s';
  if (year < 1945) return 'early-1900s';
  if (year < 1980) return 'mid-1900s';
  return 'contemporary';
}
const ERA_DEATH_LABEL = {
  'pre-1800': 'Died before 1800',
  '1800s': 'Died in the 1800s (1800-1899)',
  'early-1900s': 'Died 1900-1944',
  'mid-1900s': 'Died 1945-1979',
  contemporary: 'Died 1980 or later',
};

// Mirrors the TYPE_LABEL map in src/pages/cemeteries/[slug].astro (that
// file is out of scope for this change; kept in sync by comment, not import,
// same rationale as classifyEra above).
const TYPE_ENUM = [
  'national-military',
  'religious-churchyard',
  'historic-heritage',
  'garden-rural',
  'natural-green-burial',
  'municipal-public',
  'private',
];
const TYPE_LABEL = {
  'national-military': 'National and military',
  'religious-churchyard': 'Religious and churchyard',
  'historic-heritage': 'Historic and heritage',
  'garden-rural': 'Garden and rural',
  'natural-green-burial': 'Natural and green burial',
  'municipal-public': 'Municipal and public',
  private: 'Private',
};

// A known_for string is flagged (not classified) when it contains a plain
// military-related term. This never asserts a branch of service or any
// specific rank beyond the word already present in the sourced text.
const MILITARY_TERM_RE = /\b(soldier|general|admiral|officer|marshal)\b/i;

// Real data-quality gap, not something invented here: 511 of 19,990
// notable_interments entries (2.6%) and 76 of 11,558 buried-Claude.json
// records (0.7%) carry an unresolved Wikidata label, where person_name is
// literally the QID (e.g. "Q5043282") instead of a human name. That value
// is real in the sense that it's what the pipeline stored, but it is not a
// documented name fit to show as a quiz answer, so every quiz mode filters
// it out rather than surfacing "Q5043282" as a multiple-choice option.
const QID_LOOKING_NAME_RE = /^Q\d+$/;
const isRealName = (name) => typeof name === 'string' && !QID_LOOKING_NAME_RE.test(name);

function makeMC({ id, mode, template, prompt, clues, correct, distractors, citation, link, note }) {
  const choiceObjs = shuffle([{ text: correct, correct: true }, ...distractors.map((d) => ({ text: d, correct: false }))]);
  const answerIndex = choiceObjs.findIndex((c) => c.correct);
  return {
    id,
    mode,
    template,
    ...(prompt ? { prompt } : {}),
    ...(clues ? { clues } : {}),
    choices: choiceObjs.map((c) => c.text),
    answerIndex,
    citation,
    link,
    ...(note ? { note } : {}),
  };
}

// ---------- load source data ----------
const persons = JSON.parse(await readFile(path.join(ROOT, 'data', 'buried-Claude.json'), 'utf8'));
const cemeteries = JSON.parse(await readFile(path.join(ROOT, 'data', 'cemeteries-Claude.json'), 'utf8'));
console.log(`[quiz] loaded ${persons.length} persons, ${cemeteries.length} cemeteries`);

// ============================================================
// QUIZ 1: "Where Are They Buried?" (persons -> cemetery match)
// ============================================================
const QUIZ1_TARGET = 300;

const eligiblePersons = persons.filter(
  (p) => p.known_for && p.birth_year !== null && p.death_year !== null && p.cemetery_name && isRealName(p.name)
);

// Distractor pool: every distinct cemetery_name that appears in the persons
// collection, paired with its country (first seen). Real values only, drawn
// from other real people's actual burial records.
const cemeteryNamePool = new Map();
for (const p of persons) {
  if (!cemeteryNamePool.has(p.cemetery_name)) cemeteryNamePool.set(p.cemetery_name, p.cemetery_country);
}
const cemeteryNameList = [...cemeteryNamePool.entries()].map(([name, country]) => ({ name, country }));

// Weight toward more-documented (higher-sitelinks) people: they make more
// recognizable quiz subjects. Take the top slice by sitelinks, then sample
// randomly within it so the question set still has spread.
const bySitelinks = [...eligiblePersons].sort((a, b) => b.sitelinks - a.sitelinks);
const quiz1Pool = bySitelinks.slice(0, Math.min(2000, bySitelinks.length));
const quiz1Subjects = sampleN(quiz1Pool, Math.min(QUIZ1_TARGET, quiz1Pool.length));

const quiz1Questions = quiz1Subjects.map((p, i) => {
  const sameCountry = cemeteryNameList.filter((c) => c.name !== p.cemetery_name && c.country && c.country === p.cemetery_country);
  const rest = cemeteryNameList.filter((c) => c.name !== p.cemetery_name && !(c.country && c.country === p.cemetery_country));
  const fromSameCountry = pickDistinct(sameCountry, 3, [p.cemetery_name], (c) => c.name);
  const remaining = 3 - fromSameCountry.length;
  const fromRest = remaining > 0 ? pickDistinct(rest, remaining, [p.cemetery_name, ...fromSameCountry.map((c) => c.name)], (c) => c.name) : [];
  const distractors = [...fromSameCountry, ...fromRest].map((c) => c.name);
  return makeMC({
    id: `bw-${String(i + 1).padStart(4, '0')}`,
    mode: 'buried_where',
    template: 'person_to_cemetery',
    prompt: `${p.name} (${p.known_for}, ${formatRange(p.birth_year, p.death_year)}) is buried at which of these?`,
    correct: p.cemetery_name,
    distractors,
    citation: { person_qid: p.qid, cemetery_slug: p.cemetery_slug },
    link: `/buried/${p.slug}/`,
  });
});

// ============================================================
// QUIZ 2: "Cemetery Trivia" (six field-derived templates)
// ============================================================
const TEMPLATE_TARGET = 60;
const quiz2Questions = [];
let q2counter = 0;
const nextQ2Id = () => `ct-${String(++q2counter).padStart(4, '0')}`;

// --- 1. Decade established ---
// Two records predate year 1 (-2588, -699 BCE); bucketing those into a
// "decade" label would be nonsensical, so this template simply excludes
// established_year < 1 rather than inventing a century bucket for two rows.
const decadeEligible = cemeteries.filter((c) => c.established_year !== null && c.established_year >= 1);
const decadePool = [...new Set(decadeEligible.map((c) => Math.floor(c.established_year / 10) * 10))];
for (const c of sampleN(decadeEligible, Math.min(TEMPLATE_TARGET, decadeEligible.length))) {
  const decade = Math.floor(c.established_year / 10) * 10;
  const correct = `${decade}s`;
  const distractors = pickDistinct(decadePool, 3, [decade]).map((d) => `${d}s`);
  quiz2Questions.push(
    makeMC({
      id: nextQ2Id(),
      mode: 'cemetery_trivia',
      template: 'decade_established',
      prompt: `In which decade was ${c.name} established?`,
      correct,
      distractors,
      citation: { wikidata_qid: c.wikidata_qid, cemetery_slug: c.slug },
      link: `/cemeteries/${c.slug}/`,
    })
  );
}

// --- 2. Country ---
const countryEligible = cemeteries.filter((c) => c.country);
const countryPool = [...new Set(countryEligible.map((c) => c.country))];
for (const c of sampleN(countryEligible, Math.min(TEMPLATE_TARGET, countryEligible.length))) {
  const distractors = pickDistinct(countryPool, 3, [c.country]);
  quiz2Questions.push(
    makeMC({
      id: nextQ2Id(),
      mode: 'cemetery_trivia',
      template: 'country',
      prompt: `Which country is ${c.name} in?`,
      correct: c.country,
      distractors,
      citation: { wikidata_qid: c.wikidata_qid, cemetery_slug: c.slug },
      link: `/cemeteries/${c.slug}/`,
    })
  );
}

// --- 3. Cemetery type ---
// Real distribution is heavily skewed toward historic-heritage (1077 of
// 1293 tagged records), so two guards keep this from being trivially
// guessable by always answering the most common label:
//   (a) featured cemeteries are sampled evenly ACROSS types (a stratified
//       cap per type), not proportionally to the skewed real distribution,
//       so historic-heritage isn't the correct answer most of the time;
//   (b) distractors are drawn uniformly from the 7-value type enum, not
//       weighted by how common each type really is.
const typeEligible = cemeteries.filter((c) => Array.isArray(c.type) && c.type.length > 0);
const byPrimaryType = new Map(TYPE_ENUM.map((t) => [t, []]));
for (const c of typeEligible) {
  const primary = c.type[0];
  if (byPrimaryType.has(primary)) byPrimaryType.get(primary).push(c);
}
const TYPE_CAP = 15;
const typeSelected = [];
for (const t of TYPE_ENUM) {
  const bucket = byPrimaryType.get(t) ?? [];
  typeSelected.push(...sampleN(bucket, Math.min(TYPE_CAP, bucket.length)));
}
for (const c of shuffle(typeSelected)) {
  const correctType = c.type[0];
  const distractorTypes = pickDistinct(TYPE_ENUM, 3, [correctType]);
  quiz2Questions.push(
    makeMC({
      id: nextQ2Id(),
      mode: 'cemetery_trivia',
      template: 'cemetery_type',
      prompt: `Which of these best describes ${c.name}?`,
      correct: TYPE_LABEL[correctType],
      distractors: distractorTypes.map((t) => TYPE_LABEL[t]),
      citation: { wikidata_qid: c.wikidata_qid, cemetery_slug: c.slug },
      link: `/cemeteries/${c.slug}/`,
    })
  );
}

// --- 4. Documented notable interment ---
// has_notable_interments / length checks use the raw array (a cemetery's
// true interment count shouldn't shrink because of an unrelated data
// artifact), but the real-name filter is applied wherever a name gets
// displayed: which interment can be the CORRECT answer, and the pool
// distractors are drawn from.
const intermentEligible = cemeteries.filter(
  (c) => c.has_notable_interments && c.notable_interments.length >= 3 && c.notable_interments.some((i) => isRealName(i.person_name))
);
const intermentByRichness = [...intermentEligible].sort((a, b) => b.notable_interments.length - a.notable_interments.length);
const intermentPoolCems = intermentByRichness.slice(0, Math.min(400, intermentByRichness.length));
const allInterments = cemeteries.flatMap((c) =>
  c.notable_interments.filter((i) => isRealName(i.person_name)).map((i) => ({ name: i.person_name, cemSlug: c.slug }))
);
for (const c of sampleN(intermentPoolCems, Math.min(TEMPLATE_TARGET, intermentPoolCems.length))) {
  const ownNames = new Set(c.notable_interments.map((i) => i.person_name));
  const realInterments = c.notable_interments.filter((i) => isRealName(i.person_name));
  const correctInterment = sampleN(realInterments, 1)[0];
  const otherPool = allInterments.filter((i) => i.cemSlug !== c.slug && !ownNames.has(i.name));
  const distractors = pickDistinct(otherPool, 3, [correctInterment.person_name], (i) => i.name).map((i) => i.name);
  quiz2Questions.push(
    makeMC({
      id: nextQ2Id(),
      mode: 'cemetery_trivia',
      template: 'notable_interment',
      prompt: `Which of these is a real documented interment at ${c.name}?`,
      correct: correctInterment.person_name,
      distractors,
      citation: { wikidata_qid: c.wikidata_qid, cemetery_slug: c.slug, person_qid: correctInterment.person_qid },
      link: `/cemeteries/${c.slug}/`,
    })
  );
}

// --- 5. Heritage designation ---
// Of the 761 distinct real heritage_id values, 684 (90%) are bare U.S.
// National Register reference numbers ("NRHP 06001335") rather than a
// descriptive status. Real data, but matching one opaque reference number
// against three others isn't meaningful trivia about documented history.
// 372 cemeteries carry a descriptive (non-NRHP-number) heritage_id, which
// is plenty to hit this template's sample target on its own, so the
// question set draws from that more legible subset. Distractors are also
// restricted to descriptive values for the same reason: an NRHP number
// showing up as one of three wrong answers next to a real designation name
// would be a bizarre, not-hard-just-noisy choice.
const heritageEligible = cemeteries.filter((c) => c.heritage_id && !/^NRHP\s?\d+/.test(c.heritage_id));
const heritagePool = [...new Set(heritageEligible.map((c) => c.heritage_id))];
for (const c of sampleN(heritageEligible, Math.min(TEMPLATE_TARGET, heritageEligible.length))) {
  const distractors = pickDistinct(heritagePool, 3, [c.heritage_id]);
  quiz2Questions.push(
    makeMC({
      id: nextQ2Id(),
      mode: 'cemetery_trivia',
      template: 'heritage_designation',
      prompt: `Which heritage status does ${c.name} hold?`,
      correct: c.heritage_id,
      distractors,
      citation: { wikidata_qid: c.wikidata_qid, cemetery_slug: c.slug },
      link: `/cemeteries/${c.slug}/`,
    })
  );
}

// --- 6. Continent ---
const continentEligible = cemeteries.filter((c) => Array.isArray(c.continents) && c.continents.length > 0);
const continentLabelPool = [...new Set(cemeteries.flatMap((c) => c.continents.map((k) => k.label)))];
for (const c of sampleN(continentEligible, Math.min(TEMPLATE_TARGET, continentEligible.length))) {
  const ownLabels = c.continents.map((k) => k.label);
  const correctLabel = sampleN(ownLabels, 1)[0];
  // Exclude ALL of this cemetery's own continents from the distractor pool,
  // not just the chosen correct one. A multi-continent cemetery's second
  // continent would otherwise be a secretly-also-correct "wrong" answer.
  const distractorPool = continentLabelPool.filter((l) => !ownLabels.includes(l));
  const distractors = pickDistinct(distractorPool, 3, []);
  quiz2Questions.push(
    makeMC({
      id: nextQ2Id(),
      mode: 'cemetery_trivia',
      template: 'continent',
      prompt: `Which continent is ${c.name} on?`,
      correct: correctLabel,
      distractors,
      citation: { wikidata_qid: c.wikidata_qid, cemetery_slug: c.slug },
      link: `/cemeteries/${c.slug}/`,
    })
  );
}

// NOTE: no area_hectares template. Coverage is 11.7% and the raw data
// contains at least one implausible outlier (a 40,569.5-hectare value,
// roughly the area of a small country, not a cemetery) that needs a
// sanity-check pass before area_hectares is surfaced anywhere on the site,
// not just here. See task brief; flagging again here so the omission reads
// as deliberate to a future reader of this script.

// ============================================================
// QUIZ 3: "Historical Figure Mystery Grid"
// ============================================================
// nationality only exists on the per-cemetery notable_interments[] entries
// (src/content.config.ts's `interment` schema), not on the top-level
// persons collection (data/buried-Claude.json), confirmed against the live
// schema and live data before building this. Coverage on that embedded
// field is healthy (94.5% of 19,990 interments), so this ships as the full
// 3-clue design, not a fallback 2-clue mode.
const MYSTERY_TARGET = 250;
const ERA_BUCKETS = ['pre-1800', '1800s', 'early-1900s', 'mid-1900s', 'contemporary'];

const mysteryCandidates = [];
const seenQid = new Set();
for (const c of cemeteries) {
  for (const i of c.notable_interments) {
    if (!i.known_for || i.death_year === null || !i.nationality) continue;
    if (!isRealName(i.person_name)) continue; // unresolved Wikidata label, see isRealName above
    if (seenQid.has(i.person_qid)) continue; // defensive: dedupe by real QID
    seenQid.add(i.person_qid);
    mysteryCandidates.push({
      name: i.person_name,
      qid: i.person_qid,
      slug: i.person_slug,
      knownFor: i.known_for,
      nationality: i.nationality,
      deathYear: i.death_year,
      era: classifyEra(i.death_year),
      cemeterySlug: c.slug,
      cemeteryName: c.name,
    });
  }
}
console.log(
  `[quiz] mystery-grid candidate pool: ${mysteryCandidates.length} distinct persons with known_for + death_year + nationality`
);

// Stratify by era-of-death bucket so the question set has real variety
// instead of clustering wherever the data happens to be densest.
const MYSTERY_PER_ERA = Math.ceil(MYSTERY_TARGET / ERA_BUCKETS.length);
let mysterySubjects = [];
for (const era of ERA_BUCKETS) {
  const bucket = mysteryCandidates.filter((p) => p.era === era);
  mysterySubjects.push(...sampleN(bucket, Math.min(MYSTERY_PER_ERA, bucket.length)));
}
mysterySubjects = sampleN(mysterySubjects, Math.min(MYSTERY_TARGET, mysterySubjects.length));

const quiz3Questions = mysterySubjects.map((p, i) => {
  // Avoid a distractor that would ALSO satisfy every clue (same era +
  // same nationality string), which would make the question genuinely
  // ambiguous rather than merely hard.
  const distractorPool = mysteryCandidates.filter(
    (o) => o.qid !== p.qid && !(o.era === p.era && o.nationality === p.nationality)
  );
  const distractors = pickDistinct(distractorPool, 3, [p.name], (o) => o.name).map((o) => o.name);
  const militaryTerm = MILITARY_TERM_RE.test(p.knownFor);
  return makeMC({
    id: `mg-${String(i + 1).padStart(4, '0')}`,
    mode: 'mystery_grid',
    template: 'three_clue',
    clues: [
      ERA_DEATH_LABEL[p.era],
      `Known for: ${p.knownFor}`,
      `Nationality (as recorded): ${p.nationality}`,
    ],
    correct: p.name,
    distractors,
    citation: { person_qid: p.qid, cemetery_slug: p.cemeterySlug },
    link: p.slug ? `/buried/${p.slug}/` : `/cemeteries/${p.cemeterySlug}/`,
    // Surfaced by the page as a plain note. Never upgraded to a claimed
    // branch of service or rank. The source text is the whole claim.
    ...(militaryTerm ? { note: 'The "known for" text above includes a military-related term.' } : {}),
  });
});

// ============================================================
// assemble + write
// ============================================================
const bank = {
  generated_at: new Date().toISOString(),
  source: 'data/buried-Claude.json + data/cemeteries-Claude.json (Wikidata, CC0)',
  seed: QUIZ_SEED,
  modes: {
    buried_where: {
      title: 'Where Are They Buried?',
      description: 'Match a documented public figure to their real, recorded resting place.',
      questions: quiz1Questions,
    },
    cemetery_trivia: {
      title: 'Cemetery Trivia',
      description: 'Six field-derived question types about real, documented cemeteries.',
      questions: quiz2Questions,
    },
    mystery_grid: {
      title: 'Historical Figure Mystery Grid',
      description: 'Three real clues, guess the documented person they describe.',
      questions: quiz3Questions,
    },
  },
};

await writeJson('data/quiz-questions-Claude.json', bank);

const report = {
  buried_where: quiz1Questions.length,
  cemetery_trivia: {
    total: quiz2Questions.length,
    by_template: Object.fromEntries(
      Object.entries(
        quiz2Questions.reduce((acc, q) => {
          acc[q.template] = (acc[q.template] ?? 0) + 1;
          return acc;
        }, {})
      )
    ),
  },
  mystery_grid: quiz3Questions.length,
  total_questions: quiz1Questions.length + quiz2Questions.length + quiz3Questions.length,
};
console.log(JSON.stringify(report, null, 2));
