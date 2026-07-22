// Decade-of-death bucketing for the person-centric /decade/ browse axis.
// death_year comes straight from Wikidata (may be negative for BCE dates,
// e.g. Egyptian pharaohs reinterred/documented at a modern cemetery record).
// Bucketing math (Math.floor) is direction-correct for negative years too;
// only the display slug/label need a BCE-aware format so URLs stay
// hyphen-safe and the label reads honestly instead of showing a bare minus.

export function decadeOf(year: number | null): number | null {
  if (year === null) return null;
  return Math.floor(year / 10) * 10;
}

export function decadeSlug(decade: number): string {
  return decade < 0 ? `${Math.abs(decade)}s-bce` : `${decade}s`;
}

export function decadeLabel(decade: number): string {
  return decade < 0 ? `${Math.abs(decade)}s BCE` : `${decade}s`;
}
