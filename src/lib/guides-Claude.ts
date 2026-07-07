// Guide definitions. Each selector runs over the real collection at build
// time; each intro is written for that specific guide, in the site's
// dignified register. No guide asserts anything its listed data cannot show.

type Cem = any;

export const GUIDES: Record<
  string,
  { title: string; h1: string; intro: string; select: (all: Cem[]) => Cem[] }
> = {
  'most-documented-notable-interments': {
    title: 'Cemeteries with the most documented notable interments',
    h1: 'The most documented resting places',
    intro:
      'Some cemeteries hold so many public figures that they read as a national biography. This list ranks the burial grounds in our directory by the number of notable interments recorded in Wikidata, where each person has a Wikipedia article and a documented place of burial. The counts reflect documentation, not importance: a well-recorded municipal cemetery can outrank a royal crypt.',
    select: (all) =>
      all
        .filter((c) => c.notable_interments_total > 0)
        .sort((a, b) => b.notable_interments_total - a.notable_interments_total)
        .slice(0, 25),
  },
  'oldest-documented-cemeteries': {
    title: 'The oldest documented cemeteries',
    h1: 'The oldest documented cemeteries',
    intro:
      'These are the burial grounds in our directory with the earliest recorded founding dates in Wikidata, from ancient necropoleis to medieval churchyards. A caution on reading them: a founding date this old is usually an archaeological or historiographical estimate attached to the source record, and many old grounds have no recorded date at all, so absence from this list means missing data, not youth.',
    select: (all) =>
      all
        .filter((c) => c.established_year !== null)
        .sort((a, b) => a.established_year - b.established_year)
        .slice(0, 30),
  },
  'historic-garden-cemeteries': {
    title: 'Historic garden cemeteries of the world',
    h1: 'Historic garden cemeteries',
    intro:
      'The garden cemetery movement of the early 1800s replaced crowded churchyards with landscaped grounds meant for walking, mourning, and public life at once. Père Lachaise in Paris set the pattern in 1804 and cities across Europe and the Americas followed. These are the cemeteries in our directory whose source records place them in that tradition.',
    select: (all) =>
      all.filter((c) => c.type.includes('garden-rural')).sort((a, b) => b.notable_interments_total - a.notable_interments_total),
  },
  'heritage-listed-cemeteries': {
    title: 'Heritage-listed cemeteries',
    h1: 'Heritage-listed cemeteries',
    intro:
      'A heritage listing recognizes a cemetery as a cultural site in its own right: its monuments, its landscape design, or its place in a community’s history. The cemeteries here carry a recorded heritage designation in Wikidata, from the US National Register of Historic Places to national monument registers elsewhere. The 40 with the most documented notable interments are listed.',
    select: (all) =>
      all.filter((c) => c.heritage_id !== null).sort((a, b) => b.notable_interments_total - a.notable_interments_total).slice(0, 40),
  },
  'national-cemeteries-and-war-graves': {
    title: 'National cemeteries and war grave sites',
    h1: 'National cemeteries and war graves',
    intro:
      'National and military cemeteries carry a particular weight: they are where countries formalize remembrance. This list covers the grounds in our directory recorded as national cemeteries, military cemeteries, or war grave sites, ranked by documented notable interments. Visiting information should always be confirmed with the site itself, as commemorations affect access.',
    select: (all) =>
      all.filter((c) => c.type.includes('national-military')).sort((a, b) => b.notable_interments_total - a.notable_interments_total).slice(0, 40),
  },
};
