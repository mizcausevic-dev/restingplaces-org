// Glossary term definitions for /glossary/. Plain exported data, no external
// dependencies, following the pattern in src/lib/guides-Claude.ts.
//
// Cross-linking is deliberately narrow: only three terms map onto real
// per-cemetery classification data (the /type/national-military/ and
// /type/historic-heritage/ hubs), so only those three carry a relatedHub.
// Every other term is definition-only. Do not add a hub link for a term
// that has no supporting per-cemetery data, and do not invent new hub pages.

export type GlossaryTerm = {
  slug: string;
  term: string;
  definition: string;
  relatedHub?: {
    label: string;
    href: string;
    note: string;
  };
};

// Alphabetical by term. Keep it that way; the page renders in this order.
export const GLOSSARY: GlossaryTerm[] = [
  {
    slug: 'catacombs',
    term: 'Catacombs',
    definition:
      'Underground networks of tunnels and galleries with burial recesses cut into the walls, historically used where surface burial space was scarce.',
    relatedHub: {
      label: 'Historic and heritage cemeteries',
      href: '/type/historic-heritage/',
      note: 'That hub groups the broader historic-and-heritage category. It overlaps catacombs only partly, through a classification-name match and recorded heritage status, and is not an exact list of them.',
    },
  },
  {
    slug: 'cenotaph',
    term: 'Cenotaph',
    definition:
      'A monument honoring someone whose body is buried elsewhere or was never recovered. The defining feature is that no remains are actually interred there, the opposite of a mausoleum.',
  },
  {
    slug: 'columbarium',
    term: 'Columbarium',
    definition:
      'A structure or wall of small individual niches built specifically to hold urns of cremated remains. Not a general burial structure; the defining feature is that it houses ashes, not bodies or bones.',
  },
  {
    slug: 'crypt',
    term: 'Crypt',
    definition:
      'An underground vaulted chamber, typically beneath a church floor or within a mausoleum, used for burial. Usually a single chamber under one building, smaller in scope than a catacomb complex.',
  },
  {
    slug: 'garden-cemetery-movement',
    term: 'Garden Cemetery Movement',
    definition:
      'A 19th-century design movement, beginning with Paris\'s Père Lachaise and spreading to Britain and the US as "rural cemeteries," that laid out burial grounds as landscaped parks with paths and plantings rather than crowded churchyard plots.',
  },
  {
    slug: 'heritage-status',
    term: 'Heritage Status',
    definition:
      "An official designation recognizing a site's historical, architectural, or cultural significance, granted by a national or regional authority. The specific body and criteria vary by country.",
    relatedHub: {
      label: 'Historic and heritage cemeteries',
      href: '/type/historic-heritage/',
      note: 'That hub groups the broader historic-and-heritage category. It overlaps heritage status only partly, through a classification-name match and recorded heritage status, and is not an exact list of every site that holds it.',
    },
  },
  {
    slug: 'inhumation',
    term: 'Inhumation',
    definition: 'Ground burial specifically, as distinct from entombment in a crypt or mausoleum.',
  },
  {
    slug: 'interment',
    term: 'Interment',
    definition: 'The act of burying a body, whether in the ground or placed in a tomb or vault.',
  },
  {
    slug: 'mausoleum',
    term: 'Mausoleum',
    definition:
      'A free-standing, above-ground structure built to enclose one or more entombed remains, usually stone-built with a sealed interior chamber rather than an open room.',
  },
  {
    slug: 'nrhp',
    term: 'National Register of Historic Places (NRHP)',
    definition:
      'The official US federal list of districts, sites, buildings, structures, and objects recognized as historically significant. On this site, a cemetery whose recorded heritage status begins with "NRHP" carries a listing on this specific register.',
  },
  {
    slug: 'necropolis',
    term: 'Necropolis',
    definition:
      'Literally "city of the dead": a large, often ancient burial ground, typically with elaborate tombs or monuments, distinct in scale and formality from an ordinary local cemetery.',
    relatedHub: {
      label: 'Historic and heritage cemeteries',
      href: '/type/historic-heritage/',
      note: 'That hub groups the broader historic-and-heritage category. It overlaps necropolises only partly, through a classification-name match and recorded heritage status, and is not an exact list of them.',
    },
  },
  {
    slug: 'notable-interment',
    term: 'Notable interment',
    definition:
      'This site\'s own term, used throughout its generated cemetery descriptions, for a person buried at a location whose Wikidata record clears the site\'s notability threshold: an English Wikipedia article, a recorded death date, and a documented place of burial. It is a sourcing threshold, not an editorial judgment about who "deserves" the label.',
  },
  {
    slug: 'obelisk',
    term: 'Obelisk',
    definition:
      'A tall, four-sided, tapering stone pillar topped with a pyramidal point, used in cemeteries as a monument or marker form. It commemorates but does not itself hold remains, unlike a mausoleum.',
  },
  {
    slug: 'ossuary',
    term: 'Ossuary',
    definition:
      'A container or room built specifically to hold the bones of the dead after decomposition, often when an original grave was reused. It holds skeletal remains only, not full-body burials or cremated ash, which distinguishes it from a crypt or columbarium.',
  },
  {
    slug: 'potters-field',
    term: "Potter's Field",
    definition:
      'A burial ground specifically for the unidentified, indigent, or unclaimed dead, historically maintained at public expense.',
  },
  {
    slug: 'war-grave',
    term: 'War Grave',
    definition:
      'The grave of someone who died in military service, usually maintained under a formal government or commemorative program rather than a private family plot.',
    relatedHub: {
      label: 'National and military cemeteries',
      href: '/type/national-military/',
      note: 'That hub groups the broader national-and-military category, not war graves specifically.',
    },
  },
];
