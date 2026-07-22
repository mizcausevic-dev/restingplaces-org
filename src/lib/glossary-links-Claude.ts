// Per-cemetery glossary cross-references for /cemeteries/[slug]/. Deliberately
// data-driven: every link below is decided from the cemetery's own real
// fields, never from scanning body copy for keyword matches. See
// src/data/glossary-Claude.ts for why the term set is this narrow.

import { GLOSSARY, type GlossaryTerm } from '../data/glossary-Claude';

type Cem = {
  type: string[];
  heritage_id: string | null;
  notable_interments_total: number;
  name: string;
  name_variants: string[];
};

const BY_SLUG = new Map(GLOSSARY.map((t) => [t.slug, t]));

function has(slug: string): GlossaryTerm {
  const t = BY_SLUG.get(slug);
  if (!t) throw new Error(`glossary-links-Claude: unknown glossary slug "${slug}"`);
  return t;
}

// Real textual match only: does the cemetery's own recorded name or a
// recorded name variant literally contain the word. Not a blanket
// category assumption from the (much broader) historic-heritage type
// bucket or the seed_sublists scrape source list.
function nameMentions(cem: Cem, word: string): boolean {
  const haystack = [cem.name, ...cem.name_variants].join(' ').toLowerCase();
  return haystack.includes(word);
}

export function relatedGlossaryTerms(cem: Cem): GlossaryTerm[] {
  const terms: GlossaryTerm[] = [];
  const add = (slug: string) => {
    const t = has(slug);
    if (!terms.includes(t)) terms.push(t);
  };

  if (cem.type.includes('national-military')) add('war-grave');

  const isNrhp = cem.heritage_id?.startsWith('NRHP') ?? false;
  if (isNrhp) {
    add('nrhp');
  } else if (cem.type.includes('historic-heritage') || cem.heritage_id) {
    add('heritage-status');
  }

  if (nameMentions(cem, 'necropolis')) add('necropolis');
  if (nameMentions(cem, 'catacomb')) add('catacombs');
  if (nameMentions(cem, 'ossuary')) add('ossuary');

  if (cem.notable_interments_total > 0) {
    add('notable-interment');
    add('interment');
  }

  return terms;
}
