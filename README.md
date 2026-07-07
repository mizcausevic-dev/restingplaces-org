# Resting Places

A respectful reference directory of the world's cemeteries. Built from licensed open data: Wikidata (CC0), Wikimedia Commons (verified free licenses), and OpenStreetMap. Static Astro site, DirectoryOS pattern: the site is a public API for crawlers and a clean dataset for machine models.

## Data sources and what we never do

- Facts (names, locations, established dates, notable interments) come from Wikidata, which publishes under CC0.
- Notable interment data covers public figures only: a person qualifies when Wikidata records a place of burial (P119), a death date, and an English Wikipedia article.
- Images are Wikimedia Commons files with individually verified free licenses. Every displayed image carries inline credit and appears in /image-credits.
- We link out to Find a Grave and BillionGraves where relevant. We never ingest, scrape, or republish their data or photos.
- Opening hours are shown only when live-fetched with a visible last-checked date. No live source, no hours.

## Stack

Astro 7, @astrojs/sitemap, @astrojs/rss, Pagefind search, Sharp image pipeline. Zero client-side JS by default.

## Development

```
npm install
npm run dev
npm run build   # postbuild runs Pagefind indexing
```

Data pipeline scripts live in `scripts/` and write to `data/`. Raw API responses are cached in `data/cache/` (gitignored, regenerable).
