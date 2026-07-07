# Handoff: Resting Places (DirectoryOS, cemeteries vertical)

Built 2026-07-07. Repo: https://github.com/mizcausevic-dev/restingplaces-org (public, so GitHub Actions run free of the account's private-repo billing block).

## State at handoff

- 16,373 built pages: 2,443 cemetery pages, 11,526 /buried/ answer pages, 459 full interment indexes, geo/type/era hubs, 5 guides, compliance pages, machine layer (JSON API, llms.txt, sitemap, RSS).
- QA green: 504,471 internal links, 0 broken, 0 orphans, 0 image-license violations, 0 pages showing hours (freshness gate holds), compliance audit clean.
- The interment graph is the moat: 75,372 CC0 edges, 70,270 notable persons, shipped whole at /api/interments.json.

## Blocked or deferred (decisions for the operator)

1. **Domain.** restingplaces.org is unregistered (availability checked at build; see final report). Purchase is a spend decision, deliberately not made by the build. After registering on Hostinger: point DNS, create the website, set repo secrets FTP_HOST/FTP_USER/FTP_PASS, run the manual deploy workflow.
2. **Google Places.** No key configured, so google_place_id and hours are null and hours are omitted sitewide. Wiring a key and a refresh job upgrades hours into a live, freshness-stamped field via `scripts/enrich-Claude.mjs`.
3. **Affiliates.** Ancestry/MyHeritage ids not provided. Placements are built and gated: set PUBLIC_ANCESTRY_AFFILIATE_URL / PUBLIC_MYHERITAGE_AFFILIATE_URL at build time and the placements render; unset, nothing ships. Verify the programs are live before setting.
4. **Email capture.** Same gating: PUBLIC_CAPTURE_FORM_ACTION + PUBLIC_CAPTURE_ACCESS_KEY (Web3Forms pattern, single opt-in per estate standard).
5. **Lighthouse.** Home: perf 0.51 / a11y 0.91 / bp 0.81 / seo 1.00 (localhost preview). Cemetery and guide runs crashed in chrome-launcher on this Windows box after 3 attempts. Perf follow-ups: lazy-load Pagefind UI only on interaction, trim the home country chip list.
6. **history field.** Null on all records by design. The prompt asked for ~150-word histories per cemetery; generating 2,443 templated paragraphs is exactly the thin-variable-swap pattern Google's March 2026 enforcement targets. Write them editorially, flagship-first, or not at all.
7. **classification_reviewed** is false everywhere. Type/era tags are generated from source facts; an editorial review pass can flip records to true.

## Two reusable DirectoryOS modules born here

1. **Meta-list fan-out crawler** (`scripts/ingest-Claude.mjs`): BFS over Wikipedia list pages to closure with depth cap, entity confirmation by Wikidata class membership (P31/P279*) instead of title heuristics. Unlocks every "Lists of X" index seed: museums, festivals, universities, lighthouses.
2. **Wikidata knowledge-graph layer** (`scripts/enrich-Claude.mjs`, interment section): reverse-property sweep (here P119 place of burial) with notability enforced in the query (sitelink + date guards), adaptive batch splitting on timeout. Generalizes to birthplaces (P19), headquarters (P159), filming locations (P915).

## Operating notes

- Rebuild pipeline order: ingest -> enrich -> image-rights -> build-data -> npm run build -> qa. Every script caches raw responses in data/cache/ (gitignored); re-runs are cheap and deterministic.
- Corrections flow through Wikidata, not local edits: fix the source item, re-run enrich + build.
- The /buried/ page tier is one constant (PERSON_PAGE_SITELINKS in build-data-Claude.mjs, currently 15 = 11,526 pages). Full 70k-person graph ships in the API regardless.
- Penalty-surface guardrails embedded: no AggregateRating/Review schema anywhere, FAQPage only when two or more data-backed answers exist, dates only when real, affiliate links rel="sponsored", llms.txt treated as hygiene.
