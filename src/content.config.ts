import { defineCollection, z } from 'astro:content';
import { file } from 'astro/loaders';

// No-fabrication guard at the data layer: every entry is validated against
// this schema at build time. A field that did not resolve from a licensed
// source is null, never invented. Build fails on violation.

const coordinates = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const interment = z.object({
  person_name: z.string().min(1),
  person_qid: z.string().regex(/^Q\d+$/),
  person_slug: z.string().nullable(), // null when below the /buried/ page tier
  known_for: z.string().nullable(),
  nationality: z.string().nullable(),
  birth_year: z.number().int().nullable(),
  death_year: z.number().int().nullable(),
});

const photo = z.object({
  url: z.string().url(),
  license: z.enum(['PD', 'CC0', 'CC BY', 'CC BY-SA']),
  license_url: z.string().url().nullable(),
  credit: z.string(),
  source: z.string().url(),
  share_alike: z.boolean(),
});

const hours = z.object({
  weekday_text: z.array(z.string()),
  last_checked: z.string(), // ISO date, only ever set from a live API response
  source: z.literal('google-places'),
});

const cemeteryType = z.enum([
  'national-military',
  'religious-churchyard',
  'historic-heritage',
  'garden-rural',
  'natural-green-burial',
  'municipal-public',
  'private',
]);

const era = z.enum(['pre-1800', '1800s', 'early-1900s', 'mid-1900s', 'contemporary']);

const cemeteries = defineCollection({
  loader: file('data/cemeteries-Claude.json'),
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    name_variants: z.array(z.string()),
    country: z.string().nullable(),
    country_slug: z.string().nullable(),
    country_iso2: z.string().length(2).nullable(), // null for historical/colonial entities with no modern ISO code
    continents: z.array(z.object({ label: z.string(), slug: z.string() })), // real Wikidata P30 values, may be 0-3
    region: z.string().nullable(),
    region_slug: z.string().nullable(),
    city: z.string().nullable(),
    city_slug: z.string().nullable(),
    coordinates: coordinates.nullable(),
    coordinates_source: z.enum(['wikidata', 'nominatim']).nullable(),
    established_year: z.number().int().nullable(),
    type: z.array(cemeteryType),
    era: era.nullable(),
    area_hectares: z.number().nullable(),
    wikidata_qid: z.string().regex(/^Q\d+$/),
    wikipedia_url: z.string().url().nullable(),
    osm_id: z.string().nullable(),
    heritage_id: z.string().nullable(),
    official_website: z.string().url().nullable(),
    findagrave_url: z.string().url().nullable(), // link-out only, never scraped
    notable_interments: z.array(interment),
    notable_interments_total: z.number().int(),
    has_notable_interments: z.boolean(),
    occupation_breakdown: z.array(
      z.object({
        label: z.string().min(1),
        count: z.number().int().min(2),
        pct: z.number().int().min(0).max(100),
      })
    ),
    photo: photo.nullable(),
    gallery: z.array(photo).max(3), // capped multi-image gallery, see gallery-Claude.mjs; [] when no P373 category or nothing passed the gate
    google_place_id: z.string().nullable(),
    hours: hours.nullable(), // freshness-gated: null unless live-fetched
    short_desc: z.string().min(1),
    history: z.string().nullable(),
    related_slugs: z.array(z.string()),
    // Genuinely distance-based supplement to related_slugs (which scores by
    // shared country/region/type/era, not real geography). Null when this
    // cemetery itself has no coordinates; a distance can't be claimed to or
    // from an unlocated place.
    nearby_slugs: z
      .array(
        z.object({
          slug: z.string().min(1),
          distance_km: z.number().min(0),
        })
      )
      .nullable(),
    seed_sublists: z.array(z.string()),
    classification_source: z.literal('generated'),
    classification_reviewed: z.boolean(),
  }),
});

const persons = defineCollection({
  loader: file('data/buried-Claude.json'),
  schema: z.object({
    slug: z.string().min(1),
    name: z.string().min(1),
    qid: z.string().regex(/^Q\d+$/),
    birth_year: z.number().int().nullable(),
    death_year: z.number().int().nullable(),
    known_for: z.string().nullable(),
    sitelinks: z.number().int(),
    wikipedia_url: z.string().url().nullable(),
    cemetery_slug: z.string().min(1),
    cemetery_name: z.string().min(1),
    cemetery_city: z.string().nullable(),
    cemetery_region: z.string().nullable(),
    cemetery_country: z.string().nullable(),
    cemetery_coordinates: coordinates.nullable(),
  }),
});

export const collections = { cemeteries, persons };
