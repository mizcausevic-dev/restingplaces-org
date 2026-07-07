// Data-driven hub intros. Every number and name comes from the records
// being listed on the page; nothing is asserted that the data does not show.

type Cem = {
  name: string;
  established_year: number | null;
  notable_interments_total: number;
};

export function hubIntro(scopeLabel: string, cems: Cem[]): string {
  const n = cems.length;
  const parts = [`This directory documents ${n} ${n === 1 ? 'cemetery' : 'cemeteries'} ${scopeLabel}.`];

  const withGraves = cems.filter((c) => c.notable_interments_total > 0);
  if (withGraves.length > 0) {
    const top = [...withGraves].sort((a, b) => b.notable_interments_total - a.notable_interments_total)[0];
    parts.push(
      `${withGraves.length} of them hold documented notable interments; the most documented is ${top.name} with ${top.notable_interments_total}.`
    );
  }

  const years = cems.map((c) => c.established_year).filter((y): y is number => y !== null);
  if (years.length >= 3) {
    parts.push(`Recorded founding dates run from ${Math.min(...years)} to ${Math.max(...years)}.`);
  }

  parts.push('Every fact is sourced from Wikidata and linked to its record.');
  return parts.join(' ');
}
