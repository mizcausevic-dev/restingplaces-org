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
  person_slug: z.string().min(1),
  known_for: z.string().nullable(),
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
    has_notable_interments: z.boolean(),
    photo: photo.nullable(),
    google_place_id: z.string().nullable(),
    hours: hours.nullable(), // freshness-gated: null unless live-fetched
    short_desc: z.string().min(1),
    history: z.string().nullable(),
    related_slugs: z.array(z.string()),
    seed_sublists: z.array(z.string()),
    classification_source: z.literal('generated'),
    classification_reviewed: z.boolean(),
  }),
});

export const collections = { cemeteries };
