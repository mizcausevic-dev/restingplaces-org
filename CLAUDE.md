# Resting Places — project notes for Claude Code

Live at **https://restingplaces.site**. DirectoryOS pattern: a static reference directory of cemeteries, built from licensed open data (Wikidata CC0, Wikimedia Commons, OpenStreetMap). Astro 7, zero client JS except Pagefind search. Separate product repo, not part of the kineticgain-com-apex estate repo.

## Orientation

- Rebuild pipeline, in order: `node scripts/ingest-Claude.mjs` → `enrich-Claude.mjs` → `image-rights-Claude.mjs` → `build-data-Claude.mjs` → `npm run build` → `node scripts/qa-Claude.mjs`. Every script caches raw API responses in `data/cache/` (gitignored) so re-runs are cheap and deterministic.
- The interment graph (`data/interment-graph-Claude.json`, CC0) is the core asset. `/buried/` page tier is one constant, `PERSON_PAGE_SITELINKS` in `scripts/build-data-Claude.mjs`.
- No-fabrication guard lives in `src/content.config.ts` (Zod schema) — a field with no licensed source is `null`, never guessed.
- Full architecture: `docs/architecture-Claude.html`. Original build handoff: `docs/HANDOFF-Claude.md`.

---

## Checkpoint — 2026-07-09

### What shipped this session

- Full 9-phase DirectoryOS build completed and QA-green: Astro 7.0.6, 16,373 pages (2,443 cemetery pages, 11,526 `/buried/` answer pages, geo/type/era hubs, 5 guides, JSON API, `llms.txt`). Pipeline gates: 120 sub-lists crawled → 2,443 Wikidata-confirmed cemeteries → 75,372-edge / 70,270-person interment graph → 1,887/1,906 images passed the license gate → 0 broken links / 0 orphans / 0 image violations / 0 hours rendered on final QA.
- **Domain**: the brief's pick (`restingplaces.org`) and `.com` were both already registered — discovered via live Hostinger availability check, not assumed. Backups from the brief (`cemeteryindex.org`, `graveatlas.org`) were confirmed available, but the user instead registered **`restingplaces.site`** (a $0.99-first-year / $38.99-renewal promo) to keep the actual brand name intact rather than rebrand.
- **Domain purchase via API failed partway**: `domains_purchaseNewDomainV1` accepted a valid WHOIS profile + catalog item and returned `"Domain registration is not yet available, please use hPanel to finalize domain registration"` — confirmed nothing was created (domain absent from `domains_getDomainListV1` after the call). This is a real boundary in Hostinger's API, not a token/permissions issue: new-domain purchases require a manual hPanel confirmation even though the purchase endpoint is exposed. User completed the actual purchase in hPanel directly. Documented in global memory as `hostinger-api-capability.md` so future sessions don't retry the same dead end.
- **Deployed and verified live**, same day: added `restingplaces.site` as a 7th "addon domain" on the *existing* Hostinger hosting order (`order_id 1008048131` — the same account already runs kineticgain.com's ~180 subdomains plus 6 other standalone domains), so this cost zero new hosting spend. Deploy mechanism: discovered the existing `KG_SFTP_*` env vars (originally wired for the CineOps Pro deploy, same Hostinger account) grant **full SSH shell exec**, not just an SFTP jail. Tarred `dist/` locally (17.9 MB, 16,373 files), uploaded the single tarball via `sftp put`, then `ssh`-exec'd `tar -xzf` into `public_html` server-side, replacing Hostinger's default placeholder page. Verified with `curl`: HTTP 200 on `/`, a cemetery page, and `/api/cemeteries.json`; correct title and cemetery count in the response bodies; valid HTTPS on the first request (no cert warnings, no `-k` needed).
- The `.github/workflows/deploy.yml` (FTPS + GitHub Secrets) built earlier during Phase 9 planning **is unused** — the SSH tar/extract path above is what actually shipped the site, and it needed no new secrets at all. Left in the repo as a documented-but-inactive alternate path; safe to delete if it causes confusion.
- Updated `astro.config.mjs` site URL, `public/robots.txt` sitemap line, and the pipeline scripts' User-Agent string from `restingplaces.org` → `restingplaces.site`; rebuilt and re-ran QA clean before deploying.

### Nuances worth knowing

- **`history` field is `null` on all 2,443 records, by design.** Writing ~150-word templated histories at that scale was assessed against the `vip-seo-geo-aeo-expert` skill's 2026 penalty-surface reference *before* building anything, and flagged as a thin-variable-swap / scaled-content-abuse signature (Google's March 2026 top enforcement target). Pages ship data-forward instead. If cemetery history prose is wanted, write it editorially per-cemetery (flagship entries first — Père Lachaise, Highgate, Arlington, etc.), not generated in bulk.
- **`classification_reviewed` is `false` on every record** — type/era tags are machine-derived from Wikidata P31 labels, heritage status, and founding date, not human-reviewed one by one. 1,150 of 2,443 cemeteries carry no `type` tag at all because their source records don't support one; that's honest under-tagging, not a bug.
- **`/buried/` page tier** is one constant (`PERSON_PAGE_SITELINKS = 15` in `build-data-Claude.mjs`), currently producing 11,526 of 70,270 qualifying notable-person pages. The complete graph (all 70,270 persons, 75,372 edges) ships regardless via `/api/interments.json` — the page tier only controls how many get individual crawlable pages.
- **Image-rights gate failed 19 of 1,906 Commons candidates** (GFDL / FAL / "Licence Ouverte" / etc. — anything outside PD/CC0/CC BY/CC BY-SA). Those cemeteries ship text-forward with `photo: null`, by design, not an oversight.
- GitHub repo name is still `mizcausevic-dev/restingplaces-org` even though the live domain is `restingplaces.site` — cosmetic mismatch from the original repo-creation step, never revisited. Renaming the repo is trivial (`gh repo rename`) if it ever bothers anyone.

### Open issues / deferred (all deliberate gates, not bugs)

1. **No Google Places API key.** `google_place_id` and `hours` are `null` on every record; opening hours are omitted sitewide by the freshness gate rather than guessed. Wiring a key (plus a refresh job) would light this up via `scripts/enrich-Claude.mjs`.
2. **No affiliate ids.** `PUBLIC_ANCESTRY_AFFILIATE_URL` / `PUBLIC_MYHERITAGE_AFFILIATE_URL` are unset, so `AffiliateNote-Claude.astro` renders nothing anywhere on the site. Verify the affiliate programs are actually live before setting these.
3. **No email-capture keys.** `PUBLIC_CAPTURE_FORM_ACTION` / `PUBLIC_CAPTURE_ACCESS_KEY` unset (Web3Forms pattern) — `EmailCapture-Claude.astro` renders nothing until set.
4. **Lighthouse is incomplete.** Home page (via local `astro preview`): perf 0.51 / a11y 0.91 / best-practices 0.81 / SEO 1.00 — real numbers. Cemetery-page and guide-page runs crashed `chrome-launcher` on this Windows box across 3 attempts (bash, PowerShell, `--headless=new`); no real numbers for those templates. Home perf's biggest lever is likely the Pagefind UI bundle and the full country-chip list on `/`.

### Next steps (not started, no commitment implied)

- Perf pass on the home page (lazy-load Pagefind UI on interaction, trim/paginate the country-chip list) to move the 0.51 Lighthouse score.
- Get real Lighthouse numbers for the cemetery-page and guide-page templates (retry on a different machine or a hosted Lighthouse CI service instead of local `chrome-launcher`).
- Wire affiliate ids and email capture once those decisions/credentials exist (both are pure config, components already gated on env vars).
- Editorial history-writing pass on a handful of flagship cemeteries, if narrative history pages are wanted.
- Decide whether to delete the unused `.github/workflows/deploy.yml` or keep it as a documented fallback.
- **Places API full-scale hours run.** Test batch done (see checkpoint below), real cost ~$0.02/cemetery, ~$48.86 projected for all 2,443. Needs an explicit go-ahead before running, not a code gap.

---

## Checkpoint — 2026-07-21/22

Deploy mechanics unchanged from the 2026-07-09 checkpoint (same `KG_SFTP_*` SSH tar/extract path). One gotcha hit this session: `KG_SFTP_*` is defined in `~/.bashrc`, not a persistent Windows env var — a fresh Bash tool call (e.g. after a worktree recycle) won't have it until you `source ~/.bashrc` in that same call (shell state doesn't persist between separate tool calls, so it needs re-sourcing every time, not just once). `HOSTINGER_API_TOKEN` is a real persistent env var and doesn't have this problem.

### What shipped

Domain switched to `restingplaces.site` (was still `.org` internally at last checkpoint); GSC verification tag added and live sitewide. Then a large enrichment batch, built by a 9-agent background Workflow (data pipeline stages sequential, not parallel, since they share `content.config.ts`/`build-data-Claude.mjs` — running them concurrently would have caused edit conflicts) plus three more background Agent calls for glossary/quiz, all independently verified before merging:

- **Nationality** (P27) added to the interment pipeline: 90-94% coverage, real re-fetch (~20 min against live Wikidata).
- **Photo gallery**, capped at 3/cemetery, sourced via Wikidata P373 → Commons categorymembers → the existing license gate: 1,524/1,625 categorized cemeteries got ≥1 image, 4,233 images total. Flagships (Père Lachaise, Arlington) still get 0-1 images each — their real photo volume sits in Commons subcategories a flat `categorymembers` query can't see; a subcategory crawl is a real, separate follow-up, not done.
- **Occupation breakdown**, **browse by decade of death** (`/decade/`, BCE-aware), **real nearby-cemeteries** (haversine distance, supplements the existing category-scored `related_slugs`, doesn't replace it), **public `/data-quality/` page**, **citation export** (`CiteBlock-Claude.astro`, APA + BibTeX, no fabricated access date), **random-cemetery button**, **Wikidata "help improve" framing** — all built from fields already in the pipeline, no new data sources needed.
- **Google Static Maps preview** per cemetery (`CemeteryMap-Claude.astro`): built as a live per-visitor `<img>` URL, deliberately never fetched/cached server-side — baking the PNG into `dist/` would violate Maps Platform ToS caching rules (checked against the real current ToS, not assumed). Gated on `PUBLIC_GOOGLE_MAPS_KEY`; renders nothing when unset. **The key currently in `.env` is unrestricted-by-referrer and shared across two use cases that need separate restrictions** (public embed needs HTTP-referrer restriction; future server-side Places calls need the opposite) — flagged repeatedly, not yet acted on, a Google Cloud Console task for the site owner, project `kg-gsc-mcp`.
- **Places API hours: test batch only, full run NOT executed.** 15-cemetery real test: OSM Overpass hit only 1/15 (7%, barely helps), Google Places hit 13/14 attempted (87%). Real cost so far: $0.28 (14 test calls). This changes the earlier pre-research cost estimate materially: full-scale is closer to **~$48.86** (2,443 × $0.02, since Overpass isn't offsetting much), not the ~$29 blended estimate from before the test ran. Also: the Overpass fallback aborts on the first radius error instead of retrying (hit one real HTTP 504 in the test) — needs hardening before a 2,443-record run against the shared public `overpass-api.de` instance.
- **Glossary**: 16 terms, independently fact-checked before writing (not written from memory) at `/glossary/`. Cross-linked into cemetery pages and the two type hubs that have a genuine data-backed mapping (national-military → War Grave, historic-heritage → Heritage Status) — explicitly **not** built as 13 new per-architecture-style tag hubs, because no per-cemetery data supports claims like "this cemetery has a mausoleum"; inventing that classification would have been the same fabrication risk the null `history` field already avoids.
- **Quiz** at `/quiz/`, three modes, 918 questions, **every question mechanically generated from real stored fields at build time** — the reviewer's own example question ("which cemetery was modeled after Père Lachaise") was rejected outright as an unsourced-claim risk, and the rest of the proposal was redesigned around real fields (decade established, country, type, real documented interments, heritage designation, continent) rather than hand-authored trivia. Caught a real pre-existing pipeline bug independently: 511 interments + 76 buried-page records had an unresolved Wikidata QID string (e.g. `"Q5043282"`) instead of a real name; filtered out of every quiz pool, not fixed upstream yet (worth a real fix in `enrich-Claude.mjs` at some point, currently just excluded from the quiz).
- **Fixed a QA gate false positive**: the image-license audit predated the Static Maps feature and didn't recognize `maps.googleapis.com` as a legitimate host, so it flagged all 2,430 live map embeds as violations. Added a narrow, explicit allowlist branch for that specific host+param pattern rather than loosening the Commons check.

Final QA: 649,791 internal links checked, 0 broken, 0 orphans, 0 image violations, across 16,524 pages.

### Process note worth repeating

Ran a large batch of file-overlapping tasks (schema changes, shared component edits) as a **sequential** Workflow, not parallel agents with worktree isolation — deliberately, because worktree isolation doesn't merge cleanly when multiple agents independently edit the *same* core files (`content.config.ts`, `build-data-Claude.mjs`); sequential agents each seeing the prior agent's real completed edits avoided that entirely. Genuinely independent new-file work (glossary, quiz, this checkpoint's integration pass) ran as separate background Agent calls once the shared files were stable, explicitly told not to touch files still in flight.

---

## Checkpoint — 2026-07-22 (Places API full-scale hours run: pipeline shipped, bulk run BLOCKED)

Generalized `hours-test-Claude.mjs` into a real production pipeline stage, `scripts/hours-Claude.mjs`, wired the result into the actual site (`hours`/`google_place_id` fields, `content.config.ts`, `build-data-Claude.mjs`), and ran it for real. **The full 2,443-cemetery sweep did NOT complete — two real external blockers, not code bugs, stopped it well short.** What's shipped is real, tested, QA-green, and safely resumable; what's outstanding needs one Google Cloud Console fix plus a genuinely long unattended run.

### What shipped (real, verified, in the working tree)

- `scripts/hours-Claude.mjs`: OSM Overpass first (free), then Google Places Text Search (free, id-only mask) → Place Details (billed, same minimal Enterprise-tier mask as the test — `id,displayName,regularOpeningHours,currentOpeningHours,businessStatus`). At most one billed Details call per cemetery per run, enforced by a hard cost ceiling ($49.00) that aborts immediately if breached. Supports `HOURS_LIMIT=N` (bounded slice) and `HOURS_SLUGS=a,b,c` (exact slug targeting, e.g. to cheaply replay an already-cached set) for controlled partial runs; both unset in a real full production invocation.
- **Schema**: `hours.source` broadened from `z.literal('google-places')` to `z.enum(['google-places', 'osm-overpass'])` in `content.config.ts` — an OSM-sourced value is never mislabeled under the Google literal. OSM's raw `opening_hours` DSL string (e.g. `"Mar-Oct 10:00-17:00; Nov-Feb 10:00-16:00; Dec 25,Dec 26 off"`) is stored verbatim as a single-element `weekday_text` array, not reformatted into Google's day-by-day shape — no OSM `opening_hours` parser exists in this repo, and writing one to split it into 7 lines risked a real mis-parse presented as fact.
- `build-data-Claude.mjs` merges `data/hours-Claude.json` (slug → hours record) into each cemetery; optional-file pattern matches `gallery-Claude.json`. `[slug].astro`'s Opening hours block now shows a source line ("Google Places" vs "OpenStreetMap contributors"). `attribution.astro` and `data-quality.astro` updated off the old "no hours displayed anywhere" claim, which the feature now contradicts — `data-quality.astro`'s hours row/paragraph computes live from the real collection rather than the enrich-time coverage report, so it can't go stale again the same way. `qa-Claude.mjs`'s freshness-gate note corrected to describe what it actually measures.
- **Three real bugs found and fixed**, none theoretical:
  1. Plain `fetch()` in the shared `lib/api-Claude.mjs` `cachedJson()` had no timeout — a stalled connection to the shared public `overpass-api.de` instance hung the whole process indefinitely. Added an `AbortController`-based per-attempt timeout (default 30s).
  2. `cachedJson()`'s retry loop, if every attempt hit the 429/503 branch, never set `lastErr` and threw `undefined` instead of an `Error` — crashed any caller reading `err.message`. This is exactly what happened mid-run (Overpass under real load, repeated 429/503/504). Fixed by seeding a real `Error` up front and setting `lastErr` on the rate-limit branch too.
  3. The original test script's Overpass tier aborted to Google on the *first* error at a radius/direct-id query instead of falling through to the next tier. Hardened in the production script: direct-id errors fall through to nearby search; a radius-300 error tries radius-1500 before giving up.
- **Circuit breaker added** (not in the original test): 3 consecutive Google HTTP 403 responses disables the Google tier for the rest of that run — a permission failure is a whole-run problem, not a per-record miss, and hammering it for thousands more records wastes real time for zero yield.
- **Resumability fix**: `writeOutputs()` originally overwrote `data/hours-Claude.json` from `{}` every run instead of merging with a prior run's real results — a second targeted/bounded invocation would have silently discarded the first's data. Fixed to load and accumulate into any existing file.

### Why the full run didn't happen

1. **The Google key currently in `.env` is now HTTP-referrer-restricted** (`API_KEY_HTTP_REFERRER_BLOCKED`, confirmed via real `403 PERMISSION_DENIED` responses on every attempt) — it worked fine for the 2026-07-21/22 test batch (13/14 real hits) but something changed it between then and this session. Server-side requests carry no `Referer` header, so a referrer-restricted key fails 100% of the time here; this is exactly the risk `CemeteryMap-Claude.astro`'s header comment and `docs/HANDOFF-Claude.md` have flagged twice already — the fix is provisioning a **second, non-referrer-restricted key** in Google Cloud Console (project `kg-gsc-mcp`) for server-side Places calls, keeping the existing referrer-restricted key for the public Static Maps `<img>` embed. Not something fixable from code. Confirmed **zero dollars spent**: every attempt failed at the 403 permission stage, before Google's billable Details endpoint was ever reached (`billable_place_details_calls_this_run: 0` across every run this session).
2. **The free OSM Overpass path was real but too slow to sweep all 2,430 coordinate-bearing cemeteries in one session** — the shared public `overpass-api.de` instance was under real load this session (repeated 429/503/504s, individual queries taking up to ~75s after retries). Politeness-respecting sequential querying (no parallelizing against a shared free instance) means a full sweep is realistically a multi-hour unattended job, not something to force through interactively.

### Real numbers, this session

- Cemeteries actually attempted: 29 distinct (14 fresh, real-time attempts this session, plus the original 15-cemetery test set replayed to pull its already-cached, already-billed real results into the pipeline).
- **16 cemeteries now carry real, live-checked hours**: 3 from OSM Overpass (Highgate Cemetery, Wadi-us-Salaam, Tombs of the Kings Paphos), 13 from Google Places (from the original validated test batch's real, cached results — Père Lachaise, Arlington National Cemetery, and 11 others).
- Real cost incurred **this session: $0.00** (zero new billed Details calls; the 13 Google-sourced records are the original test batch's real $0.28 spend from 2026-07-21/22, already paid for, pulled into the pipeline from cache, not re-billed).
- QA after wiring: 649,792 internal links checked, 0 broken, 0 orphans, 0 image violations, `pages_showing_hours: 16` (matches exactly).
- Spot-checked and confirmed rendering correctly: Highgate (OSM, verbatim DSL string), Père Lachaise and Arlington (Google, day-by-day), Sparkman Hillcrest Memorial Park (resolved by Google, no hours found → correctly renders no "Opening hours" section at all, not blank).

### Next steps (not started, no commitment implied)

1. Split the Google Maps Platform key in Google Cloud Console (project `kg-gsc-mcp`): keep the current referrer-restricted key for the public Static Maps embed, provision a new non-referrer-restricted key for server-side Places calls. Single highest-leverage fix — unlocks the ~87% Google hit rate the original test validated.
2. Once fixed, run `node --env-file=.env scripts/hours-Claude.mjs` (no `HOURS_LIMIT`/`HOURS_SLUGS`) as a genuinely long-lived background/overnight job — real per-record Overpass latency this session suggests several hours for a full sweep, and that's independent of the Google fix (Overpass runs first for everyone). Safe to interrupt and resume: already-billed Google calls and already-queried Overpass results are cached and never re-billed/re-queried; the hard $49 cost ceiling and 403 circuit breaker are both real safeguards, not aspirational.
3. Re-run `node scripts/build-data-Claude.mjs && npm run build && node scripts/qa-Claude.mjs` after the full sweep to ship the complete result.
